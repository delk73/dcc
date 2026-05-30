import type { Channel, ColorCurve, CurvePoint } from '../types';
import { orderCurvePoints } from './curvePointPolicy';

export type CurvePasteImageMode = 'color-curve' | 'sorted-pixels' | 'top-colors';

export type CurvePasteImageResult = {
  curve: ColorCurve;
  previewColors: string[];
  summary: string;
};

const CHANNELS = ['r', 'g', 'b', 'a'] as const;
const SAMPLE_COUNT = 16;
const MAX_SOURCE_SIZE = 192;

type Rgba = {
  r: number;
  g: number;
  b: number;
  a: number;
};

type WeightedColor = Rgba & {
  count: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const toHex = (color: Rgba) =>
  `#${Math.round(clamp01(color.r) * 255).toString(16).padStart(2, '0')}${Math.round(clamp01(color.g) * 255).toString(16).padStart(2, '0')}${Math.round(clamp01(color.b) * 255).toString(16).padStart(2, '0')}`;

const luminance = (color: Rgba) =>
  color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;

const colorDistance = (a: Rgba, b: Rgba) =>
  Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

const createImportedPoint = (
  channel: Channel,
  index: number,
  time: number,
  value: number,
  total: number
): CurvePoint => ({
  id: `paste_${channel}_${index}_${Math.round(time * 1_000_000)}_${Math.round(value * 1_000_000)}`,
  time: clamp01(time),
  value: clamp01(value),
  role: index === 0 || index === total - 1 ? 'boundary' : 'sample',
  source: 'imported',
  edit: 'free',
  continuity: 'corner',
  outInterpolation: 'linear',
  flags: [],
  constraints: index === 0
    ? { edgeOwner: 'start' }
    : index === total - 1
      ? { edgeOwner: 'end' }
      : undefined
});

const buildCurve = (samples: Array<{ time: number; color: Rgba }>): ColorCurve => {
  const ordered = [...samples].sort((a, b) => a.time - b.time);

  return CHANNELS.reduce((curve, channel) => {
    const points = ordered.map((sample, index) => (
      createImportedPoint(channel, index, sample.time, sample.color[channel], ordered.length)
    ));

    return {
      ...curve,
      [channel]: orderCurvePoints(points)
    };
  }, { r: [], g: [], b: [], a: [] } as ColorCurve);
};

const readImagePixels = async (file: File) => {
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read image.'));
      img.src = imageUrl;
    });

    const scale = Math.min(1, MAX_SOURCE_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is unavailable.');

    ctx.drawImage(image, 0, 0, width, height);
    return {
      width,
      height,
      data: ctx.getImageData(0, 0, width, height).data
    };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

const pixelAt = (data: Uint8ClampedArray, index: number): Rgba => ({
  r: data[index] / 255,
  g: data[index + 1] / 255,
  b: data[index + 2] / 255,
  a: data[index + 3] / 255
});

const curveFromColumns = (width: number, height: number, data: Uint8ClampedArray) => {
  const samples = Array.from({ length: SAMPLE_COUNT }, (_, sampleIndex) => {
    const x = Math.round((sampleIndex / (SAMPLE_COUNT - 1)) * (width - 1));
    const color = { r: 0, g: 0, b: 0, a: 0 };

    for (let y = 0; y < height; y += 1) {
      const pixel = pixelAt(data, (y * width + x) * 4);
      color.r += pixel.r;
      color.g += pixel.g;
      color.b += pixel.b;
      color.a += pixel.a;
    }

    return {
      time: sampleIndex / (SAMPLE_COUNT - 1),
      color: {
        r: color.r / height,
        g: color.g / height,
        b: color.b / height,
        a: color.a / height
      }
    };
  });

  return {
    curve: buildCurve(samples),
    previewColors: samples.map(sample => toHex(sample.color)),
    summary: `${samples.length} column samples`
  };
};

const curveFromSortedPixels = (width: number, height: number, data: Uint8ClampedArray) => {
  const stride = Math.max(1, Math.floor((width * height) / 4096));
  const pixels: Rgba[] = [];

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += stride) {
    const pixel = pixelAt(data, pixelIndex * 4);
    if (pixel.a > 0.02) pixels.push(pixel);
  }

  const sorted = pixels.sort((a, b) => luminance(a) - luminance(b));
  const samples = Array.from({ length: SAMPLE_COUNT }, (_, sampleIndex) => {
    const sourceIndex = Math.round((sampleIndex / (SAMPLE_COUNT - 1)) * (sorted.length - 1));
    return {
      time: sampleIndex / (SAMPLE_COUNT - 1),
      color: sorted[sourceIndex] ?? { r: 0, g: 0, b: 0, a: 1 }
    };
  });

  return {
    curve: buildCurve(samples),
    previewColors: samples.map(sample => toHex(sample.color)),
    summary: `${samples.length} luminance-sorted samples`
  };
};

const curveFromTopColors = (width: number, height: number, data: Uint8ClampedArray) => {
  const bins = new Map<string, WeightedColor>();

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const pixel = pixelAt(data, pixelIndex * 4);
    if (pixel.a < 0.04) continue;

    const r = Math.round(pixel.r * 7) / 7;
    const g = Math.round(pixel.g * 7) / 7;
    const b = Math.round(pixel.b * 7) / 7;
    const key = `${r},${g},${b}`;
    const existing = bins.get(key);

    if (existing) {
      existing.r += pixel.r;
      existing.g += pixel.g;
      existing.b += pixel.b;
      existing.a += pixel.a;
      existing.count += 1;
    } else {
      bins.set(key, { r: pixel.r, g: pixel.g, b: pixel.b, a: pixel.a, count: 1 });
    }
  }

  const colors = [...bins.values()]
    .map(color => ({
      ...color,
      r: color.r / color.count,
      g: color.g / color.count,
      b: color.b / color.count,
      a: color.a / color.count
    }))
    .sort((a, b) => b.count - a.count)
    .reduce<WeightedColor[]>((chosen, color) => {
      if (chosen.length >= 3) return chosen;
      if (chosen.every(existing => colorDistance(existing, color) > 0.28)) chosen.push(color);
      return chosen;
    }, []);

  const fallback = colors[0] ?? { r: 0, g: 0, b: 0, a: 1, count: 1 };
  const palette = colors.length > 0 ? colors : [fallback];
  const total = palette.reduce((sum, color) => sum + color.count, 0) || 1;
  let cursor = 0;
  const samples: Array<{ time: number; color: Rgba }> = [];

  palette.forEach((color, index) => {
    const ratio = color.count / total;
    const start = cursor;
    const end = index === palette.length - 1 ? 1 : Math.min(1, cursor + ratio);
    const center = start + ((end - start) * 0.5);
    if (index === 0) samples.push({ time: 0, color });
    if (center > 0 && center < 1) samples.push({ time: center, color });
    if (index === palette.length - 1) samples.push({ time: 1, color });
    cursor = end;
  });

  return {
    curve: buildCurve(samples),
    previewColors: palette.map(toHex),
    summary: palette.map(color => `${Math.round((color.count / total) * 100)}%`).join(' / ')
  };
};

export async function imageFileToCurve(file: File, mode: CurvePasteImageMode): Promise<CurvePasteImageResult> {
  const { width, height, data } = await readImagePixels(file);

  switch (mode) {
    case 'sorted-pixels':
      return curveFromSortedPixels(width, height, data);
    case 'top-colors':
      return curveFromTopColors(width, height, data);
    case 'color-curve':
    default:
      return curveFromColumns(width, height, data);
  }
}
