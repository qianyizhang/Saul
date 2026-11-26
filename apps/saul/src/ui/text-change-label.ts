import type { TextChange } from '../../shared/model/text-change.ts';

export function changeLabel(change: TextChange): string {
  if (change.kind === 'same') return 'Text unchanged';
  if (change.kind === 'formatting') return 'Whitespace changed only';
  if (!change.added && !change.removed) return 'Text order changed · same token counts';
  return `Text changed · ${change.percent < 1 ? '<1' : change.percent}% token difference · +${change.added.toLocaleString()} / −${change.removed.toLocaleString()}`;
}
