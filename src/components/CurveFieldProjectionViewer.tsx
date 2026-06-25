import React, { useEffect, useMemo, useRef } from 'react';
import { compileCurveFieldProjection } from '../lib/curveFieldProjectionCompile';
import { evaluateCompiledCurveFieldProjection } from '../lib/curveFieldProjectionEval';
import type { CurveFieldPreviewSpec } from '../lib/curveProjectionIr';

type CurveFieldProjectionViewerProps = {
  spec: CurveFieldPreviewSpec;
  className?: string;
};

export function CurveFieldProjectionViewer({ spec, className }: CurveFieldProjectionViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compiled = useMemo(() => compileCurveFieldProjection(spec), [spec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return;

    const imageData = ctx.createImageData(compiled.width, compiled.height);
    const { data } = imageData;

    for (let y = 0; y < compiled.height; y++) {
      for (let x = 0; x < compiled.width; x++) {
        const gray = Math.round(evaluateCompiledCurveFieldProjection(compiled, x, y) * 255);
        const index = (y * compiled.width + x) * 4;
        data[index] = gray;
        data[index + 1] = gray;
        data[index + 2] = gray;
        data[index + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [compiled]);

  return (
    <canvas
      ref={canvasRef}
      width={compiled.width}
      height={compiled.height}
      className={className}
      style={{ imageRendering: 'pixelated', width: '100%', height: '100%', objectFit: 'contain' }}
    />
  );
}