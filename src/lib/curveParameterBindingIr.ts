import type { CurveChannelId } from './curveSpaceIr';

export type CurveParameterInputIr =
  | 'major-axis'
  | 'orthogonal-axis'
  | 'radial'
  | 'circle-distance'
  | 'triangle-distance'
  | 'field';

export type CurveParameterRemapIr = {
  scale?: number;
  offset?: number;
  invert?: boolean;
  clamp?: '01' | 'hdr' | 'signed';
};

export type CurveParameterBindingIr = {
  parameter: string;
  curveId: CurveChannelId;
  input: CurveParameterInputIr;
  remap?: CurveParameterRemapIr;
};