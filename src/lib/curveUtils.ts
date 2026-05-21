import { ColorCurve, CurvePoint } from '../types';
import {
  getOutgoingInterpolation,
  getEdgeOwner
} from './curvePointPolicy';

export type InterpMode = 'linear' | 'cubic' | 'constant';

const EXACT_ANCHOR_EPSILON = 1e-9;

const orderPointsByTime = (points: CurvePoint[]) =>
  [...points].sort((a, b) => a.time - b.time);

const createEvaluatedPoint = (
  curve: CurvePoint[],
  time: number,
  interpMode: InterpMode,
  id: string
): CurvePoint => {
  const orderedCurve = orderPointsByTime(curve);
  return {
    id,
    time,
    value: evaluateCurve(orderedCurve, computeTangents(orderedCurve), time, interpMode),
    role: 'interior',
    source: 'derived',
    edit: 'convertible',
    continuity: 'smooth',
    outInterpolation: 'smooth',
    flags: []
  };
};

const findMatchingPointIndex = (
  point: CurvePoint,
  candidates: CurvePoint[],
  fallbackIndex: number,
  usedIndexes: Set<number>,
  allowIndexFallback: boolean
) => {
  const sameIdIndex = candidates.findIndex((candidate, index) =>
    !usedIndexes.has(index) && candidate.id === point.id
  );
  if (sameIdIndex !== -1) return sameIdIndex;

  const edgeOwner = getEdgeOwner(point);
  if (edgeOwner) {
    const sameEdgeIndex = candidates.findIndex((candidate, index) =>
      !usedIndexes.has(index) && getEdgeOwner(candidate) === edgeOwner
    );
    if (sameEdgeIndex !== -1) return sameEdgeIndex;
  }

  if (!allowIndexFallback) return -1;
  const fallback = candidates[fallbackIndex];
  if (!fallback || usedIndexes.has(fallbackIndex)) return -1;
  if (Boolean(getEdgeOwner(point)) !== Boolean(getEdgeOwner(fallback))) return -1;
  return fallbackIndex;
};

const pairCurvePoints = (ch1: CurvePoint[], ch2: CurvePoint[], interpMode: InterpMode) => {
  const left = orderPointsByTime(ch1);
  const right = orderPointsByTime(ch2);
  const usedRightIndexes = new Set<number>();
  const usedLeftIndexes = new Set<number>();
  const allowIndexFallback = left.length === right.length;

  const matchedPairs = left.flatMap((point, index) => {
    const matchIndex = findMatchingPointIndex(point, right, index, usedRightIndexes, allowIndexFallback);
    if (matchIndex === -1) return [];
    usedLeftIndexes.add(index);
    usedRightIndexes.add(matchIndex);
    return [{ left: point, right: right[matchIndex] }];
  });

  const leftOnlyPairs = left.flatMap((point, index) => {
    if (usedLeftIndexes.has(index) || getEdgeOwner(point)) return [];
    return [{
      left: point,
      right: createEvaluatedPoint(ch2, point.time, interpMode, `sample_right_${point.id}`)
    }];
  });

  const rightOnlyPairs = right.flatMap((point, index) => {
    if (usedRightIndexes.has(index) || getEdgeOwner(point)) return [];
    return [{
      left: createEvaluatedPoint(ch1, point.time, interpMode, `sample_left_${point.id}`),
      right: point
    }];
  });

  return [...matchedPairs, ...leftOnlyPairs, ...rightOnlyPairs];
};

const blendPointRole = (left: CurvePoint, right: CurvePoint, index: number, total: number): CurvePoint['role'] => {
  if (index === 0 || index === total - 1 || getEdgeOwner(left) || getEdgeOwner(right)) return 'boundary';
  if (left.role === right.role && (left.role === 'anchor' || left.role === 'feature' || left.role === 'sample')) {
    return left.role;
  }
  return 'interior';
};

const blendPointFlags = (left: CurvePoint, right: CurvePoint): CurvePoint['flags'] =>
  left.flags.filter(flag =>
    (flag === 'uncompressible' || flag === 'protected') && right.flags.includes(flag)
  );

const isEvaluatedCounterpart = (point: CurvePoint) =>
  point.id.startsWith('sample_left_') || point.id.startsWith('sample_right_');

const blendPointId = (left: CurvePoint, right: CurvePoint, index: number) =>
  isEvaluatedCounterpart(left)
    ? right.id
    : isEvaluatedCounterpart(right)
      ? left.id
      : left.id === right.id
        ? `derived_${left.id}`
        : `derived_${index}_${left.id}_${right.id}`;

export function computeTangents(data: CurvePoint[]): number[] {
  const n = data.length;
  const tangents = new Array(n).fill(0);
  if (n < 2) return tangents;
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tangents[i] = (data[1].value - data[0].value) / Math.max(0.0001, data[1].time - data[0].time);
    } else if (i === n - 1) {
      tangents[i] = (data[i].value - data[i-1].value) / Math.max(0.0001, data[i].time - data[i-1].time);
    } else {
      // Catmull-Rom / average secant (Auto tangency)
      tangents[i] = (data[i+1].value - data[i-1].value) / Math.max(0.0001, data[i+1].time - data[i-1].time);
    }
  }
  return tangents;
}

export function evaluateCurve(keyframes: CurvePoint[], tangents: number[], t: number, interpMode: InterpMode): number {
  const n = keyframes.length;
  if (n === 0) return 0;
  if (n === 1) return keyframes[0].value;
  
  if (t <= keyframes[0].time) return keyframes[0].value;
  if (t >= keyframes[n - 1].time) return keyframes[n - 1].value;
  
  for (let i = 0; i < n - 1; i++) {
    const k1 = keyframes[i];
    const k2 = keyframes[i + 1];
    if (t >= k1.time && t <= k2.time) {
      const dx = k2.time - k1.time;
      if (dx <= 0) return k1.value;
      
      const tNorm = (t - k1.time) / dx;
      
      const pointInterpolation = getOutgoingInterpolation(k1);
      const segmentInterpolation = pointInterpolation === 'smooth' ? 'cubic' : pointInterpolation;

      if (segmentInterpolation === 'constant') {
        return k1.value;
      } else if (segmentInterpolation === 'linear') {
        return k1.value + (k2.value - k1.value) * tNorm;
      } else {
        const t2 = tNorm * tNorm;
        const t3 = t2 * tNorm;
        
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + tNorm;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        
        const m0 = tangents[i];
        const m1 = tangents[i + 1];
        
        return h00 * k1.value + h10 * dx * m0 + h01 * k2.value + h11 * dx * m1;
      }
    }
  }
  return 0;
}

export function blendCurves(c1: ColorCurve, c2: ColorCurve, blendT: number, interpMode: InterpMode): ColorCurve {
  const blendChannel = (ch1: CurvePoint[], ch2: CurvePoint[]) => {
    const pairs = pairCurvePoints(ch1, ch2, interpMode)
      .map(({ left, right }) => {
        const time = left.time + (right.time - left.time) * blendT;
        const value = left.value + (right.value - left.value) * blendT;
        return { left, right, time, value };
      })
      .sort((a, b) => a.time - b.time);
    const total = pairs.length;
    
    return pairs.map(({ left, right, time, value }, index) => {
      const edgeOwner = getEdgeOwner(left) ?? getEdgeOwner(right);
      const role = blendPointRole(left, right, index, total);

      const point: CurvePoint = {
        id: blendPointId(left, right, index),
        time,
        value,
        role,
        source: 'derived',
        edit: 'convertible',
        continuity: left.continuity === right.continuity ? left.continuity : 'smooth',
        outInterpolation: left.outInterpolation === right.outInterpolation ? left.outInterpolation : 'smooth',
        flags: blendPointFlags(left, right),
        constraints: edgeOwner
          ? { edgeOwner }
          : undefined
      };
      return point;
    });
  };
  
  return {
    r: blendChannel(c1.r, c2.r),
    g: blendChannel(c1.g, c2.g),
    b: blendChannel(c1.b, c2.b),
    a: blendChannel(c1.a, c2.a),
  };
}

export function blendSpaceCurves(curves: { position: number, curve: ColorCurve }[], position: number, interpMode: InterpMode): ColorCurve {
  if (curves.length === 0) return { r:[], g:[], b:[], a:[] };
  if (curves.length === 1) return curves[0].curve;
  
  const sorted = [...curves].sort((a, b) => a.position - b.position);
  const exactAnchor = sorted.find(anchor => Math.abs(position - anchor.position) <= EXACT_ANCHOR_EPSILON);
  if (exactAnchor) return exactAnchor.curve;

  if (position <= sorted[0].position) return sorted[0].curve;
  if (position >= sorted[sorted.length - 1].position) return sorted[sorted.length - 1].curve;
  
  for (let i = 0; i < sorted.length - 1; i++) {
    const c1 = sorted[i];
    const c2 = sorted[i+1];
    if (position >= c1.position && position <= c2.position) {
      const dx = c2.position - c1.position;
      if (dx <= 0) return c1.curve;
      const tNorm = (position - c1.position) / dx;
      return blendCurves(c1.curve, c2.curve, tNorm, interpMode);
    }
  }
  
  return sorted[0].curve;
}
