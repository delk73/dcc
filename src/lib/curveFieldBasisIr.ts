import type { CurveChannelId } from './curveSpaceIr';

export type CurveFieldBasisIr = SeparableRadialBasisIr | ShapeLerpBasisIr;

export type SeparableRadialBasisIr = {
  kind: 'separable-radial';
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
  label: string;
  basis: CurveFieldBasisIr;
  tags?: string[];
};

export const SEPARABLE_RADIAL_BASIS: SeparableRadialBasisIr = {
  kind: 'separable-radial',
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

export const CURVE_FIELD_BASIS_RECIPES: CurveFieldBasisRecipeIr[] = [
  {
    version: 1,
    kind: 'curve-field-basis-recipe',
    label: 'Separable Radial',
    basis: SEPARABLE_RADIAL_BASIS,
    tags: ['axis', 'radial'],
  },
  {
    version: 1,
    kind: 'curve-field-basis-recipe',
    label: 'Shape Lerp',
    basis: SHAPE_LERP_CIRCLE_TRIANGLE_BASIS,
    tags: ['shape', 'circle', 'triangle'],
  },
];