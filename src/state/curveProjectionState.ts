import type { ColorCurve } from '../types';
import { migrateKeyframesToCurvePoints } from '../lib/curvePointPolicy';
import { DEFAULT_CURVE_FIELD_PROJECTION, type CurveFieldProjectionIr } from '../lib/curveProjectionIr';

export type OutputMode = 'atlas' | 'curve-field';

export type CurveProjectionState = {
  outputMode: OutputMode;
  curveFieldCurve: ColorCurve;
  curveFieldTransform: CurveFieldProjectionIr['transform'];
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
    curveFieldTransform: { ...DEFAULT_CURVE_FIELD_PROJECTION.transform },
    curveFieldPreviewSize: 256,
  };
}

export type CurveProjectionAction =
  | { type: 'set-output-mode'; mode: OutputMode }
  | { type: 'set-curve-field-curve'; curve: ColorCurve }
  | { type: 'set-curve-field-transform'; transform: Partial<CurveFieldProjectionIr['transform']> }
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
      return { ...state, curveFieldTransform: { ...state.curveFieldTransform, ...action.transform } };
    case 'set-curve-field-preview-size':
      return { ...state, curveFieldPreviewSize: action.size };
    default:
      return state;
  }
}