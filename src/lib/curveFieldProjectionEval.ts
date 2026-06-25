import type { CompiledCurveFieldProjection } from './curveFieldProjectionCompile';
import { circleDistanceToT, triangleDistanceToT } from './curveFieldShapeKernels';
import {
  clamp01,
  hdrToSigned,
  signedCoordToT,
  signedToCurveT,
  signedToPreviewGray,
} from './curveSpaceIr';

export function worldToCurveFieldLocal(
  worldX: number,
  worldY: number,
  transform: CompiledCurveFieldProjection['transform']
): [number, number] {
  const dx = worldX - transform.cx;
  const dy = worldY - transform.cy;
  const rotatedX = transform.cos * dx - transform.sin * dy;
  const rotatedY = transform.sin * dx + transform.cos * dy;
  const localX = transform.scaleX !== 0 ? (rotatedX / transform.scaleX) * 2 : 0;
  const localY = transform.scaleY !== 0 ? (rotatedY / transform.scaleY) * 2 : 0;
  return [localX, localY];
}

export function radialInteractionToT(localX: number, localY: number): number {
  return clamp01(Math.hypot(localX, localY) / Math.SQRT2);
}

function sampleLutHdr(lut: Float32Array, t: number): number {
  const clampedT = clamp01(t);
  const position = clampedT * (lut.length - 1);
  const leftIndex = Math.floor(position);
  const rightIndex = Math.min(lut.length - 1, leftIndex + 1);
  const ratio = position - leftIndex;
  return lut[leftIndex] + (lut[rightIndex] - lut[leftIndex]) * ratio;
}

function sampleLutSigned(lut: Float32Array, t: number): number {
  return hdrToSigned(sampleLutHdr(lut, t));
}

export function evaluateCompiledCurveFieldProjection(
  compiled: CompiledCurveFieldProjection,
  pixelX: number,
  pixelY: number
): number {
  const worldX = compiled.width > 1 ? pixelX / (compiled.width - 1) : 0.5;
  const worldY = compiled.height > 1 ? pixelY / (compiled.height - 1) : 0.5;
  const dx = worldX - compiled.transform.cx;
  const dy = worldY - compiled.transform.cy;
  const rotatedX = compiled.transform.cos * dx - compiled.transform.sin * dy;
  const rotatedY = compiled.transform.sin * dx + compiled.transform.cos * dy;
  const localX = compiled.transform.scaleX !== 0 ? (rotatedX / compiled.transform.scaleX) * 2 : 0;
  const localY = compiled.transform.scaleY !== 0 ? (rotatedY / compiled.transform.scaleY) * 2 : 0;
  const radialT = radialInteractionToT(localX, localY);

  switch (compiled.basis.kind) {
    case 'shape-lerp': {
      const circleT = circleDistanceToT(localX, localY, compiled.basis.circleRadius);
      const triangleT = triangleDistanceToT(
        localX,
        localY,
        compiled.basis.triangleRadius,
        compiled.basis.triangleCornerRoundness
      );
      const circleResponse = sampleLutSigned(compiled.channels.r, circleT);
      const triangleResponse = sampleLutSigned(compiled.channels.g, triangleT);
      const mixT = clamp01(sampleLutHdr(compiled.channels.b, radialT) * 0.5);
      const base = circleResponse + (triangleResponse - circleResponse) * mixT;
      const outSigned = sampleLutSigned(compiled.channels.a, signedToCurveT(base));

      return signedToPreviewGray(outSigned);
    }
    case 'separable-radial':
    default: {
      const r = sampleLutSigned(compiled.channels.r, signedCoordToT(localX));
      const g = sampleLutSigned(compiled.channels.g, signedCoordToT(localY));
      const b = sampleLutSigned(compiled.channels.b, radialT);
      const base = Math.min(r, g, b);
      const outSigned = sampleLutSigned(compiled.channels.a, signedToCurveT(base));

      return signedToPreviewGray(outSigned);
    }
  }
}