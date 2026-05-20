import assert from 'node:assert/strict';
import {
  canDeletePoint,
  canDragPoint,
  canConvertToAuthored,
  canEditPoint,
  canEditOutgoingInterpolation,
  canEditPointRole,
  canToggleLock,
  convertPointToAuthored,
  createAuthoredInteriorPoint,
  createStablePointId,
  fromTimeKey,
  getOutgoingInterpolation,
  migrateKeyframesToCurvePoints,
  normalizeCurvePoints,
  orderCurvePoints,
  patchCurvePoint,
  patchEditableCurvePoint,
  setCurvePointRole,
  togglePointFlag,
  updatePointById,
  shouldPreserveDuringCompression,
  clampPointMove,
  toTimeKey
} from './curvePointPolicy';
import { blendCurves, computeTangents, evaluateCurve } from './curveUtils';
import { CurvePoint } from '../types';
import { createInitialEditorState, serializeUxState } from '../state/editorState';

const migrated = migrateKeyframesToCurvePoints([
  { time: 0, value: 0 },
  { time: 0.5, value: 0.8 },
  { time: 1, value: 1 }
]);

assert.equal(migrated[0].role, 'boundary');
assert.equal(migrated[2].role, 'boundary');
assert.equal(migrated[0].constraints?.edgeOwner, 'start');
assert.equal(migrated[2].constraints?.edgeOwner, 'end');
assert.deepEqual(
  {
    role: migrated[1].role,
    source: migrated[1].source,
    edit: migrated[1].edit,
    continuity: migrated[1].continuity,
    outInterpolation: migrated[1].outInterpolation
  },
  {
    role: 'interior',
    source: 'authored',
    edit: 'free',
    continuity: 'smooth',
    outInterpolation: 'smooth'
  }
);

const locked: CurvePoint = { ...migrated[1], edit: 'locked' };
assert.equal(canDragPoint(locked), false);
assert.equal(canDeletePoint(locked), false);
assert.equal(canEditPoint(locked), false);
assert.equal(canToggleLock(locked), true);

assert.equal(canDeletePoint({ ...migrated[1], flags: ['protected'] }), false);
assert.equal(canDeletePoint(migrated[0]), false);
assert.equal(shouldPreserveDuringCompression({ ...migrated[1], flags: ['uncompressible'] }), true);
assert.equal(shouldPreserveDuringCompression({ ...migrated[1], flags: ['protected'] }), false);

const segmentPoints: CurvePoint[] = [
  { ...migrated[0], value: 0, outInterpolation: 'constant' },
  { ...migrated[1], time: 1, value: 1 }
];
assert.equal(getOutgoingInterpolation(segmentPoints[0]), 'constant');
assert.equal(evaluateCurve(segmentPoints, computeTangents(segmentPoints), 0.5, 'linear'), 0);

assert.equal(toTimeKey(0.5), toTimeKey(0.500000001));
assert.equal(fromTimeKey(toTimeKey(0.5)), 0.5);
assert.equal(toTimeKey(-1), 0);
assert.equal(toTimeKey(2), 1_000_000);

const exactMiddleBlend = blendCurves(
  {
    r: [
      { ...migrated[0], time: 0 },
      { ...migrated[1], id: 'middle-a', time: 0.5 },
      { ...migrated[2], time: 1 }
    ],
    g: migrated,
    b: migrated,
    a: migrated
  },
  {
    r: [
      { ...migrated[0], time: 0 },
      { ...migrated[1], id: 'middle-b', time: 0.5 },
      { ...migrated[2], time: 1 }
    ],
    g: migrated,
    b: migrated,
    a: migrated
  },
  0.5,
  'cubic'
);
const quantizedMiddleBlend = blendCurves(
  {
    r: [
      { ...migrated[0], time: 0 },
      { ...migrated[1], id: 'middle-a', time: 0.5 },
      { ...migrated[2], time: 1 }
    ],
    g: migrated,
    b: migrated,
    a: migrated
  },
  {
    r: [
      { ...migrated[0], time: 0 },
      { ...migrated[1], id: 'middle-b', time: 0.500000001 },
      { ...migrated[2], time: 1 }
    ],
    g: migrated,
    b: migrated,
    a: migrated
  },
  0.5,
  'cubic'
);
assert.equal(quantizedMiddleBlend.r.length, 3);
assert.deepEqual(quantizedMiddleBlend.r.map(point => toTimeKey(point.time)), [0, 500000, 1000000]);
assert.equal(exactMiddleBlend.r[1].id, quantizedMiddleBlend.r[1].id);
assert.equal(
  createStablePointId({ time: 0.5, value: 0.8 }, 1),
  createStablePointId({ time: 0.500000001, value: 0.8 }, 1)
);

assert.deepEqual(
  clampPointMove({ ...migrated[1], constraints: { pinnedTime: true } }, { time: 0.75, value: 1.2 }),
  { time: 0.5, value: 1.2 }
);
assert.deepEqual(
  clampPointMove({ ...migrated[1], constraints: { pinnedValue: true } }, { time: 0.75, value: 1.2 }),
  { time: 0.75, value: 0.8 }
);
assert.deepEqual(
  clampPointMove(
    { ...migrated[1], constraints: { minTime: 0.25, maxTime: 0.75, minValue: 0.1, maxValue: 0.9 } },
    { time: 0.9, value: -1 }
  ),
  { time: 0.75, value: 0.1 }
);

const selectedPoint = { ...createAuthoredInteriorPoint(0.25, 0.5, 'selected-test'), selected: true };
const normalized = normalizeCurvePoints([selectedPoint]);
assert.equal('selected' in normalized[0], false);
assert.equal(normalized[0].flags.includes('selected' as never), false);

const testCurve = {
  r: migrated,
  g: migrateKeyframesToCurvePoints([{ time: 0, value: 0 }, { time: 1, value: 1 }]),
  b: migrateKeyframesToCurvePoints([{ time: 0, value: 0 }, { time: 1, value: 1 }]),
  a: migrateKeyframesToCurvePoints([{ time: 0, value: 1 }, { time: 1, value: 1 }])
};
const selection = { channel: 'r' as const, pointId: migrated[1].id };
const updatedCurve = patchCurvePoint(testCurve, selection, point => ({ ...point, outInterpolation: 'linear' }));
assert.equal(updatedCurve.r[1].outInterpolation, 'linear');
assert.equal(updatedCurve.r[0].outInterpolation, 'smooth');
assert.equal(updatedCurve.g[1].outInterpolation, 'smooth');

const targetedCurve = updatePointById(testCurve, 'r', migrated[1].id, { continuity: 'corner' });
assert.equal(targetedCurve.r[1].continuity, 'corner');
assert.equal(targetedCurve.r[0].continuity, 'smooth');
assert.equal(targetedCurve.g[1].continuity, 'smooth');

const oncePreserved = togglePointFlag(testCurve, 'r', migrated[1].id, 'uncompressible');
const twicePreserved = togglePointFlag(oncePreserved, 'r', migrated[1].id, 'uncompressible');
assert.deepEqual(oncePreserved.r[1].flags, ['uncompressible']);
assert.deepEqual(twicePreserved.r[1].flags, []);

const reordered = updatePointById(testCurve, 'r', migrated[1].id, { time: 0.9 });
assert.equal(reordered.r.find(point => point.id === migrated[1].id)?.time, 0.9);
assert.equal(orderCurvePoints(reordered.r).find(point => point.id === migrated[1].id)?.id, migrated[1].id);

const roleAttempt = patchEditableCurvePoint(testCurve, { channel: 'r', pointId: migrated[0].id }, point => ({
  ...setCurvePointRole(point, 'anchor')
}));
assert.equal(roleAttempt.r[0].role, 'boundary');
assert.equal(canEditPointRole(migrated[0]), false);

const derivedPoint: CurvePoint = {
  ...migrated[1],
  source: 'derived',
  edit: 'convertible',
  role: 'feature',
  flags: ['diagnostic'],
  constraints: { minTime: 0.1 }
};
const authoredPoint = convertPointToAuthored(derivedPoint);
assert.deepEqual(
  {
    source: authoredPoint.source,
    edit: authoredPoint.edit,
    role: authoredPoint.role,
    flags: authoredPoint.flags,
    constraints: authoredPoint.constraints,
    continuity: authoredPoint.continuity,
    outInterpolation: authoredPoint.outInterpolation
  },
  {
    source: 'authored',
    edit: 'free',
    role: derivedPoint.role,
    flags: derivedPoint.flags,
    constraints: derivedPoint.constraints,
    continuity: derivedPoint.continuity,
    outInterpolation: derivedPoint.outInterpolation
  }
);

assert.equal(canEditOutgoingInterpolation(migrated[0]), true);
assert.equal(canEditOutgoingInterpolation(migrated[2]), false);
assert.equal(canConvertToAuthored({ ...migrated[1], source: 'procedural', edit: 'free' }), false);
assert.equal(canConvertToAuthored({ ...migrated[1], source: 'procedural', edit: 'convertible' }), true);
assert.equal(convertPointToAuthored({ ...migrated[1], source: 'procedural', edit: 'convertible' }).source, 'authored');

const serializedUx = serializeUxState({
  ...createInitialEditorState().ui,
  selectedPoint: selection
});
assert.equal('selectedPoint' in serializedUx, false);

console.log('curvePointPolicy tests passed');
