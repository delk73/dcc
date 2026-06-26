import React from 'react';
import type { Channel, ChannelMask } from '../types';
import type { CurveMappingRow } from '../lib/curveMappingRows';
import { cn } from '../lib/utils';

type CurveLaneLegendProps = {
  rows: CurveMappingRow[];
  editChannels: ChannelMask;
  activeChannel?: Channel;
  onToggleChannel: (channel: Channel) => void;
  compact?: boolean;
  className?: string;
};

const CHANNEL_COLORS: Record<Channel, string> = {
  r: '#ef4444',
  g: '#22c55e',
  b: '#3b82f6',
  a: '#a8a29e',
};

export function CurveLaneLegend({
  rows,
  editChannels,
  activeChannel,
  onToggleChannel,
  compact = false,
  className,
}: CurveLaneLegendProps) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1', className)} aria-label="Curve lane legend">
      {rows.map(row => {
        const channel = row.curveId;
        const isEnabled = editChannels[channel];
        const isActive = activeChannel === channel;
        const title = row.parameter
          ? `${row.curveLabel} -> ${row.roleLabel} / ${row.parameter}`
          : `${row.curveLabel} -> ${row.roleLabel}`;

        return (
          <button
            key={`${channel}-${row.parameter ?? row.roleLabel}`}
            type="button"
            onClick={() => onToggleChannel(channel)}
            aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${row.curveLabel} ${row.roleLabel} lane`}
            aria-pressed={isEnabled}
            className={cn(
              'flex min-w-0 items-center gap-1 rounded border px-1 py-0.5 font-mono text-[10px] leading-4 transition-colors',
              compact ? 'max-w-28' : 'max-w-36',
              isEnabled
                ? 'border-zinc-700 bg-zinc-900 text-zinc-200'
                : 'border-zinc-900 bg-transparent text-zinc-600 opacity-50 hover:border-zinc-800 hover:bg-zinc-900/60 hover:text-zinc-400',
              isActive && 'ring-1 ring-zinc-500/70'
            )}
            title={title}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: CHANNEL_COLORS[channel] }}
            />
            <span className="grid h-4 min-w-4 place-items-center rounded border border-zinc-800 bg-zinc-950 font-bold text-zinc-100">
              {row.curveLabel}
            </span>
            <span className="truncate text-zinc-300">{row.roleLabel}</span>
            {row.parameter && <span className="hidden truncate text-zinc-600 xl:inline">{row.parameter}</span>}
          </button>
        );
      })}
    </div>
  );
}