import { expect, it } from 'vitest';
import { catalogIssue, validConnectionCatalog } from '../shared/protocol/connections-contract.mts';
import {
  validateCredentialEvent,
  validateCredentialRequest,
} from '../shared/protocol/credentials-contract.mts';
import {
  validateConnections,
  validateConnectionChanges,
} from '../shared/protocol/shared-presets-contract.mts';
import { preparePreset } from '../src/configuration/resolve';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';

const catalog = {
  fetchedAt: 123,
  models: [
    { id: 'future-model', name: 'Future', capabilities: ['write'], efforts: [], defaultEffort: '' },
  ],
};
it('separates confirmed removal, successful empty discovery and failed refresh without rewriting the model', () => {
  expect(validConnectionCatalog(catalog)).toBe(true);
  expect(catalogIssue({ ...catalog, models: [] }, 'future-model')).toContain('no longer available');
  const stale = { ...catalog, error: 'Network unavailable' };
  expect(catalogIssue(stale as Parameters<typeof catalogIssue>[0], 'future-model')).toBeUndefined();
  expect(
    catalogIssue({ models: [], fetchedAt: 0, error: 'Discovery unsupported' }, 'future-model'),
  ).toBe('Discovery unsupported');
  expect(
    validConnectionCatalog({ ...catalog, models: [...catalog.models, ...catalog.models] }),
  ).toBe(false);
});
it('validates catalog and status through the actual credential wire without accepting secret fields', () => {
  expect(() => validateCredentialEvent({ type: 'result', catalog })).not.toThrow();
  expect(() =>
    validateCredentialEvent({ type: 'result', connection: { connected: true, keySuffix: '1234' } }),
  ).not.toThrow();
  expect(() =>
    validateCredentialEvent({ type: 'result', connection: { connected: true, key: 'secret' } }),
  ).toThrow();
  expect(() =>
    validateCredentialEvent({ type: 'result', catalog: { ...catalog, accessToken: 'secret' } }),
  ).toThrow();
  expect(() =>
    validateCredentialRequest({
      action: 'connection-key-save',
      connectionKey: 'local',
      endpoint: 'http://localhost:11434/v1',
      key: '',
    }),
  ).not.toThrow();
  expect(() =>
    validateCredentialRequest({
      action: 'connection-key-save',
      connectionKey: 'local',
      endpoint: 'https://user:secret@example.test/v1',
      key: 'key',
    }),
  ).toThrow();
});
it('opts new catalog callers into provider defaults while retaining old request and reply shapes', () => {
  const request = { action: 'connection-catalog', connectionKey: 'plan-a' };
  for (const fields of [
    {},
    { force: true },
    { intent: 'check' },
    { intent: 'display' },
    { intent: 'refresh' },
  ])
    expect(() => validateCredentialRequest({ ...request, ...fields })).not.toThrow();
  for (const fields of [
    { intent: 'execution' },
    { intent: ['check'] },
    { intent: 'check', force: false },
  ])
    expect(() => validateCredentialRequest({ ...request, ...fields })).toThrow();

  const model = catalog.models[0]!;
  expect(validConnectionCatalog({ ...catalog, models: [{ ...model, isDefault: true }] })).toBe(
    true,
  );
  expect(validConnectionCatalog({ ...catalog, models: [{ ...model, isDefault: 1 }] })).toBe(false);
});
it('pins a plan connection regardless of another account selected by the app', () => {
  const settings = structuredClone(DEFAULT_CONFIGURATION);
  settings.sharedCredentials = 'saul';
  settings.connections = [
    { key: 'work', name: 'Work', kind: 'chatgpt-plan', accountId: 'work-account' },
  ];
  settings.chatgptPlan = { accountId: 'personal-account', model: 'other-model' };
  const preset = {
    id: 'preset',
    name: 'Work preset',
    provider: 'chatgpt-plan' as const,
    connectionKey: 'work',
    capability: 'write' as const,
    model: 'future-model',
    effort: '',
    fast: false,
  };
  expect(preparePreset(settings, preset).choices.plan?.accountId).toBe('work-account');
  expect(() =>
    validateConnectionChanges(settings.connections, [
      { ...settings.connections[0]!, accountId: 'personal-account' },
    ]),
  ).toThrow('cannot change');
  delete settings.connections[0]!.accountId;
  expect(() => preparePreset(settings, preset)).toThrow('Choose an account');
});
it('keeps custom endpoint definitions secret-free and resolves their own credential owner', () => {
  const settings = structuredClone(DEFAULT_CONFIGURATION);
  settings.sharedCredentials = 'saul';
  settings.connections = [
    { key: 'local', name: 'Local', kind: 'openai-api', baseUrl: 'http://localhost:11434/v1' },
  ];
  validateConnections(settings.connections);
  const resolved = preparePreset(settings, {
    id: 'preset',
    name: 'Local',
    provider: 'openai-compatible',
    connectionKey: 'local',
    model: 'new-model',
    capability: 'write',
    effort: '',
    fast: false,
  });
  expect(resolved.choices.remote.baseUrl).toBe('http://localhost:11434/v1');
  expect(resolved.choices.remote.credentialOwner).toBe('saul');
  expect(resolved.credential).toBe('');
  expect(() =>
    validateConnectionChanges(settings.connections, [
      { ...settings.connections[0]!, baseUrl: 'https://elsewhere.test/v1' },
    ]),
  ).toThrow('cannot change');
  expect(() =>
    validateConnectionChanges(
      [{ key: 'openai-api', name: 'OpenAI API', kind: 'openai-api' }],
      [
        {
          key: 'openai-api',
          name: 'OpenAI API',
          kind: 'openai-api',
          baseUrl: 'https://elsewhere.test/v1',
        },
      ],
    ),
  ).toThrow('cannot change');
});
