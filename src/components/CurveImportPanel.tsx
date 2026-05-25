import React, { useMemo, useState } from 'react';
import { ClipboardPaste, Upload, X } from 'lucide-react';
import type { ColorCurve } from '../types';
import { parseCurveImportText } from '../lib/curveImport';
import { cn } from '../lib/utils';

interface CurveImportPanelProps {
  onImport: (curve: ColorCurve) => void;
}

const CHANNEL_COLORS = {
  r: 'bg-red-500',
  g: 'bg-green-500',
  b: 'bg-blue-500',
  a: 'bg-stone-400'
};

export const CurveImportPanel: React.FC<CurveImportPanelProps> = ({ onImport }) => {
  const [text, setText] = useState('');
  const result = useMemo(() => parseCurveImportText(text), [text]);
  const totalPoints = result.summary.reduce((total, item) => total + item.count, 0);
  const canImport = totalPoints > 0;

  return (
    <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardPaste className="w-4 h-4 text-zinc-400 shrink-0" />
          <h3 className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 truncate">Curve Import</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setText('')}
            disabled={!text}
            className="w-8 h-8 rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:bg-white/5 disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center"
            title="Clear import text"
            aria-label="Clear import text"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onImport(result.curve)}
            disabled={!canImport}
            className="w-8 h-8 rounded-md border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-35 disabled:pointer-events-none flex items-center justify-center"
            title="Apply imported curve"
            aria-label="Apply imported curve"
          >
            <Upload className="w-4 h-4" />
          </button>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        className="min-h-36 resize-y rounded-lg border border-zinc-800 bg-black/50 p-3 font-mono text-xs leading-5 text-zinc-200 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700"
        placeholder="Begin Object Class=/Script/CurveEditor..."
      />

      <div className="flex flex-wrap items-center gap-2">
        {result.summary.map(item => (
          <div
            key={item.channel}
            className={cn(
              'h-7 min-w-12 rounded-md border border-zinc-800 bg-black/40 px-2 text-xs font-mono text-zinc-300 flex items-center justify-center gap-1.5',
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
