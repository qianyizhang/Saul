import { TagStreamParser } from '../../shared/model/tag-stream-parser.ts';
import type { HistoryItem, RunResult } from '../../shared/protocol/history-types.ts';

export function exportHistoryMarkdown(
  page: (offset: number, limit: number) => HistoryItem[],
  attempts: (id: string) => RunResult[],
): string {
  const lines = ['# Saul Knowledge Export', `Generated on: ${new Date().toISOString()}`];
  let total = 0;
  for (let offset = 0; ; offset += 500) {
    const batch = page(offset, 500);
    total += batch.length;
    for (const item of batch) {
      lines.push(
        `\n## ${item.pageTitle} (${item.pageUrl})`,
        `### > "${item.selectedText}"`,
        `Captured: ${new Date(item.createdAt).toISOString()}`,
        item.bookmarked ? 'Bookmarked' : '',
      );
      if (item.selectionId.startsWith('ez:')) {
        lines.push(item.responseRaw);
        if (item.hasImage) lines.push('[Saved image in shared history]');
        continue;
      }
      for (const run of attempts(item.selectionId)) {
        const segments = new TagStreamParser().feed(run.responseRaw);
        lines.push(
          `\n${run.status === 'completed' ? 'Completed' : 'Incomplete (' + run.status + ')'} · Model: ${run.model}`,
          ...(run.recipe
            ? [`Action: ${run.recipe.name}${run.preset ? ` · Preset: ${run.preset.name}` : ''}`]
            : []),
          ...(run.inspection?.followUpQuestion
            ? [`Follow-up: ${run.inspection.followUpQuestion}`]
            : []),
          segments.map((s) => (s.type === 'text' ? s.text : s.term)).join(''),
        );
        for (const s of segments)
          if (s.type === 'term' && s.note) lines.push(`- **${s.term}:** ${s.note}`);
        if (run.error) lines.push(String(run.error));
      }
      lines.push('---');
    }
    if (batch.length < 500) break;
  }
  lines.splice(2, 0, `Total Selections: ${total}\n`);
  return lines.join('\n');
}
