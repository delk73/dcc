import type { CurveChannelId } from './curveSpaceIr';
import type { CurveParameterBindingIr } from './curveParameterBindingIr';

export type CurveFieldBasisIr = SeparableRadialBasisIr | ShapeLerpBasisIr;

export type SeparableRadialBasisIr = {
  kind: 'separable-radial';
  bindings: CurveParameterBindingIr[];
  channels: {
    r: 'major-axis';
    g: 'orthogonal-axis';
    b: 'radial-interaction';
    a: 'final-transfer';
  };
  compose: {
    mode: 'min';
    transfer: 'a-curve';
  };
};

export type ShapeLerpBasisIr = {
  kind: 'shape-lerp';
  bindings: CurveParameterBindingIr[];
  shapes: {
    a: {
      kind: 'circle';
      radius: number;
    };
    b: {
      kind: 'triangle';
      radius: number;
      cornerRoundness: number;
    };
  };
  channels: {
    r: 'circle-response';
    g: 'triangle-response';
    b: 'shape-lerp';
    a: 'final-transfer';
  };
  lerp: {
    channel: CurveChannelId;
    input: 'radial';
  };
  transfer: {
    channel: CurveChannelId;
  };
};

export type CurveFieldBasisRecipeIr = {
  version: 1;
  kind: 'curve-field-basis-recipe';
  id: 'separable-radial' | 'shape-lerp' | 'shape-lerp-b-corners';
  label: string;
  basis: CurveFieldBasisIr;
  tags?: string[];
};

export const SEPARABLE_RADIAL_BASIS: SeparableRadialBasisIr = {
  kind: 'separable-radial',
  bindings: [
    { parameter: 'major.response', curveId: 'r', input: 'major-axis' },
    { parameter: 'orthogonal.response', curveId: 'g', input: 'orthogonal-axis' },
    { parameter: 'radial.response', curveId: 'b', input: 'radial' },
    { parameter: 'transfer.output', curveId: 'a', input: 'field' },
  ],
  channels: {
    r: 'major-axis',
    g: 'orthogonal-axis',
    b: 'radial-interaction',
    a: 'final-transfer',
  },
  compose: {
    mode: 'min',
    transfer: 'a-curve',
  },
};

export const SHAPE_LERP_CIRCLE_TRIANGLE_BASIS: ShapeLerpBasisIr = {
  kind: 'shape-lerp',
  bindings: [
    { parameter: 'circle.response', curveId: 'r', input: 'circle-distance' },
    { parameter: 'triangle.response', curveId: 'g', input: 'triangle-distance' },
    { parameter: 'shape.morph', curveId: 'b', input: 'radial' },
    { parameter: 'transfer.output', curveId: 'a', input: 'field' },
  ],
  shapes: {
    a: {
      kind: 'circle',
      radius: 0.82,
    },
    b: {
      kind: 'triangle',
      radius: 0.92,
      cornerRoundness: 0.18,
    },
  },
  channels: {
    r: 'circle-response',
    g: 'triangle-response',
    b: 'shape-lerp',
    a: 'final-transfer',
  },
  lerp: {
    channel: 'b',
    input: 'radial',
  },
  transfer: {
    channel: 'a',
  },
};

export const SHAPE_LERP_CIRCLE_TRIANGLE_B_CORNERS_BASIS: ShapeLerpBasisIr = {
  ...SHAPE_LERP_CIRCLE_TRIANGLE_BASIS,
  bindings: [
    { parameter: 'circle.response', curveId: 'r', input: 'circle-distance' },
    { parameter: 'triangle.response', curveId: 'g', input: 'triangle-distance' },
    { parameter: 'shape.morph', curveId: 'b', input: 'radial' },
    {
      parameter: 'shape.cornerRoundness',
      curveId: 'b',
      input: 'radial',
      remap: { scale: 0.35, offset: 0.05, clamp: '01' },
    },
    { parameter: 'transfer.output', curveId: 'a', input: 'field' },
  ],
};

export type CurveFieldBasisRecipeId = CurveFieldBasisRecipeIr['id'];

export const CURVE_FIELD_BASIS_RECIPES: CurveFieldBasisRecipeIr[] = [
  {
    version: 1,
    kind: 'curve-field-basis-recipe',
    id: 'separable-radial',
    label: 'Separable Radial',
    basis: SEPARABLE_RADIAL_BASIS,
    tags: ['axis', 'radial'],
  },
  {
    version: 1,
    kind: 'curve-field-basis-recipe',
    id: 'shape-lerp',
    label: 'Shape Lerp',
    basis: SHAPE_LERP_CIRCLE_TRIANGLE_BASIS,
    tags: ['shape', 'circle', 'triangle'],
  },
  {
    version: 1,
    kind: 'curve-field-basis-recipe',
    id: 'shape-lerp-b-corners',
    label: 'Shape Lerp + Corners',
    basis: SHAPE_LERP_CIRCLE_TRIANGLE_B_CORNERS_BASIS,
    tags: ['shape', 'circle', 'triangle', 'corners'],
  },
];

export function getCurveFieldBasisRecipe(id: CurveFieldBasisRecipeId): CurveFieldBasisRecipeIr {
  return CURVE_FIELD_BASIS_RECIPES.find(recipe => recipe.id === id) ?? CURVE_FIELD_BASIS_RECIPES[0];
}