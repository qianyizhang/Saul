import { TagStreamParser } from '../parser/tag-stream-parser';
export function searchableResponse(raw: string): string {
  return new TagStreamParser()
    .feed(raw)
    .map((s) => (s.type === 'text' ? s.text : s.term + ' ' + s.note))
    .join(' ');
}
