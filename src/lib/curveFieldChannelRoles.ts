import type { CurveFieldBasisIr } from './curveFieldBasisIr';
import { getCurveFieldMappingRows } from './curveMappingRows';

export function getCurveFieldChannelRoleLabels(basis: CurveFieldBasisIr): string[] {
  return getCurveFieldMappingRows(basis, { shortLabels: true })
    .map(row => `${row.curveLabel} ${row.roleLabel}`);
}

export function getCurveFieldChannelRoleSummary(basis: CurveFieldBasisIr): string {
  return getCurveFieldChannelRoleLabels(basis).join('  ');
}