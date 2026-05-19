import { Keyframe } from '../types';

export type InterpMode = 'linear' | 'cubic' | 'constant';

export function computeTangents(data: Keyframe[]): number[] {
  const n = data.length;
  const tangents = new Array(n).fill(0);
  if (n < 2) return tangents;
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tangents[i] = (data[1].value - data[0].value) / Math.max(0.0001, data[1].time - data[0].time);
    } else if (i === n - 1) {
      tangents[i] = (data[i].value - data[i-1].value) / Math.max(0.0001, data[i].time - data[i-1].time);
    } else {
      // Catmull-Rom / average secant (Auto tangency)
      tangents[i] = (data[i+1].value - data[i-1].value) / Math.max(0.0001, data[i+1].time - data[i-1].time);
    }
  }
  return tangents;
}

export function evaluateCurve(keyframes: Keyframe[], tangents: number[], t: number, interpMode: InterpMode): number {
  const n = keyframes.length;
  if (n === 0) return 0;
  if (n === 1) return keyframes[0].value;
  
  if (t <= keyframes[0].time) return keyframes[0].value;
  if (t >= keyframes[n - 1].time) return keyframes[n - 1].value;
  
  for (let i = 0; i < n - 1; i++) {
    const k1 = keyframes[i];
    const k2 = keyframes[i + 1];
    if (t >= k1.time && t <= k2.time) {
      const dx = k2.time - k1.time;
      if (dx <= 0) return k1.value;
      
      const tNorm = (t - k1.time) / dx;
      
      if (interpMode === 'constant') {
        return k1.value;
      } else if (interpMode === 'linear') {
        return k1.value + (k2.value - k1.value) * tNorm;
      } else {
        const t2 = tNorm * tNorm;
        const t3 = t2 * tNorm;
        
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + tNorm;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        
        const m0 = tangents[i];
        const m1 = tangents[i + 1];
        
        return h00 * k1.value + h10 * dx * m0 + h01 * k2.value + h11 * dx * m1;
      }
    }
  }
  return 0;
}

import { ColorCurve } from '../types';

export function blendCurves(c1: ColorCurve, c2: ColorCurve, blendT: number, interpMode: InterpMode): ColorCurve {
  const getTimes = (arr: Keyframe[]) => arr.map(k => k.time);
  
  const blendChannel = (ch1: Keyframe[], ch2: Keyframe[]) => {
    const times = Array.from(new Set([...getTimes(ch1), ...getTimes(ch2)])).sort((a,b) => a - b);
    const t1 = computeTangents(ch1);
    const t2 = computeTangents(ch2);
    
    return times.map(time => {
      const val1 = evaluateCurve(ch1, t1, time, interpMode);
      const val2 = evaluateCurve(ch2, t2, time, interpMode);
      return {
        time,
        value: val1 + (val2 - val1) * blendT
      };
    });
  };
  
  return {
    r: blendChannel(c1.r, c2.r),
    g: blendChannel(c1.g, c2.g),
    b: blendChannel(c1.b, c2.b),
    a: blendChannel(c1.a, c2.a),
  };
}

export function blendSpaceCurves(curves: { position: number, curve: ColorCurve }[], position: number, interpMode: InterpMode): ColorCurve {
  if (curves.length === 0) return { r:[], g:[], b:[], a:[] };
  if (curves.length === 1) return curves[0].curve;
  
  const sorted = [...curves].sort((a, b) => a.position - b.position);
  if (position <= sorted[0].position) return sorted[0].curve;
  if (position >= sorted[sorted.length - 1].position) return sorted[sorted.length - 1].curve;
  
  for (let i = 0; i < sorted.length - 1; i++) {
    const c1 = sorted[i];
    const c2 = sorted[i+1];
    if (position >= c1.position && position <= c2.position) {
      const dx = c2.position - c1.position;
      if (dx <= 0) return c1.curve;
      const tNorm = (position - c1.position) / dx;
      return blendCurves(c1.curve, c2.curve, tNorm, interpMode);
    }
  }
  
  return sorted[0].curve;
}
