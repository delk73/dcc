import assert from 'node:assert/strict';
import { compileCurveFieldBasis } from './curveFieldBasisCompile';
import { compileCurveFieldProjection } from './curveFieldProjectionCompile';
import { evaluateCompiledCurveFieldProjection, worldToCurveFieldLocal } from './curveFieldProjectionEval';
import { compileCurveParameterBindings } from './curveParameterBindingCompile';
import { getCurveFieldChannelRoleSummary } from './curveFieldChannelRoles';
import { DEFAULT_CURVE_FIELD_PROJECTION, type CurveFieldProjectionIr, type CurveFieldPreviewSpec } from './curveProjectionIr';
import {
  SEPARABLE_RADIAL_BASIS,
  SHAPE_LERP_CIRCLE_TRIANGLE_BASIS,
  SHAPE_LERP_CIRCLE_TRIANGLE_B_CORNERS_BASIS,
  type CurveFieldBasisIr,
  type ShapeLerpBasisIr,
} from './curveFieldBasisIr';
import { hashCurveFieldBasisIr } from './curveFieldBasisHash';
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
const negative = makeChannel([[0, 0], [1, 0]]);
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

function makeShapeLerpBasis(
  overrides: {
    circleRadius?: number;
    triangleRadius?: number;
    cornerRoundness?: number;
  } = {}
): ShapeLerpBasisIr {
  return {
    ...SHAPE_LERP_CIRCLE_TRIANGLE_BASIS,
    shapes: {
      a: {
        ...SHAPE_LERP_CIRCLE_TRIANGLE_BASIS.shapes.a,
        radius: overrides.circleRadius ?? SHAPE_LERP_CIRCLE_TRIANGLE_BASIS.shapes.a.radius,
      },
      b: {
        ...SHAPE_LERP_CIRCLE_TRIANGLE_BASIS.shapes.b,
        radius: overrides.triangleRadius ?? SHAPE_LERP_CIRCLE_TRIANGLE_BASIS.shapes.b.radius,
        cornerRoundness: overrides.cornerRoundness ?? SHAPE_LERP_CIRCLE_TRIANGLE_BASIS.shapes.b.cornerRoundness,
      },
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
assert.equal(hashCurveFieldBasisIr(SEPARABLE_RADIAL_BASIS), hashCurveFieldBasisIr(SEPARABLE_RADIAL_BASIS), 'basis hash is deterministic');

const compiledDefaultBindings = compileCurveParameterBindings([
  { parameter: 'major.response', curveId: 'r', input: 'major-axis' },
]);
assert.deepEqual(compiledDefaultBindings[0].remap, {
  scale: 1,
  offset: 0,
  invert: false,
  clamp: 'none',
}, 'binding compile fills default remap values');

const multiUseBindings = compileCurveParameterBindings([
  { parameter: 'major.response', curveId: 'r', input: 'major-axis' },
  { parameter: 'transfer.output', curveId: 'r', input: 'field' },
]);
assert.equal(multiUseBindings[0].curveId, 'r', 'one curve can drive first binding');
assert.equal(multiUseBindings[1].curveId, 'r', 'one curve can drive second binding');
assert.equal(
  getCurveFieldChannelRoleSummary(SEPARABLE_RADIAL_BASIS),
  'R Major  G Orth  B Radial  A Transfer',
  'separable-radial channel roles are derived from bindings'
);
assert.equal(
  getCurveFieldChannelRoleSummary(SHAPE_LERP_CIRCLE_TRIANGLE_BASIS),
  'R Circle  G Triangle  B Morph  A Transfer',
  'shape-lerp channel roles are derived from bindings'
);
assert.equal(
  getCurveFieldChannelRoleSummary(SHAPE_LERP_CIRCLE_TRIANGLE_B_CORNERS_BASIS),
  'R Circle  G Triangle  B Morph  A Transfer',
  'shape-lerp corner recipe keeps the same visible channel roles'
);

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

assert.notEqual(
  hashCurveFieldProjectionIr(makeProjection({ basis: SEPARABLE_RADIAL_BASIS })),
  hashCurveFieldProjectionIr(makeProjection({ basis: SHAPE_LERP_CIRCLE_TRIANGLE_BASIS })),
  'Projection hash changes when basis kind changes'
);

assert.notEqual(
  hashCurveFieldProjectionIr(makeProjection({ basis: SEPARABLE_RADIAL_BASIS })),
  hashCurveFieldProjectionIr(makeProjection({
    basis: {
      ...SEPARABLE_RADIAL_BASIS,
      bindings: SEPARABLE_RADIAL_BASIS.bindings.map(binding => binding.parameter === 'major.response'
        ? { ...binding, curveId: 'g' }
        : binding),
    },
  })),
  'Projection hash changes when binding curveId changes'
);

assert.notEqual(
  hashCurveFieldBasisIr(SEPARABLE_RADIAL_BASIS),
  hashCurveFieldBasisIr({
    ...SEPARABLE_RADIAL_BASIS,
    bindings: SEPARABLE_RADIAL_BASIS.bindings.map(binding => binding.parameter === 'major.response'
      ? { ...binding, parameter: 'major.altResponse' }
      : binding),
  }),
  'basis hash changes when binding parameter changes'
);

assert.throws(
  () => compileCurveFieldBasis({
    ...SEPARABLE_RADIAL_BASIS,
    bindings: SEPARABLE_RADIAL_BASIS.bindings.filter(binding => binding.parameter !== 'major.response'),
  }),
  /Missing curve parameter binding: major\.response/,
  'separable-radial compile fails loudly when a required binding is missing'
);

assert.throws(
  () => compileCurveFieldBasis({
    ...SHAPE_LERP_CIRCLE_TRIANGLE_BASIS,
    bindings: SHAPE_LERP_CIRCLE_TRIANGLE_BASIS.bindings.filter(binding => binding.parameter !== 'triangle.response'),
  }),
  /Missing curve parameter binding: triangle\.response/,
  'shape-lerp compile fails loudly when a required binding is missing'
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
assert.equal(compiled.basis.kind, 'separable-radial', 'existing separable-radial basis still compiles');
if (compiled.basis.kind === 'separable-radial') {
  assert.equal(compiled.basis.majorResponse.parameter, 'major.response', 'separable-radial basis compiles major binding slot');
  assert.equal(compiled.basis.orthogonalResponse.parameter, 'orthogonal.response', 'separable-radial basis compiles orthogonal binding slot');
  assert.equal(compiled.basis.radialResponse.parameter, 'radial.response', 'separable-radial basis compiles radial binding slot');
  assert.equal(compiled.basis.transferOutput.parameter, 'transfer.output', 'separable-radial basis compiles transfer binding slot');
}

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

const shapeCurve = makeCurveSpace({
  r: makeChannel([[0, 2], [1, 0.5]]),
  g: makeChannel([[0, 0.35], [1, 2]]),
  b: makeChannel([[0, 0], [1, 2]]),
  a: identityTransfer,
});
const shapeProjection = makeProjection({ basis: makeShapeLerpBasis() });
const shapeCompiled = compileCurveFieldProjection(makeSpec(shapeCurve, shapeProjection), { lutSize: 32 });
assert.equal(shapeCompiled.basis.kind, 'shape-lerp', 'shape-lerp basis compiles');
if (shapeCompiled.basis.kind === 'shape-lerp') {
  assert.equal(shapeCompiled.basis.circleResponse.parameter, 'circle.response', 'shape-lerp basis compiles circle binding slot');
  assert.equal(shapeCompiled.basis.triangleResponse.parameter, 'triangle.response', 'shape-lerp basis compiles triangle binding slot');
  assert.equal(shapeCompiled.basis.shapeMorph.parameter, 'shape.morph', 'shape-lerp basis compiles morph binding slot');
  assert.equal(shapeCompiled.basis.transferOutput.parameter, 'transfer.output', 'shape-lerp basis compiles transfer binding slot');
}
assert.equal(
  evaluateCompiledCurveFieldProjection(shapeCompiled, 18, 27),
  evaluateCompiledCurveFieldProjection(shapeCompiled, 18, 27),
  'shape-lerp basis evaluates deterministically'
);

const shapeBaseline = evaluateCompiledCurveFieldProjection(shapeCompiled, 18, 27);
const shapeWithNeutralR = evaluateCompiledCurveFieldProjection(
  compileCurveFieldProjection(makeSpec(makeCurveSpace({ r: neutral, g: shapeCurve.channels.g, b: shapeCurve.channels.b }), shapeProjection)),
  18,
  27
);
const shapeWithNeutralG = evaluateCompiledCurveFieldProjection(
  compileCurveFieldProjection(makeSpec(makeCurveSpace({ r: shapeCurve.channels.r, g: neutral, b: shapeCurve.channels.b }), shapeProjection)),
  18,
  27
);
const shapeWithNegativeB = evaluateCompiledCurveFieldProjection(
  compileCurveFieldProjection(makeSpec(makeCurveSpace({ r: shapeCurve.channels.r, g: shapeCurve.channels.g, b: negative }), shapeProjection)),
  18,
  27
);
const shapeWithNeutralA = evaluateCompiledCurveFieldProjection(
  compileCurveFieldProjection(makeSpec(makeCurveSpace({ r: shapeCurve.channels.r, g: shapeCurve.channels.g, b: shapeCurve.channels.b, a: neutral }), shapeProjection)),
  18,
  27
);

assert.notEqual(shapeBaseline, shapeWithNeutralR, 'R affects shape-lerp output');
assert.notEqual(shapeBaseline, shapeWithNeutralG, 'G affects shape-lerp output');
assert.notEqual(shapeBaseline, shapeWithNegativeB, 'B affects shape-lerp output');
assert.notEqual(shapeBaseline, shapeWithNeutralA, 'A affects shape-lerp output');

assert.notEqual(
  shapeBaseline,
  evaluateCompiledCurveFieldProjection(compileCurveFieldProjection(makeSpec(shapeCurve, makeProjection({ basis: makeShapeLerpBasis({ circleRadius: 0.35 }) }))), 18, 27),
  'shape-lerp output changes when circle radius changes'
);
assert.notEqual(
  shapeBaseline,
  evaluateCompiledCurveFieldProjection(compileCurveFieldProjection(makeSpec(shapeCurve, makeProjection({ basis: makeShapeLerpBasis({ triangleRadius: 0.45 }) }))), 18, 27),
  'shape-lerp output changes when triangle radius changes'
);

const cornerShapeCurve = makeCurveSpace({
  r: makeChannel([[0, 1], [1, 1]]),
  g: makeChannel([[0, 0], [0.5, 2], [1, 0]]),
  b: makeChannel([[0, 0], [1, 2]]),
  a: identityTransfer,
});
const cornerProjection = makeProjection({ basis: SHAPE_LERP_CIRCLE_TRIANGLE_B_CORNERS_BASIS });
const cornerCompiled = compileCurveFieldProjection(makeSpec(cornerShapeCurve, cornerProjection), { lutSize: 64 });
assert.equal(cornerCompiled.basis.kind, 'shape-lerp', 'shape-lerp corner recipe compiles');
if (cornerCompiled.basis.kind === 'shape-lerp') {
  assert.equal(cornerCompiled.basis.cornerRoundness?.parameter, 'shape.cornerRoundness', 'shape-lerp corner recipe compiles corner binding slot');
  assert.equal(cornerCompiled.basis.cornerRoundness?.curveId, 'b', 'shape-lerp corner recipe uses B for corner roundness');
}

const fixedCornerBasis: ShapeLerpBasisIr = {
  ...SHAPE_LERP_CIRCLE_TRIANGLE_B_CORNERS_BASIS,
  bindings: SHAPE_LERP_CIRCLE_TRIANGLE_B_CORNERS_BASIS.bindings.filter(binding => binding.parameter !== 'shape.cornerRoundness'),
};
assert.notEqual(
  evaluateCompiledCurveFieldProjection(cornerCompiled, 28, 18),
  evaluateCompiledCurveFieldProjection(compileCurveFieldProjection(makeSpec(cornerShapeCurve, makeProjection({ basis: fixedCornerBasis }), 64), { lutSize: 64 }), 28, 18),
  'B-driven corner roundness changes shape-lerp output'
);

console.log('curveFieldProjection tests passed');