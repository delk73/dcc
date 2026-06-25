import type { CompiledCurveFieldProjection } from './curveFieldProjectionCompile';
import type { CompiledCurveParameterBinding } from './curveParameterBindingCompile';
import { circleDistanceToT, triangleDistanceToT } from './curveFieldShapeKernels';
import {
  clamp01,
  clampHdr,
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

function applyBindingRemap(value: number, binding: CompiledCurveParameterBinding): number {
  const inverted = binding.remap.invert ? 1 - value : value;
  const remapped = inverted * binding.remap.scale + binding.remap.offset;

  switch (binding.remap.clamp) {
    case '01':
      return clamp01(remapped);
    case 'hdr':
      return clampHdr(remapped);
    case 'signed':
      return Math.max(-1, Math.min(1, remapped));
    case 'none':
    default:
      return remapped;
  }
}

function sampleBindingHdr(
  compiled: CompiledCurveFieldProjection,
  binding: CompiledCurveParameterBinding,
  inputT: number
): number {
  return applyBindingRemap(sampleLutHdr(compiled.channels[binding.curveId], inputT), binding);
}

function sampleBindingSigned(
  compiled: CompiledCurveFieldProjection,
  binding: CompiledCurveParameterBinding,
  inputT: number
): number {
  return hdrToSigned(clampHdr(sampleBindingHdr(compiled, binding, inputT)));
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
      const cornerRoundness = compiled.basis.cornerRoundness
        ? sampleBindingHdr(compiled, compiled.basis.cornerRoundness, radialT)
        : compiled.basis.triangleCornerRoundness;
      const triangleT = triangleDistanceToT(
        localX,
        localY,
        compiled.basis.triangleRadius,
        cornerRoundness
      );
      const circleResponse = sampleBindingSigned(compiled, compiled.basis.circleResponse, circleT);
      const triangleResponse = sampleBindingSigned(compiled, compiled.basis.triangleResponse, triangleT);
      const mixT = clamp01(sampleBindingHdr(compiled, compiled.basis.shapeMorph, radialT) * 0.5);
      const base = circleResponse + (triangleResponse - circleResponse) * mixT;
      const outSigned = sampleBindingSigned(compiled, compiled.basis.transferOutput, signedToCurveT(base));

      return signedToPreviewGray(outSigned);
    }
    case 'separable-radial':
    default: {
      const r = sampleBindingSigned(compiled, compiled.basis.majorResponse, signedCoordToT(localX));
      const g = sampleBindingSigned(compiled, compiled.basis.orthogonalResponse, signedCoordToT(localY));
      const b = sampleBindingSigned(compiled, compiled.basis.radialResponse, radialT);
      const base = Math.min(r, g, b);
      const outSigned = sampleBindingSigned(compiled, compiled.basis.transferOutput, signedToCurveT(base));

      return signedToPreviewGray(outSigned);
    }
  }
}