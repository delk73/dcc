export type CurveViewport = {
  timeMin: number;
  timeMax: number;
  valueMin: number;
  valueMax: number;
};

export type PlotRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type Tick = {
  value: number;
  major: boolean;
  label: string;
};

export const DEFAULT_CURVE_VIEWPORT: CurveViewport = {
  timeMin: 0,
  timeMax: 1,
  valueMin: 0,
  valueMax: 2
};

export const SIGNED_DISTANCE_CURVE_VIEWPORT: CurveViewport = {
  timeMin: 0,
  timeMax: 1,
  valueMin: -1,
  valueMax: 1
};

const TIME_DOMAIN = { min: 0, max: 1 };
const VALUE_DOMAIN = { min: -1, max: 3 };
const MIN_TIME_SPAN = 0.001;
const MIN_VALUE_SPAN = 0.02;
const MAX_VALUE_SPAN = VALUE_DOMAIN.max - VALUE_DOMAIN.min;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const normalizeSpan = (
  min: number,
  max: number,
  domainMin: number,
  domainMax: number,
  minSpan: number,
  maxSpan = domainMax - domainMin
) => {
  const center = Number.isFinite((min + max) / 2) ? (min + max) / 2 : (domainMin + domainMax) / 2;
  const span = clamp(Math.abs(max - min), minSpan, maxSpan);
  let nextMin = center - span / 2;
  let nextMax = center + span / 2;

  if (nextMin < domainMin) {
    nextMax += domainMin - nextMin;
    nextMin = domainMin;
  }
  if (nextMax > domainMax) {
    nextMin -= nextMax - domainMax;
    nextMax = domainMax;
  }

  return {
    min: clamp(nextMin, domainMin, domainMax - span),
    max: clamp(nextMax, domainMin + span, domainMax)
  };
};

export const clampViewport = (viewport: CurveViewport): CurveViewport => {
  const time = normalizeSpan(
    viewport.timeMin,
    viewport.timeMax,
    TIME_DOMAIN.min,
    TIME_DOMAIN.max,
    MIN_TIME_SPAN,
    TIME_DOMAIN.max - TIME_DOMAIN.min
  );
  const value = normalizeSpan(
    viewport.valueMin,
    viewport.valueMax,
    VALUE_DOMAIN.min,
    VALUE_DOMAIN.max,
    MIN_VALUE_SPAN,
    MAX_VALUE_SPAN
  );

  return {
    timeMin: time.min,
    timeMax: time.max,
    valueMin: value.min,
    valueMax: value.max
  };
};

export const timeToX = (time: number, viewport: CurveViewport, plot: PlotRect) => {
  const t = (time - viewport.timeMin) / (viewport.timeMax - viewport.timeMin);
  return plot.left + t * plot.width;
};

export const xToTime = (x: number, viewport: CurveViewport, plot: PlotRect) => {
  const t = (x - plot.left) / plot.width;
  return clamp(viewport.timeMin + t * (viewport.timeMax - viewport.timeMin), TIME_DOMAIN.min, TIME_DOMAIN.max);
};

export const valueToY = (value: number, viewport: CurveViewport, plot: PlotRect) => {
  const t = (value - viewport.valueMin) / (viewport.valueMax - viewport.valueMin);
  return plot.bottom - t * plot.height;
};

export const yToValue = (y: number, viewport: CurveViewport, plot: PlotRect) => {
  const t = (plot.bottom - y) / plot.height;
  return clamp(
    viewport.valueMin + t * (viewport.valueMax - viewport.valueMin),
    viewport.valueMin,
    viewport.valueMax
  );
};

export const zoomViewport = (
  viewport: CurveViewport,
  anchor: { time: number; value: number },
  scaleX: number,
  scaleY: number
): CurveViewport => {
  const nextTimeSpan = (viewport.timeMax - viewport.timeMin) * scaleX;
  const nextValueSpan = (viewport.valueMax - viewport.valueMin) * scaleY;
  const timeRatio = (anchor.time - viewport.timeMin) / (viewport.timeMax - viewport.timeMin);
  const valueRatio = (anchor.value - viewport.valueMin) / (viewport.valueMax - viewport.valueMin);

  return clampViewport({
    timeMin: anchor.time - nextTimeSpan * timeRatio,
    timeMax: anchor.time + nextTimeSpan * (1 - timeRatio),
    valueMin: anchor.value - nextValueSpan * valueRatio,
    valueMax: anchor.value + nextValueSpan * (1 - valueRatio)
  });
};

export const panViewport = (viewport: CurveViewport, deltaTime: number, deltaValue: number): CurveViewport =>
  clampViewport({
    timeMin: viewport.timeMin + deltaTime,
    timeMax: viewport.timeMax + deltaTime,
    valueMin: viewport.valueMin + deltaValue,
    valueMax: viewport.valueMax + deltaValue
  });

export const screenDeltaToCurveDelta = (
  dx: number,
  dy: number,
  viewport: CurveViewport,
  plot: PlotRect
) => ({
  time: -(dx / plot.width) * (viewport.timeMax - viewport.timeMin),
  value: (dy / plot.height) * (viewport.valueMax - viewport.valueMin)
});

const niceStep = (rawStep: number) => {
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = Math.pow(10, exponent);
  const normalized = rawStep / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
};

const precisionForStep = (step: number) => Math.max(0, Math.ceil(-Math.log10(step)) + 1);

export const buildTicks = (min: number, max: number, targetCount: number): Tick[] => {
  const span = Math.max(Number.EPSILON, max - min);
  const majorStep = niceStep(span / Math.max(1, targetCount));
  const minorStep = majorStep / 5;
  const precision = precisionForStep(minorStep);
  const first = Math.ceil(min / minorStep) * minorStep;
  const ticks: Tick[] = [];

  for (let value = first; value <= max + minorStep * 0.5; value += minorStep) {
    const rounded = Number(value.toFixed(precision + 2));
    const majorIndex = Math.round(rounded / majorStep);
    const isMajor = Math.abs(rounded - majorIndex * majorStep) <= minorStep * 0.01;

    ticks.push({
      value: rounded,
      major: isMajor,
      label: isMajor ? rounded.toFixed(precisionForStep(majorStep)) : ''
    });
  }

  return ticks;
};
