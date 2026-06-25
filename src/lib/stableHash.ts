export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function stableHashHex(value: unknown): string {
  const serialized = typeof value === 'string' ? value : stableStringify(value);
  let hash = 5381;
  for (let index = 0; index < serialized.length; index++) {
    hash = ((hash << 5) + hash + serialized.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}