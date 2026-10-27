import { expect, it } from 'vitest';
import { compareText, changeLabel } from '../src/reading/input-change';
import { textPages } from '../src/surface/InspectionText';

it('distinguishes exact input, whitespace, word boundaries, reordering and Chinese additions', () => {
  expect(compareText('a b', 'a b').kind).toBe('same');
  expect(compareText('a\nb', 'a  b').kind).toBe('formatting');
  expect(compareText('a b', 'ab').kind).toBe('changed');
  expect(changeLabel(compareText('one two', 'two one'))).toContain('order changed');
  expect(compareText('研究结果', '研究新结果')).toMatchObject({
    added: 1,
    removed: 0,
    kind: 'changed',
  });
  expect(compareText('alpha beta', 'alpha gamma')).toMatchObject({
    added: 1,
    removed: 1,
    percent: 50,
  });
});
it('handles a full capture without quadratic comparisons and preserves every character in bounded pages', () => {
  const text = 'A paragraph of source text. 中文内容 😀\n\n'.repeat(4000);
  const pages = textPages(text);
  expect(pages.join('')).toBe(text);
  expect(Math.max(...pages.map((page) => page.length))).toBeLessThanOrEqual(6000);
  expect(
    pages.every((page) => !/^[\uDC00-\uDFFF]/.test(page) && !/[\uD800-\uDBFF]$/.test(page)),
  ).toBe(true);
  expect(compareText(text, text + 'new finding')).toMatchObject({
    kind: 'changed',
    added: 2,
    removed: 0,
  });
});
