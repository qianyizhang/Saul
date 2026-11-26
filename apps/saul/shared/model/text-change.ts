export interface TextChange {
  kind: 'same' | 'formatting' | 'changed';
  before: number;
  after: number;
  added: number;
  removed: number;
  percent: number;
}

// A bounded, linear token inventory, not a semantic similarity score or edit distance.
// Han characters are separate tokens; word runs cover alphabetic scripts.
const tokens = (text: string) =>
  text.match(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}])+|[^\s]/gu) || [];
export function compareText(before: string, after: string): TextChange {
  const previous = tokens(before),
    current = tokens(after);
  const counts = new Map<string, number>();
  for (const token of previous) counts.set(token, (counts.get(token) || 0) + 1);
  let added = 0;
  for (const token of current) {
    const count = counts.get(token) || 0;
    if (count) counts.set(token, count - 1);
    else added++;
  }
  const removed = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return {
    kind:
      before === after
        ? 'same'
        : previous.length === current.length &&
            previous.every((token, index) => token === current[index])
          ? 'formatting'
          : 'changed',
    before: previous.length,
    after: current.length,
    added,
    removed,
    percent: Math.round((100 * (added + removed)) / Math.max(1, previous.length + current.length)),
  };
}
