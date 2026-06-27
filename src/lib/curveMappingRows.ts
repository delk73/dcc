import type { CurveFieldBasisIr } from './curveFieldBasisIr';
import type { CurveParameterBindingIr, CurveParameterRemapIr } from './curveParameterBindingIr';
import type { CurveChannelId } from './curveSpaceIr';

export type CurveMappingRow = {
  curveId: CurveChannelId;
  curveLabel: string;
  roleLabel: string;
  parameter?: string;
  input?: CurveParameterBindingIr['input'];
  clamp?: CurveParameterRemapIr['clamp'];
};

const CHANNEL_LABELS: Record<CurveChannelId, string> = {
  r: 'R',
  g: 'G',
  b: 'B',
  a: 'A',
};

const ATLAS_ROLE_LABELS: Record<CurveChannelId, string> = {
  r: 'Red',
  g: 'Green',
  b: 'Blue',
  a: 'Alpha',
};

export const CURVE_PARAMETER_ROLE_LABELS: Record<string, string> = {
  'major.response': 'Major',
  'orthogonal.response': 'Orthogonal',
  'radial.response': 'Radial',
  'circle.response': 'Circle',
  'triangle.response': 'Triangle',
  'shape.morph': 'Morph',
  'transfer.output': 'Transfer',
};

export const CURVE_PARAMETER_ROLE_SHORT_LABELS: Record<string, string> = {
  ...CURVE_PARAMETER_ROLE_LABELS,
  'orthogonal.response': 'Orth',
};

const CHANNEL_ROLE_LABELS: Record<string, string> = {
  'major-axis': 'Major',
  'orthogonal-axis': 'Orthogonal',
  'radial-interaction': 'Radial',
  'circle-response': 'Circle',
  'triangle-response': 'Triangle',
  'shape-lerp': 'Morph',
  'final-transfer': 'Transfer',
};

function getChannelSemanticLabel(basis: CurveFieldBasisIr, channel: CurveChannelId): string | undefined {
  return CHANNEL_ROLE_LABELS[basis.channels[channel]];
}

export function getAtlasMappingRows(): CurveMappingRow[] {
  return (['r', 'g', 'b', 'a'] as CurveChannelId[]).map(curveId => ({
    curveId,
    curveLabel: CHANNEL_LABELS[curveId],
    roleLabel: ATLAS_ROLE_LABELS[curveId],
  }));
}

export function getCurveFieldMappingRows(
  basis: CurveFieldBasisIr,
  options: { shortLabels?: boolean } = {}
): CurveMappingRow[] {
  const parameterLabels = options.shortLabels ? CURVE_PARAMETER_ROLE_SHORT_LABELS : CURVE_PARAMETER_ROLE_LABELS;

  return basis.bindings
    .map((binding): CurveMappingRow | undefined => {
      const parameterLabel = parameterLabels[binding.parameter];
      if (!parameterLabel && binding.parameter.includes('.')) return undefined;
      const roleLabel = parameterLabel ?? getChannelSemanticLabel(basis, binding.curveId);

      return roleLabel ? {
        curveId: binding.curveId,
        curveLabel: CHANNEL_LABELS[binding.curveId],
        roleLabel,
        parameter: binding.parameter,
        input: binding.input,
        clamp: binding.remap?.clamp,
      } : undefined;
    })
    .filter((row): row is CurveMappingRow => Boolean(row));
}
