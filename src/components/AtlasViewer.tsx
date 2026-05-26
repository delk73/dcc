import React, { useEffect, useRef } from 'react';
import { LibraryCurve } from '../types';
import { InterpMode, computeTangents, evaluateCurve } from '../lib/curveUtils';
import { Download } from 'lucide-react';

interface AtlasViewerProps {
  curves: LibraryCurve[];
  interpMode: InterpMode;
  spaceLever: number;
  domainTime: number;
  activeAnchorId?: string;
  activeCurveLabel?: string;
  activeChannelsLabel?: string;
  onSpaceLeverChange?: (position: number) => void;
  onDomainTimeChange?: (position: number) => void;
  onAnchorDragStart?: (anchorId: string) => void;
  onAnchorPositionChange?: (anchorId: string, position: number) => void;
  onAnchorDragEnd?: () => void;
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
  domainTime,
  activeAnchorId,
  activeCurveLabel,
  activeChannelsLabel,
  onSpaceLeverChange,
  onDomainTimeChange,
  onAnchorDragStart,
  onAnchorPositionChange,
  onAnchorDragEnd,
  onTextureUpdate,
  onExportAtlas,
  canExportAtlas = true,
  className = '',
  canvasClassName = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const atlasFrameRef = useRef<HTMLDivElement>(null);

  const deferredCurves = React.useDeferredValue(curves);

  const getSelectorPosition = (clientX: number, clientY: number) => {
    const rect = atlasFrameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { time: domainTime, space: spaceLever };
    }

    return {
      time: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      space: Math.max(0, Math.min(1, 1 - ((clientY - rect.top) / rect.height)))
    };
  };

  const updateSelectorFromPointer = (clientX: number, clientY: number) => {
    const next = getSelectorPosition(clientX, clientY);
    onDomainTimeChange?.(next.time);
    onSpaceLeverChange?.(next.space);
  };

  const handleAtlasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((!onSpaceLeverChange && !onDomainTimeChange) || event.button !== 0) return;
    event.preventDefault();
    updateSelectorFromPointer(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleAtlasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((!onSpaceLeverChange && !onDomainTimeChange) || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    updateSelectorFromPointer(event.clientX, event.clientY);
  };

  const handleAtlasPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const getSpacePositionFromClientY = (clientY: number) => {
    const rect = atlasFrameRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return spaceLever;
    return Math.max(0, Math.min(1, 1 - ((clientY - rect.top) / rect.height)));
  };

  const handleAnchorPointerDown = (event: React.PointerEvent<HTMLButtonElement>, anchorId: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onAnchorDragStart?.(anchorId);
    onAnchorPositionChange?.(anchorId, getSpacePositionFromClientY(event.clientY));
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleAnchorPointerMove = (event: React.PointerEvent<HTMLButtonElement>, anchorId: string) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    onAnchorPositionChange?.(anchorId, getSpacePositionFromClientY(event.clientY));
  };

  const handleAnchorPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onAnchorDragEnd?.();
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
                  <span className="rotate-[-90deg] whitespace-nowrap">Y SPACE</span>
                  <span>0.0</span>
              </div>

              <div 
                ref={atlasFrameRef}
                className={`flex-1 relative min-h-[200px] rounded-lg overflow-hidden border border-zinc-800 shadow-inner touch-none ${canvasClassName || 'aspect-[2/1]'}`}
                role={onSpaceLeverChange || onDomainTimeChange ? 'slider' : undefined}
                aria-label={onSpaceLeverChange || onDomainTimeChange ? '2D atlas XY selector' : undefined}
                aria-valuemin={onSpaceLeverChange || onDomainTimeChange ? 0 : undefined}
                aria-valuemax={onSpaceLeverChange || onDomainTimeChange ? 1 : undefined}
                aria-valuenow={onSpaceLeverChange || onDomainTimeChange ? domainTime : undefined}
                tabIndex={onSpaceLeverChange || onDomainTimeChange ? 0 : undefined}
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
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    onDomainTimeChange?.(Math.min(1, domainTime + 0.01));
                  }
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    onDomainTimeChange?.(Math.max(0, domainTime - 0.01));
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
            {curves.map((curve, index) => {
              const isActive = curve.id === activeAnchorId;

              return (
                <button
                  key={curve.id}
                  type="button"
                  aria-label={`Move space keyframe ${index + 1}`}
                  title={`Space keyframe ${index + 1}: ${curve.position.toFixed(3)}`}
                  className={`absolute left-1 z-20 h-5 w-5 -translate-y-1/2 rounded-full border bg-black shadow-lg transition-transform ${
                    isActive
                      ? 'scale-125 border-white text-white'
                      : 'border-zinc-500 text-zinc-300 hover:border-white hover:text-white'
                  }`}
                  style={{ top: `${(1 - curve.position) * 100}%` }}
                  onPointerDown={(event) => handleAnchorPointerDown(event, curve.id)}
                  onPointerMove={(event) => handleAnchorPointerMove(event, curve.id)}
                  onPointerUp={handleAnchorPointerUp}
                  onPointerCancel={handleAnchorPointerUp}
                >
                  <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                </button>
              );
            })}
            <div
              className="absolute bottom-0 top-0 w-px bg-white/80 shadow-[0_0_6px_rgba(255,255,255,0.65)] pointer-events-none"
              style={{ left: `${domainTime * 100}%` }}
            />
            {(onSpaceLeverChange || onDomainTimeChange) && (
              <div
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-black shadow-[0_0_8px_rgba(255,255,255,0.75)]"
                style={{
                  left: `${domainTime * 100}%`,
                  top: `${(1 - spaceLever) * 100}%`
                }}
              />
            )}
            {(onSpaceLeverChange || onDomainTimeChange) && (
              <div className="pointer-events-none absolute right-2 top-2 rounded border border-zinc-800 bg-black/60 px-2 py-1 text-[10px] font-mono text-zinc-400">
                X {domainTime.toFixed(3)} / Y {spaceLever.toFixed(3)}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex h-7 shrink-0 items-center gap-4 border-t border-zinc-900/80 pt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        <span className="font-bold text-zinc-300">Status</span>
        <span>
          X <span className="text-zinc-300">{domainTime.toFixed(3)}</span>
        </span>
        <span>
          Y <span className="text-zinc-300">{spaceLever.toFixed(3)}</span>
        </span>
        <span>
          Curve <span className="text-zinc-300">{activeCurveLabel ?? 'C:0'}</span>
        </span>
        <span>
          Mode <span className="text-zinc-300">{interpMode}</span>
        </span>
        <span className="min-w-0 truncate">
          Channels <span className="text-zinc-300">{activeChannelsLabel ?? 'NONE'}</span>
        </span>
        <span className="ml-auto">
          Space Keys <span className="text-zinc-300">{curves.length}</span>
        </span>
      </div>
      </div>
  );
};
