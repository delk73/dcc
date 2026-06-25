import type { CurveSpaceIr } from './curveSpaceIr';

export type CurveFieldProjectionIr = {
  version: 1;
  kind: 'curve-field-projection';
  transform: {
    cx: number;
    cy: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  };
  basis: {
    r: 'major-axis';
    g: 'orthogonal-axis';
    b: 'radial-interaction';
    a: 'final-transfer';
  };
  compose: {
    mode: 'min';
    bInput: 'radial';
    transfer: 'a-curve';
  };
};

export type CurveFieldPreviewSpec = {
  curveSpace: CurveSpaceIr;
  projection: CurveFieldProjectionIr;
  output: {
    width: number;
    height: number;
  };
};

export const DEFAULT_CURVE_FIELD_PROJECTION: CurveFieldProjectionIr = {
  version: 1,
  kind: 'curve-field-projection',
  transform: {
    cx: 0.5,
    cy: 0.5,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  },
  basis: {
    r: 'major-axis',
    g: 'orthogonal-axis',
    b: 'radial-interaction',
    a: 'final-transfer',
  },
  compose: {
    mode: 'min',
    bInput: 'radial',
    transfer: 'a-curve',
  },
};