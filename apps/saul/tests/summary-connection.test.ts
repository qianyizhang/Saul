import { expect, it } from 'vitest';
import type { UserSettings } from '../src/types';
import { summaryConnections, validateSummaryConnection } from '../src/digest/connection';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/storage/settings';
import { portableSettings, restoreSettings } from '../src/storage/scoped-config';
import { validateDigest } from '../src/digest/contracts';

const accounts = ['bound', 'duplicate'].map((id) => ({
  id,
  label: 'Same email',
  signedIn: true,
  planEnabled: true,
}));
function managed(): UserSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    sharedCredentials: 'saul' as const,
    chatgptPlan: { accountId: 'duplicate', model: 'other' },
    connections: [
      { key: 'gpt-plan', name: 'My plan', kind: 'chatgpt-plan' as const, accountId: 'bound' },
    ],
  };
}
it('uses the bound connection despite duplicate registrations and another globally selected account', () => {
  expect(summaryConnections(managed(), accounts)).toMatchObject({
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
    expect(() => normalizeSettings({ ...settings, summaryConnectionKey: value })).toThrow();
});
it('rejects stale account bindings and credential route changes at new-run admission', () => {
  const settings = managed();
  expect(() => validateSummaryConnection(settings, 'bound', 'gpt-plan')).not.toThrow();
  expect(() => validateSummaryConnection(settings, 'duplicate', 'gpt-plan')).toThrow('changed');
  expect(() => validateSummaryConnection(settings, 'bound')).toThrow('changed');
  expect(() => validateSummaryConnection(DEFAULT_SETTINGS, 'bound', 'gpt-plan')).toThrow(
    'route changed',
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
it('retains standalone local account selection and does not borrow another account when signed out', () => {
  expect(summaryConnections(DEFAULT_SETTINGS, accounts).chosen).toBe('');
  const settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    chatgptPlan: { accountId: 'bound', model: '' },
  };
  expect(summaryConnections(settings, accounts).chosen).toBe('bound');
  expect(summaryConnections(settings, accounts.slice(1)).chosen).toBe('');
  expect(() => validateSummaryConnection(settings, 'bound')).not.toThrow();
});
