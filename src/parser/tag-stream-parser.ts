import type { TagSegment } from '../types';

/**
 * Token-by-token streaming state machine parser for `<term note="...">content</term>`
 */
export class TagStreamParser {
  private buffer = '';
  private segments: TagSegment[] = [];

  /**
   * Feed an incremental text chunk and return current parsed segments
   */
  public feed(chunk: string): TagSegment[] {
    this.buffer += chunk;
    this.segments = this.parse(this.buffer);
    return this.segments;
  }

  /**
   * Reset parser state
   */
  public reset(): void {
    this.buffer = '';
    this.segments = [];
  }

  /**
   * Get the accumulated raw text
   */
  public getRaw(): string {
    return this.buffer;
  }

  /**
   * Get current parsed segments
   */
  public getSegments(): TagSegment[] {
    return this.segments;
  }

  /**
   * Parse the complete buffer into TagSegments
   */
  private parse(input: string): TagSegment[] {
    const result: TagSegment[] = [];
    let cursor = 0;
    let segmentIndex = 0;

    while (cursor < input.length) {
      const openTagStart = input.indexOf('<term', cursor);

      if (openTagStart === -1) {
        // No more term tags, remainder is plain text
        const text = input.slice(cursor);
        if (text) {
          result.push({
            id: `seg-${segmentIndex++}`,
            type: 'text',
            text,
          });
        }
        break;
      }

      // There is plain text before the <term> tag
      if (openTagStart > cursor) {
        const text = input.slice(cursor, openTagStart);
        if (text) {
          result.push({
            id: `seg-${segmentIndex++}`,
            type: 'text',
            text,
          });
        }
      }

      // Find the end of opening tag '>'
      const openTagEnd = input.indexOf('>', openTagStart);
      if (openTagEnd === -1) {
        // Opening tag is incomplete mid-stream (e.g. `<term note="some...`)
        const incompleteTag = input.slice(openTagStart);
        const noteMatch = incompleteTag.match(/note=["']([^"']*)/i);
        const note = noteMatch ? noteMatch[1] : '';

        result.push({
          id: `seg-${segmentIndex++}`,
          type: 'term',
          term: '',
          note: note || '',
          complete: false,
        });
        break;
      }

      const openTagStr = input.slice(openTagStart, openTagEnd + 1);
      const noteMatch = openTagStr.match(/note=["']([^"']*)["']/i);
      const note = noteMatch ? noteMatch[1] : '';

      const contentStart = openTagEnd + 1;
      const closeTagStart = input.indexOf('</term>', contentStart);

      if (closeTagStart === -1) {
        // Tag is open and content is still streaming
        const termContent = input.slice(contentStart);
        result.push({
          id: `seg-${segmentIndex++}`,
          type: 'term',
          term: termContent,
          note: note || '',
          complete: false,
        });
        break;
      } else {
        // Tag is fully closed
        const termContent = input.slice(contentStart, closeTagStart);
        result.push({
          id: `seg-${segmentIndex++}`,
          type: 'term',
          term: termContent,
          note: note || '',
          complete: true,
        });
        cursor = closeTagStart + '</term>'.length;
      }
    }

    return result;
  }
}
