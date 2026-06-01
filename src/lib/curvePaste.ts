import type { Channel, ColorCurve, CurvePoint, LibraryCurve } from '../types';
import { orderCurvePoints } from './curvePointPolicy';
import { computeTangents, evaluateCurve } from './curveUtils';

export type CurvePasteImageMode = 'color-curve' | 'sorted-pixels' | 'top-colors';
export type CurvePasteSpaceMode = 'rows' | 'row-sorted-pixels';

export type CurvePasteImageResult = {
  curve: ColorCurve;
  previewColors: string[];
  summary: string;
};

export type CurvePasteSpaceResult = {
  library: LibraryCurve[];
  previewColors: string[];
  summary: string;
};

const CHANNELS = ['r', 'g', 'b', 'a'] as const;
const SAMPLE_COUNT = 16;
const EVALUATED_ROW_SAMPLE_COUNT = 32;
const CURVE_SAMPLE_ERROR_THRESHOLD = 0.012;
const ROW_MATCH_ERROR_THRESHOLD = 0.045;
const MAX_ROW_MATCH_SPACE_ROWS = 48;
export const MAX_SOURCE_SIZE = 192;

type Rgba = {
  r: number;
  g: number;
  b: number;
  a: number;
};

type WeightedColor = Rgba & {
  count: number;
};

type RowSignature = {
  y: number;
  position: number;
  samples: Array<{ time: number; color: Rgba }>;
  curve: ColorCurve;
  preparedCurve: PreparedCurve;
  evaluatedSamples: Rgba[];
};

type PreparedCurve = {
  sorted: ColorCurve;
  tangents: Record<Channel, number[]>;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const toHex = (color: Rgba) =>
  `#${Math.round(clamp01(color.r) * 255).toString(16).padStart(2, '0')}${Math.round(clamp01(color.g) * 255).toString(16).padStart(2, '0')}${Math.round(clamp01(color.b) * 255).toString(16).padStart(2, '0')}`;

const luminance = (color: Rgba) =>
  color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;

const colorDistance = (a: Rgba, b: Rgba) =>
  Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

const rgbaDistance = (a: Rgba, b: Rgba) =>
  colorDistance(a, b) + Math.abs(a.a - b.a);

const lerpRgba = (a: Rgba, b: Rgba, t: number): Rgba => ({
  r: a.r + ((b.r - a.r) * t),
  g: a.g + ((b.g - a.g) * t),
  b: a.b + ((b.b - a.b) * t),
  a: a.a + ((b.a - a.a) * t)
});

const lerpSampleColor = (
  start: { time: number; color: Rgba },
  end: { time: number; color: Rgba },
  time: number
) => {
  const t = (time - start.time) / (end.time - start.time || 1);
  return lerpRgba(start.color, end.color, t);
};

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

const selectSparseChannelSamples = (
  samples: Array<{ time: number; color: Rgba }>,
  channel: Channel,
  errorThreshold = CURVE_SAMPLE_ERROR_THRESHOLD
) => {
  if (samples.length <= 2) return samples;

  const selected = new Set([0, samples.length - 1]);
  const segments = [{ startIndex: 0, endIndex: samples.length - 1 }];

  while (segments.length > 0) {
    let bestSegmentIndex = -1;
    let bestSampleIndex = -1;
    let bestError = 0;

    segments.forEach((segment, segmentIndex) => {
      const start = samples[segment.startIndex];
      const end = samples[segment.endIndex];

      for (let index = segment.startIndex + 1; index < segment.endIndex; index += 1) {
        const expected = lerpSampleColor(start, end, samples[index].time);
        const error = Math.abs(expected[channel] - samples[index].color[channel]);
        if (error > bestError) {
          bestError = error;
          bestSampleIndex = index;
          bestSegmentIndex = segmentIndex;
        }
      }
    });

    if (bestSegmentIndex === -1 || bestSampleIndex === -1 || bestError <= errorThreshold) break;

    const [segment] = segments.splice(bestSegmentIndex, 1);
    selected.add(bestSampleIndex);

    if (bestSampleIndex - segment.startIndex > 1) {
      segments.push({ startIndex: segment.startIndex, endIndex: bestSampleIndex });
    }
    if (segment.endIndex - bestSampleIndex > 1) {
      segments.push({ startIndex: bestSampleIndex, endIndex: segment.endIndex });
    }
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map(index => samples[index]);
};

const buildCurve = (samples: Array<{ time: number; color: Rgba }>): ColorCurve => {
  const ordered = [...samples].sort((a, b) => a.time - b.time);

  return CHANNELS.reduce((curve, channel) => {
    const channelSamples = selectSparseChannelSamples(ordered, channel);
    const points = channelSamples.map((sample, index) => (
      createImportedPoint(channel, index, sample.time, sample.color[channel], channelSamples.length)
    ));

    return {
      ...curve,
      [channel]: orderCurvePoints(points)
    };
  }, { r: [], g: [], b: [], a: [] } as ColorCurve);
};

export const getScaledImageSize = (naturalWidth: number, naturalHeight: number) => {
  const scale = Math.min(1, MAX_SOURCE_SIZE / Math.max(naturalWidth, naturalHeight));

  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale))
  };
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

    const { width, height } = getScaledImageSize(image.naturalWidth, image.naturalHeight);
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

const rowPixels = (width: number, y: number, data: Uint8ClampedArray) =>
  Array.from({ length: width }, (_, x) => pixelAt(data, (y * width + x) * 4));

const samplesFromPixels = (pixels: Rgba[]) =>
  Array.from({ length: SAMPLE_COUNT }, (_, sampleIndex) => {
    const sourceIndex = Math.round((sampleIndex / (SAMPLE_COUNT - 1)) * (pixels.length - 1));

    return {
      time: sampleIndex / (SAMPLE_COUNT - 1),
      color: pixels[sourceIndex] ?? { r: 0, g: 0, b: 0, a: 1 }
    };
  });

const rowSamples = (width: number, y: number, data: Uint8ClampedArray, mode: CurvePasteSpaceMode) => {
  if (mode === 'row-sorted-pixels') {
    return samplesFromPixels(rowPixels(width, y, data).sort((a, b) => luminance(a) - luminance(b)));
  }

  return Array.from({ length: SAMPLE_COUNT }, (_, sampleIndex) => {
    const x = Math.round((sampleIndex / (SAMPLE_COUNT - 1)) * (width - 1));

    return {
      time: sampleIndex / (SAMPLE_COUNT - 1),
      color: pixelAt(data, (y * width + x) * 4)
    };
  });
};

export const selectSparseCurveSamples = (
  samples: Array<{ time: number; color: Rgba }>,
  errorThreshold = CURVE_SAMPLE_ERROR_THRESHOLD
) => {
  if (samples.length <= 2) return samples;

  const selected = new Set([0, samples.length - 1]);
  const segments = [{ startIndex: 0, endIndex: samples.length - 1 }];

  while (segments.length > 0) {
    let bestSegmentIndex = -1;
    let bestSampleIndex = -1;
    let bestError = 0;

    segments.forEach((segment, segmentIndex) => {
      const start = samples[segment.startIndex];
      const end = samples[segment.endIndex];

      for (let index = segment.startIndex + 1; index < segment.endIndex; index += 1) {
        const expected = lerpSampleColor(start, end, samples[index].time);
        const error = rgbaDistance(expected, samples[index].color);
        if (error > bestError) {
          bestError = error;
          bestSampleIndex = index;
          bestSegmentIndex = segmentIndex;
        }
      }
    });

    if (bestSegmentIndex === -1 || bestSampleIndex === -1 || bestError <= errorThreshold) break;

    const [segment] = segments.splice(bestSegmentIndex, 1);
    selected.add(bestSampleIndex);

    if (bestSampleIndex - segment.startIndex > 1) {
      segments.push({ startIndex: segment.startIndex, endIndex: bestSampleIndex });
    }
    if (segment.endIndex - bestSampleIndex > 1) {
      segments.push({ startIndex: bestSampleIndex, endIndex: segment.endIndex });
    }
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map(index => samples[index]);
};

const prepareCurve = (curve: ColorCurve): PreparedCurve => {
  const sorted = {
    r: [...curve.r].sort((a, b) => a.time - b.time),
    g: [...curve.g].sort((a, b) => a.time - b.time),
    b: [...curve.b].sort((a, b) => a.time - b.time),
    a: [...curve.a].sort((a, b) => a.time - b.time)
  };
  const tangents = {
    r: computeTangents(sorted.r),
    g: computeTangents(sorted.g),
    b: computeTangents(sorted.b),
    a: computeTangents(sorted.a)
  };

  return { sorted, tangents };
};

const evaluatePreparedCurve = ({ sorted, tangents }: PreparedCurve, time: number): Rgba => ({
  r: clamp01(evaluateCurve(sorted.r, tangents.r, time, 'linear')),
  g: clamp01(evaluateCurve(sorted.g, tangents.g, time, 'linear')),
  b: clamp01(evaluateCurve(sorted.b, tangents.b, time, 'linear')),
  a: clamp01(evaluateCurve(sorted.a, tangents.a, time, 'linear'))
});

const evaluateRowSamples = (preparedCurve: PreparedCurve) => {
  return Array.from({ length: EVALUATED_ROW_SAMPLE_COUNT }, (_, index) => {
    const time = index / (EVALUATED_ROW_SAMPLE_COUNT - 1);
    return evaluatePreparedCurve(preparedCurve, time);
  });
};

const createRowSignatures = (
  width: number,
  height: number,
  data: Uint8ClampedArray,
  mode: CurvePasteSpaceMode
): RowSignature[] =>
  Array.from({ length: height }, (_, y) => {
    const samples = selectSparseCurveSamples(rowSamples(width, y, data, mode));
    const curve = buildCurve(samples);
    const preparedCurve = prepareCurve(curve);

    return {
      y,
      position: height === 1 ? 0 : 1 - (y / (height - 1)),
      samples,
      curve,
      preparedCurve,
      evaluatedSamples: evaluateRowSamples(preparedCurve)
    };
  });

const rowInterpolationError = (
  start: RowSignature,
  end: RowSignature,
  candidate: RowSignature
) => {
  const t = (candidate.y - start.y) / (end.y - start.y || 1);

  const keyframeError = candidate.samples.reduce((maxError, sample) => {
    const expected = lerpRgba(
      evaluatePreparedCurve(start.preparedCurve, sample.time),
      evaluatePreparedCurve(end.preparedCurve, sample.time),
      t
    );
    return Math.max(maxError, rgbaDistance(expected, sample.color));
  }, 0);

  const evaluatedCurveError = candidate.evaluatedSamples.reduce((maxError, sample, index) => {
    const expected = lerpRgba(start.evaluatedSamples[index], end.evaluatedSamples[index], t);
    return Math.max(maxError, rgbaDistance(expected, sample));
  }, 0);

  return Math.max(keyframeError, evaluatedCurveError);
};

const findWorstRowError = (
  signatures: RowSignature[],
  startIndex: number,
  endIndex: number
) => {
  let rowIndex = -1;
  let error = 0;

  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const nextError = rowInterpolationError(signatures[startIndex], signatures[endIndex], signatures[index]);
    if (nextError > error) {
      error = nextError;
      rowIndex = index;
    }
  }

  return { startIndex, endIndex, rowIndex, error };
};

export const selectSparseImageRows = (
  signatures: RowSignature[],
  errorThreshold = ROW_MATCH_ERROR_THRESHOLD,
  maxRows = MAX_ROW_MATCH_SPACE_ROWS
): RowSignature[] => {
  if (signatures.length <= 2) return signatures;

  const selected = new Set([0, signatures.length - 1]);
  const segments = [findWorstRowError(signatures, 0, signatures.length - 1)];

  while (segments.length > 0 && selected.size < maxRows) {
    segments.sort((a, b) => b.error - a.error);
    const segment = segments.shift();
    if (!segment || segment.rowIndex === -1 || segment.error <= errorThreshold) break;
    if (selected.has(segment.rowIndex)) continue;

    selected.add(segment.rowIndex);

    if (segment.rowIndex - segment.startIndex > 1) {
      segments.push(findWorstRowError(signatures, segment.startIndex, segment.rowIndex));
    }
    if (segment.endIndex - segment.rowIndex > 1) {
      segments.push(findWorstRowError(signatures, segment.rowIndex, segment.endIndex));
    }
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map(index => signatures[index]);
};

export const spaceLibraryFromImageRows = (
  width: number,
  height: number,
  data: Uint8ClampedArray,
  mode: CurvePasteSpaceMode = 'rows'
): LibraryCurve[] => (
  selectSparseImageRows(createRowSignatures(width, height, data, mode)).map((row, index) => {
    return {
      id: `paste_row_${row.y}_${width}x${height}`,
      name: `Image Row ${index + 1}`,
      category: 'Image Rows',
      position: row.position,
      curve: row.curve,
      authored: true,
      source: 'loaded'
    };
  })
);

const spaceFromImageRows = (width: number, height: number, data: Uint8ClampedArray, mode: CurvePasteSpaceMode) => {
  const library = spaceLibraryFromImageRows(width, height, data, mode);
  const previewRow = Math.max(0, Math.floor((height - 1) / 2));
  const previewSamples = selectSparseCurveSamples(rowSamples(width, previewRow, data, mode));

  return {
    library,
    previewColors: previewSamples.map(sample => toHex(sample.color)),
    summary: mode === 'row-sorted-pixels'
      ? `${library.length} sorted 2D row samples`
      : `${library.length} 2D row samples`
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

export async function imageFileToSpace(file: File, mode: CurvePasteSpaceMode): Promise<CurvePasteSpaceResult> {
  const { width, height, data } = await readImagePixels(file);
  return spaceFromImageRows(width, height, data, mode);
}
