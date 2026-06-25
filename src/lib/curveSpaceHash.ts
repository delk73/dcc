import type { CurveFieldProjectionIr } from './curveProjectionIr';
import type { CurveSpaceIr } from './curveSpaceIr';
import { stableHashHex } from './stableHash';

export function hashCurveSpaceIr(curveSpace: CurveSpaceIr): string {
  return stableHashHex(curveSpace);
}

export function hashCurveFieldProjectionIr(projection: CurveFieldProjectionIr): string {
  return stableHashHex(projection);
}

export function hashCurveFieldProjectionCanonical(
  curveSpace: CurveSpaceIr,
  projection: CurveFieldProjectionIr
): string {
  return stableHashHex({ curveSpace, projection });
}