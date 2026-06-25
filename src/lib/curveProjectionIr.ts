import type { CurveSpaceIr } from './curveSpaceIr';
import { SEPARABLE_RADIAL_BASIS, type CurveFieldBasisIr } from './curveFieldBasisIr';

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
  basis: CurveFieldBasisIr;
};

export type CurveFieldPreviewSpec = {
  version: 1;
  kind: 'curve-field-preview-spec';
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
  basis: SEPARABLE_RADIAL_BASIS,
};