import type { CurveChannelId } from './curveSpaceIr';
import type { CurveParameterBindingIr, CurveParameterInputIr } from './curveParameterBindingIr';

export type CompiledCurveParameterBinding = {
  parameter: string;
  curveId: CurveChannelId;
  input: CurveParameterInputIr;
  remap: {
    scale: number;
    offset: number;
    invert: boolean;
    clamp: 'none' | '01' | 'hdr' | 'signed';
  };
};

export function compileCurveParameterBindings(
  bindings: CurveParameterBindingIr[]
): CompiledCurveParameterBinding[] {
  return bindings.map(binding => ({
    parameter: binding.parameter,
    curveId: binding.curveId,
    input: binding.input,
    remap: {
      scale: binding.remap?.scale ?? 1,
      offset: binding.remap?.offset ?? 0,
      invert: binding.remap?.invert ?? false,
      clamp: binding.remap?.clamp ?? 'none',
    },
  }));
}