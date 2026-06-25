import type { ColorCurve, CurvePoint } from '../types';

export type CurveChannelId = 'r' | 'g' | 'b' | 'a';

export type CurveSpaceIr = {
  version: 1;
  kind: 'curve-space';
  channels: Record<CurveChannelId, CurvePoint[]>;
  domain: {
    tMin: 0;
    tMax: 1;
    valueMin: 0;
    valueMax: 2;
    valueMeaning: 'hdr-offset-signed';
  };
};

export const CURVE_SPACE_DOMAIN: CurveSpaceIr['domain'] = {
  tMin: 0,
  tMax: 1,
  valueMin: 0,
  valueMax: 2,
  valueMeaning: 'hdr-offset-signed',
};

export function colorCurveToCurveSpaceIr(curve: ColorCurve): CurveSpaceIr {
  return {
    version: 1,
    kind: 'curve-space',
    channels: {
      r: curve.r,
      g: curve.g,
      b: curve.b,
      a: curve.a,
    },
    domain: CURVE_SPACE_DOMAIN,
  };
}

export function curveSpaceIrToColorCurve(curveSpace: CurveSpaceIr): ColorCurve {
  return {
    r: curveSpace.channels.r,
    g: curveSpace.channels.g,
    b: curveSpace.channels.b,
    a: curveSpace.channels.a,
  };
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clampHdr(value: number): number {
  return Math.max(0, Math.min(2, value));
}

export function hdrToSigned(value: number): number {
  return clampHdr(value) - 1;
}

export function signedToHdr(value: number): number {
  return Math.max(0, Math.min(2, value + 1));
}

export function signedCoordToT(value: number): number {
  return clamp01((value + 1) * 0.5);
}

export function signedToCurveT(value: number): number {
  return signedCoordToT(value);
}

export function signedToPreviewGray(value: number): number {
  return signedCoordToT(value);
}