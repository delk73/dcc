import assert from 'node:assert/strict';
import { getScaledImageSize, MAX_SOURCE_SIZE, selectSparseCurveSamples, spaceLibraryFromImageRows } from './curvePaste';

const rgba = (...values: number[]) => new Uint8ClampedArray(values);

const twoRowImage = rgba(
  255, 0, 0, 255,
  0, 255, 0, 255,
  0, 0, 255, 255,
  255, 255, 255, 255
);

const twoRows = spaceLibraryFromImageRows(2, 2, twoRowImage);

assert.equal(twoRows.length, 2);
assert.equal(twoRows[0].position, 1);
assert.equal(twoRows[1].position, 0);

for (const row of twoRows) {
  assert.equal(row.curve.r[0].role, 'boundary');
  assert.equal(row.curve.r.at(-1)?.role, 'boundary');
  assert.equal(row.curve.r[0].time, 0);
  assert.equal(row.curve.r.at(-1)?.time, 1);
  assert.equal(row.curve.g[0].time, 0);
  assert.equal(row.curve.b.at(-1)?.time, 1);
  assert.equal(row.curve.a[0].value, 1);
}

assert.equal(twoRows[0].curve.r[0].value, 1);
assert.equal(twoRows[0].curve.g.at(-1)?.value, 1);
assert.equal(twoRows[1].curve.b[0].value, 1);
assert.equal(twoRows[1].curve.r.at(-1)?.value, 1);

const unsortedRowImage = rgba(
  255, 255, 255, 255,
  0, 0, 0, 255,
  128, 128, 128, 255,
  32, 32, 32, 255
);
const naturalRow = spaceLibraryFromImageRows(4, 1, unsortedRowImage, 'rows')[0];
const sortedRow = spaceLibraryFromImageRows(4, 1, unsortedRowImage, 'row-sorted-pixels')[0];
assert.equal(naturalRow.curve.r[0].value, 1);
assert.equal(sortedRow.curve.r[0].value, 0);

const scaledTall = getScaledImageSize(64, 384);
assert.equal(scaledTall.height, MAX_SOURCE_SIZE);
assert.equal(scaledTall.width, 32);

const tallData = new Uint8ClampedArray(1 * scaledTall.height * 4);
for (let y = 0; y < scaledTall.height; y += 1) {
  tallData[(y * 4) + 3] = 255;
}

const sparseTallRows = spaceLibraryFromImageRows(1, scaledTall.height, tallData);
assert.equal(sparseTallRows.length, 2);
assert.equal(sparseTallRows[0].position, 1);
assert.equal(sparseTallRows[1].position, 0);
assert.equal(sparseTallRows[0].curve.r.length, 2);
assert.equal(sparseTallRows[0].curve.g.length, 2);
assert.equal(sparseTallRows[0].curve.b.length, 2);
assert.equal(sparseTallRows[0].curve.a.length, 2);

const alternatingData = new Uint8ClampedArray(1 * scaledTall.height * 4);
for (let y = 0; y < scaledTall.height; y += 1) {
  const value = y % 2 === 0 ? 0 : 255;
  alternatingData[y * 4] = value;
  alternatingData[(y * 4) + 1] = value;
  alternatingData[(y * 4) + 2] = value;
  alternatingData[(y * 4) + 3] = 255;
}

const highDetailRows = spaceLibraryFromImageRows(1, scaledTall.height, alternatingData);
assert.equal(highDetailRows.length <= 48, true);
assert.equal(highDetailRows.length > 2, true);

const mixedRowShapeData = rgba(
  0, 0, 0, 255,
  0, 0, 0, 255,
  0, 0, 0, 255,
  0, 0, 0, 255,
  0, 0, 0, 255,

  0, 0, 0, 255,
  0, 0, 0, 255,
  255, 255, 255, 255,
  0, 0, 0, 255,
  0, 0, 0, 255,

  0, 0, 0, 255,
  0, 0, 0, 255,
  0, 0, 0, 255,
  0, 0, 0, 255,
  0, 0, 0, 255
);
const mixedRowShapeRows = spaceLibraryFromImageRows(5, 3, mixedRowShapeData);
assert.equal(mixedRowShapeRows.length, 3);
assert.equal(mixedRowShapeRows[0].curve.r.length, 2);
assert.equal(mixedRowShapeRows[1].curve.r.length > 2, true);
assert.equal(mixedRowShapeRows[1].curve.a.length, 2);
assert.equal(mixedRowShapeRows[2].curve.r.length, 2);

const flatSamples = [
  { time: 0, color: { r: 0.25, g: 0.25, b: 0.25, a: 1 } },
  { time: 0.25, color: { r: 0.25, g: 0.25, b: 0.25, a: 1 } },
  { time: 0.5, color: { r: 0.25, g: 0.25, b: 0.25, a: 1 } },
  { time: 0.75, color: { r: 0.25, g: 0.25, b: 0.25, a: 1 } },
  { time: 1, color: { r: 0.25, g: 0.25, b: 0.25, a: 1 } }
];
assert.equal(selectSparseCurveSamples(flatSamples).length, 2);

const peakedSamples = [
  { time: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
  { time: 0.25, color: { r: 0, g: 0, b: 0, a: 1 } },
  { time: 0.5, color: { r: 1, g: 1, b: 1, a: 1 } },
  { time: 0.75, color: { r: 0, g: 0, b: 0, a: 1 } },
  { time: 1, color: { r: 0, g: 0, b: 0, a: 1 } }
];
assert.equal(selectSparseCurveSamples(peakedSamples).length > 2, true);

console.log('-> [PASS] curve paste row-match 2D conversion.');
