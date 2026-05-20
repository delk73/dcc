import assert from 'node:assert/strict';
import {
  canDeletePoint,
  canDragPoint,
  canConvertToAuthored,
  canEditOutgoingInterpolation,
  canEditPointRole,
  convertPointToAuthored,
  createAuthoredInteriorPoint,
  getOutgoingInterpolation,
  migrateKeyframesToCurvePoints,
  normalizeCurvePoints,
  patchCurvePoint,
  patchEditableCurvePoint,
  setCurvePointRole,
  shouldPreserveDuringCompression,
  clampPointMove
} from './curvePointPolicy';
import { computeTangents, evaluateCurve } from './curveUtils';
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
