import React, { useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import type { CurveFieldProjectionIr } from '../lib/curveProjectionIr';
import type { CurveSpaceIr } from '../lib/curveSpaceIr';
import {
  hashCurveFieldProjectionIr,
  hashCurveSpaceIr,
} from '../lib/curveSpaceHash';
import { hashCurveFieldBasisIr } from '../lib/curveFieldBasisHash';

type CurveProjectionIrPanelProps = {
  curveSpace: CurveSpaceIr;
  projection: CurveFieldProjectionIr;
  className?: string;
};

export function CurveProjectionIrPanel({ curveSpace, projection, className }: CurveProjectionIrPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const curveSpaceHash = useMemo(() => hashCurveSpaceIr(curveSpace), [curveSpace]);
  const basisHash = useMemo(() => hashCurveFieldBasisIr(projection.basis), [projection.basis]);
  const projectionHash = useMemo(() => hashCurveFieldProjectionIr(projection), [projection]);
  const summary = useMemo(() => JSON.stringify({
    hierarchy: {
      curveSpace: {
        version: curveSpace.version,
        kind: curveSpace.kind,
        domain: curveSpace.domain,
        channels: {
          r: { points: curveSpace.channels.r.length },
          g: { points: curveSpace.channels.g.length },
          b: { points: curveSpace.channels.b.length },
          a: { points: curveSpace.channels.a.length },
        },
        curveSpaceHash,
      },
      basisRecipe: {
        basisKind: projection.basis.kind,
        basisHash,
        channels: projection.basis.channels,
        bindings: projection.basis.bindings.map(binding => ({
          parameter: binding.parameter,
          curveId: binding.curveId,
          input: binding.input,
          remap: binding.remap,
        })),
        constants: projection.basis.kind === 'shape-lerp'
          ? {
              circleRadius: projection.basis.shapes.a.radius,
              triangleRadius: projection.basis.shapes.b.radius,
              triangleCornerRoundness: projection.basis.shapes.b.cornerRoundness,
            }
          : undefined,
      },
      projection: {
        version: projection.version,
        kind: projection.kind,
        transform: projection.transform,
        selectedBasisKind: projection.basis.kind,
        projectionHash,
      },
      previewSpec: {
        kind: 'curve-field-preview-spec',
        output: 'owned outside projection hash',
      },
      compiledProjection: {
        containsRawCurveSpaceIr: false,
        note: 'compile resolves authored curves and bindings into LUTs and fixed slots',
      },
      realization: {
        note: 'runtime evaluator consumes compiled LUTs, slots, transform, and numeric constants',
      },
    },
  }, null, 2), [curveSpace, projection, curveSpaceHash, basisHash, projectionHash]);

  return (
    <div className={cn('rounded-sm border border-zinc-800 bg-zinc-950', className)}>
      <button type="button" onClick={() => setExpanded(value => !value)} className="flex min-h-5 w-full items-center gap-1.5 px-1.5 py-0.5 text-left leading-none">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">IR Path</span>
        <span className="hidden font-mono text-[10px] text-zinc-600 sm:inline">CurveSpace -&gt; BasisRecipe -&gt; Projection</span>
        <span className="font-mono text-[10px] text-zinc-600">{projection.basis.kind}</span>
        <span className="ml-auto font-mono text-[10px] text-zinc-600">{expanded ? '-' : '+'}</span>
      </button>
      {expanded && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-all px-1.5 pb-1.5 font-mono text-[10px] leading-relaxed text-zinc-400">
          {summary}
        </pre>
      )}
    </div>
  );
}
