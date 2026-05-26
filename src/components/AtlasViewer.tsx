import React, { useEffect, useRef } from 'react';
import { LibraryCurve } from '../types';
import { InterpMode, computeTangents, evaluateCurve } from '../lib/curveUtils';
import { Download } from 'lucide-react';

interface AtlasViewerProps {
  curves: LibraryCurve[];
  interpMode: InterpMode;
  spaceLever: number;
  onSpaceLeverChange?: (position: number) => void;
  onTextureUpdate?: (tex: ImageData) => void;
  onExportAtlas?: () => void;
  canExportAtlas?: boolean;
  className?: string;
  canvasClassName?: string;
}

export const AtlasViewer: React.FC<AtlasViewerProps> = ({
  curves,
  interpMode,
  spaceLever,
  onSpaceLeverChange,
  onTextureUpdate,
  onExportAtlas,
  canExportAtlas = true,
  className = '',
  canvasClassName = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const atlasFrameRef = useRef<HTMLDivElement>(null);

  const deferredCurves = React.useDeferredValue(curves);

  const getSpacePositionFromClientY = (clientY: number) => {
    const rect = atlasFrameRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return spaceLever;
    return Math.max(0, Math.min(1, 1 - ((clientY - rect.top) / rect.height)));
  };

  const updateSpaceFromPointer = (clientY: number) => {
    onSpaceLeverChange?.(getSpacePositionFromClientY(clientY));
  };

  const handleAtlasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onSpaceLeverChange || event.button !== 0) return;
    event.preventDefault();
    updateSpaceFromPointer(event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleAtlasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onSpaceLeverChange || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    updateSpaceFromPointer(event.clientY);
  };

  const handleAtlasPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || deferredCurves.length === 0) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    const width = 256;
    const height = 256;
    
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
    setTimeout(() => onTextureUpdate?.(imageData), 0);
  }, [deferredCurves, interpMode, onTextureUpdate]);

  return (
      <div className={`flex flex-col gap-3 bg-[#09090b] border border-zinc-800 rounded-xl p-4 min-h-0 ${className}`}>
        <div className="flex items-center justify-between">
          <h3 className="text-zinc-100 font-bold text-[11px] tracking-widest uppercase">2D ATLAS <span className="text-zinc-500 font-normal normal-case tracking-normal">(Output)</span></h3>
          {onExportAtlas && (
            <button
              onClick={onExportAtlas}
              disabled={!canExportAtlas}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              Export 2D
            </button>
          )}
        </div>
        
        <div className="w-full min-h-0 flex-1 transition-all duration-300">
            <div className="flex gap-4 items-stretch h-full min-h-0">
              <div className="flex flex-col justify-between py-2 text-[10px] text-zinc-500 font-mono tracking-wider">
                  <span>1.0</span>
                  <span className="rotate-[-90deg] whitespace-nowrap">SPACE</span>
                  <span>0.0</span>
              </div>

              <div 
                ref={atlasFrameRef}
                className={`flex-1 relative min-h-[200px] rounded-lg overflow-hidden border border-zinc-800 shadow-inner touch-none ${canvasClassName || 'aspect-[2/1]'}`}
                role={onSpaceLeverChange ? 'slider' : undefined}
                aria-label={onSpaceLeverChange ? '2D atlas space index' : undefined}
                aria-orientation={onSpaceLeverChange ? 'vertical' : undefined}
                aria-valuemin={onSpaceLeverChange ? 0 : undefined}
                aria-valuemax={onSpaceLeverChange ? 1 : undefined}
                aria-valuenow={onSpaceLeverChange ? spaceLever : undefined}
                tabIndex={onSpaceLeverChange ? 0 : undefined}
                onPointerDown={handleAtlasPointerDown}
                onPointerMove={handleAtlasPointerMove}
                onPointerUp={handleAtlasPointerUp}
                onPointerCancel={handleAtlasPointerUp}
                onKeyDown={(event) => {
                  if (!onSpaceLeverChange) return;
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    onSpaceLeverChange(Math.min(1, spaceLever + 0.01));
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    onSpaceLeverChange(Math.max(0, spaceLever - 0.01));
                  }
                }}
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
            <div
              className="absolute left-0 right-0 h-px bg-white/80 shadow-[0_0_6px_rgba(255,255,255,0.65)] pointer-events-none"
              style={{ top: `${(1 - spaceLever) * 100}%` }}
            />
            {onSpaceLeverChange && (
              <div className="pointer-events-none absolute right-2 top-2 rounded border border-zinc-800 bg-black/60 px-2 py-1 text-[10px] font-mono text-zinc-400">
                Y {spaceLever.toFixed(3)}
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
  );
};
