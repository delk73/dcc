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
  getEdgeOwner,
  getOutgoingInterpolation,
  materializeColorCurveForAuthoring,
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
import { blendCurves, blendSpaceCurves, computeTangents, evaluateCurve } from './curveUtils';
import { parseCurveImportText } from './curveImport';
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

const peakedSmoothCurve = migrateKeyframesToCurvePoints([
  { time: 0, value: 0 },
  { time: 0.5, value: 1 },
  { time: 1, value: 0 }
]);
const peakedTangents = computeTangents(peakedSmoothCurve);
for (let sample = 0; sample <= 20; sample++) {
  const value = evaluateCurve(peakedSmoothCurve, peakedTangents, sample / 20, 'cubic');
  assert.ok(value >= -0.000001 && value <= 1.000001, `smooth curve overshot at sample ${sample}: ${value}`);
}

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

const movingMiddleBlend = blendCurves(
  {
    r: [
      { ...migrated[0], time: 0 },
      { ...migrated[1], id: 'moving-middle', time: 0.25, value: 0.2 },
      { ...migrated[2], time: 1 }
    ],
    g: migrated,
    b: migrated,
    a: migrated
  },
  {
    r: [
      { ...migrated[0], time: 0 },
      { ...migrated[1], id: 'moving-middle', time: 0.75, value: 1.2 },
      { ...migrated[2], time: 1 }
    ],
    g: migrated,
    b: migrated,
    a: migrated
  },
  0.5,
  'cubic'
);
assert.equal(movingMiddleBlend.r[1].source, 'derived');
assert.equal(movingMiddleBlend.r[1].edit, 'convertible');
assert.equal(movingMiddleBlend.r[1].time, 0.5);
assert.equal(movingMiddleBlend.r[1].value, 0.7);

const removedMiddleBlend = blendCurves(
  {
    r: [
      { ...migrated[0], time: 0 },
      { ...migrated[1], id: 'removed-middle', time: 0.5, value: 0.8 },
      { ...migrated[2], time: 1 }
    ],
    g: migrated,
    b: migrated,
    a: migrated
  },
  {
    r: [
      { ...migrated[0], time: 0 },
      { ...migrated[2], time: 1 }
    ],
    g: migrated,
    b: migrated,
    a: migrated
  },
  0.5,
  'cubic'
);
assert.deepEqual(removedMiddleBlend.r.map(point => getEdgeOwner(point)), ['start', undefined, 'end']);
assert.equal(removedMiddleBlend.r[1].role, 'interior');
assert.equal(removedMiddleBlend.r[1].source, 'derived');

const unevenPointBlend = blendCurves(
  {
    r: [
      { ...migrated[0], time: 0 },
      { ...migrated[1], id: 'new-left-point', time: 0.25, value: 0.25 },
      { ...migrated[1], id: 'shared-middle', time: 0.5, value: 0.8 },
      { ...migrated[2], time: 1 }
    ],
    g: migrated,
    b: migrated,
    a: migrated
  },
  {
    r: [
      { ...migrated[0], time: 0 },
      { ...migrated[1], id: 'shared-middle', time: 0.5, value: 0.8 },
      { ...migrated[2], time: 1 }
    ],
    g: migrated,
    b: migrated,
    a: migrated
  },
  0.5,
  'cubic'
);
assert.equal(unevenPointBlend.r.length, 4);
assert.deepEqual(unevenPointBlend.r.map(point => point.id.includes('shared-middle')), [false, false, true, false]);
assert.equal(unevenPointBlend.r[1].id, 'new-left-point');
assert.equal(unevenPointBlend.r[1].role, 'interior');
assert.equal(unevenPointBlend.r[2].time, 0.5);
assert.equal(unevenPointBlend.r[2].value, 0.8);

const materializedUnevenBlend = materializeColorCurveForAuthoring(unevenPointBlend);
assert.equal(materializedUnevenBlend.r[1].id, 'new-left-point');
assert.equal(materializedUnevenBlend.r[1].source, 'authored');
assert.equal(materializedUnevenBlend.r[1].edit, 'free');
assert.equal(materializedUnevenBlend.r.some(point => point.id.startsWith('derived_')), false);
assert.equal(materializedUnevenBlend.r.some(point => point.id.startsWith('sample_')), false);

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
const exactAnchorCurve = {
  r: [
    { ...migrated[0], time: 0 },
    { ...migrated[2], time: 1 }
  ],
  g: migrated,
  b: migrated,
  a: migrated
};
assert.strictEqual(
  blendSpaceCurves([
    { position: 0, curve: testCurve },
    { position: 0.5, curve: exactAnchorCurve },
    { position: 1, curve: testCurve }
  ], 0.5, 'cubic'),
  exactAnchorCurve
);
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

const unrealImport = parseCurveImportText(`
Begin Object Class=/Script/CurveEditor.CurveEditorCopyBuffer Name="CurveEditorCopyBuffer_0"
   Begin Object Class=/Script/CurveEditor.CurveEditorCopyableCurveKeys Name="CurveEditorCopyableCurveKeys_0"
      KeyPositions(0)=(InputValue=0.250000,OutputValue=0.500000)
      KeyPositions(1)=(InputValue=1.004373,OutputValue=0.750000)
      ShortDisplayName="R"
   End Object
   Begin Object Class=/Script/CurveEditor.CurveEditorCopyableCurveKeys Name="CurveEditorCopyableCurveKeys_1"
      KeyPositions(0)=(OutputValue=-0.100000)
      KeyPositions(1)=(InputValue=0.504373,OutputValue=0.300000)
      ShortDisplayName="A"
   End Object
   TimeOffset=-0.004373
End Object
`);
assert.deepEqual(unrealImport.summary.map(item => [item.channel, item.count]), [
  ['r', 2],
  ['g', 0],
  ['b', 0],
  ['a', 2]
]);
assert.equal(unrealImport.curve.r[0].source, 'imported');
assert.equal(unrealImport.curve.r[0].role, 'boundary');
assert.equal(getEdgeOwner(unrealImport.curve.r[0]), 'start');
assert.equal(unrealImport.curve.r[1].time, 1);
assert.equal(unrealImport.curve.a[0].time, 0);
assert.equal(unrealImport.curve.a[0].value, -0.1);

const looseImport = parseCurveImportText('0,0 0.5,1 1,0');
assert.deepEqual(looseImport.summary.map(item => item.count), [3, 0, 0, 0]);
assert.equal(looseImport.curve.r[1].time, 0.5);

console.log('curvePointPolicy tests passed');
