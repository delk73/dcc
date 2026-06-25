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

const CHANNEL_ROLE_LABELS: Record<string, string> = {
  'major-axis': 'Major',
  'orthogonal-axis': 'Orth',
  'radial-interaction': 'Radial',
  'circle-response': 'Circle',
  'triangle-response': 'Triangle',
  'shape-lerp': 'Morph',
  'final-transfer': 'Transfer',
};

function getChannelSemanticLabel(basis: CurveFieldBasisIr, channel: CurveChannelId): string | undefined {
  return CHANNEL_ROLE_LABELS[basis.channels[channel]];
}

export function getCurveFieldChannelRoleLabels(basis: CurveFieldBasisIr): string[] {
  return basis.bindings
    .map(binding => {
      if (!PARAMETER_LABELS[binding.parameter]) return undefined;
      const roleLabel = getChannelSemanticLabel(basis, binding.curveId) ?? PARAMETER_LABELS[binding.parameter];
      return roleLabel ? `${CHANNEL_LABELS[binding.curveId]} ${roleLabel}` : undefined;
    })
    .filter((label): label is string => Boolean(label));
}

export function getCurveFieldChannelRoleSummary(basis: CurveFieldBasisIr): string {
  return getCurveFieldChannelRoleLabels(basis).join('  ');
}