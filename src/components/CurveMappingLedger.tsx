import React from 'react';
import { Check, Circle, Copy, Download } from 'lucide-react';
import type { Channel, ChannelMask } from '../types';
import type { InterpMode } from '../lib/curveUtils';
import type { CurveMappingRow } from '../lib/curveMappingRows';
import { cn } from '../lib/utils';

type RecipeIdentity = {
  name: string;
  hash?: string;
  status?: 'clean' | 'dirty';
};

type CurveMappingLedgerProps = {
  recipe: RecipeIdentity;
  rows: CurveMappingRow[];
  editChannels: ChannelMask;
  activeChannel: Channel;
  interpMode: InterpMode;
  onSelectChannel: (channel: Channel) => void;
  onToggleChannel: (channel: Channel) => void;
  onCopyHash?: () => void;
  onExport?: () => void;
  canExport?: boolean;
  className?: string;
};

const SHORT_HASH_LENGTH = 8;

const formatHash = (hash?: string) =>
  hash ? `${hash.slice(0, SHORT_HASH_LENGTH)}${hash.length > SHORT_HASH_LENGTH ? '...' : ''}` : 'none';

const formatSource = (row: CurveMappingRow) =>
  row.input ?? row.parameter ?? '-';

const formatClamp = (row: CurveMappingRow) =>
  row.clamp ? `clamp: ${row.clamp}` : row.parameter ? 'clamp: off' : '-';

const formatInterpMode = (interpMode: InterpMode) => {
  if (interpMode === 'constant') return 'stepped';
  if (interpMode === 'cubic') return 'spline';
  return interpMode;
};

export function CurveMappingLedger({
  recipe,
  rows,
  editChannels,
  activeChannel,
  interpMode,
  onSelectChannel,
  onToggleChannel,
  onCopyHash,
  onExport,
  canExport = true,
  className,
}: CurveMappingLedgerProps) {
  return (
    <div className={cn('shrink-0 overflow-hidden border-t border-zinc-900/90 bg-[#09090b]', className)}>
      <div className="flex min-h-7 items-center gap-2 overflow-hidden px-1.5 py-1 font-mono text-[10px] leading-none text-zinc-500">
        <span className="shrink-0 font-bold uppercase tracking-wider text-zinc-400">Recipe:</span>
        <span className="min-w-0 truncate text-zinc-200" title={recipe.name}>{recipe.name}</span>
        {recipe.hash && (
          <span className="shrink-0 text-zinc-500" title={recipe.hash}>
            hash <span className="text-zinc-300">{formatHash(recipe.hash)}</span>
          </span>
        )}
        {recipe.status && <span className="shrink-0 text-zinc-500">{recipe.status}</span>}
        {recipe.hash && onCopyHash && (
          <button
            type="button"
            onClick={onCopyHash}
            className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-100"
            title="Copy recipe hash"
            aria-label="Copy recipe hash"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {onExport && (
          <button
            type="button"
            onClick={onExport}
            disabled={!canExport}
            className={cn(
              'grid h-5 w-5 shrink-0 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-100',
              !canExport && 'cursor-not-allowed opacity-40'
            )}
            title="Export"
            aria-label="Export"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-sm border border-zinc-900/90 bg-black/20 font-mono text-[10px] leading-5">
        {rows.map(row => {
          const channel = row.curveId;
          const enabled = editChannels[channel];
          const active = activeChannel === channel;
          const title = [
            row.curveLabel,
            row.roleLabel,
            row.parameter,
            row.input,
            formatInterpMode(interpMode),
            formatClamp(row),
          ].filter(Boolean).join(' / ');

          return (
            <div
              key={`${channel}-${row.parameter ?? row.roleLabel}`}
              className={cn(
                'grid min-h-6 grid-cols-[1rem_1rem_1.25rem_minmax(4rem,0.9fr)_minmax(5rem,1fr)_minmax(3.75rem,0.7fr)_minmax(4.5rem,0.75fr)_2rem] items-center gap-1 border-b border-zinc-900/70 px-1.5 last:border-b-0',
                active ? 'bg-zinc-900/90 text-zinc-100' : 'text-zinc-400',
                !enabled && 'text-zinc-600'
              )}
              title={title}
            >
              <button
                type="button"
                onClick={() => onSelectChannel(channel)}
                className={cn('h-5 text-left text-zinc-600 hover:text-zinc-100', active && 'text-zinc-100')}
                aria-label={`Select ${row.curveLabel} mapping`}
              >
                {active ? '>' : ''}
              </button>
              <button
                type="button"
                onClick={() => onToggleChannel(channel)}
                className={cn('grid h-5 w-5 place-items-center rounded hover:bg-white/10', enabled ? 'text-zinc-200' : 'text-zinc-600')}
                aria-label={`${enabled ? 'Disable' : 'Enable'} ${row.curveLabel} mapping`}
                aria-pressed={enabled}
              >
                {enabled ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}
              </button>
              <span className="font-bold text-zinc-300">{row.curveLabel}</span>
              <span className="truncate" title={row.roleLabel}>{row.roleLabel}</span>
              <span className="truncate text-zinc-500" title={formatSource(row)}>{formatSource(row)}</span>
              <span className="truncate text-zinc-500">{formatInterpMode(interpMode)}</span>
              <span className="truncate text-zinc-500">{formatClamp(row)}</span>
              <button
                type="button"
                onClick={() => onSelectChannel(channel)}
                className="h-5 rounded px-1 text-left text-zinc-500 hover:bg-white/10 hover:text-zinc-100"
              >
                edit
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
