import React, { useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import type { CurveFieldProjectionIr } from '../lib/curveProjectionIr';
import type { CurveSpaceIr } from '../lib/curveSpaceIr';
import {
  hashCurveFieldProjectionCanonical,
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
  const canonicalHash = useMemo(
    () => hashCurveFieldProjectionCanonical(curveSpace, projection),
    [curveSpace, projection]
  );
  const summary = useMemo(() => JSON.stringify({
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
      hash: curveSpaceHash,
    },
    projection: {
      version: projection.version,
      kind: projection.kind,
      transform: projection.transform,
      basisKind: projection.basis.kind,
      basisHash,
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
      hash: projectionHash,
    },
    canonicalHash,
  }, null, 2), [curveSpace, projection, curveSpaceHash, basisHash, projectionHash, canonicalHash]);

  return (
    <div className={cn('rounded border border-zinc-800 bg-zinc-950', className)}>
      <button type="button" onClick={() => setExpanded(value => !value)} className="flex w-full items-center gap-2 px-2 py-1 text-left">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">IR / Hash</span>
        <span className="font-mono text-[10px] text-zinc-600">{projection.basis.kind}</span>
        <span className="ml-auto font-mono text-[10px] text-zinc-500">{canonicalHash}</span>
        <span className="font-mono text-[10px] text-zinc-600">{expanded ? '-' : '+'}</span>
      </button>
      {expanded && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-all px-2 pb-2 font-mono text-[10px] leading-relaxed text-zinc-400">
          {summary}
        </pre>
      )}
    </div>
  );
}