import type { Channel, ColorCurve, CurvePoint } from '../types';
import { orderCurvePoints } from './curvePointPolicy';

export type CurveImportChannelSummary = {
  channel: Channel;
  count: number;
};

export type CurveImportResult = {
  curve: ColorCurve;
  summary: CurveImportChannelSummary[];
  warnings: string[];
};

const CHANNELS = ['r', 'g', 'b', 'a'] as const;
const CHANNEL_LABELS = new Set(['r', 'g', 'b', 'a']);
const NUMBER_PATTERN = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const TIME_OFFSET_RE = new RegExp(`\\bTimeOffset\\s*=\\s*(${NUMBER_PATTERN})`);
const CURVE_BLOCK_RE = /Begin Object Class=\/Script\/CurveEditor\.CurveEditorCopyableCurveKeys[\s\S]*?End Object/g;
const SHORT_NAME_RE = /ShortDisplayName="([^"]+)"/;
const KEY_POSITION_RE = new RegExp(
  `KeyPositions\\((\\d+)\\)=\\(([^)]*OutputValue\\s*=\\s*${NUMBER_PATTERN}[^)]*)\\)`,
  'g'
);
const INPUT_VALUE_RE = new RegExp(`\\bInputValue\\s*=\\s*(${NUMBER_PATTERN})`);
const OUTPUT_VALUE_RE = new RegExp(`\\bOutputValue\\s*=\\s*(${NUMBER_PATTERN})`);
const PAIR_RE = new RegExp(`(${NUMBER_PATTERN})\\s*[,\\s]\\s*(${NUMBER_PATTERN})`, 'g');

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const parseNumber = (value: string | undefined, fallback = 0) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const createImportedPoint = (
  channel: Channel,
  index: number,
  time: number,
  value: number,
  total: number
): CurvePoint => ({
  id: `import_${channel}_${index}_${Math.round(time * 1_000_000)}`,
  time,
  value,
  role: index === 0 || index === total - 1 ? 'boundary' : 'interior',
  source: 'imported',
  edit: 'free',
  continuity: 'smooth',
  outInterpolation: 'smooth',
  flags: [],
  constraints: index === 0
    ? { edgeOwner: 'start' }
    : index === total - 1
      ? { edgeOwner: 'end' }
      : undefined
});

const channelFromLabel = (label: string | undefined): Channel | null => {
  const normalized = label?.trim().toLowerCase();
  return normalized && CHANNEL_LABELS.has(normalized)
    ? normalized as Channel
    : null;
};

const dedupeByTime = (points: Array<{ time: number; value: number }>) => {
  const byKey = new Map<number, { time: number; value: number }>();
  points.forEach(point => {
    byKey.set(Math.round(point.time * 1_000_000), point);
  });
  return [...byKey.values()].sort((a, b) => a.time - b.time);
};

const buildChannel = (channel: Channel, points: Array<{ time: number; value: number }>) => {
  const ordered = dedupeByTime(points);
  return orderCurvePoints(ordered.map((point, index) =>
    createImportedPoint(channel, index, point.time, point.value, ordered.length)
  ));
};

const parseUnrealCopyBuffer = (text: string): CurveImportResult | null => {
  const blocks = text.match(CURVE_BLOCK_RE);
  if (!blocks?.length) return null;

  const timeOffset = parseNumber(text.match(TIME_OFFSET_RE)?.[1], 0);
  const parsedByChannel: Partial<Record<Channel, Array<{ time: number; value: number }>>> = {};
  const warnings: string[] = [];

  blocks.forEach((block, blockIndex) => {
    const labelChannel = channelFromLabel(block.match(SHORT_NAME_RE)?.[1]);
    const fallbackChannel = CHANNELS[blockIndex];
    const channel = labelChannel ?? fallbackChannel;
    if (!channel) return;

    const points: Array<{ keyIndex: number; time: number; value: number }> = [];
    for (const match of block.matchAll(KEY_POSITION_RE)) {
      const keyIndex = parseNumber(match[1]);
      const body = match[2];
      const time = clamp(parseNumber(body.match(INPUT_VALUE_RE)?.[1], 0) + timeOffset, 0, 1);
      const value = parseNumber(body.match(OUTPUT_VALUE_RE)?.[1], 0);
      points.push({ keyIndex, time, value });
    }

    if (points.length === 0) {
      warnings.push(`${channel.toUpperCase()} had no readable KeyPositions.`);
      return;
    }

    parsedByChannel[channel] = points
      .sort((a, b) => a.keyIndex - b.keyIndex)
      .map(({ time, value }) => ({ time, value }));
  });

  const curve = CHANNELS.reduce((nextCurve, channel) => ({
    ...nextCurve,
    [channel]: buildChannel(channel, parsedByChannel[channel] ?? [])
  }), { r: [], g: [], b: [], a: [] } as ColorCurve);

  const summary = CHANNELS.map(channel => ({ channel, count: curve[channel].length }));
  if (summary.every(item => item.count === 0)) return null;

  return { curve, summary, warnings };
};

const parseLoosePairs = (text: string): CurveImportResult | null => {
  const points = [...text.matchAll(PAIR_RE)].map(match => ({
    time: clamp(parseNumber(match[1]), 0, 1),
    value: parseNumber(match[2])
  }));

  if (points.length === 0) return null;

  const curve = {
    r: buildChannel('r', points),
    g: [],
    b: [],
    a: []
  };

  return {
    curve,
    summary: CHANNELS.map(channel => ({ channel, count: curve[channel].length })),
    warnings: ['Loose point pairs were imported into R.']
  };
};

export function parseCurveImportText(text: string): CurveImportResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      curve: { r: [], g: [], b: [], a: [] },
      summary: CHANNELS.map(channel => ({ channel, count: 0 })),
      warnings: ['Paste curve text to import.']
    };
  }

  return parseUnrealCopyBuffer(trimmed)
    ?? parseLoosePairs(trimmed)
    ?? {
      curve: { r: [], g: [], b: [], a: [] },
      summary: CHANNELS.map(channel => ({ channel, count: 0 })),
      warnings: ['No point data found.']
    };
}
