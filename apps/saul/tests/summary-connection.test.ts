import { expect, it, vi } from 'vitest';
import { createCallAdmission } from '../src/calls/admission';
import type { Configuration } from '../src/configuration/definition';
import {
  summaryConnections,
  validateSummaryConnection,
} from '../src/calls/execution/summary-connection';
import { decodeConfiguration } from '../src/configuration/record';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import { portableSettings, restoreSettings } from '../src/configuration/scoped';
import { validateDigest } from '../src/calls/batch-messages';
import type { DigestBatch } from '../shared/model/call-batch.ts';

const accounts = ['bound', 'duplicate'].map((id) => ({
  id,
  label: 'Same email',
  signedIn: true,
  planEnabled: true,
}));
function managed(): Configuration {
  return {
    ...structuredClone(DEFAULT_CONFIGURATION),
    sharedCredentials: 'saul' as const,
    chatgptPlan: { accountId: 'duplicate', model: 'other' },
    connections: [
      { key: 'gpt-plan', name: 'My plan', kind: 'chatgpt-plan' as const, accountId: 'bound' },
    ],
  };
}
it('uses the bound connection despite duplicate registrations and another globally selected account', () => {
  expect(
    summaryConnections({ ...managed(), summaryConnectionKey: 'gpt-plan' }, accounts),
  ).toMatchObject({
    chosen: 'gpt-plan',
    choices: [{ key: 'gpt-plan', accountId: 'bound', available: true }],
  });
  expect(summaryConnections(managed(), accounts).choices).toHaveLength(1);
});
it('remembers an explicit choice and never falls back after removal or lost permission', () => {
  const settings = { ...managed(), summaryConnectionKey: 'work' };
  settings.connections.push({
    key: 'work',
    name: 'Work',
    kind: 'chatgpt-plan',
    accountId: 'duplicate',
  });
  expect(summaryConnections(settings, accounts).chosen).toBe('work');
  expect(summaryConnections(settings, accounts.slice(0, 1))).toMatchObject({
    chosen: '',
    error: expect.stringContaining('unavailable'),
  });
  settings.connections.pop();
  expect(summaryConnections(settings, accounts).chosen).toBe('');
  delete settings.connections[0]!.accountId;
  expect(summaryConnections(managed(), [{ ...accounts[0]!, signedIn: false }]).chosen).toBe('');
  expect(
    summaryConnections({ ...settings, summaryConnectionKey: undefined }, accounts).chosen,
  ).toBe('');
});
it('asks once for multiple configured connections without a default and blocks disconnected mode', () => {
  const settings = managed();
  settings.connections = [
    { key: 'home', name: 'Home', kind: 'chatgpt-plan', accountId: 'bound' },
    { key: 'work', name: 'Work', kind: 'chatgpt-plan', accountId: 'duplicate' },
  ];
  expect(summaryConnections(settings, accounts).chosen).toBe('');
  expect(
    summaryConnections({ ...settings, sharedCredentials: 'disconnected' }, accounts).choices,
  ).toEqual([]);
});
it('preserves the summary connection through portable settings and validates malformed saved keys', () => {
  const settings = { ...managed(), summaryConnectionKey: 'gpt-plan' };
  const portable = portableSettings(settings);
  expect(portable.summaryConnectionKey).toBe('gpt-plan');
  expect(portable.chatgptPlan).toBeUndefined();
  expect(restoreSettings(settings, { revision: 2, value: portable }).summaryConnectionKey).toBe(
    'gpt-plan',
  );
  for (const value of [null, 42, '', 'UPPER', 'secret/endpoint'])
    expect(() => decodeConfiguration({ ...settings, summaryConnectionKey: value })).toThrow();
});
it('rejects stale account bindings and credential route changes at new-run admission', () => {
  const settings = managed();
  expect(() => validateSummaryConnection(settings, 'bound', 'gpt-plan')).not.toThrow();
  expect(() => validateSummaryConnection(settings, 'duplicate', 'gpt-plan')).toThrow('changed');
  expect(() => validateSummaryConnection(settings, 'bound')).toThrow('changed');
  expect(() => validateSummaryConnection(DEFAULT_CONFIGURATION, 'bound', 'gpt-plan')).toThrow(
    'Connect this app',
  );
  expect(() =>
    validateSummaryConnection(
      { ...settings, sharedCredentials: 'disconnected' },
      'bound',
      'gpt-plan',
    ),
  ).toThrow('Connect this app');
  expect(() =>
    validateDigest({
      action: 'start',
      id: 'summary',
      tabIds: [1],
      accountId: 'bound',
      connectionKey: 'gpt-plan',
    }),
  ).not.toThrow();
  expect(() =>
    validateDigest({
      action: 'start',
      id: 'summary',
      tabIds: [1],
      accountId: 'bound',
      connectionKey: '../bad',
    }),
  ).toThrow();
});
it('preserves a legacy account choice but never admits it for a Summary', () => {
  expect(summaryConnections(DEFAULT_CONFIGURATION, accounts).chosen).toBe('');
  const settings = {
    ...structuredClone(DEFAULT_CONFIGURATION),
    chatgptPlan: { accountId: 'bound', model: '' },
  };
  expect(summaryConnections(settings, accounts).chosen).toBe('');
  expect(summaryConnections(settings, accounts.slice(1)).chosen).toBe('');
  expect(() => validateSummaryConnection(settings, 'bound')).toThrow(/Connect/);
});

it('requires an explicit shared choice before replacing a legacy Summary account', () => {
  const settings = { ...managed(), chatgptPlan: { accountId: 'retired-local', model: '' } };
  const before = summaryConnections(settings, accounts);
  expect(before.choices).toContainEqual(
    expect.objectContaining({ key: 'gpt-plan', available: true }),
  );
  expect(before.chosen).toBe('');
  expect(
    summaryConnections({ ...settings, summaryConnectionKey: 'gpt-plan' }, accounts).chosen,
  ).toBe('gpt-plan');
});

it('validates the saved binding when retrying the original Summary route', async () => {
  const settings = { ...managed(), summaryConnectionKey: 'other' };
  const saved: DigestBatch = {
    id: 'saved-summary',
    windowId: 1,
    windowTitle: 'Saved window',
    createdAt: 1,
    accountId: 'bound',
    credentialOwner: 'saul',
    connectionKey: 'gpt-plan',
    model: 'gpt-6-luna',
    effort: 'medium',
    prompt: 'Summarize',
    items: [],
  };
  const readSettings = vi.fn(async () => ({ state: 'ready' as const, settings, revision: '1' }));
  const admit = createCallAdmission({
    readSettings,
    readChoices: async () => {
      throw new Error('Retry must not read the current Call selection.');
    },
    readBatch: async () => saved,
  });
  const retry = { action: 'retry' as const, id: saved.id };
  await expect(admit(retry)).resolves.toMatchObject({ message: retry });
  settings.connections = [];
  await expect(admit(retry)).rejects.toThrow('connection changed');

  // Never infer signed ownership from the current mode or a matching account label.
  delete saved.connectionKey;
  saved.credentialOwner = 'local';
  readSettings.mockClear();
  await expect(admit(retry)).rejects.toThrow('Select a new preset');
  delete saved.credentialOwner;
  await expect(admit(retry)).rejects.toThrow('Select a new preset');
  expect(readSettings).not.toHaveBeenCalled();
  // A signed original Summary can retry its exact old registration without finding a new binding.
  saved.credentialOwner = 'saul';
  await expect(admit(retry)).resolves.toMatchObject({ message: retry });
  settings.sharedCredentials = 'disconnected';
  await expect(admit(retry)).rejects.toThrow('Integrations');
});
