import { isRecord } from './value.mts';
// Chrome caps each native frame at 1 MiB. Bound and assemble larger history messages.
export function packets(value: unknown): unknown[] {
  const json = JSON.stringify(value);
  if (json.length <= 120_000) return [value];
  const result: unknown[] = [];
  for (let offset = 0; offset < json.length; offset += 120_000)
    result.push({
      fragment: json.slice(offset, offset + 120_000),
      last: offset + 120_000 >= json.length,
    });
  return result;
}
export class Fragments {
  private chunks: string[] = [];
  private size = 0;
  accept(value: unknown): unknown | undefined {
    if (!isRecord(value) || !('fragment' in value)) return value;
    if (
      typeof value.fragment !== 'string' ||
      value.fragment.length > 120_000 ||
      typeof value.last !== 'boolean' ||
      (this.size += value.fragment.length) > 128 * 1024 * 1024
    )
      throw new Error('Invalid or oversized native history message.');
    this.chunks.push(value.fragment);
    if (!value.last) return;
    const json = this.chunks.join('');
    this.chunks = [];
    this.size = 0;
    return JSON.parse(json);
  }
}
