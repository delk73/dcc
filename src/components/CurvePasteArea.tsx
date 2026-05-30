import React, { useMemo, useState } from 'react';
import { ClipboardPaste, FileInput, ImagePlus, Upload, X } from 'lucide-react';
import type { ColorCurve } from '../types';
import { parseCurveImportText } from '../lib/curveImport';
import { imageFileToCurve, type CurvePasteImageMode } from '../lib/curvePaste';
import { cn } from '../lib/utils';

interface CurvePasteAreaProps {
  onImport: (curve: ColorCurve) => void;
  className?: string;
}

const MODES: Array<{ value: CurvePasteImageMode; label: string; title: string }> = [
  { value: 'color-curve', label: 'Image CC', title: 'Sample image columns as a color curve' },
  { value: 'sorted-pixels', label: 'Pixel Sort', title: 'Sort image pixels by luminance and sample them into the curve' },
  { value: 'top-colors', label: 'Top Colors', title: 'Use the strongest colors and their image ratios' }
];

const CHANNEL_COLORS = {
  r: 'bg-red-500',
  g: 'bg-green-500',
  b: 'bg-blue-500',
  a: 'bg-stone-400'
};

const firstImageFile = (files: FileList | File[]) =>
  [...files].find(file => file.type.startsWith('image/')) ?? null;

type CapturedPayload =
  | { kind: 'image'; file: File }
  | { kind: 'text'; text: string }
  | null;

export const CurvePasteArea: React.FC<CurvePasteAreaProps> = ({ onImport, className }) => {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<CurvePasteImageMode>('color-curve');
  const [imageResult, setImageResult] = useState<Awaited<ReturnType<typeof imageFileToCurve>> | null>(null);
  const [capturedPayload, setCapturedPayload] = useState<CapturedPayload>(null);
  const [status, setStatus] = useState('Paste text, drop an image, or paste pixels.');
  const [isDragging, setIsDragging] = useState(false);
  const [acknowledgedAt, setAcknowledgedAt] = useState(0);

  const textResult = useMemo(() => parseCurveImportText(text), [text]);
  const textPointCount = textResult.summary.reduce((total, item) => total + item.count, 0);
  const canImportText = textPointCount > 0;
  const canImportImage = imageResult !== null;
  const hasPayload = capturedPayload !== null || canImportImage || canImportText;
  const resultLabel = capturedPayload?.kind === 'image'
    ? 'Image Result'
    : capturedPayload?.kind === 'text'
      ? 'Curve Result'
      : 'Paste Result';

  const acknowledgePaste = () => {
    setAcknowledgedAt(Date.now());
  };

  const readImage = async (file: File, nextMode = mode, acknowledge = true) => {
    setCapturedPayload({ kind: 'image', file });
    if (acknowledge) acknowledgePaste();
    setStatus('Reading image...');
    try {
      const result = await imageFileToCurve(file, nextMode);
      setImageResult(result);
      setStatus(result.summary);
    } catch (error) {
      setImageResult(null);
      setStatus(error instanceof Error ? error.message : 'Could not read image.');
    }
  };

  const handleModeChange = async (nextMode: CurvePasteImageMode) => {
    setMode(nextMode);
    if (capturedPayload?.kind === 'image') {
      await readImage(capturedPayload.file, nextMode, false);
      return;
    }
    setStatus(capturedPayload?.kind === 'text'
      ? 'Image modes apply to pasted or dropped images.'
      : 'Drop or paste an image for this mode.'
    );
  };

  const handlePaste: React.ClipboardEventHandler<HTMLDivElement> = (event) => {
    const imageItem = [...event.clipboardData.items].find(item => item.type.startsWith('image/'));
    const imageFile = imageItem?.getAsFile();

    if (imageFile) {
      event.preventDefault();
      void readImage(imageFile);
      return;
    }

    const pastedText = event.clipboardData.getData('text');
    if (pastedText) {
      event.preventDefault();
      setText(pastedText);
      setImageResult(null);
      setCapturedPayload({ kind: 'text', text: pastedText });
      const pastedResult = parseCurveImportText(pastedText);
      const pointCount = pastedResult.summary.reduce((total, item) => total + item.count, 0);
      setStatus(pointCount > 0 ? `${pointCount} curve points parsed.` : pastedResult.warnings[0] ?? 'No point data found.');
      acknowledgePaste();
    }
  };

  const handleDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const imageFile = firstImageFile(event.dataTransfer.files);
    if (imageFile) void readImage(imageFile);
  };

  return (
    <div
      className={cn(
        "shrink-0 rounded-lg border border-zinc-800 bg-black/40 p-2 outline-none",
        isDragging && "border-zinc-500 bg-white/5",
        className
      )}
      tabIndex={0}
      onPaste={handlePaste}
      onDragEnter={() => setIsDragging(true)}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardPaste className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <h3 className="truncate text-[10px] font-bold uppercase tracking-wider text-zinc-400">Paste Area</h3>
        </div>

        <div className="flex items-center gap-1">
          <div className="flex rounded-md border border-zinc-800 bg-black p-0.5" aria-label="Image interpretation mode">
            {MODES.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => void handleModeChange(option.value)}
                className={cn(
                  "h-6 min-w-14 rounded px-2 text-[10px] font-medium text-zinc-500 hover:text-zinc-200",
                  mode === option.value && "bg-zinc-800 text-zinc-100"
                )}
                title={option.title}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label
            className="grid h-7 w-7 cursor-pointer place-items-center rounded-md border border-zinc-800 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
            title="Load image"
            aria-label="Load image"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const imageFile = firstImageFile(event.target.files ?? []);
                if (imageFile) void readImage(imageFile);
                event.target.value = '';
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => {
              setText('');
              setImageResult(null);
              setCapturedPayload(null);
              setStatus('Paste text, drop an image, or paste pixels.');
            }}
            className="grid h-7 w-7 place-items-center rounded-md border border-zinc-800 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
            title="Clear paste area"
            aria-label="Clear paste area"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onImport(imageResult?.curve ?? textResult.curve)}
            disabled={!canImportImage && !canImportText}
            className="grid h-7 w-7 place-items-center rounded-md border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-35"
            title="Apply paste area curve"
            aria-label="Apply paste area curve"
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <div
          key={acknowledgedAt}
          className={cn(
            "relative flex h-16 min-h-16 items-center gap-3 overflow-hidden rounded-md border border-zinc-800 bg-black/60 px-3 outline-none transition-colors",
            isDragging && "border-zinc-500 bg-white/5",
            hasPayload && "border-zinc-700",
            acknowledgedAt > 0 && "animate-[paste-ack_720ms_ease-out]"
          )}
        >
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-zinc-800 bg-black/60 text-zinc-500">
            <FileInput className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-zinc-300">
              {hasPayload ? 'Paste captured' : 'Paste or drop here'}
            </div>
            <div className="truncate text-[10px] leading-4 text-zinc-500">
              {capturedPayload?.kind === 'image'
                ? `Image ${mode === 'color-curve' ? 'sampled' : mode === 'sorted-pixels' ? 'sorted' : 'analyzed'}`
                : capturedPayload?.kind === 'text' && canImportText
                  ? `${textPointCount} curve points parsed`
                  : 'Images, UE copy buffers, or loose point pairs'}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-0 opacity-0" />
        </div>

        <div className="flex w-32 flex-col gap-1.5">
          <div className="overflow-hidden rounded-md border border-zinc-800 bg-black">
            <div className="border-b border-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-600">
              {resultLabel}
            </div>
            <div className="grid h-6 grid-cols-4">
              {imageResult?.previewColors.slice(0, 4).map((color, index) => (
                <div key={`${color}-${index}`} style={{ backgroundColor: color }} />
              )) ?? (
                <div className="col-span-4 grid place-items-center text-[9px] text-zinc-700">
                  {capturedPayload?.kind === 'text' ? `${textPointCount} pts` : 'empty'}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {textResult.summary.map(item => (
              <span
                key={item.channel}
                className={cn(
                  "flex h-5 min-w-8 items-center justify-center gap-1 rounded border border-zinc-800 bg-black/50 px-1 font-mono text-[9px] text-zinc-400",
                  item.count === 0 && "text-zinc-700"
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", CHANNEL_COLORS[item.channel])} />
                {item.channel.toUpperCase()}{item.count}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-1 truncate text-[10px] leading-4 text-zinc-500">
        {imageResult ? `Image: ${status}` : textResult.warnings[0] || status}
      </div>

      <style>{`
        @keyframes paste-ack {
          0% {
            box-shadow: 0 0 0 0 rgba(99, 102, 241, 0);
            background:
              radial-gradient(circle at 18% 50%, rgba(99, 102, 241, 0.36), transparent 38%),
              linear-gradient(90deg, rgba(34, 197, 94, 0.14), rgba(59, 130, 246, 0.16), rgba(244, 114, 182, 0.12)),
              rgba(0, 0, 0, 0.6);
          }
          45% {
            box-shadow: 0 0 28px rgba(99, 102, 241, 0.28);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(99, 102, 241, 0);
            background: rgba(0, 0, 0, 0.6);
          }
        }
      `}</style>
    </div>
  );
};
