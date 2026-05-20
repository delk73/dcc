import { ColorCurve, SpaceAnchor } from '../types';
import { blendSpaceCurves, InterpMode } from './curveUtils';

export const POSITION_EPSILON = 0.001;
export const SNAP_EPSILON = 0.01;

export const clampSpacePosition = (position: number) => Math.max(0, Math.min(1, position));

export const cloneCurve = (curve: ColorCurve): ColorCurve => ({
  r: curve.r.map((point) => ({ ...point })),
  g: curve.g.map((point) => ({ ...point })),
  b: curve.b.map((point) => ({ ...point })),
  a: curve.a.map((point) => ({ ...point }))
});

export const sortAnchors = (anchors: SpaceAnchor[]) =>
  [...anchors].sort((a, b) => (a.position || 0) - (b.position || 0));

export const normalizeAnchors = (anchors: SpaceAnchor[]) => {
  const sorted = sortAnchors(anchors);
  return sorted.map((curve, index) => ({
    ...curve,
    position: curve.position ?? (sorted.length > 1 ? index / (sorted.length - 1) : 0),
    authored: curve.authored ?? true
  }));
};

export const snapToAnchorIfClose = (position: number, anchors: SpaceAnchor[]) => {
  const clamped = clampSpacePosition(position);
  const nearestAnchor = anchors.reduce<SpaceAnchor | null>((nearest, anchor) => {
    if (!nearest) return anchor;
    return Math.abs(anchor.position - clamped) < Math.abs(nearest.position - clamped) ? anchor : nearest;
  }, null);

  return nearestAnchor && Math.abs(nearestAnchor.position - clamped) <= SNAP_EPSILON
    ? nearestAnchor.position
    : clamped;
};

export const evaluateSpaceAt = (
  position: number,
  anchors: SpaceAnchor[],
  interpMode: InterpMode,
  fallbackCurve: ColorCurve
): ColorCurve => {
  if (anchors.length === 0) return cloneCurve(fallbackCurve);
  return cloneCurve(blendSpaceCurves(anchors, clampSpacePosition(position), interpMode));
};
