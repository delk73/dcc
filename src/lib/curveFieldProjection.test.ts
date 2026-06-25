import assert from 'node:assert/strict';
import { compileCurveFieldProjection } from './curveFieldProjectionCompile';
import { evaluateCompiledCurveFieldProjection, worldToCurveFieldLocal } from './curveFieldProjectionEval';
import { DEFAULT_CURVE_FIELD_PROJECTION, type CurveFieldProjectionIr, type CurveFieldPreviewSpec } from './curveProjectionIr';
import {
  colorCurveToCurveSpaceIr,
  hdrToSigned,
  signedToPreviewGray,
  type CurveChannelId,
  type CurveSpaceIr,
} from './curveSpaceIr';
import { hashCurveFieldProjectionIr, hashCurveSpaceIr } from './curveSpaceHash';
import { migrateKeyframesToCurvePoints } from './curvePointPolicy';
import type { ColorCurve } from '../types';

const nearlyEqual = (actual: number, expected: number, epsilon = 0.000001) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !== ${expected}`);
};

const makeChannel = (values: Array<[number, number]>) =>
  migrateKeyframesToCurvePoints(values.map(([time, value]) => ({ time, value })));

const neutral = makeChannel([[0, 1], [1, 1]]);
const positive = makeChannel([[0, 2], [1, 2]]);
const identityTransfer = makeChannel([[0, 0], [0.5, 1], [1, 2]]);

function makeCurve(overrides: Partial<ColorCurve> = {}): ColorCurve {
  return {
    r: positive,
    g: positive,
    b: positive,
    a: identityTransfer,
    ...overrides,
  };
}

function makeCurveSpace(overrides: Partial<ColorCurve> = {}): CurveSpaceIr {
  return colorCurveToCurveSpaceIr(makeCurve(overrides));
}

function makeProjection(
  overrides: Partial<Omit<CurveFieldProjectionIr, 'transform'>> & {
    transform?: Partial<CurveFieldProjectionIr['transform']>;
  } = {}
): CurveFieldProjectionIr {
  return {
    ...DEFAULT_CURVE_FIELD_PROJECTION,
    ...overrides,
    transform: {
      ...DEFAULT_CURVE_FIELD_PROJECTION.transform,
      ...overrides.transform,
    },
  };
}

function makeSpec(curveSpace = makeCurveSpace(), projection = makeProjection(), size = 64): CurveFieldPreviewSpec {
  return {
    curveSpace,
    projection,
    output: { width: size, height: size },
  };
}

assert.equal(hashCurveSpaceIr(makeCurveSpace()), hashCurveSpaceIr(makeCurveSpace()), 'CurveSpaceIr hash is deterministic');

(['r', 'g', 'b', 'a'] as CurveChannelId[]).forEach(channel => {
  assert.notEqual(
    hashCurveSpaceIr(makeCurveSpace()),
    hashCurveSpaceIr(makeCurveSpace({ [channel]: neutral })),
    `CurveSpaceIr hash changes when ${channel.toUpperCase()} changes`
  );
});

assert.notEqual(
  hashCurveFieldProjectionIr(makeProjection()),
  hashCurveFieldProjectionIr(makeProjection({ transform: { rotation: 0.5 } })),
  'Projection hash changes when transform changes'
);

assert.equal(
  hashCurveSpaceIr(makeSpec(makeCurveSpace(), makeProjection(), 64).curveSpace),
  hashCurveSpaceIr(makeSpec(makeCurveSpace(), makeProjection(), 512).curveSpace),
  'Preview size does not change canonical curve-space hash'
);

const compiled = compileCurveFieldProjection(makeSpec(), { lutSize: 16 });
assert.equal(compiled.channels.r.length, 16, 'compile creates R LUT');
assert.equal(compiled.channels.g.length, 16, 'compile creates G LUT');
assert.equal(compiled.channels.b.length, 16, 'compile creates B LUT');
assert.equal(compiled.channels.a.length, 16, 'compile creates A LUT');
assert.equal(evaluateCompiledCurveFieldProjection(compiled, 31, 31), evaluateCompiledCurveFieldProjection(compiled, 31, 31), 'compiled evaluator is deterministic');
assert.equal('curveSpace' in compiled, false, 'compiled evaluator does not require raw curve-space data');

assert.equal(hdrToSigned(0), -1, 'HDR 0 maps to signed -1');
assert.equal(hdrToSigned(1), 0, 'HDR 1 maps to signed 0');
assert.equal(hdrToSigned(2), 1, 'HDR 2 maps to signed +1');
assert.equal(signedToPreviewGray(-1), 0, 'signed -1 maps to grayscale 0');
assert.equal(signedToPreviewGray(0), 0.5, 'signed 0 maps to grayscale 0.5');
assert.equal(signedToPreviewGray(1), 1, 'signed +1 maps to grayscale 1');

const unitCompiled = compileCurveFieldProjection(makeSpec(makeCurveSpace(), makeProjection(), 3));
nearlyEqual(worldToCurveFieldLocal(0.5, 0.5, unitCompiled.transform)[0], 0);
nearlyEqual(worldToCurveFieldLocal(0.5, 0.5, unitCompiled.transform)[1], 0);
nearlyEqual(worldToCurveFieldLocal(0, 0.5, unitCompiled.transform)[0], -1);
nearlyEqual(worldToCurveFieldLocal(1, 0.5, unitCompiled.transform)[0], 1);
nearlyEqual(worldToCurveFieldLocal(0.5, 0, unitCompiled.transform)[1], -1);
nearlyEqual(worldToCurveFieldLocal(0.5, 1, unitCompiled.transform)[1], 1);

const baseline = evaluateCompiledCurveFieldProjection(compileCurveFieldProjection(makeSpec(makeCurveSpace())), 32, 32);
const withNeutralR = evaluateCompiledCurveFieldProjection(compileCurveFieldProjection(makeSpec(makeCurveSpace({ r: neutral }))), 32, 32);
const withNeutralG = evaluateCompiledCurveFieldProjection(compileCurveFieldProjection(makeSpec(makeCurveSpace({ g: neutral }))), 32, 32);
const withNeutralB = evaluateCompiledCurveFieldProjection(compileCurveFieldProjection(makeSpec(makeCurveSpace({ b: neutral }))), 32, 32);
const withNeutralA = evaluateCompiledCurveFieldProjection(compileCurveFieldProjection(makeSpec(makeCurveSpace({ a: neutral }))), 32, 32);

assert.notEqual(baseline, withNeutralR, 'R affects output');
assert.notEqual(baseline, withNeutralG, 'G affects output');
assert.notEqual(baseline, withNeutralB, 'B affects output');
assert.notEqual(baseline, withNeutralA, 'A affects output');

console.log('curveFieldProjection tests passed');