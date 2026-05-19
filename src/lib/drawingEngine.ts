export type DrawingMode = 'airbrush' | 'sdf_circle' | 'smudge';

export interface DrawingOptions {
  mode: DrawingMode;
  size: number; // 1-100
  opacity: number; // 0-1
  color: { r: number, g: number, b: number }; // 0-1
}

const QUAD_VERT = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_base;
uniform sampler2D u_draw;
uniform int u_blendMode;
uniform float u_layerOpacity;
out vec4 outColor;

void main() {
    vec4 base = texture(u_base, vec2(v_uv.x, 1.0 - v_uv.y));
    vec4 draw = texture(u_draw, v_uv);
    
    vec3 result = base.rgb;
    float alpha = draw.a * u_layerOpacity;
    
    if (alpha <= 0.0) {
        outColor = vec4(base.rgb * base.a, base.a);
        return;
    }
    
    // De-premultiply drawing color before blending
    vec3 drawColor = draw.rgb / max(draw.a, 0.0001);
    
    if (u_blendMode == 0) { // Normal
        result = mix(base.rgb, drawColor, alpha);
    } else if (u_blendMode == 1) { // Multiply
        result = mix(base.rgb, base.rgb * drawColor, alpha);
    } else if (u_blendMode == 2) { // Screen
        result = mix(base.rgb, 1.0 - (1.0 - base.rgb) * (1.0 - drawColor), alpha);
    } else if (u_blendMode == 3) { // Overlay
        vec3 less = 2.0 * base.rgb * drawColor;
        vec3 more = 1.0 - 2.0 * (1.0 - base.rgb) * (1.0 - drawColor);
        vec3 overlay = mix(less, more, step(0.5, base.rgb));
        result = mix(base.rgb, overlay, alpha);
    } else if (u_blendMode == 4) { // Add
        result = base.rgb + drawColor * alpha;
    } else if (u_blendMode == 5) { // Mask/Alpha
        result = base.rgb * (1.0 - alpha);
    }
    
    float finalAlpha = max(base.a, alpha);
    outColor = vec4(result * finalAlpha, finalAlpha);
}
`;

const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
out vec4 outColor;
void main() {
    outColor = texture(u_texture, v_uv);
}
`;

const BRUSH_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_radius;
uniform vec4 u_color;
uniform int u_mode;
uniform float u_feather;

out vec4 outColor;

void main() {
    vec2 p = v_uv * u_resolution;
    float d = length(p - u_center);
    float alpha = 0.0;
    
    if (u_mode == 0) {
        float softness = max(u_radius * u_radius * 0.5, 0.1);
        alpha = exp(-(d * d) / softness) * u_color.a;
    } else if (u_mode == 1) {
        float distToEdge = d - u_radius;
        alpha = smoothstep(u_feather, 0.0, distToEdge) * u_color.a;
    }
    
    outColor = vec4(u_color.rgb * alpha, alpha);
}
`;

const SMUDGE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec2 u_cursor;
uniform vec2 u_prev_cursor;
uniform float u_radius;
uniform float u_opacity;

out vec4 outColor;

void main() {
    vec2 velocity = u_cursor - u_prev_cursor;
    vec2 p = v_uv * u_resolution;
    float d = length(p - u_cursor);
    
    float softness = max(u_radius * u_radius * 0.5, 0.1);
    float weight = exp(-(d * d) / softness);
    
    vec2 offset = -(velocity / u_resolution) * weight * u_opacity;
    outColor = texture(u_texture, v_uv + offset);
}
`;

function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Create shader failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        throw new Error('Shader compilation failed');
    }
    return shader;
}

function createProgram(gl: WebGL2RenderingContext, vertSource: string, fragSource: string) {
    const program = gl.createProgram();
    if (!program) throw new Error('Create program failed');
    const vert = createShader(gl, gl.VERTEX_SHADER, vertSource);
    const frag = createShader(gl, gl.FRAGMENT_SHADER, fragSource);
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(program));
        throw new Error('Program link failed');
    }
    return program;
}

export class DrawingEngine {
    gl: WebGL2RenderingContext;
    programs = { copy: null as any, brush: null as any, smudge: null as any, composite: null as any };
    quadVao: WebGLVertexArrayObject | null = null;
    
    textures = { main: null as any, scratch: null as any, undo: null as any, redo: null as any, base: null as any };
    fbos = { main: null as any, scratch: null as any, undo: null as any, redo: null as any };
    
    width: number;
    height: number;
    
    undoValid = false;
    redoValid = false;
    
    blendMode = 0;
    layerOpacity = 1.0;

    constructor(canvas: HTMLCanvasElement, width: number, height: number) {
        this.width = width;
        this.height = height;
        const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true });
        if (!gl) throw new Error('WebGL2 not supported');
        this.gl = gl;
        
        gl.viewport(0, 0, width, height);
        
        this.programs.copy = createProgram(gl, QUAD_VERT, COPY_FRAG);
        this.programs.composite = createProgram(gl, QUAD_VERT, COMPOSITE_FRAG);
        this.programs.brush = createProgram(gl, QUAD_VERT, BRUSH_FRAG);
        this.programs.smudge = createProgram(gl, QUAD_VERT, SMUDGE_FRAG);
        
        // Set up quad
        const positions = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
        const posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        this.quadVao = gl.createVertexArray();
        gl.bindVertexArray(this.quadVao);
        const posLoc = 0; // Assuming a_position is 0, best to query but fine for simple
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        
        // Init textures & FBOs
        ['main', 'scratch', 'undo', 'redo', 'base'].forEach((name) => {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            (this.textures as any)[name] = tex;
            
            if (name !== 'base') {
                const fbo = gl.createFramebuffer();
                gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
                (this.fbos as any)[name] = fbo;
            }
        });
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    
    destroy() {
        // cleanup gl resources
        const gl = this.gl;
        Object.values(this.programs).forEach(p => gl.deleteProgram(p));
        Object.values(this.textures).forEach(t => gl.deleteTexture(t));
        Object.values(this.fbos).forEach(f => gl.deleteFramebuffer(f));
        if (this.quadVao) gl.deleteVertexArray(this.quadVao);
    }

    clear() {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.main);
        gl.clearColor(0,0,0,0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    
    saveUndoState() {
        this.copyTexture(this.textures.main, this.fbos.undo);
        this.undoValid = true;
        this.redoValid = false;
    }
    
    undo() {
        if (!this.undoValid) return;
        this.copyTexture(this.textures.main, this.fbos.redo);
        this.copyTexture(this.textures.undo, this.fbos.main);
        this.redoValid = true;
        this.undoValid = false; // 1-step undo
        this.renderToScreen();
    }
    
    redo() {
        if (!this.redoValid) return;
        this.copyTexture(this.textures.main, this.fbos.undo);
        this.copyTexture(this.textures.redo, this.fbos.main);
        this.undoValid = true;
        this.redoValid = false;
        this.renderToScreen();
    }
    
    copyTexture(srcTex: WebGLTexture, dstFbo: WebGLFramebuffer) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
        gl.useProgram(this.programs.copy);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.uniform1i(gl.getUniformLocation(this.programs.copy, 'u_texture'), 0);
        gl.bindVertexArray(this.quadVao);
        gl.disable(gl.BLEND);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    
    updateBaseTexture(imgData: ImageData) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.textures.base);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgData);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // Restore
        this.renderToScreen();
    }
    
    updateCompositeSettings(mode: number, opacity: number) {
        if (this.blendMode !== mode || this.layerOpacity !== opacity) {
            this.blendMode = mode;
            this.layerOpacity = opacity;
            this.renderToScreen();
        }
    }
    
    renderToScreen(drawTexOverride?: WebGLTexture) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const drawTex = drawTexOverride || this.textures.main;
        
        gl.useProgram(this.programs.composite);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.base);
        gl.uniform1i(gl.getUniformLocation(this.programs.composite, 'u_base'), 0);
        
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, drawTex);
        gl.uniform1i(gl.getUniformLocation(this.programs.composite, 'u_draw'), 1);
        
        gl.uniform1i(gl.getUniformLocation(this.programs.composite, 'u_blendMode'), this.blendMode);
        gl.uniform1f(gl.getUniformLocation(this.programs.composite, 'u_layerOpacity'), this.layerOpacity);
        
        gl.bindVertexArray(this.quadVao);
        
        // Use blending when drawing onto the screen canvas?
        // Actually, the webgl canvas itself sits with background transparent, 
        // so we can just replace. The browser composites WebGL onto DOM.
        // Wait, WebGL canvas needs to output its alpha properly so browser composites it.
        // Clear screen canvas first 
        gl.clearColor(0,0,0,0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.disable(gl.BLEND);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    
    // Call this repeatedly for airbrush during mouse down + movement
    drawBrush(opts: DrawingOptions, center: {x:number, y:number}, radiusOverride?: number) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.main);
        gl.useProgram(this.programs.brush);
        
        gl.bindVertexArray(this.quadVao);
        gl.enable(gl.BLEND);
        // Premultiplied alpha blending
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        
        const locRes = gl.getUniformLocation(this.programs.brush, 'u_resolution');
        const locCenter = gl.getUniformLocation(this.programs.brush, 'u_center');
        const locRadius = gl.getUniformLocation(this.programs.brush, 'u_radius');
        const locColor = gl.getUniformLocation(this.programs.brush, 'u_color');
        const locMode = gl.getUniformLocation(this.programs.brush, 'u_mode');
        const locFeather = gl.getUniformLocation(this.programs.brush, 'u_feather');
        
        gl.uniform2f(locRes, this.width, this.height);
        // Map top-left coords to WebGL bottom-left coords
        gl.uniform2f(locCenter, center.x, this.height - center.y);
        gl.uniform1f(locRadius, radiusOverride || opts.size);
        gl.uniform4f(locColor, opts.color.r, opts.color.g, opts.color.b, opts.opacity);
        gl.uniform1i(locMode, opts.mode === 'airbrush' ? 0 : 1);
        gl.uniform1f(locFeather, opts.mode === 'sdf_circle' ? 2.0 : 0.0);
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        this.renderToScreen();
    }
    
    // For SDF circle preview during drag
    previewSdfCircle(opts: DrawingOptions, center: {x:number, y:number}, radius: number) {
        // copy main to scratch
        this.copyTexture(this.textures.main, this.fbos.scratch);
        
        // draw brush onto scratch
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.scratch);
        gl.useProgram(this.programs.brush);
        gl.bindVertexArray(this.quadVao);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        
        gl.uniform2f(gl.getUniformLocation(this.programs.brush, 'u_resolution'), this.width, this.height);
        gl.uniform2f(gl.getUniformLocation(this.programs.brush, 'u_center'), center.x, this.height - center.y);
        gl.uniform1f(gl.getUniformLocation(this.programs.brush, 'u_radius'), radius);
        gl.uniform4f(gl.getUniformLocation(this.programs.brush, 'u_color'), opts.color.r, opts.color.g, opts.color.b, opts.opacity);
        gl.uniform1i(gl.getUniformLocation(this.programs.brush, 'u_mode'), 1);
        gl.uniform1f(gl.getUniformLocation(this.programs.brush, 'u_feather'), 2.0);
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        // render scratch to screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.renderToScreen(this.textures.scratch);
    }
    
    // Discards preview and simply renders main to screen
    cancelPreview() {
        this.renderToScreen();
    }
    
    drawSmudge(opts: DrawingOptions, current: {x:number, y:number}, prev: {x:number, y:number}) {
        const gl = this.gl;
        
        // Render from main to scratch using smudge shader
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.scratch);
        gl.useProgram(this.programs.smudge);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.main);
        
        gl.bindVertexArray(this.quadVao);
        gl.disable(gl.BLEND);
        
        const locTex = gl.getUniformLocation(this.programs.smudge, 'u_texture');
        const locRes = gl.getUniformLocation(this.programs.smudge, 'u_resolution');
        const locCursor = gl.getUniformLocation(this.programs.smudge, 'u_cursor');
        const locPrev = gl.getUniformLocation(this.programs.smudge, 'u_prev_cursor');
        const locRadius = gl.getUniformLocation(this.programs.smudge, 'u_radius');
        const locOpac = gl.getUniformLocation(this.programs.smudge, 'u_opacity');
        
        gl.uniform1i(locTex, 0);
        gl.uniform2f(locRes, this.width, this.height);
        gl.uniform2f(locCursor, current.x, this.height - current.y);
        gl.uniform2f(locPrev, prev.x, this.height - prev.y);
        gl.uniform1f(locRadius, opts.size);
        gl.uniform1f(locOpac, opts.opacity); // smudge strength
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        // Swap main and scratch
        const tempTex = this.textures.main;
        this.textures.main = this.textures.scratch;
        this.textures.scratch = tempTex;
        
        const tempFbo = this.fbos.main;
        this.fbos.main = this.fbos.scratch;
        this.fbos.scratch = tempFbo;
        
        this.renderToScreen();
    }

    serializeComposite(): string {
        const gl = this.gl;
        
        const compTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, compTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        
        const compFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, compFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, compTex, 0);
        
        gl.useProgram(this.programs.composite);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.base);
        gl.uniform1i(gl.getUniformLocation(this.programs.composite, 'u_base'), 0);
        
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.main);
        gl.uniform1i(gl.getUniformLocation(this.programs.composite, 'u_draw'), 1);
        
        gl.uniform1i(gl.getUniformLocation(this.programs.composite, 'u_blendMode'), this.blendMode);
        gl.uniform1f(gl.getUniformLocation(this.programs.composite, 'u_layerOpacity'), this.layerOpacity);
        
        gl.bindVertexArray(this.quadVao);
        gl.clearColor(0,0,0,0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.BLEND);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        const data = new Uint8Array(this.width * this.height * 4);
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        
        // Flip Y for ImageData compatibility
        const stride = this.width * 4;
        const halfHeight = Math.floor(this.height / 2);
        for (let y = 0; y < halfHeight; y++) {
            const topOffset = y * stride;
            const bottomOffset = (this.height - y - 1) * stride;
            for (let i = 0; i < stride; i++) {
                const temp = data[topOffset + i];
                data[topOffset + i] = data[bottomOffset + i];
                data[bottomOffset + i] = temp;
            }
        }
        
        gl.deleteTexture(compTex);
        gl.deleteFramebuffer(compFbo);
        
        // Chunk to avoid call stack size limits or slow string concats
        const CHUNK_SZ = 0x8000;
        const c = [];
        for (let i = 0; i < data.length; i += CHUNK_SZ) {
            c.push(String.fromCharCode.apply(null, Array.from(data.subarray(i, i + CHUNK_SZ))));
        }
        return btoa(c.join(''));
    }

    serialize(): string {
        const gl = this.gl;
        // Bind main fbo and read pixels
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.main);
        const data = new Uint8Array(this.width * this.height * 4);
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        
        // Chunk to avoid call stack size limits or slow string concats
        const CHUNK_SZ = 0x8000;
        const c = [];
        for (let i = 0; i < data.length; i += CHUNK_SZ) {
            c.push(String.fromCharCode.apply(null, Array.from(data.subarray(i, i + CHUNK_SZ))));
        }
        return btoa(c.join(''));
    }
    
    deserialize(base64: string) {
        try {
            const bin = atob(base64);
            const data = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) {
                data[i] = bin.charCodeAt(i);
            }
            const gl = this.gl;
            gl.bindTexture(gl.TEXTURE_2D, this.textures.main);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
            this.renderToScreen();
        } catch (e) {
            console.error('Failed to load drawing layer', e);
        }
    }
}
