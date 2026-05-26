import React, { useMemo, useState } from 'react';
import { ClipboardPaste, Upload, X } from 'lucide-react';
import type { ColorCurve } from '../types';
import { parseCurveImportText } from '../lib/curveImport';
import { cn } from '../lib/utils';

interface CurveImportPanelProps {
  onImport: (curve: ColorCurve) => void;
  dense?: boolean;
  className?: string;
}

const CHANNEL_COLORS = {
  r: 'bg-red-500',
  g: 'bg-green-500',
  b: 'bg-blue-500',
  a: 'bg-stone-400'
};

export const CurveImportPanel: React.FC<CurveImportPanelProps> = ({ onImport, dense = false, className }) => {
  const [text, setText] = useState('');
  const result = useMemo(() => parseCurveImportText(text), [text]);
  const totalPoints = result.summary.reduce((total, item) => total + item.count, 0);
  const canImport = totalPoints > 0;

  return (
    <div className={cn(
      "bg-[#09090b] border border-zinc-800 rounded-xl flex flex-col min-h-0 overflow-hidden",
      dense ? "p-2 gap-2" : "p-4 gap-3",
      className
    )}>
      <div className={cn("flex items-center justify-between gap-3 border-b border-zinc-800", dense ? "pb-1.5" : "pb-2")}>
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardPaste className={cn("text-zinc-400 shrink-0", dense ? "w-3.5 h-3.5" : "w-4 h-4")} />
          <h3 className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 truncate">Curve Import</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setText('')}
            disabled={!text}
            className={cn(
              "rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:bg-white/5 disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center",
              dense ? "w-7 h-7" : "w-8 h-8"
            )}
            title="Clear import text"
            aria-label="Clear import text"
          >
            <X className={cn(dense ? "w-3.5 h-3.5" : "w-4 h-4")} />
          </button>
          <button
            type="button"
            onClick={() => onImport(result.curve)}
            disabled={!canImport}
            className={cn(
              "rounded-md border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center",
              dense ? "w-7 h-7" : "w-8 h-8"
            )}
            title="Apply imported curve"
            aria-label="Apply imported curve"
          >
            <Upload className={cn(dense ? "w-3.5 h-3.5" : "w-4 h-4")} />
          </button>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        className={cn(
          "resize-y rounded-lg border border-zinc-800 bg-black/50 font-mono text-xs text-zinc-200 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700",
          dense ? "min-h-16 flex-1 p-2 leading-4" : "min-h-36 p-3 leading-5"
        )}
        placeholder="Begin Object Class=/Script/CurveEditor..."
      />

      <div className={cn("flex flex-wrap items-center", dense ? "gap-1.5" : "gap-2")}>
        {result.summary.map(item => (
          <div
            key={item.channel}
            className={cn(
              'rounded-md border border-zinc-800 bg-black/40 font-mono text-zinc-300 flex items-center justify-center gap-1.5',
              dense ? 'h-6 min-w-10 px-1.5 text-[10px]' : 'h-7 min-w-12 px-2 text-xs',
              item.count === 0 && 'text-zinc-600'
            )}
          >
            <span className={cn('w-2 h-2 rounded-full', CHANNEL_COLORS[item.channel])} />
            {item.channel.toUpperCase()} {item.count}
          </div>
        ))}
      </div>

      {result.warnings.length > 0 && (
        <div className="text-[10px] leading-4 text-zinc-500">
          {result.warnings[0]}
        </div>
      )}
    </div>
  );
};
