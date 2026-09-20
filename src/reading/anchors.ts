import type { SelectionSnapshot } from '../types';

const MAX_TEXT = 1_000_000;
const MAX_NODES = 30_000;
const excluded = 'saul-root,script,style,noscript,textarea,input,[contenteditable="true"]';
interface Span {
  node: Text;
  start: number;
  end: number;
}
export interface TextMap {
  text: string;
  spans: Span[];
  starts: number[];
  ends: number[];
  truncated: boolean;
}
export function buildTextMap(): TextMap {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const spans: Span[] = [];
  let raw = '',
    truncated = false,
    node: Node | null;
  while ((node = walker.nextNode())) {
    if (spans.length >= MAX_NODES || raw.length >= MAX_TEXT) {
      truncated = true;
      break;
    }
    const text = (node as Text).data.slice(0, MAX_TEXT - raw.length);
    spans.push({ node: node as Text, start: raw.length, end: raw.length + text.length });
    raw += text;
    if (text.length < (node as Text).length) {
      truncated = true;
      break;
    }
  }
  const starts: number[] = [],
    ends: number[] = [];
  let text = '';
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i]!)) {
      const start = i;
      while (i + 1 < raw.length && /\s/.test(raw[i + 1]!)) i++;
      text += ' ';
      starts.push(start);
      ends.push(i + 1);
    } else {
      text += raw[i];
      starts.push(i);
      ends.push(i + 1);
    }
  }
  return { text, spans, starts, ends, truncated };
}
export function captureAnchor(range: Range, map = buildTextMap()): SelectionSnapshot['anchor'] {
  // A bounded scan cannot establish uniqueness outside its covered document.
  if (map.truncated)
    throw new Error('This page is too large to anchor reliably. Select text in a shorter page.');
  let start: number | undefined, end: number | undefined;
  for (const span of map.spans) {
    if (!range.intersectsNode(span.node)) continue;
    const a = span.node === range.startContainer ? range.startOffset : 0;
    const b = span.node === range.endContainer ? range.endOffset : span.node.length;
    const probe = document.createRange();
    probe.setStart(span.node, a);
    probe.setEnd(span.node, b);
    if (
      a === b ||
      range.compareBoundaryPoints(Range.END_TO_START, probe) >= 0 ||
      range.compareBoundaryPoints(Range.START_TO_END, probe) <= 0
    )
      continue;
    start ??= span.start + a;
    end = span.start + b;
  }
  if (start === undefined || end === undefined)
    throw new Error('This selection is outside the readable part of the page.');
  let textStart = map.ends.findIndex((value) => value > start!);
  let textEnd = map.starts.findIndex((value) => value >= end!);
  if (textEnd < 0) textEnd = map.text.length;
  while (map.text[textStart] === ' ') textStart++;
  while (map.text[textEnd - 1] === ' ') textEnd--;
  return {
    exact: map.text.slice(textStart, textEnd),
    prefix: map.text.slice(Math.max(0, textStart - 80), textStart),
    suffix: map.text.slice(textEnd, textEnd + 80),
    textStart,
    textEnd,
  };
}
export type Attachment =
  | { state: 'attached'; range: Range }
  | { state: 'not-yet-present' | 'unresolved' };
export function resolveAnchor(anchor: SelectionSnapshot['anchor'], map: TextMap): Attachment {
  if (map.truncated) return { state: 'unresolved' };
  const quote = anchor.exact.replace(/\s+/g, ' ').trim();
  if (!quote) return { state: 'unresolved' };
  const prefix = anchor.prefix.replace(/\s+/g, ' '),
    suffix = anchor.suffix.replace(/\s+/g, ' ');
  const matches: number[] = [];
  for (let at = map.text.indexOf(quote); at >= 0; at = map.text.indexOf(quote, at + 1)) {
    // Position is only a hint. Exact surrounding text must still agree.
    const before = map.text.slice(Math.max(0, at - prefix.length), at),
      after = map.text.slice(at + quote.length, at + quote.length + suffix.length);
    if ((!prefix || before === prefix) && (!suffix || after === suffix)) matches.push(at);
    if (matches.length > 1) return { state: 'unresolved' };
  }
  if (!matches.length)
    return { state: map.text.includes(quote) ? 'unresolved' : 'not-yet-present' };
  // Without any context a unique quote is useful only when the original position agrees.
  const at = matches[0]!;
  if (!prefix && !suffix && anchor.textStart !== at) return { state: 'unresolved' };
  const rawStart = map.starts[at]!,
    rawEnd = map.ends[at + quote.length - 1]!;
  const first = map.spans.find((s) => s.end > rawStart),
    last = map.spans.find((s) => s.end >= rawEnd);
  if (!first || !last) return { state: 'unresolved' };
  const range = document.createRange();
  range.setStart(first.node, rawStart - first.start);
  range.setEnd(last.node, rawEnd - last.start);
  return range.getClientRects().length
    ? { state: 'attached', range }
    : { state: 'not-yet-present' };
}
