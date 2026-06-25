import React from 'react';
import { cn } from '../lib/utils';
import type { OutputMode } from '../state/curveProjectionState';

type OutputModeTabsProps = {
  mode: OutputMode;
  onChange: (mode: OutputMode) => void;
};

export function OutputModeTabs({ mode, onChange }: OutputModeTabsProps) {
  return (
    <div className="flex items-center gap-0.5 rounded border border-zinc-800 bg-zinc-950 p-0.5">
      <button
        type="button"
        onClick={() => onChange('atlas')}
        className={cn(
          'rounded px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
          mode === 'atlas' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
        )}
      >
        2D Atlas
      </button>
      <button
        type="button"
        onClick={() => onChange('curve-field')}
        className={cn(
          'rounded px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
          mode === 'curve-field' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
        )}
      >
        Curve Field
      </button>
    </div>
  );
}