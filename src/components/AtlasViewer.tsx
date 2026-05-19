import React, { useEffect, useRef, useState } from 'react';
import { LibraryCurve } from '../types';
import { InterpMode, computeTangents, evaluateCurve, blendSpaceCurves } from '../lib/curveUtils';
import { DrawingLayer, DrawingLayerRef } from './DrawingLayer';
import { DrawingOptions, DrawingMode } from '../lib/drawingEngine';
import { Undo, Redo, Brush, Circle, Droplet, Trash2, Eye, EyeOff, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AtlasViewerProps {
  curves: LibraryCurve[];
  interpMode: InterpMode;
  spaceLever: number;
  setSpaceLever: (val: number) => void;
  wrapSpace: boolean;
  setWrapSpace: (val: boolean) => void;
  loopBlend: number;
  setLoopBlend: (val: number) => void;
  isDrawingMode: boolean;
  setIsDrawingMode: (val: boolean) => void;
  onTextureUpdate?: (tex: ImageData) => void;
}

const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16) / 255.0,
        g: parseInt(result[2], 16) / 255.0,
        b: parseInt(result[3], 16) / 255.0
    } : { r: 1, g: 1, b: 1 };
};

const rgbToHex = (r: number, g: number, b: number) => {
    const toHex = (c: number) => {
        const hex = Math.round(c * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const AtlasViewer: React.FC<AtlasViewerProps> = ({ curves, interpMode, spaceLever, setSpaceLever, wrapSpace, setWrapSpace, loopBlend, setLoopBlend, isDrawingMode, setIsDrawingMode, onTextureUpdate }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Drawing state
  const drawingLayerRef = useRef<DrawingLayerRef>(null);
  const [drawOptions, setDrawOptions] = useState<DrawingOptions>({
      mode: 'airbrush',
      size: 20,
      opacity: 0.5,
      color: { r: 1, g: 1, b: 1 }
  });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  
  const [blendMode, setBlendMode] = useState<number>(0);
  const [layerOpacity, setLayerOpacity] = useState<number>(1.0);
  const [drawVisible, setDrawVisible] = useState<boolean>(true);
  
  const [isDirty, setIsDirty] = useState(false);
  const [isExitDialogOpen, setIsExitDialogOpen] = useState(false);
  
  const [mergedAtlas, setMergedAtlas] = useState<string | null>(() => {
      try { return localStorage.getItem('drawing-merged-atlas') || null; } catch { return null; }
  });

  // Persist drawing content
  useEffect(() => {
     // load on mount
     const savedDrawing = localStorage.getItem('drawing-texture-content');
     if (savedDrawing && drawingLayerRef.current) {
         drawingLayerRef.current.deserialize(savedDrawing);
         setIsDirty(true);
     }
     
     const savedBlend = localStorage.getItem('drawing-blend-settings');
     if (savedBlend) {
         try {
             const { mode, opacity, visible } = JSON.parse(savedBlend);
             setBlendMode(mode ?? 0);
             setLayerOpacity(opacity ?? 1.0);
             setDrawVisible(visible ?? true);
         } catch(e) {}
     }
  }, []);
  
  useEffect(() => {
     drawingLayerRef.current?.updateCompositeSettings(blendMode, layerOpacity, drawVisible);
     localStorage.setItem('drawing-blend-settings', JSON.stringify({ mode: blendMode, opacity: layerOpacity, visible: drawVisible }));
  }, [blendMode, layerOpacity, drawVisible]);

  const handleSaveDrawing = () => {
      if (drawingLayerRef.current) {
          const data = drawingLayerRef.current.serialize();
          localStorage.setItem('drawing-texture-content', data);
      }
  };

  const [mergedAtlasImageData, setMergedAtlasImageData] = useState<ImageData | null>(null);

  // Parse mergedAtlas only when it changes
  useEffect(() => {
     if (mergedAtlas) {
         const binaryString = atob(mergedAtlas);
         const bytes = new Uint8ClampedArray(binaryString.length);
         for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
         setMergedAtlasImageData(new ImageData(bytes, 256, 256));
     } else {
         setMergedAtlasImageData(null);
     }
  }, [mergedAtlas]);

  const deferredCurves = React.useDeferredValue(curves);
  const deferredMergedAtlas = React.useDeferredValue(mergedAtlasImageData);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || deferredCurves.length === 0) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    const width = 256;
    const height = 256;
    
    if (deferredMergedAtlas) {
        ctx.putImageData(deferredMergedAtlas, 0, 0);
        drawingLayerRef.current?.updateBaseTexture(deferredMergedAtlas);
        // Defer slow state update until render is done
        setTimeout(() => onTextureUpdate?.(deferredMergedAtlas), 0);
        return;
    }

    // Pre-process all curves to avoid sorting and computing tangents in the inner loop
    const processedCurves = deferredCurves.map(c => {
        const sortedCurve = {
            r: [...c.curve.r].sort((a, b) => a.time - b.time),
            g: [...c.curve.g].sort((a, b) => a.time - b.time),
            b: [...c.curve.b].sort((a, b) => a.time - b.time),
            a: [...c.curve.a].sort((a, b) => a.time - b.time),
        };
        const tangents = {
            r: computeTangents(sortedCurve.r),
            g: computeTangents(sortedCurve.g),
            b: computeTangents(sortedCurve.b),
            a: computeTangents(sortedCurve.a)
        };
        return { position: c.position, sorted: sortedCurve, tangents };
    });
    // Ensure curves are sorted by position
    processedCurves.sort((a, b) => a.position - b.position);

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
        const tSpace = 1.0 - (y / (height - 1));
        
        let c1 = processedCurves[0];
        let c2 = processedCurves[processedCurves.length - 1];
        let blendT = 0;

        if (tSpace <= c1.position) {
            c2 = c1;
        } else if (tSpace >= c2.position) {
            c1 = c2;
        } else {
            for (let i = 0; i < processedCurves.length - 1; i++) {
                if (tSpace >= processedCurves[i].position && tSpace <= processedCurves[i+1].position) {
                    c1 = processedCurves[i];
                    c2 = processedCurves[i+1];
                    const dx = c2.position - c1.position;
                    blendT = dx > 0 ? (tSpace - c1.position) / dx : 0;
                    break;
                }
            }
        }

        for (let x = 0; x < width; x++) {
            const t = x / (width - 1);
            
            // Evaluate both curves
            const r1 = evaluateCurve(c1.sorted.r, c1.tangents.r, t, interpMode);
            const g1 = evaluateCurve(c1.sorted.g, c1.tangents.g, t, interpMode);
            const b1 = evaluateCurve(c1.sorted.b, c1.tangents.b, t, interpMode);
            const a1 = evaluateCurve(c1.sorted.a, c1.tangents.a, t, interpMode);

            let r = r1, g = g1, b = b1, a = a1;

            if (blendT > 0 && c1 !== c2) {
                const r2 = evaluateCurve(c2.sorted.r, c2.tangents.r, t, interpMode);
                const g2 = evaluateCurve(c2.sorted.g, c2.tangents.g, t, interpMode);
                const b2 = evaluateCurve(c2.sorted.b, c2.tangents.b, t, interpMode);
                const a2 = evaluateCurve(c2.sorted.a, c2.tangents.a, t, interpMode);

                r = r1 + (r2 - r1) * blendT;
                g = g1 + (g2 - g1) * blendT;
                b = b1 + (b2 - b1) * blendT;
                a = a1 + (a2 - a1) * blendT;
            }
            
            const idx = (y * width + x) * 4;
            data[idx] = Math.min(255, Math.max(0, r * 255));
            data[idx + 1] = Math.min(255, Math.max(0, g * 255));
            data[idx + 2] = Math.min(255, Math.max(0, b * 255));
            data[idx + 3] = Math.min(255, Math.max(0, a * 255));
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
    drawingLayerRef.current?.updateBaseTexture(imageData);
    // Defer slow state update until render is done
    setTimeout(() => onTextureUpdate?.(imageData), 0);
  }, [deferredCurves, interpMode, deferredMergedAtlas]);

  const handlePointer = (e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
      if (isDrawingMode) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
      const y = clientY - rect.top;
      const t = Math.max(0, Math.min(1, 1.0 - (y / rect.height)));
      setSpaceLever(t);
  };

  const handleExitRequest = () => {
   if (isDirty) {
       setIsExitDialogOpen(true);
   } else {
       setIsDrawingMode(false);
   }
  };

  const handleApplyToAtlas = () => {
   if (drawingLayerRef.current) {
       const data = drawingLayerRef.current.serializeComposite();
       localStorage.setItem('drawing-merged-atlas', data);
       setMergedAtlas(data);

       drawingLayerRef.current.clear();
       setIsDirty(false);
       if (isExitDialogOpen) {
           setIsExitDialogOpen(false);
           setIsDrawingMode(false);
       }
   }
  };

  const handleClearBakedAtlas = () => {
       localStorage.removeItem('drawing-merged-atlas');
       setMergedAtlas(null);
  };

  const handleDiscardLayer = () => {
     drawingLayerRef.current?.clear();
     setIsDirty(false);
     if (isExitDialogOpen) {
         setIsExitDialogOpen(false);
         setIsDrawingMode(false);
     }
  };

  const handleCancelExit = () => {
      setIsExitDialogOpen(false);
  };

  return (
    <div className="flex flex-col gap-8">
      {/* 2D Atlas Card */}
      <div className="flex flex-col gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-zinc-100 font-medium tracking-tight">2D Interpolation Atlas</h3>
        </div>
        
        <div className="w-full transition-all duration-300">
            <div className="flex gap-6 items-stretch">
              <div className="flex flex-col justify-between py-2 text-[10px] text-zinc-500 font-mono tracking-wider">
                  <span>1.0</span>
                  <span className="rotate-[-90deg] whitespace-nowrap">SPACE LEVER</span>
                  <span>0.0</span>
              </div>

              <div 
                className={`flex-1 relative aspect-square rounded-lg overflow-hidden border border-zinc-800 shadow-inner group ${isDrawingMode ? 'cursor-default' : 'cursor-crosshair'} touch-none`}
            onPointerDown={(e) => {
                if (!isDrawingMode) {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    handlePointer(e);
                }
            }}
            onPointerMove={(e) => {
                if (!isDrawingMode && e.buttons > 0) handlePointer(e);
            }}
            onPointerUp={() => { if (isDrawingMode) handleSaveDrawing(); }}
            style={{
              backgroundColor: '#09090b',
              backgroundImage: `
                linear-gradient(45deg, #18181b 25%, transparent 25%), 
                linear-gradient(-45deg, #18181b 25%, transparent 25%), 
                linear-gradient(45deg, transparent 75%, #18181b 75%), 
                linear-gradient(-45deg, transparent 75%, #18181b 75%)`,
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
            }}
          >
            <canvas 
              ref={canvasRef} 
              width={256} 
              height={256} 
              className="w-full h-full object-fill style-crisp-edges"
              style={{ imageRendering: 'pixelated' }}
            />
            
            <DrawingLayer 
              ref={drawingLayerRef}
              width={256}
              height={256}
              options={drawOptions}
              isDrawingMode={isDrawingMode}
              onUndoAvailable={setCanUndo}
              onRedoAvailable={setCanRedo}
              onChange={() => setIsDirty(true)}
            />
          </div>
        </div>
      </div>

      {/* Editor Card */}
      <div className="flex flex-col gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-medium">Atlas Editor</h2>
            
            <div className="flex items-center gap-4">
                {mergedAtlas && !isDrawingMode && (
                    <button 
                        onClick={handleClearBakedAtlas}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/10 transition-all shadow-[0_0_12px_rgba(16,185,129,0.1)]"
                        title="Revert to procedural curves"
                    >
                        Revert to Curves
                    </button>
                )}
                <button 
                    onClick={() => isDrawingMode ? handleExitRequest() : setIsDrawingMode(true)}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-all border ${
                      isDrawingMode 
                        ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/50" 
                        : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white hover:bg-zinc-700"
                    }`}
                >
                    {isDrawingMode ? "Exit Draw Mode" : "Enter Draw Mode"}
                </button>
            </div>
          </div>
          
          {isDrawingMode && (
              <div className="flex flex-col gap-4 bg-zinc-950 border border-zinc-800 rounded-xl p-4 shadow-inner">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-zinc-400" />
                        <h3 className="text-sm font-medium text-zinc-300">Draw Layer</h3>
                    </div>
                    <button 
                        onClick={() => setDrawVisible(!drawVisible)} 
                        className={`p-1.5 rounded-md transition-colors ${drawVisible ? 'text-zinc-300 hover:bg-zinc-800' : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800'}`}
                        title={drawVisible ? "Hide Layer" : "Show Layer"}
                    >
                        {drawVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                </div>
                
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1">
                        <select 
                            value={blendMode} 
                            onChange={(e) => setBlendMode(Number(e.target.value))}
                            className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-indigo-500 transition-colors"
                        >
                            <option value={0}>Normal</option>
                            <option value={1}>Multiply</option>
                            <option value={2}>Screen</option>
                        </select>
                        <div className="flex items-center gap-2 flex-1">
                            <span className="text-xs text-zinc-500">Opacity</span>
                            <input 
                                type="range" min="0" max="1" step="0.01" 
                                value={layerOpacity} 
                                onChange={(e) => setLayerOpacity(Number(e.target.value))} 
                                className="flex-1 max-w-[120px] h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                            />
                            <span className="text-xs text-zinc-400 font-mono w-8">{(layerOpacity*100).toFixed(0)}%</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={(e) => { e.preventDefault(); drawingLayerRef.current?.clear(); handleSaveDrawing(); }}
                            className="px-3 py-1.5 text-xs font-medium rounded-md text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors border border-transparent hover:border-red-500/20"
                        >
                            Clear
                        </button>
                        <button 
                            onClick={handleApplyToAtlas}
                            disabled={!isDirty}
                            className="px-3 py-1.5 text-xs font-medium rounded-md text-indigo-300 hover:bg-indigo-500/10 transition-colors border border-indigo-500/30 hover:border-indigo-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Apply to Atlas
                        </button>
                    </div>
                </div>
              </div>
          )}

          {!isDrawingMode && (
              <div className="flex items-center gap-4 bg-black border border-zinc-800 rounded-xl px-4 py-3 shadow-inner">
                <div className="flex flex-col flex-1 gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400 font-medium tracking-wide uppercase">Space Variant</span>
                    <div className="flex items-center gap-3">
                       <div className="flex items-center gap-2 mr-2">
                           <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Seamless Loop</span>
                           <input 
                               type="range"
                               min="0" max="0.5" step="0.01"
                               value={wrapSpace ? loopBlend : 0}
                               onChange={(e) => {
                                   const val = parseFloat(e.target.value);
                                   if (val > 0) {
                                       setWrapSpace(true);
                                       setLoopBlend(val);
                                   } else {
                                       setWrapSpace(false);
                                   }
                               }}
                               className="w-20 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                           />
                           <span className="text-[10px] text-zinc-400 font-mono w-6">
                               {wrapSpace ? `${Math.round(loopBlend * 200)}%` : 'Off'}
                           </span>
                       </div>
                       <span className="text-xs text-indigo-400 font-mono border-l border-zinc-800 pl-3">{(spaceLever * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Drawing Toolbar */}
          {isDrawingMode && (
              <div className="flex flex-wrap items-center justify-start gap-4 pt-4 border-t border-zinc-800">
             <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                <button
                   onClick={(e) => { e.preventDefault(); drawingLayerRef.current?.undo(); handleSaveDrawing(); }}
                   disabled={!canUndo}
                   className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 transition-all"
                   title="Undo"
                >
                    <Undo className="w-4 h-4" />
                </button>
                <button
                   onClick={(e) => { e.preventDefault(); drawingLayerRef.current?.redo(); handleSaveDrawing(); }}
                   disabled={!canRedo}
                   className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 transition-all"
                   title="Redo"
                >
                    <Redo className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-zinc-800 mx-1"></div>
                <button
                   onClick={(e) => { e.preventDefault(); drawingLayerRef.current?.clear(); handleSaveDrawing(); }}
                   className="p-1.5 rounded-md text-red-500 hover:bg-red-500/10 transition-all"
                   title="Clear Drawing"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
             </div>
             
             <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                <button
                   onClick={() => setDrawOptions(p => ({...p, mode: 'airbrush'}))}
                   className={`p-1.5 rounded-md transition-all ${drawOptions.mode === 'airbrush' ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
                   title="Airbrush"
                >
                    <Brush className="w-4 h-4" />
                </button>
                <button
                   onClick={() => setDrawOptions(p => ({...p, mode: 'sdf_circle'}))}
                   className={`p-1.5 rounded-md transition-all ${drawOptions.mode === 'sdf_circle' ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
                   title="SDF Circle"
                >
                    <Circle className="w-4 h-4" />
                </button>
                <button
                   onClick={() => setDrawOptions(p => ({...p, mode: 'smudge'}))}
                   className={`p-1.5 rounded-md transition-all ${drawOptions.mode === 'smudge' ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
                   title="Smudge"
                >
                    <Droplet className="w-4 h-4" />
                </button>
             </div>
             
             <div className="flex items-center gap-4 bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 uppercase">Size</span>
                    <input 
                        type="range"
                        min="2" max="100" step="1"
                        value={drawOptions.size}
                        onChange={(e) => setDrawOptions(p => ({...p, size: parseFloat(e.target.value)}))}
                        className="w-20 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 uppercase">Brush Opac</span>
                    <input 
                        type="range"
                        min="0.01" max="1.0" step="0.01"
                        value={drawOptions.opacity}
                        onChange={(e) => setDrawOptions(p => ({...p, opacity: parseFloat(e.target.value)}))}
                        className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 uppercase">Color</span>
                    <input 
                        type="color"
                        value={rgbToHex(drawOptions.color.r, drawOptions.color.g, drawOptions.color.b)}
                        onChange={(e) => setDrawOptions(p => ({...p, color: hexToRgb(e.target.value)}))}
                        className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                    />
                </div>
             </div>

             {/* Secondary: Blend Mode */}
             <div className="w-px h-6 bg-zinc-800 mx-2 hidden sm:block"></div>
             
             <div className="flex items-center gap-4 bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800 opacity-80 hover:opacity-100 transition-opacity">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 uppercase">Blend</span>
                    <select 
                        value={blendMode}
                        onChange={(e) => setBlendMode(parseInt(e.target.value))}
                        className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-xs text-zinc-300 outline-none focus:border-indigo-500"
                    >
                        <option value={0}>Normal</option>
                        <option value={1}>Multiply</option>
                        <option value={2}>Screen</option>
                        <option value={3}>Overlay</option>
                        <option value={4}>Add</option>
                        <option value={5}>Mask</option>
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 uppercase">Layer Opac</span>
                    <input 
                        type="range"
                        min="0.0" max="1.0" step="0.01"
                        value={layerOpacity}
                        onChange={(e) => setLayerOpacity(parseFloat(e.target.value))}
                        className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                </div>
             </div>
          </div>
      )}
        </div>
      </div>
      
      <AnimatePresence>
        {isExitDialogOpen && (
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            >
                <motion.div 
                   initial={{ scale: 0.95, opacity: 0, y: 10 }}
                   animate={{ scale: 1, opacity: 1, y: 0 }}
                   exit={{ scale: 0.95, opacity: 0, y: 10 }}
                   className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl flex flex-col gap-6"
                >
                    <div>
                        <h3 className="text-xl font-medium text-zinc-100">Unsaved Draw Layer</h3>
                        <p className="text-zinc-400 mt-2 text-sm leading-relaxed">You have unapplied drawing changes. What should happen to the draw layer?</p>
                    </div>
                    <div className="flex flex-col gap-2">
                        <button onClick={handleApplyToAtlas} className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-colors">Apply to Atlas</button>
                        <button onClick={handleDiscardLayer} className="px-4 py-2.5 bg-red-600/10 text-red-500 hover:bg-red-600/20 rounded-xl font-medium transition-colors">Discard</button>
                        <button onClick={handleCancelExit} className="px-4 py-2.5 bg-transparent text-zinc-500 hover:text-zinc-300 rounded-xl font-medium transition-colors">Cancel</button>
                    </div>
                </motion.div>
            </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

