import { TagStreamParser } from '../parser/tag-stream-parser';
export function plainExplanation(raw: string) {
  return new TagStreamParser()
    .feed(raw)
    .map((s) => (s.type === 'text' ? s.text : s.term))
    .join('');
}
export function safeSource(url: string) {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
export function downloadMarkdown(markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `saul-reading-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
