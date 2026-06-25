import type { CurveFieldBasisIr } from './curveFieldBasisIr';
import { clamp01 } from './curveSpaceIr';

export type CompiledCurveFieldBasis = CompiledSeparableRadialBasis | CompiledShapeLerpBasis;

export type CompiledSeparableRadialBasis = {
  kind: 'separable-radial';
};

export type CompiledShapeLerpBasis = {
  kind: 'shape-lerp';
  circleRadius: number;
  triangleRadius: number;
  triangleCornerRoundness: number;
};

const MIN_RADIUS = 0.001;

export function compileCurveFieldBasis(basis: CurveFieldBasisIr): CompiledCurveFieldBasis {
  switch (basis.kind) {
    case 'separable-radial':
      return { kind: 'separable-radial' };
    case 'shape-lerp':
      return {
        kind: 'shape-lerp',
        circleRadius: Math.max(MIN_RADIUS, basis.shapes.a.radius),
        triangleRadius: Math.max(MIN_RADIUS, basis.shapes.b.radius),
        triangleCornerRoundness: clamp01(basis.shapes.b.cornerRoundness),
      };
    default:
      return { kind: 'separable-radial' };
  }
}