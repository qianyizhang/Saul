import { describe, expect, it } from 'vitest';
import {
  createHistoryRequest,
  decomposeHistoryCommand,
  historyRequestPolicy,
  validateHistoryRequest,
  validateHistoryResult,
} from '../shared/protocol/history-protocol.mts';

const owner = '799c6695-f0ce-42b6-ae7b-14b78876342b';
const operationId = '01834fb9-0996-4ef4-9808-f4ceefe9177a';

describe('History wire', () => {
  it('accepts custom and built-in Call runs after undefined fields are serialized away', () => {
    const batch = {
      id: 'call',
      windowId: 1,
      windowTitle: 'Selected page',
      createdAt: 1000,
      items: [
        {
          index: 0,
          tabId: 1,
          title: 'Page',
          url: 'https://example.com/',
          status: 'queued' as const,
          raw: '',
        },
      ],
    };
    const variants = [
      { ...batch, prompt: 'Summarize' },
      {
        ...batch,
        action: {
          presetId: 'preset',
          revision: {
            contractVersion: 1 as const,
            name: 'Summarize',
            description: '',
            language: 'javascript' as const,
            source: 'export default () => "Summary";',
            revision: 'a'.repeat(64),
            createdAt: 1000,
          },
        },
      },
    ];
    for (const payload of variants) {
      const request = createHistoryRequest(owner, operationId, {
        type: 'DB_DIGEST_CREATE',
        payload,
      });
      expect(() => validateHistoryRequest(JSON.parse(JSON.stringify(request)))).not.toThrow();
      expect(() =>
        validateHistoryResult(request, { type: 'result', value: payload }),
      ).not.toThrow();
      expect(decomposeHistoryCommand(request.command)).toEqual({
        type: 'DB_DIGEST_CREATE',
        payload,
      });
      expect(() =>
        validateHistoryRequest({
          ...request,
          command: {
            ...request.command,
            input: { ...payload, items: [{ ...payload.items[0], future: 1 }] },
          },
        }),
      ).toThrow('command.input.items[0].future: unknown field');
      // Old stored rows can carry fields outside this writer's command schema.
      expect(() =>
        validateHistoryResult(request, {
          type: 'result',
          value: { ...payload, items: [{ ...payload.items[0], future: 1 }] },
        }),
      ).not.toThrow();
    }
  });

  it('keeps valid nested Call source and output fields and rejects unknown attachment fields', () => {
    const item = {
      index: 0,
      tabId: 1,
      title: 'Report',
      url: 'https://example.test/report.pdf',
      raw: 'Generated text',
      status: 'completed' as const,
      calls: [{ instructions: 'Read', input: 'Report', output: 'Extracted text', complete: true }],
      finalText: 'Final',
    };
    const fields = { title: 'Report', capturedAt: 1, truncated: false, coverage: 'Full' };
    const sources = [
      { ...fields, text: 'Report' },
      {
        ...fields,
        kind: 'pdf-url' as const,
        attachment: { type: 'pdf-url' as const, url: item.url },
      },
    ];
    for (const source of sources) {
      const message = { type: 'DB_DIGEST_ITEM', payload: { id: 'call', item, source } } as const;
      const request = createHistoryRequest(owner, operationId, message);
      expect(decomposeHistoryCommand(request.command)).toEqual(message);
    }
    const request = createHistoryRequest(owner, operationId, {
      type: 'DB_DIGEST_ITEM',
      payload: { id: 'call', item },
    });
    expect(() =>
      validateHistoryRequest({
        ...request,
        command: {
          ...request.command,
          input: {
            id: 'call',
            item,
            source: {
              ...fields,
              kind: 'pdf-url',
              attachment: { type: 'pdf-url', url: item.url, label: 'extra' },
            },
          },
        },
      }),
    ).toThrow('command.input.source.attachment:');
  });

  it('round-trips a scoped, filtered view using an opaque cursor', () => {
    const request = createHistoryRequest(owner, operationId, {
      type: 'DB_HISTORY_PAGE',
      payload: { cursor: 'opaque', limit: 2, visibility: 'masked', searchQuery: 'answer' },
    });
    expect(() => validateHistoryRequest(request)).not.toThrow();
    expect(request.command).toMatchObject({
      kind: 'list',
      view: 'library.records',
      visibility: 'masked',
    });
    expect(decomposeHistoryCommand(request.command)).toEqual({
      type: 'DB_HISTORY_PAGE',
      payload: { cursor: 'opaque', limit: 2, searchQuery: 'answer' },
    });
    expect(historyRequestPolicy(request)).toBe('read');
    expect(() =>
      validateHistoryResult(request, { type: 'result', value: { cursor: 'next', items: [] } }),
    ).not.toThrow();
    expect(() =>
      validateHistoryResult(request, { type: 'result', value: { cursor: -1, items: [] } }),
    ).toThrow('invalid reply');
  });

  it('rejects a malformed projected write before dispatch', () => {
    const request = createHistoryRequest(owner, operationId, {
      type: 'DB_SET_BOOKMARK',
      payload: { selectionId: 'saved', bookmarked: true },
    });
    expect(() => validateHistoryRequest(request)).not.toThrow();
    expect(() =>
      validateHistoryRequest({
        ...request,
        command: { ...request.command, input: { selectionId: 'saved', bookmarked: 'yes' } },
      }),
    ).toThrow('Invalid History request');
  });

  it('requires a valid revision receipt and never replays purge automatically', () => {
    const request = createHistoryRequest(owner, operationId, {
      type: 'DB_PURGE_SELECTION',
      payload: { selectionId: 'saved' },
    });
    expect(() => validateHistoryRequest(request)).not.toThrow();
    expect(request.command).toEqual({
      kind: 'purge',
      target: { collection: 'library', id: 'saved' },
    });
    expect(historyRequestPolicy(request)).toBe('explicit-write');
    expect(() => validateHistoryResult(request, { type: 'result', value: null })).toThrow(
      'Refresh the affected History view',
    );
    expect(() =>
      validateHistoryResult(request, { type: 'result', value: null, revision: 2 }),
    ).not.toThrow();
  });

  it('routes annotation attempt reads through entries with read reconnect behavior', () => {
    const request = createHistoryRequest(owner, operationId, {
      type: 'DB_ANNOTATION_ATTEMPT',
      payload: { action: 'read', annotationId: 'note' },
    });
    expect(() => validateHistoryRequest(request)).not.toThrow();
    expect(request.command).toMatchObject({ kind: 'entries', view: 'annotations.legacy-activity' });
    expect(historyRequestPolicy(request)).toBe('read');
    expect(() => validateHistoryResult(request, { type: 'result', value: ['garbled'] })).toThrow(
      'invalid reply',
    );
  });
});
