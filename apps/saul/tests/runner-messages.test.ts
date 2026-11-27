import { expect, it } from 'vitest';
import { validateRunnerRequest } from '../src/platform/chrome/runner';

it('distinguishes the exact legacy clear envelope from an incomplete record deletion', () => {
  const clear = { target: 'saul-offscreen', operation: 'delete' };
  expect(() => validateRunnerRequest(clear)).not.toThrow();
  expect(() => validateRunnerRequest({ ...clear, selectionID: 'record' })).toThrow();
  expect(() => validateRunnerRequest({ ...clear, selectionId: null })).toThrow();
});

it('rejects a malformed storage payload before dispatch to the runner', () => {
  expect(() =>
    validateRunnerRequest({
      operation: 'db',
      message: { type: 'DB_ANNOTATION', payload: { operation: { action: 'change', changes: [] } } },
    }),
  ).toThrow();
});

it('validates frozen model choices on annotation responses and Call lookups', () => {
  expect(() =>
    validateRunnerRequest({
      operation: 'annotation',
      message: {
        action: 'respond',
        url: 'https://example.test/',
        targets: [],
        presetId: 'preset',
        textOnly: true,
        current: false,
      },
      prepared: { credential: '', choices: {} },
    }),
  ).toThrow();
  expect(() =>
    validateRunnerRequest({
      operation: 'digest',
      message: { action: 'resolve', id: 'example' },
      snapshot: { items: [], currentModel: {} },
    }),
  ).toThrow();
});
