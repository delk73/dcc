import type { CurveFieldProjectionIr } from './curveProjectionIr';
import type { CurveSpaceIr } from './curveSpaceIr';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function hashHex(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function hashCurveSpaceIr(curveSpace: CurveSpaceIr): string {
  return hashHex(stableStringify(curveSpace));
}

export function hashCurveFieldProjectionIr(projection: CurveFieldProjectionIr): string {
  return hashHex(stableStringify(projection));
}

export function hashCurveFieldProjectionCanonical(
  curveSpace: CurveSpaceIr,
  projection: CurveFieldProjectionIr
): string {
  return hashHex(stableStringify({ curveSpace, projection }));
}