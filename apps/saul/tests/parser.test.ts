import { describe, it, expect } from 'vitest';
import { TagStreamParser } from '../shared/model/tag-stream-parser.ts';

describe('TagStreamParser', () => {
  it('handles mid-stream incomplete term tag without crashing', () => {
    const parser = new TagStreamParser();

    // Chunk 1: plain text
    let segments = parser.feed('Model uses ');
    expect(segments).toMatchObject([{ type: 'text', text: 'Model uses ' }]);

    // Chunk 2: incomplete opening tag
    segments = parser.feed('<term note="A neural net');
    expect(segments).toHaveLength(2);
    const seg1 = segments[1];
    if (seg1 && seg1.type === 'term') {
      expect(seg1.note).toBe('A neural net');
      expect(seg1.complete).toBe(false);
    } else {
      throw new Error('Expected term segment');
    }

    // Chunk 3: opening tag finished, term content streaming
    segments = parser.feed('work layer">trans');
    expect(segments).toHaveLength(2);
    const seg2 = segments[1];
    if (seg2 && seg2.type === 'term') {
      expect(seg2.term).toBe('trans');
      expect(seg2.complete).toBe(false);
    } else {
      throw new Error('Expected term segment');
    }

    // Chunk 4: term content finished and closed
    segments = parser.feed('former</term> architecture.');
    expect(segments).toHaveLength(3);
    expect(segments[1]).toMatchObject({
      type: 'term',
      term: 'transformer',
      note: 'A neural network layer',
      complete: true,
    });
    expect(segments[2]).toMatchObject({
      type: 'text',
      text: ' architecture.',
    });
  });

  it('handles multiple terms seamlessly', () => {
    const parser = new TagStreamParser();
    const segments = parser.feed(
      'Use <term note="Key 1">A</term> and <term note="Key 2">B</term> together.',
    );
    expect(segments).toMatchObject([
      { type: 'text', text: 'Use ' },
      { type: 'term', term: 'A', note: 'Key 1', complete: true },
      { type: 'text', text: ' and ' },
      { type: 'term', term: 'B', note: 'Key 2', complete: true },
      { type: 'text', text: ' together.' },
    ]);
  });
});
