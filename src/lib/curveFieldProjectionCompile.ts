import { computeTangents, evaluateCurve } from './curveUtils';
import type { CurveFieldPreviewSpec } from './curveProjectionIr';
import { clampHdr } from './curveSpaceIr';
import type { CurveChannelId } from './curveSpaceIr';
import type { CurvePoint } from '../types';

const DEFAULT_LUT_SIZE = 1024;
const CHANNELS: CurveChannelId[] = ['r', 'g', 'b', 'a'];

export type CompiledCurveFieldProjection = {
  width: number;
  height: number;
  transform: {
    cx: number;
    cy: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    cos: number;
    sin: number;
  };
  channels: Record<CurveChannelId, Float32Array>;
  lutSize: number;
  compose: {
    mode: 'min';
    bInput: 'radial';
    transfer: 'a-curve';
    valueMeaning: 'hdr-offset-signed';
  };
};

function compileChannel(points: CurvePoint[], lutSize: number): Float32Array {
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const tangents = computeTangents(sorted);
  const lut = new Float32Array(lutSize);
  const maxIndex = lutSize - 1;

  for (let index = 0; index < lutSize; index++) {
    const t = maxIndex > 0 ? index / maxIndex : 0;
    lut[index] = clampHdr(evaluateCurve(sorted, tangents, t, 'cubic'));
  }

  return lut;
}

export function compileCurveFieldProjection(
  spec: CurveFieldPreviewSpec,
  options: { lutSize?: number } = {}
): CompiledCurveFieldProjection {
  const lutSize = Math.max(2, Math.floor(options.lutSize ?? DEFAULT_LUT_SIZE));
  const { transform } = spec.projection;
  const radians = -transform.rotation;

  const channels = CHANNELS.reduce((compiled, channel) => ({
    ...compiled,
    [channel]: compileChannel(spec.curveSpace.channels[channel], lutSize),
  }), {} as Record<CurveChannelId, Float32Array>);

  return {
    width: spec.output.width,
    height: spec.output.height,
    transform: {
      ...transform,
      cos: Math.cos(radians),
      sin: Math.sin(radians),
    },
    channels,
    lutSize,
    compose: {
      ...spec.projection.compose,
      valueMeaning: spec.curveSpace.domain.valueMeaning,
    },
  };
}