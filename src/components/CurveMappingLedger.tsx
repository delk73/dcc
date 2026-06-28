import React from 'react';
import { Check } from 'lucide-react';
import type { Channel, ChannelMask } from '../types';
import type { InterpMode } from '../lib/curveUtils';
import type { CurveMappingRow } from '../lib/curveMappingRows';
import { cn } from '../lib/utils';

type CurveMappingLedgerProps = {
  rows: CurveMappingRow[];
  editChannels: ChannelMask;
  activeChannel: Channel;
  interpMode: InterpMode;
  onSelectChannel: (channel: Channel) => void;
  onToggleChannel: (channel: Channel) => void;
  className?: string;
};

const formatSource = (row: CurveMappingRow) =>
  row.input ?? row.parameter ?? '-';

const formatClamp = (row: CurveMappingRow) =>
  row.clamp ?? (row.parameter ? 'off' : '-');

const formatInterpMode = (interpMode: InterpMode) => {
  if (interpMode === 'constant') return 'stepped';
  if (interpMode === 'cubic') return 'spline';
  return interpMode;
};

export function CurveMappingLedger({
  rows,
  editChannels,
  activeChannel,
  interpMode,
  onSelectChannel,
  onToggleChannel,
  className,
}: CurveMappingLedgerProps) {
  return (
    <div className={cn('shrink-0 overflow-hidden bg-[#09090b] font-mono text-[10px]', className)}>
      <div className="flex min-h-7 items-center gap-1.5 overflow-hidden border-t border-zinc-900/90 px-1.5 py-1 leading-none text-zinc-500">
        <span className="shrink-0 font-bold uppercase tracking-wider text-zinc-400">Compare:</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {rows.map(row => {
            const enabled = editChannels[row.curveId];

            return (
              <button
                key={`visible-${row.curveId}-${row.parameter ?? row.roleLabel}`}
                type="button"
                onClick={() => onToggleChannel(row.curveId)}
                className={cn(
                  'flex h-5 max-w-32 items-center gap-1 rounded border px-1 text-left leading-none',
                  enabled
                    ? 'border-zinc-700 bg-zinc-900 text-zinc-200'
                    : 'border-zinc-900 bg-transparent text-zinc-600 opacity-60 hover:border-zinc-800 hover:text-zinc-400'
                )}
                aria-pressed={enabled}
                aria-label={`${enabled ? 'Hide' : 'Show'} ${row.curveLabel} ${row.roleLabel}`}
                title={`${row.curveLabel} ${row.roleLabel}`}
              >
                {enabled && <Check className="h-3 w-3 shrink-0" />}
                <span className="shrink-0 font-bold">{row.curveLabel}</span>
                <span className="truncate">{row.roleLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-1 overflow-hidden rounded-sm border border-zinc-900/90 bg-black/20">
        <div className="flex min-h-6 items-center border-b border-zinc-900/90 px-1.5 font-bold uppercase tracking-widest text-zinc-400">
          Channel Bindings
        </div>
        <div className="hidden min-h-6 grid-cols-[minmax(5rem,0.85fr)_minmax(8rem,1.4fr)_minmax(3.75rem,0.55fr)_minmax(4.5rem,0.65fr)_minmax(3.5rem,0.5fr)_2rem] items-center gap-1 border-b border-zinc-900/90 px-1.5 font-bold uppercase tracking-wider text-zinc-500 lg:grid">
          <span>Channel</span>
          <span>Source Expression</span>
          <span>Basis</span>
          <span>State</span>
          <span>Clamp</span>
          <span />
        </div>
        {rows.map(row => {
          const channel = row.curveId;
          const enabled = editChannels[channel];
          const active = activeChannel === channel;
          const title = [
            `${row.curveLabel} / ${row.roleLabel}`,
            formatSource(row),
            formatInterpMode(interpMode),
            enabled ? 'active' : 'hidden',
            formatClamp(row),
          ].filter(Boolean).join(' / ');

          return (
          <button
            key={`${channel}-${row.parameter ?? row.roleLabel}`}
            type="button"
            onClick={() => onSelectChannel(channel)}
            className={cn(
              'grid min-h-9 w-full grid-cols-[1fr_auto] items-center gap-x-2 gap-y-0.5 border-b border-zinc-900/70 px-1.5 py-1 text-left last:border-b-0 lg:min-h-6 lg:grid-cols-[minmax(5rem,0.85fr)_minmax(8rem,1.4fr)_minmax(3.75rem,0.55fr)_minmax(4.5rem,0.65fr)_minmax(3.5rem,0.5fr)_2rem] lg:py-0',
              active ? 'bg-zinc-900/90 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-950',
              !enabled && 'text-zinc-600'
            )}
            title={title}
            aria-label={`Edit ${row.curveLabel} ${row.roleLabel} binding`}
          >
            <span className="truncate">
              <span className={cn('mr-1 inline-block w-2 text-zinc-600', active && 'text-zinc-100')}>{active ? '>' : ''}</span>
              <span className="font-bold text-zinc-300">{row.curveLabel}</span>
              <span className="text-zinc-600"> / </span>
              <span>{row.roleLabel}</span>
            </span>
            <span className="justify-self-end text-zinc-500 lg:hidden">edit</span>
            <span className="col-span-2 flex min-w-0 items-center gap-2 truncate text-zinc-500 lg:col-span-1 lg:block">
              <span className="truncate">{formatSource(row)}</span>
              <span className="text-zinc-700 lg:hidden">/</span>
              <span className="shrink-0 lg:hidden">{formatInterpMode(interpMode)}</span>
              <span className="text-zinc-700 lg:hidden">/</span>
              <span className="shrink-0 lg:hidden">{enabled ? 'active' : 'hidden'}</span>
              <span className="text-zinc-700 lg:hidden">/</span>
              <span className="shrink-0 lg:hidden">clamp {formatClamp(row)}</span>
            </span>
            <span className="hidden truncate text-zinc-500 lg:block">{formatInterpMode(interpMode)}</span>
            <span className="hidden truncate text-zinc-500 lg:block">{enabled ? 'active' : 'hidden'}</span>
            <span className="hidden truncate text-zinc-500 lg:block">{formatClamp(row)}</span>
            <span className="hidden text-zinc-500 lg:block">edit</span>
          </button>
          );
        })}
      </div>
    </div>
  );
}
