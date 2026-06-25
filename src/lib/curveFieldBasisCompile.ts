import type { CurveFieldBasisIr } from './curveFieldBasisIr';
import { compileCurveParameterBindings, type CompiledCurveParameterBinding } from './curveParameterBindingCompile';
import { clamp01 } from './curveSpaceIr';

export type CompiledCurveFieldBasis = CompiledSeparableRadialBasis | CompiledShapeLerpBasis;

export type CompiledSeparableRadialBasis = {
  kind: 'separable-radial';
  majorResponse: CompiledCurveParameterBinding;
  orthogonalResponse: CompiledCurveParameterBinding;
  radialResponse: CompiledCurveParameterBinding;
  transferOutput: CompiledCurveParameterBinding;
};

export type CompiledShapeLerpBasis = {
  kind: 'shape-lerp';
  circleRadius: number;
  triangleRadius: number;
  triangleCornerRoundness: number;
  circleResponse: CompiledCurveParameterBinding;
  triangleResponse: CompiledCurveParameterBinding;
  shapeMorph: CompiledCurveParameterBinding;
  transferOutput: CompiledCurveParameterBinding;
  cornerRoundness?: CompiledCurveParameterBinding;
};

const MIN_RADIUS = 0.001;

function requireBinding(
  bindings: CompiledCurveParameterBinding[],
  parameter: string
): CompiledCurveParameterBinding {
  const binding = bindings.find(candidate => candidate.parameter === parameter);
  if (!binding) throw new Error(`Missing curve parameter binding: ${parameter}`);
  return binding;
}

export function compileCurveFieldBasis(basis: CurveFieldBasisIr): CompiledCurveFieldBasis {
  const bindings = compileCurveParameterBindings(basis.bindings);

  switch (basis.kind) {
    case 'separable-radial':
      return {
        kind: 'separable-radial',
        majorResponse: requireBinding(bindings, 'major.response'),
        orthogonalResponse: requireBinding(bindings, 'orthogonal.response'),
        radialResponse: requireBinding(bindings, 'radial.response'),
        transferOutput: requireBinding(bindings, 'transfer.output'),
      };
    case 'shape-lerp':
      return {
        kind: 'shape-lerp',
        circleRadius: Math.max(MIN_RADIUS, basis.shapes.a.radius),
        triangleRadius: Math.max(MIN_RADIUS, basis.shapes.b.radius),
        triangleCornerRoundness: clamp01(basis.shapes.b.cornerRoundness),
        circleResponse: requireBinding(bindings, 'circle.response'),
        triangleResponse: requireBinding(bindings, 'triangle.response'),
        shapeMorph: requireBinding(bindings, 'shape.morph'),
        transferOutput: requireBinding(bindings, 'transfer.output'),
        cornerRoundness: bindings.find(binding => binding.parameter === 'shape.cornerRoundness'),
      };
    default:
      throw new Error(`Unsupported curve field basis: ${(basis as { kind?: string }).kind ?? 'unknown'}`);
  }
}