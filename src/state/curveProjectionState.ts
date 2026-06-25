import type { ColorCurve } from '../types';
import { migrateKeyframesToCurvePoints } from '../lib/curvePointPolicy';
import { DEFAULT_CURVE_FIELD_PROJECTION, type CurveFieldProjectionIr } from '../lib/curveProjectionIr';
import {
  SEPARABLE_RADIAL_BASIS,
  SHAPE_LERP_CIRCLE_TRIANGLE_BASIS,
  type CurveFieldBasisIr,
  type ShapeLerpBasisIr,
} from '../lib/curveFieldBasisIr';

export type OutputMode = 'atlas' | 'curve-field';

export type CurveProjectionState = {
  outputMode: OutputMode;
  curveFieldCurve: ColorCurve;
  curveFieldProjection: CurveFieldProjectionIr;
  curveFieldPreviewSize: 256 | 512;
};

function points(values: Array<{ time: number; value: number }>) {
  return migrateKeyframesToCurvePoints(values);
}

export function createInitialCurveProjectionState(): CurveProjectionState {
  return {
    outputMode: 'atlas',
    curveFieldCurve: {
      r: points([
        { time: 0, value: 0.55 },
        { time: 0.5, value: 1.85 },
        { time: 1, value: 0.55 },
      ]),
      g: points([
        { time: 0, value: 0.7 },
        { time: 0.5, value: 1.65 },
        { time: 1, value: 0.7 },
      ]),
      b: points([
        { time: 0, value: 1.75 },
        { time: 0.68, value: 1.2 },
        { time: 1, value: 0.35 },
      ]),
      a: points([
        { time: 0, value: 0 },
        { time: 0.5, value: 1 },
        { time: 1, value: 2 },
      ]),
    },
    curveFieldProjection: {
      ...DEFAULT_CURVE_FIELD_PROJECTION,
      transform: { ...DEFAULT_CURVE_FIELD_PROJECTION.transform },
      basis: { ...DEFAULT_CURVE_FIELD_PROJECTION.basis },
    },
    curveFieldPreviewSize: 256,
  };
}

export type CurveProjectionAction =
  | { type: 'set-output-mode'; mode: OutputMode }
  | { type: 'set-curve-field-curve'; curve: ColorCurve }
  | { type: 'set-curve-field-transform'; transform: Partial<CurveFieldProjectionIr['transform']> }
  | { type: 'set-curve-field-basis-kind'; kind: CurveFieldBasisIr['kind'] }
  | { type: 'set-shape-lerp-params'; params: {
      a?: Partial<ShapeLerpBasisIr['shapes']['a']>;
      b?: Partial<ShapeLerpBasisIr['shapes']['b']>;
    } }
  | { type: 'set-curve-field-preview-size'; size: 256 | 512 };

export function curveProjectionReducer(
  state: CurveProjectionState,
  action: CurveProjectionAction
): CurveProjectionState {
  switch (action.type) {
    case 'set-output-mode':
      return { ...state, outputMode: action.mode };
    case 'set-curve-field-curve':
      return { ...state, curveFieldCurve: action.curve };
    case 'set-curve-field-transform':
      return {
        ...state,
        curveFieldProjection: {
          ...state.curveFieldProjection,
          transform: { ...state.curveFieldProjection.transform, ...action.transform },
        },
      };
    case 'set-curve-field-basis-kind':
      return {
        ...state,
        curveFieldProjection: {
          ...state.curveFieldProjection,
          basis: action.kind === 'shape-lerp'
            ? SHAPE_LERP_CIRCLE_TRIANGLE_BASIS
            : SEPARABLE_RADIAL_BASIS,
        },
      };
    case 'set-shape-lerp-params': {
      if (state.curveFieldProjection.basis.kind !== 'shape-lerp') return state;

      return {
        ...state,
        curveFieldProjection: {
          ...state.curveFieldProjection,
          basis: {
            ...state.curveFieldProjection.basis,
            shapes: {
              a: {
                ...state.curveFieldProjection.basis.shapes.a,
                ...action.params.a,
              },
              b: {
                ...state.curveFieldProjection.basis.shapes.b,
                ...action.params.b,
              },
            },
          },
        },
      };
    }
    case 'set-curve-field-preview-size':
      return { ...state, curveFieldPreviewSize: action.size };
    default:
      return state;
  }
}