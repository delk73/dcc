import assert from 'node:assert/strict';
import {
  DEFAULT_CURVE_VIEWPORT,
  buildTicks,
  clampViewport,
  panViewport,
  screenDeltaToCurveDelta,
  timeToX,
  valueToY,
  xToTime,
  yToValue,
  zoomViewport,
  type PlotRect
} from './curveViewport';

const plot: PlotRect = {
  left: 20,
  top: 20,
  right: 980,
  bottom: 480,
  width: 960,
  height: 460
};

const nearlyEqual = (actual: number, expected: number, epsilon = 0.0000001) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !== ${expected}`);
};

const x = timeToX(0.42, DEFAULT_CURVE_VIEWPORT, plot);
nearlyEqual(xToTime(x, DEFAULT_CURVE_VIEWPORT, plot), 0.42);

const y = valueToY(1.35, DEFAULT_CURVE_VIEWPORT, plot);
nearlyEqual(yToValue(y, DEFAULT_CURVE_VIEWPORT, plot), 1.35);

const anchor = { time: 0.25, value: 0.75 };
const zoomed = zoomViewport(DEFAULT_CURVE_VIEWPORT, anchor, 0.5, 0.5);
nearlyEqual(timeToX(anchor.time, zoomed, plot), timeToX(anchor.time, DEFAULT_CURVE_VIEWPORT, plot));
nearlyEqual(valueToY(anchor.value, zoomed, plot), valueToY(anchor.value, DEFAULT_CURVE_VIEWPORT, plot));

const clampedTime = panViewport(DEFAULT_CURVE_VIEWPORT, -1, 0);
assert.equal(clampedTime.timeMin, 0);
assert.equal(clampedTime.timeMax, 1);

const zoomedInHard = clampViewport({
  timeMin: 0.5,
  timeMax: 0.5000001,
  valueMin: 1,
  valueMax: 1.000001
});
assert.ok(zoomedInHard.timeMax - zoomedInHard.timeMin >= 0.001 - 0.0000001);
assert.ok(zoomedInHard.valueMax - zoomedInHard.valueMin >= 0.02 - 0.0000001);

const delta = screenDeltaToCurveDelta(96, -46, DEFAULT_CURVE_VIEWPORT, plot);
nearlyEqual(delta.time, -0.1);
nearlyEqual(delta.value, -0.2);

const ticks = buildTicks(0.13, 0.37, 4);
assert.ok(ticks.some(tick => tick.major && tick.label.length > 0));
assert.ok(ticks.every(tick => tick.value >= 0.13 - 0.000001 && tick.value <= 0.37 + 0.000001));

console.log('curveViewport tests passed');
