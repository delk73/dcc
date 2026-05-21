import * as types from '../types';

export type CurveValidationIssue = {
  severity: 'error' | 'warning';
  message: string;
};

export type SelectedPointRef = {
  channel: types.Channel;
  pointId: string;
};

const CHANNELS = ['r', 'g', 'b', 'a'] as const;
export const TIME_KEY_SCALE = 1_000_000;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function toTimeKey(time: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.round(clamp(time, 0, 1) * TIME_KEY_SCALE);
}

export function fromTimeKey(key: number): number {
  if (!Number.isFinite(key)) return 0;
  return clamp(Math.round(key) / TIME_KEY_SCALE, 0, 1);
}

const stableNumberPart = (value: number) =>
  Number.isFinite(value) ? value.toFixed(6).replace(/^-/, 'n').replace(/\./g, '_') : 'invalid';

export function createStablePointId(keyframe: types.Keyframe, index: number): string {
  return `point_${index}_t${toTimeKey(keyframe.time)}_${stableNumberPart(keyframe.value)}`;
}

export function createAuthoredInteriorPoint(time: number, value: number, id: string = crypto.randomUUID()): types.CurvePoint {
  return {
    id,
    time,
    value,
    role: 'interior',
    source: 'authored',
    edit: 'free',
    continuity: 'smooth',
    outInterpolation: 'smooth',
    flags: []
  };
}

export function migrateKeyframesToCurvePoints(keyframes: types.Keyframe[]): types.CurvePoint[] {
  return keyframes.map((keyframe, index) => {
    const isFirst = index === 0;
    const isLast = index === keyframes.length - 1;

    return {
      id: createStablePointId(keyframe, index),
      time: keyframe.time,
      value: keyframe.value,

      role: isFirst || isLast ? 'boundary' : 'interior',
      source: 'authored',
      edit: 'free',

      continuity: 'smooth',
      outInterpolation: 'smooth',

      flags: [],
      constraints: isFirst
        ? { edgeOwner: 'start' }
        : isLast
          ? { edgeOwner: 'end' }
          : undefined
    };
  });
}

const isCurvePoint = (value: unknown): value is types.CurvePoint => {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as Partial<types.CurvePoint>;
  return typeof point.id === 'string'
    && typeof point.time === 'number'
    && typeof point.value === 'number'
    && typeof point.role === 'string'
    && typeof point.source === 'string'
    && typeof point.edit === 'string'
    && typeof point.continuity === 'string'
    && typeof point.outInterpolation === 'string'
    && Array.isArray(point.flags);
};

export function normalizeCurvePoints(points: unknown): types.CurvePoint[] {
  if (!Array.isArray(points)) return [];
  if (points.every(isCurvePoint)) {
    return points.map(point => ({
      id: point.id,
      time: point.time,
      value: point.value,
      role: point.role,
      source: point.source,
      edit: point.edit,
      continuity: point.continuity,
      outInterpolation: point.outInterpolation,
      flags: [...point.flags],
      constraints: point.constraints ? { ...point.constraints } : undefined
    }));
  }

  return migrateKeyframesToCurvePoints(points.filter((point): point is types.Keyframe =>
    typeof point === 'object'
    && point !== null
    && typeof (point as types.Keyframe).time === 'number'
    && typeof (point as types.Keyframe).value === 'number'
  ));
}

export function normalizeColorCurve(curve: unknown): types.ColorCurve {
  const value = typeof curve === 'object' && curve !== null ? curve as Partial<Record<keyof types.ColorCurve, unknown>> : {};
  return {
    r: normalizeCurvePoints(value.r),
    g: normalizeCurvePoints(value.g),
    b: normalizeCurvePoints(value.b),
    a: normalizeCurvePoints(value.a)
  };
}

const materializePointId = (point: types.CurvePoint, index: number) => {
  if (point.id.startsWith('sample_left_') || point.id.startsWith('sample_right_')) {
    return createStablePointId(point, index);
  }

  if (point.id.startsWith('derived_')) {
    const unwrappedId = point.id.slice('derived_'.length);
    return unwrappedId.includes('_sample_left_') || unwrappedId.includes('_sample_right_')
      ? createStablePointId(point, index)
      : unwrappedId;
  }

  return point.id;
};

export function materializeColorCurveForAuthoring(curve: types.ColorCurve): types.ColorCurve {
  const materializeChannel = (points: types.CurvePoint[]) => {
    const usedIds = new Set<string>();

    return orderCurvePoints(points).map((point, index) => {
      const baseId = materializePointId(point, index);
      const id = usedIds.has(baseId) ? createStablePointId(point, index) : baseId;
      usedIds.add(id);

      return {
        ...point,
        id,
        source: 'authored' as const,
        edit: point.edit === 'locked' ? 'locked' as const : 'free' as const,
        flags: [...point.flags],
        constraints: point.constraints ? { ...point.constraints } : undefined
      };
    });
  };

  return {
    r: materializeChannel(curve.r),
    g: materializeChannel(curve.g),
    b: materializeChannel(curve.b),
    a: materializeChannel(curve.a)
  };
}

export function normalizeLibraryCurves(library: types.LibraryCurve[]): types.LibraryCurve[] {
  return library.map(curve => ({
    ...curve,
    curve: normalizeColorCurve(curve.curve)
  }));
}

export function canDragPoint(point: types.CurvePoint): boolean {
  if (point.edit === 'locked') return false;
  if (point.source === 'procedural' && point.edit !== 'convertible') return false;
  return true;
}

export function canDeletePoint(point: types.CurvePoint): boolean {
  if (point.role === 'boundary') return false;
  if (point.flags.includes('protected')) return false;
  if (point.edit === 'locked') return false;
  return true;
}

export function canConvertToAuthored(point: types.CurvePoint): boolean {
  return point.edit === 'convertible'
    || point.source === 'derived'
    || point.source === 'imported';
}

export function shouldPreserveDuringCompression(point: types.CurvePoint): boolean {
  if (point.role === 'boundary' || point.role === 'anchor' || point.role === 'feature') return true;
  if (point.flags.includes('uncompressible')) return true;
  return false;
}

export function getPointContinuity(point: types.CurvePoint): types.CurvePointContinuity {
  return point.continuity;
}

export function getOutgoingInterpolation(point: types.CurvePoint): types.CurvePointOutInterpolation {
  return point.outInterpolation;
}

export function getEdgeOwner(point: types.CurvePoint): 'start' | 'end' | undefined {
  return point.constraints?.edgeOwner;
}

export function getPointLabel(point: types.CurvePoint): string {
  switch (point.role) {
    case 'boundary':
      return 'Boundary';
    case 'anchor':
      return 'Anchor';
    case 'feature':
      return 'Feature';
    case 'sample':
      return 'Sample';
    case 'interior':
    default:
      return 'Point';
  }
}

export function getSourceBadge(point: types.CurvePoint): string {
  return point.source.toUpperCase();
}

export function getEdgeBadge(point: types.CurvePoint): string | null {
  const edgeOwner = getEdgeOwner(point);
  if (edgeOwner === 'start') return 'Start edge';
  if (edgeOwner === 'end') return 'End edge';
  return null;
}

export function canEditPointMetadata(point: types.CurvePoint): boolean {
  if (point.edit === 'locked') return false;
  if (point.source === 'procedural' && point.edit !== 'convertible') return false;
  return true;
}

export function canEditPoint(point: types.CurvePoint): boolean {
  return canEditPointMetadata(point);
}

export function canEditPointRole(point: types.CurvePoint): boolean {
  return point.role !== 'boundary' && canEditPointMetadata(point);
}

export function canEditRole(point: types.CurvePoint): boolean {
  return canEditPointRole(point);
}

export function canEditContinuity(point: types.CurvePoint): boolean {
  return canEditPointMetadata(point);
}

export function canEditOutgoingInterpolation(point: types.CurvePoint): boolean {
  return getEdgeOwner(point) !== 'end' && canEditPointMetadata(point);
}

export function canEditOutInterpolation(point: types.CurvePoint): boolean {
  return canEditOutgoingInterpolation(point);
}

export function canToggleLock(point: types.CurvePoint): boolean {
  return point.source !== 'procedural' || point.edit === 'convertible' || point.edit === 'locked';
}

export function canTogglePreserve(point: types.CurvePoint): boolean {
  return canEditPointMetadata(point);
}

export function convertPointToAuthored(point: types.CurvePoint): types.CurvePoint {
  return {
    ...point,
    source: 'authored',
    edit: 'free'
  };
}

export function findCurvePoint(curve: types.ColorCurve, selection: SelectedPointRef | null | undefined): types.CurvePoint | null {
  if (!selection) return null;
  return curve[selection.channel].find(point => point.id === selection.pointId) ?? null;
}

export function patchCurvePoint(
  curve: types.ColorCurve,
  selection: SelectedPointRef,
  patcher: (point: types.CurvePoint) => types.CurvePoint
): types.ColorCurve {
  const channelData = curve[selection.channel];
  if (!channelData.some(point => point.id === selection.pointId)) return curve;

  return {
    ...curve,
    [selection.channel]: orderCurvePoints(channelData.map(point =>
      point.id === selection.pointId ? patcher(point) : point
    ))
  };
}

export function patchEditableCurvePoint(
  curve: types.ColorCurve,
  selection: SelectedPointRef,
  patcher: (point: types.CurvePoint) => types.CurvePoint
): types.ColorCurve {
  return patchCurvePoint(curve, selection, point => {
    if (!canEditPointMetadata(point)) return point;
    const editablePoint = canConvertToAuthored(point) ? convertPointToAuthored(point) : point;
    return patcher(editablePoint);
  });
}

export function updatePointById(
  curve: types.ColorCurve,
  channel: types.Channel,
  pointId: string,
  patch: Partial<types.CurvePoint> | ((point: types.CurvePoint) => types.CurvePoint)
): types.ColorCurve {
  return patchCurvePoint(curve, { channel, pointId }, point =>
    typeof patch === 'function' ? patch(point) : { ...point, ...patch }
  );
}

export function setCurvePointFlag(
  point: types.CurvePoint,
  flag: types.CurvePointFlag,
  enabled: boolean
): types.CurvePoint {
  const flags = new Set(point.flags);
  if (enabled) {
    flags.add(flag);
  } else {
    flags.delete(flag);
  }
  return {
    ...point,
    flags: Array.from(flags)
  };
}

export function togglePointFlag(
  curve: types.ColorCurve,
  channel: types.Channel,
  pointId: string,
  flag: types.CurvePointFlag
): types.ColorCurve {
  return updatePointById(curve, channel, pointId, point =>
    setCurvePointFlag(point, flag, !point.flags.includes(flag))
  );
}

export function convertCurvePointToAuthoredById(
  curve: types.ColorCurve,
  channel: types.Channel,
  pointId: string
): types.ColorCurve {
  return updatePointById(curve, channel, pointId, convertPointToAuthored);
}

export function setCurvePointRole(
  point: types.CurvePoint,
  role: Exclude<types.CurvePointRole, 'boundary'>
): types.CurvePoint {
  if (!canEditPointRole(point)) return point;
  return { ...point, role };
}

export function setCurvePointOutgoingInterpolation(
  point: types.CurvePoint,
  outInterpolation: types.CurvePointOutInterpolation
): types.CurvePoint {
  if (!canEditOutgoingInterpolation(point)) return point;
  return { ...point, outInterpolation };
}

export function clampPointMove(point: types.CurvePoint, next: { time: number; value: number }): { time: number; value: number } {
  const constraints = point.constraints;
  let time = constraints?.pinnedTime ? point.time : next.time;
  let value = constraints?.pinnedValue ? point.value : next.value;

  if (typeof constraints?.minTime === 'number') time = Math.max(constraints.minTime, time);
  if (typeof constraints?.maxTime === 'number') time = Math.min(constraints.maxTime, time);
  if (typeof constraints?.minValue === 'number') value = Math.max(constraints.minValue, value);
  if (typeof constraints?.maxValue === 'number') value = Math.min(constraints.maxValue, value);

  return { time, value };
}

export function orderCurvePoints(points: types.CurvePoint[]): types.CurvePoint[] {
  const start = points.find(point => getEdgeOwner(point) === 'start');
  const end = points.find(point => getEdgeOwner(point) === 'end');
  const middle = points
    .filter(point => point !== start && point !== end)
    .sort((a, b) => a.time - b.time);

  return [
    ...(start ? [start] : []),
    ...middle,
    ...(end ? [end] : [])
  ];
}

export function validateCurvePoints(points: types.CurvePoint[]): CurveValidationIssue[] {
  const issues: CurveValidationIssue[] = [];
  const ids = new Set<string>();
  let startOwners = 0;
  let endOwners = 0;

  points.forEach((point, index) => {
    if (ids.has(point.id)) {
      issues.push({ severity: 'error', message: `Duplicate point id "${point.id}".` });
    }
    ids.add(point.id);

    if (!Number.isFinite(point.time) || !Number.isFinite(point.value)) {
      issues.push({ severity: 'error', message: `Point ${point.id || index} has non-finite time or value.` });
    }

    if (getEdgeOwner(point) === 'start') startOwners += 1;
    if (getEdgeOwner(point) === 'end') endOwners += 1;

    if (point.role === 'boundary' && !getEdgeOwner(point)) {
      issues.push({ severity: 'warning', message: `Boundary point ${point.id || index} has no edge owner.` });
    }
  });

  const byTime = [...points].sort((a, b) => a.time - b.time);
  for (let i = 1; i < byTime.length; i++) {
    if (byTime[i].time <= byTime[i - 1].time) {
      issues.push({ severity: 'error', message: 'Invalid time ordering after sort.' });
      break;
    }
  }

  if (startOwners > 1) issues.push({ severity: 'error', message: 'More than one point owns the start edge.' });
  if (endOwners > 1) issues.push({ severity: 'error', message: 'More than one point owns the end edge.' });
  if (points.length > 0 && startOwners === 0) issues.push({ severity: 'error', message: 'Missing start edge owner.' });
  if (points.length > 0 && endOwners === 0) issues.push({ severity: 'error', message: 'Missing end edge owner.' });

  return issues;
}

export function validateColorCurve(curve: types.ColorCurve): CurveValidationIssue[] {
  return CHANNELS.flatMap(channel =>
    validateCurvePoints(curve[channel]).map(issue => ({
      ...issue,
      message: `${channel}: ${issue.message}`
    }))
  );
}

export function applyPointMoveConstraints(
  points: types.CurvePoint[],
  index: number,
  next: { time: number; value: number },
  pointEpsilon: number
) {
  const point = points[index];
  const minTime = index > 0 ? points[index - 1].time + pointEpsilon : 0;
  const maxTime = index < points.length - 1 ? points[index + 1].time - pointEpsilon : 1;

  return clampPointMove(
    {
      ...point,
      constraints: {
        ...point.constraints,
        minTime: Math.max(minTime, point.constraints?.minTime ?? minTime),
        maxTime: Math.min(maxTime, point.constraints?.maxTime ?? maxTime),
        minValue: Math.max(0, point.constraints?.minValue ?? 0),
        maxValue: Math.min(2, point.constraints?.maxValue ?? 2)
      }
    },
    {
      time: clamp(next.time, minTime, maxTime),
      value: clamp(next.value, 0, 2)
    }
  );
}
