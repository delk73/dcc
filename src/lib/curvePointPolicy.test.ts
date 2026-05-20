import assert from 'node:assert/strict';
import {
  canDeletePoint,
  canDragPoint,
  createAuthoredInteriorPoint,
  getOutgoingInterpolation,
  migrateKeyframesToCurvePoints,
  normalizeCurvePoints,
  shouldPreserveDuringCompression,
  clampPointMove
} from './curvePointPolicy';
import { computeTangents, evaluateCurve } from './curveUtils';
import { CurvePoint } from '../types';

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

console.log('curvePointPolicy tests passed');
