import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { DrawingEngine, DrawingOptions } from '../lib/drawingEngine';

type DrawingPoint = { x: number; y: number; pressure?: number };

interface DrawingLayerProps {
  width: number;
  height: number;
  options: DrawingOptions;
  isDrawingMode: boolean;
  onUndoAvailable?: (canUndo: boolean) => void;
  onRedoAvailable?: (canRedo: boolean) => void;
  onChange?: () => void;
}

export interface DrawingLayerRef {
  undo: () => void;
  redo: () => void;
  clear: () => void;
  serialize: () => string;
  serializeComposite: () => string;
  deserialize: (data: string) => void;
  updateBaseTexture: (imgData: ImageData) => void;
  updateCompositeSettings: (mode: number, opacity: number, drawVisible: boolean) => void;
}

export const DrawingLayer = forwardRef<DrawingLayerRef, DrawingLayerProps>(
  ({ width, height, options, isDrawingMode, onUndoAvailable, onRedoAvailable, onChange }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<DrawingEngine | null>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    
    // For SDF circle
    const startPosRef = useRef<DrawingPoint | null>(null);
    const prevPosRef = useRef<DrawingPoint | null>(null);
    
    // Animation frame for continuous airbrush
    const requestRef = useRef<number | null>(null);

    useImperativeHandle(ref, () => ({
      undo: () => {
        engineRef.current?.undo();
        onUndoAvailable?.(engineRef.current?.undoValid || false);
        onRedoAvailable?.(engineRef.current?.redoValid || false);
      },
      redo: () => {
        engineRef.current?.redo();
        onUndoAvailable?.(engineRef.current?.undoValid || false);
        onRedoAvailable?.(engineRef.current?.redoValid || false);
      },
      clear: () => {
        engineRef.current?.saveUndoState();
        engineRef.current?.clear();
        onUndoAvailable?.(engineRef.current?.undoValid || false);
        onRedoAvailable?.(engineRef.current?.redoValid || false);
        onChange?.();
      },
      serialize: () => {
        return engineRef.current?.serialize() || '';
      },
      serializeComposite: () => {
        return engineRef.current?.serializeComposite() || '';
      },
      deserialize: (data: string) => {
        engineRef.current?.deserialize(data);
      },
      updateBaseTexture: (imgData: ImageData) => {
        engineRef.current?.updateBaseTexture(imgData);
      },
      updateCompositeSettings: (mode: number, opacity: number, drawVisible: boolean) => {
        if (engineRef.current) {
            engineRef.current.blendMode = mode;
            engineRef.current.layerOpacity = drawVisible ? opacity : 0.0;
            engineRef.current.renderToScreen();
        }
      }
    }));

    useEffect(() => {
      if (canvasRef.current && !engineRef.current) {
        engineRef.current = new DrawingEngine(canvasRef.current, width, height);
        // Load persisted state if exists (we will handle via ref from parent to keep it simple)
        // or we could do it here
      }
      return () => {
        // We don't destroy engine on every re-render, only on full unmount
      };
    }, [width, height]);

    // Handle resize (if needed, but our AtlasViewer uses fixed 256x256 inside its logic)
    // Actually AtlasViewer canvas is width/height passed, but scaled by css w-full h-full
    // For pointer events we need to map client coords to intrinsic canvas coords

    const getCanvasPos = (e: React.PointerEvent) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * width;
      const y = ((e.clientY - rect.top) / rect.height) * height;
      
      // Handle pressure
      const pressure = e.pointerType === 'pen' ? (e.pressure || 1.0) : 1.0;
      return { x, y, pressure };
    };

    const handlePointerDown = (e: React.PointerEvent) => {
      if (!isDrawingMode) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      
      const pos = getCanvasPos(e);
      startPosRef.current = pos;
      prevPosRef.current = pos;
      setIsDrawing(true);
      
      // Save state before stroke begins
      engineRef.current?.saveUndoState();
      onUndoAvailable?.(true);
      onRedoAvailable?.(false);
      
      if (options.mode === 'airbrush' || options.mode === 'smudge') {
          // initial stamp
          tickBrush(pos, pos);
      }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
      if (!isDrawingMode || !isDrawing) return;
      e.stopPropagation();
      
      const pos = getCanvasPos(e);
      
      if (options.mode === 'sdf_circle' && startPosRef.current) {
        const dx = pos.x - startPosRef.current.x;
        const dy = pos.y - startPosRef.current.y;
        const r = Math.sqrt(dx*dx + dy*dy);
        engineRef.current?.previewSdfCircle(options, startPosRef.current, r);
      } else if (options.mode === 'airbrush' || options.mode === 'smudge') {
        tickBrush(pos, prevPosRef.current!);
      }
      
      prevPosRef.current = pos;
    };

    const handlePointerUp = (e: React.PointerEvent) => {
      if (!isDrawingMode || !isDrawing) return;
      e.stopPropagation();
      e.currentTarget.releasePointerCapture(e.pointerId);
      setIsDrawing(false);
      
      const pos = getCanvasPos(e);
      
      if (options.mode === 'sdf_circle' && startPosRef.current) {
         engineRef.current?.cancelPreview();
         const dx = pos.x - startPosRef.current.x;
         const dy = pos.y - startPosRef.current.y;
         const r = Math.sqrt(dx*dx + dy*dy);
         // commit circle
         engineRef.current?.drawBrush(options, startPosRef.current, r);
      }
      
      startPosRef.current = null;
      prevPosRef.current = null;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      
      onChange?.();
    };

    const tickBrush = (currentPos: DrawingPoint, prevPos: DrawingPoint) => {
        // Interpolate for fast mouse movement
        const dx = currentPos.x - prevPos.x;
        const dy = currentPos.y - prevPos.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        const steps = Math.max(1, Math.floor(dist / (options.size * 0.25)));
        
        for (let i = 1; i <= steps; i++) {
           const t = i / steps;
           const px = prevPos.x + dx * t;
           const py = prevPos.y + dy * t;
           const pp = (prevPos.pressure || 1) + ((currentPos.pressure || 1) - (prevPos.pressure || 1)) * t;
           
           const activeOpts = { ...options, opacity: options.opacity * pp };
           
           if (options.mode === 'smudge') {
               engineRef.current?.drawSmudge(activeOpts, {x:px, y:py}, prevPosRef.current || currentPos);
               // For smudge, update prevPos intermediate
               if (prevPosRef.current) {
                   prevPosRef.current = {x:px, y:py, pressure:pp};
               }
           } else {
               engineRef.current?.drawBrush(activeOpts, {x:px, y:py});
           }
        }
    };
    
    // Continuous airbrush when held still
    useEffect(() => {
        if (isDrawing && options.mode === 'airbrush' && prevPosRef.current) {
            let lastUpdate = performance.now();
            const loop = (time: number) => {
                if (time - lastUpdate > 16) {
                    if (prevPosRef.current) {
                        const activeOpts = { ...options, opacity: options.opacity * (prevPosRef.current.pressure || 1.0) };
                        engineRef.current?.drawBrush(activeOpts, prevPosRef.current);
                    }
                    lastUpdate = time;
                }
                requestRef.current = requestAnimationFrame(loop);
            };
            requestRef.current = requestAnimationFrame(loop);
            return () => {
                if (requestRef.current) cancelAnimationFrame(requestRef.current);
            };
        }
    }, [isDrawing, options]);

    return (
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="absolute inset-0 w-full h-full style-crisp-edges"
        style={{
          imageRendering: 'pixelated',
          pointerEvents: isDrawingMode ? 'auto' : 'none',
          touchAction: 'none' // Prevent scrolling while drawing on touch devices
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    );
  }
);
