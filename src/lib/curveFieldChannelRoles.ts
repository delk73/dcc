import type { CurveFieldBasisIr } from './curveFieldBasisIr';
import type { CurveChannelId } from './curveSpaceIr';

const CHANNEL_LABELS: Record<CurveChannelId, string> = {
  r: 'R',
  g: 'G',
  b: 'B',
  a: 'A',
};

const PARAMETER_LABELS: Record<string, string> = {
  'major.response': 'Major',
  'orthogonal.response': 'Orth',
  'radial.response': 'Radial',
  'circle.response': 'Circle',
  'triangle.response': 'Triangle',
  'shape.morph': 'Morph',
  'transfer.output': 'Transfer',
};

export function getCurveFieldChannelRoleLabels(basis: CurveFieldBasisIr): string[] {
  return basis.bindings
    .filter(binding => PARAMETER_LABELS[binding.parameter])
    .map(binding => `${CHANNEL_LABELS[binding.curveId]} ${PARAMETER_LABELS[binding.parameter]}`);
}

export function getCurveFieldChannelRoleSummary(basis: CurveFieldBasisIr): string {
  return getCurveFieldChannelRoleLabels(basis).join('  ');
}