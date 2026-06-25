import type { CurveFieldBasisIr } from './curveFieldBasisIr';
import { stableHashHex } from './stableHash';

export function hashCurveFieldBasisIr(basis: CurveFieldBasisIr): string {
  return stableHashHex(basis);
}