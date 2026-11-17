import { TagStreamParser } from '../../shared/model/tag-stream-parser.ts';
export function searchableResponse(raw: string): string {
  return new TagStreamParser()
    .feed(raw)
    .map((s) => (s.type === 'text' ? s.text : s.term + ' ' + s.note))
    .join(' ');
}
