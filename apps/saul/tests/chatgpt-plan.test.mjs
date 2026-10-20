import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { PlanStore, accountSummary } from '../native/plan-store.mjs';
import { PlanAuth, ISSUER } from '../native/plan-auth.mjs';
import { PlanService } from '../native/plan-service.mjs';
import { validatePlanRequest, validatePlanResult } from '../native/plan-protocol.mjs';
import { planModels, planModelDefaults, planModelIssue } from '../native/plan-models.mjs';
import { responsesBody, responseEvents } from '../native/responses.mjs';

let directory, store;
beforeEach(() => {
  directory = mkdtempSync('/tmp/saul-plan-test-');
  store = new PlanStore(directory);
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});
const keys = await generateKeyPair('RS256');
const jwk = await exportJWK(keys.publicKey);
jwk.kid = 'test-key';
const jwks = createLocalJWKSet({ keys: [jwk] });
const jwt = (clientId, nonce, overrides = {}) =>
  new SignJWT({ nonce, email: 'person@example.test', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject('subject-one')
    .setIssuer(ISSUER)
    .setAudience(clientId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey);
const tokens = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'openid chatgpt.tokens.use.direct',
};
const generate = {
  action: 'generate',
  accountId: 'oaiapp_one',
  model: 'eligible-model',
  systemPrompt: 'Explain briefly.',
  userPrompt: 'A gradient.',
};
async function collect(stream) {
  const out = [];
  for await (const event of stream) out.push(event);
  return out;
}
const sse = (...events) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
function saved(expiresAt = Date.now() + 3600_000) {
  const data = store.read();
  data.accounts.push({
    clientId: 'oaiapp_one',
    subject: 'subject-one',
    email: 'person@example.test',
    tokens: {
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      expiresAt,
      scopes: ['chatgpt.tokens.use.direct'],
    },
  });
  store.write(data);
  return data;
}

it('uses only allowed Responses fields and requires a terminal completed event', async () => {
  expect(responsesBody({ ...generate, temperature: 0.3, maxTokens: 32 })).toEqual({
    model: 'eligible-model',
    instructions: 'Explain briefly.',
    input: [{ role: 'user', content: 'A gradient.' }],
    stream: true,
    store: false,
    service_tier: 'default',
  });
  expect(
    await collect(
      responseEvents(
        sse({ type: 'response.output_text.delta', delta: 'Hello' }, { type: 'response.completed' }),
      ),
    ),
  ).toEqual([{ type: 'delta', text: 'Hello' }, { type: 'complete' }]);
  await expect(
    collect(responseEvents(sse({ type: 'response.output_text.done', text: 'Hello' }))),
  ).rejects.toMatchObject({ reason: 'unexpected-eof' });
  await expect(collect(responseEvents(sse({ type: 'response.incomplete' })))).rejects.toMatchObject(
    { reason: 'incomplete' },
  );
});
it('handles byte-split UTF-8, CRLF and terminal errors after partial text', async () => {
  const bytes = new TextEncoder().encode(
    'data: {"type":"response.output_text.delta","delta":"研究"}\r\n\r\ndata: {"type":"response.completed"}\r\n\r\n',
  );
  const body = new ReadableStream({
    start(c) {
      for (const b of bytes) c.enqueue(Uint8Array.of(b));
      c.close();
    },
  });
  expect(await collect(responseEvents(new Response(body)))).toEqual([
    { type: 'delta', text: '研究' },
    { type: 'complete' },
  ]);
  const result = [];
  await expect(
    (async () => {
      for await (const event of responseEvents(
        sse(
          { type: 'response.output_text.delta', delta: 'partial' },
          {
            type: 'response.failed',
            response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } },
          },
        ),
      ))
        result.push(event);
    })(),
  ).rejects.toThrow('Manage usage');
  expect(result).toEqual([{ type: 'delta', text: 'partial' }]);
  await expect(collect(responseEvents(new Response('data: {"type":')))).rejects.toMatchObject({
    reason: 'truncated-event',
  });
});
it('rejects unsupported bridge operations and caller-supplied endpoints or tokens', () => {
  for (const request of [
    { ...generate, apiKey: 'secret' },
    { ...generate, baseUrl: 'https://evil.test' },
    { action: 'shell' },
    { ...generate, model: '' },
    { ...generate, effort: 3 },
    { ...generate, fast: 'yes' },
    { ...generate, serviceTier: 'priority' },
    { ...generate, systemPrompt: null },
  ])
    expect(() => validatePlanRequest(request)).toThrow();
  expect(() => validatePlanRequest(generate)).not.toThrow();
  expect(() => validatePlanRequest({ ...generate, systemPrompt: '' })).not.toThrow();
});
it('loads the account catalog, streams with OAuth, and never retries quota failures or changes billing', async () => {
  saved();
  const auth = new PlanAuth(store, { jwks });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [
            { visibility: 'hidden', slug: 'hidden', display_name: 'Hidden' },
            { visibility: 'list', slug: 'eligible-model', display_name: 'Eligible' },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(
      sse({
        type: 'response.failed',
        response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } },
      }),
    );
  const service = new PlanService(auth, fetcher),
    events = [];
  await service.run({ action: 'models', accountId: 'oaiapp_one' }, (e) => events.push(e));
  expect(events).toEqual([
    {
      type: 'result',
      models: [
        {
          slug: 'eligible-model',
          display_name: 'Eligible',
          supportedReasoningEfforts: [],
          defaultReasoningEffort: '',
          isDefault: false,
        },
      ],
    },
  ]);
  await expect(service.run(generate, () => {})).rejects.toThrow('Manage usage');
  await expect(service.run(generate, () => {})).rejects.toThrow('paused');
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [url, init] = fetcher.mock.calls[1];
  expect(url).toBe('https://api.openai.com/v1/responses');
  expect(init.headers.Authorization).toBe('Bearer test-access');
  expect(JSON.parse(init.body)).toEqual(responsesBody(generate));
});
it('keeps catalog order and advertised effort/speed capabilities without model-name guesses', () => {
  const models = planModels([
    { visibility: 'hidden', slug: 'hidden' },
    {
      visibility: 'list',
      slug: 'reasoner',
      display_name: 'Reasoner',
      is_default: true,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low', description: 'Quick' },
        { effort: 'medium' },
        { effort: 'low' },
        { effort: 3 },
      ],
      additional_speed_tiers: ['priority'],
    },
    {
      visibility: 'list',
      slug: 'alternate',
      default_reasoning_effort: 'high',
      supported_reasoning_efforts: [{ reasoning_effort: 'high', description: 'Thorough' }],
      service_tiers: [{ id: 'fast', name: 'Fast' }],
    },
    { visibility: 'list', slug: 'fast-in-name', service_tiers: [{ id: 'flex', name: 3 }] },
  ]);
  expect(models).toEqual([
    {
      slug: 'reasoner',
      display_name: 'Reasoner',
      supportedReasoningEfforts: [
        { effort: 'low', description: 'Quick' },
        { effort: 'medium', description: '' },
      ],
      defaultReasoningEffort: 'medium',
      fastTier: 'priority',
      isDefault: true,
    },
    {
      slug: 'alternate',
      display_name: 'alternate',
      supportedReasoningEfforts: [{ effort: 'high', description: 'Thorough' }],
      defaultReasoningEffort: 'high',
      fastTier: 'fast',
      isDefault: false,
    },
    {
      slug: 'fast-in-name',
      display_name: 'fast-in-name',
      supportedReasoningEfforts: [],
      defaultReasoningEffort: '',
      isDefault: false,
    },
  ]);
  expect(planModelDefaults(models[0])).toEqual({ effort: 'low', fast: false });
  expect(planModelDefaults(models[1])).toEqual({ effort: 'high', fast: false });
  expect(planModelIssue({ model: 'reasoner' }, models)).toBeUndefined();
  expect(() => validatePlanResult({ action: 'models' }, { type: 'result', models })).not.toThrow();
  expect(() =>
    validatePlanResult(
      { action: 'models' },
      { type: 'result', models: [{ slug: 'old', display_name: 'Old' }] },
    ),
  ).toThrow('Update the helper');
});
it('validates saved model, effort and Fast against the account catalog before inference', async () => {
  const auth = { accessToken: vi.fn(async () => 'fixture-token') };
  const fetcher = vi.fn(async (url) =>
    url.endsWith('/models')
      ? Response.json({
          models: [
            {
              visibility: 'list',
              slug: 'eligible-model',
              display_name: 'Eligible',
              supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
              additional_speed_tiers: ['priority'],
            },
          ],
        })
      : sse({ type: 'response.completed' }),
  );
  const service = new PlanService(auth, fetcher);
  await expect(service.run({ ...generate, model: 'removed' }, () => {})).rejects.toThrow(
    'unavailable',
  );
  await expect(service.run({ ...generate, effort: 'ultra' }, () => {})).rejects.toThrow(
    'saved effort',
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  await service.run({ ...generate, effort: 'high', fast: true }, () => {});
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    ...responsesBody(generate),
    reasoning: { effort: 'high' },
    service_tier: 'priority',
  });
  // Refreshing removes old capabilities; saved choices must not normalize or send.
  fetcher.mockResolvedValueOnce(
    Response.json({ models: [{ visibility: 'list', slug: 'eligible-model' }] }),
  );
  await service.run({ action: 'models', accountId: generate.accountId }, () => {});
  const calls = fetcher.mock.calls.length;
  await expect(service.run({ ...generate, fast: true }, () => {})).rejects.toThrow(
    'Fast is unavailable',
  );
  await expect(service.run({ ...generate, effort: 'high' }, () => {})).rejects.toThrow(
    'saved effort',
  );
  expect(fetcher).toHaveBeenCalledTimes(calls);
});
it('keeps capability catalogs account-bound and blocks inference when permission or discovery fails', async () => {
  const auth = {
    accessToken: vi.fn(async (id) => {
      if (id === 'denied') throw new Error('ChatGPT plan permission is disabled.');
      return id;
    }),
  };
  const fetcher = vi.fn(async (_url, init) =>
    Response.json({
      models: [
        {
          visibility: 'list',
          slug: 'eligible-model',
          additional_speed_tiers:
            init.headers.Authorization === 'Bearer oaiapp_one' ? ['priority'] : [],
        },
      ],
    }),
  );
  const service = new PlanService(auth, fetcher);
  await service.run({ action: 'models', accountId: 'oaiapp_one' }, () => {});
  await expect(
    service.run({ ...generate, accountId: 'oaiapp_two', fast: true }, () => {}),
  ).rejects.toThrow('Fast is unavailable');
  await expect(service.run({ ...generate, accountId: 'denied' }, () => {})).rejects.toThrow(
    'permission',
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockResolvedValueOnce(
    Response.json({ error: { code: 'subscription_sharing_usage_unavailable' } }, { status: 503 }),
  );
  await expect(
    service.run({ action: 'models', accountId: 'oaiapp_one' }, () => {}),
  ).rejects.toThrow('temporarily unavailable');
  fetcher.mockResolvedValueOnce(Response.json({ models: [] }));
  await expect(service.run(generate, () => {})).rejects.toThrow('unavailable');
  expect(fetcher.mock.calls.every(([url]) => url.endsWith('/models'))).toBe(true);
});
it.each(['fast', 'priority'])(
  'maps advertised %s to Responses priority and keeps Standard explicit',
  async (tier) => {
    const fetcher = vi.fn(async (url) =>
      url.endsWith('/models')
        ? Response.json({
            models: [
              { visibility: 'list', slug: 'eligible-model', additional_speed_tiers: [tier] },
            ],
          })
        : sse({ type: 'response.completed' }),
    );
    const service = new PlanService({ accessToken: async () => 'fixture-token' }, fetcher);
    await service.run({ ...generate, fast: true }, () => {});
    expect(JSON.parse(fetcher.mock.calls[1][1].body).service_tier).toBe('priority');
    await service.run({ ...generate, fast: false, systemPrompt: '' }, () => {});
    const body = JSON.parse(fetcher.mock.calls[2][1].body);
    expect(body.service_tier).toBe('default');
    expect(body).not.toHaveProperty('instructions');
    expect(body.input).toEqual([{ role: 'user', content: generate.userPrompt }]);
  },
);
it.each(['models', 'generate'])(
  'a newer refresh supersedes an earlier %s catalog without stale inference',
  async (action) => {
    const pending = Promise.withResolvers();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(
        Response.json({ models: [{ visibility: 'list', slug: 'eligible-model' }] }),
      );
    const service = new PlanService({ accessToken: async () => 'fixture-token' }, fetcher);
    const first = service
      .run(
        action === 'generate'
          ? { ...generate, fast: true }
          : { action, accountId: generate.accountId },
        () => {},
      )
      .catch((error) => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await service.run({ action: 'models', accountId: generate.accountId }, () => {});
    pending.resolve(
      Response.json({
        models: [
          { visibility: 'list', slug: 'eligible-model', additional_speed_tiers: ['priority'] },
        ],
      }),
    );
    expect(await first).toMatchObject({
      message: expect.stringContaining('model choices changed'),
    });
    await expect(service.run({ ...generate, fast: true }, () => {})).rejects.toThrow(
      'Fast is unavailable',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);
it.each(['login', 'logout'])('%s invalidates an earlier catalog operation', async (action) => {
  const pending = Promise.withResolvers();
  const account = { id: generate.accountId };
  const auth = {
    accessToken: async () => 'fixture-token',
    login: async () => account,
    logout: async () => ({ account }),
  };
  const fetcher = vi.fn().mockImplementationOnce(() => pending.promise);
  const service = new PlanService(auth, fetcher);
  const first = service
    .run({ action: 'models', accountId: generate.accountId }, () => {})
    .catch((error) => error);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await service.run({ action, accountId: generate.accountId }, () => {});
  pending.resolve(Response.json({ models: [{ visibility: 'list', slug: 'eligible-model' }] }));
  expect(await first).toMatchObject({ message: expect.stringContaining('model choices changed') });
  expect(service.catalogs.has(generate.accountId)).toBe(false);
});
it('shares initial catalog discovery without one cancelled job cancelling another', async () => {
  const pending = Promise.withResolvers(),
    cancelled = new AbortController();
  const fetcher = vi
    .fn()
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce(sse({ type: 'response.completed' }));
  const service = new PlanService({ accessToken: async () => 'fixture-token' }, fetcher);
  const first = service.run(generate, () => {}, cancelled.signal).catch((error) => error);
  const events = [],
    second = service.run(generate, (event) => events.push(event));
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  cancelled.abort();
  pending.resolve(Response.json({ models: [{ visibility: 'list', slug: 'eligible-model' }] }));
  expect(await first).toMatchObject({ name: 'AbortError' });
  await second;
  expect(events).toEqual([{ type: 'complete' }]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0]).toBe('https://api.openai.com/v1/responses');
});
it('registers using PKCE and validates identity before atomically saving owner-only credentials', async () => {
  let authUrl, exchange;
  const fetcher = vi.fn(async (_url, options) => {
    exchange = options.body;
    return new Response(
      JSON.stringify({
        ...tokens,
        id_token: await jwt('oaiapp_new', authUrl.searchParams.get('nonce')),
      }),
    );
  });
  const auth = new PlanAuth(store, { fetcher, jwks });
  const result = await auth.login({}, async (url) => {
    authUrl = new URL(url);
    expect(authUrl.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(authUrl.searchParams.get('agent_name_hint')).toBe('Saul');
    expect(authUrl.searchParams.get('ext_agent_host_id')).toBe(store.read().hostId);
    const callback = new URL(authUrl.searchParams.get('redirect_uri'));
    expect(callback.hostname).toBe('127.0.0.1');
    expect(callback.pathname).toBe('/auth/callback');
    callback.search = new URLSearchParams({
      state: 'wrong',
      code: 'bad',
      client_id: 'oaiapp_new',
    }).toString();
    expect((await fetch(callback)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    callback.searchParams.set('state', authUrl.searchParams.get('state'));
    callback.searchParams.set('code', 'code-one');
    expect((await fetch(callback)).status).toBe(200);
  });
  expect(result).toMatchObject({ id: 'oaiapp_new', signedIn: true, planEnabled: true });
  expect(JSON.stringify(result)).not.toContain('test-access');
  expect(exchange.get('client_id')).toBe('oaiapp_new');
  const { createHash } = await import('node:crypto');
  expect(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url')).toBe(
    authUrl.searchParams.get('code_challenge'),
  );
  expect(exchange.get('redirect_uri')).toBe(authUrl.searchParams.get('redirect_uri'));
  expect(statSync(join(directory, 'accounts.json')).mode & 0o777).toBe(0o600);
  expect(statSync(directory).mode & 0o777).toBe(0o700);
  expect(readFileSync(join(directory, 'accounts.json'), 'utf8')).toContain('test-refresh');
});
it('rejects invalid identity audience, issuer, nonce, expiration, or signature', async () => {
  const auth = new PlanAuth(store, { jwks });
  await expect(auth.identity(await jwt('wrong', 'nonce'), 'client', 'nonce')).rejects.toThrow();
  await expect(auth.identity(await jwt('client', 'wrong'), 'client', 'nonce')).rejects.toThrow();
  for (const change of [{ iss: 'https://evil.test' }, { exp: 1 }, { sub: '' }]) {
    const token = await new SignJWT({
      iss: ISSUER,
      aud: 'client',
      sub: 'subject',
      nonce: 'nonce',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      ...change,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .sign(keys.privateKey);
    await expect(auth.identity(token, 'client', 'nonce')).rejects.toThrow();
  }
  const token = await jwt('client', 'nonce');
  await expect(
    auth.identity(token.slice(0, -10) + 'invalidxxx', 'client', 'nonce'),
  ).rejects.toThrow();
});
it('retains a new registration after failed exchange and reuses it for a fresh authorization', async () => {
  let authUrl;
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
  );
  const auth = new PlanAuth(store, { fetcher, jwks });
  const callback = async (url) => {
    authUrl = new URL(url);
    const destination = new URL(authUrl.searchParams.get('redirect_uri'));
    destination.search = new URLSearchParams({
      state: authUrl.searchParams.get('state'),
      code: 'fresh-code',
      ...(authUrl.searchParams.get('client_id') === 'dynamic_agent_client'
        ? { client_id: 'oaiapp_retry' }
        : {}),
    }).toString();
    await fetch(destination);
  };
  await expect(auth.login({}, callback)).rejects.toThrow('Registration was retained');
  const before = store.read();
  expect(before.accounts).toEqual([{ clientId: 'oaiapp_retry' }]);
  expect(await auth.accounts()).toEqual([
    expect.objectContaining({ id: 'oaiapp_retry', signedIn: false, planEnabled: false }),
  ]);
  await expect(auth.accessToken('oaiapp_retry')).rejects.toThrow('sign in');
  const firstState = authUrl.searchParams.get('state');
  fetcher.mockImplementationOnce(
    async () =>
      new Response(
        JSON.stringify({
          ...tokens,
          id_token: await jwt('oaiapp_retry', authUrl.searchParams.get('nonce')),
        }),
      ),
  );
  const retry = new PlanAuth(new PlanStore(directory), { fetcher, jwks });
  await expect(retry.login({ accountId: 'oaiapp_retry' }, callback)).resolves.toMatchObject({
    id: 'oaiapp_retry',
    signedIn: true,
    planEnabled: true,
  });
  expect(authUrl.searchParams.get('client_id')).toBe('oaiapp_retry');
  expect(authUrl.searchParams.has('agent_name_hint')).toBe(false);
  expect(authUrl.searchParams.get('state')).not.toBe(firstState);
  expect(authUrl.searchParams.get('ext_agent_host_id')).toBe(before.hostId);
  expect(store.read().accounts).toHaveLength(1);
  expect(store.read().accounts[0].subject).toBe('subject-one');
});
it('retains registration and host identity on signout, and warns when remote revocation fails', async () => {
  const before = saved();
  const auth = new PlanAuth(store, {
    jwks,
    fetcher: vi.fn().mockRejectedValue(new Error('network')),
  });
  const result = await auth.logout('oaiapp_one');
  expect(result.warning).toContain('not confirmed');
  expect(result.account.signedIn).toBe(false);
  expect(store.read().hostId).toBe(before.hostId);
  expect(store.read().accounts[0].clientId).toBe('oaiapp_one');
  expect(store.read().accounts[0].tokens).toBeUndefined();
});
it('serializes rotating refresh tokens across helper instances and preserves credentials for transient errors', async () => {
  saved(1);
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ ...tokens, access_token: 'new-access', refresh_token: 'rotated-refresh' }),
      ),
    );
  const one = new PlanAuth(store, { jwks, fetcher }),
    two = new PlanAuth(new PlanStore(directory), { jwks, fetcher });
  expect(await Promise.all([one.accessToken('oaiapp_one'), two.accessToken('oaiapp_one')])).toEqual(
    ['new-access', 'new-access'],
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(store.read().accounts[0].tokens.refreshToken).toBe('rotated-refresh');
  const data = store.read();
  data.accounts[0].tokens.expiresAt = 1;
  store.write(data);
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: 'temporarily_unavailable' }), { status: 503 }),
  );
  await expect(one.accessToken('oaiapp_one')).rejects.toThrow('503');
  expect(store.read().accounts[0].tokens).toBeDefined();
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
  );
  await expect(one.accessToken('oaiapp_one')).rejects.toThrow('expired');
  expect(store.read().accounts[0].tokens).toBeUndefined();
});
it('does not infer plan authorization from identity alone and keeps summaries free of credentials', async () => {
  const data = saved();
  data.accounts[0].tokens.scopes = ['openid'];
  store.write(data);
  const auth = new PlanAuth(store, { jwks });
  await expect(auth.accessToken('oaiapp_one')).rejects.toThrow('permission is disabled');
  expect(accountSummary(data.accounts[0])).toMatchObject({ signedIn: true, planEnabled: false });
  expect(JSON.stringify(await auth.accounts())).not.toMatch(/test-access|test-refresh|idToken/);
});

it('rejects a changed registration on reauthorization without replacing the saved account', async () => {
  saved();
  const before = store.read(),
    fetcher = vi.fn();
  const auth = new PlanAuth(store, { fetcher, jwks });
  await expect(
    auth.login({ accountId: 'oaiapp_one' }, async (url) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get('client_id')).toBe('oaiapp_one');
      expect(parsed.searchParams.has('agent_name_hint')).toBe(false);
      const callback = new URL(parsed.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({
        state: parsed.searchParams.get('state'),
        client_id: 'oaiapp_other',
        code: 'code',
      }).toString();
      await fetch(callback);
    }),
  ).rejects.toThrow('different or missing');
  expect(fetcher).not.toHaveBeenCalled();
  expect(store.read()).toEqual(before);
});
it('keeps granted identity without plan permission and does not proceed to inference', async () => {
  let parsed;
  const auth = new PlanAuth(store, {
    jwks,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          scope: 'openid',
          id_token: await jwt('oaiapp_identity', parsed.searchParams.get('nonce')),
        }),
      ),
  });
  const result = await auth.login({}, async (url) => {
    parsed = new URL(url);
    const callback = new URL(parsed.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({
      state: parsed.searchParams.get('state'),
      client_id: 'oaiapp_identity',
      code: 'code',
    }).toString();
    await fetch(callback);
  });
  expect(result.planEnabled).toBe(false);
  expect(result.signedIn).toBe(true);
  await expect(auth.accessToken(result.id)).rejects.toThrow('permission is disabled');
});
it('revokes the selected renewable session at the discovered endpoint without deleting another account', async () => {
  const data = saved();
  data.accounts.push({ ...data.accounts[0], clientId: 'oaiapp_two' });
  store.write(data);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ issuer: ISSUER, revocation_endpoint: `${ISSUER}/oauth/revoke` }),
      ),
    )
    .mockResolvedValueOnce(new Response(''));
  const result = await new PlanAuth(store, { jwks, fetcher }).logout('oaiapp_one');
  expect(result.warning).toBeUndefined();
  const [url, options] = fetcher.mock.calls[1];
  expect(url.href).toBe(`${ISSUER}/oauth/revoke`);
  expect(options.body.get('token')).toBe('test-refresh');
  expect(options.body.get('client_id')).toBe('oaiapp_one');
  expect(store.read().accounts[1].tokens).toBeDefined();
});
it('cancels pending authorization without storing tokens', async () => {
  const ac = new AbortController(),
    fetcher = vi.fn();
  const auth = new PlanAuth(store, { jwks, fetcher });
  await expect(auth.login({}, () => ac.abort(), ac.signal)).rejects.toThrow('stopped');
  expect(fetcher).not.toHaveBeenCalled();
  expect(store.read().accounts).toHaveLength(0);
});

it('installs a standalone plan host with its verifier dependency and exchanges framed messages', async () => {
  const { execFileSync, spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { encodeNative, nativeDecoder } = await import('../native/transport.mjs');
  const root = join(directory, 'install'),
    manifests = join(directory, 'manifests');
  execFileSync(process.execPath, [
    'native/install.mjs',
    '--chatgpt',
    '--extension-id',
    'a'.repeat(32),
    '--install-dir',
    root,
    '--manifest-dir',
    manifests,
  ]);
  const manifest = JSON.parse(readFileSync(join(manifests, 'com.saul.chatgpt.json'), 'utf8'));
  expect(manifest.allowed_origins).toEqual([`chrome-extension://${'a'.repeat(32)}/`]);
  const child = spawn(manifest.path, [`chrome-extension://${'a'.repeat(32)}/`]);
  const stopped = once(child, 'exit');
  try {
    const result = await new Promise((resolve, reject) => {
      const decode = nativeDecoder(resolve);
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Host exited before responding')));
      child.stdout.on('data', decode);
      child.stdin.write(encodeNative({ id: 'test', request: { action: 'accounts' } }));
    });
    expect(result).toEqual({ id: 'test', event: { type: 'result', accounts: [] } });
    child.stdin.end();
    expect((await stopped)[0]).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

it('recovers a dead helper lock while preserving serialized credential writes', async () => {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(directory, 'accounts.lock'), '2147483647', { mode: 0o600 });
  const update = () =>
    store.locked(async (data) => {
      const before = data.counter || 0;
      await new Promise((resolve) => setTimeout(resolve, 10));
      data.counter = before + 1;
      store.write(data);
    });
  await Promise.all([update(), update(), update()]);
  expect(store.read().counter).toBe(3);
});
it('keeps installer proxy routing when Chrome launches the helper without shell proxy variables', async () => {
  const { createServer } = await import('node:http');
  const { execFileSync, execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { writeFileSync } = await import('node:fs');
  const requests = [];
  const proxy = createServer((request, response) => {
    requests.push(request.url);
    response.end('proxy reached');
  });
  // Node's fetch proxy agent tunnels HTTP as well as HTTPS with CONNECT.
  proxy.on('connect', (request, socket) => {
    requests.push(request.url);
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () =>
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\nproxy reached'),
    );
  });
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });
  try {
    const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
    const root = join(directory, 'proxy-install');
    const env = { ...process.env };
    for (const key of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'NO_PROXY',
      'http_proxy',
      'https_proxy',
      'no_proxy',
      'NODE_USE_ENV_PROXY',
    ])
      delete env[key];
    execFileSync(
      process.execPath,
      [
        'native/install.mjs',
        '--chatgpt',
        '--extension-id',
        'a'.repeat(32),
        '--install-dir',
        root,
        '--manifest-dir',
        join(directory, 'proxy-manifests'),
      ],
      { env: { ...env, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl } },
    );
    // A harmless network fixture runs through the actual installed launcher.
    writeFileSync(
      join(root, 'bridge', 'plan-host.mjs'),
      "console.log(await (await fetch('http://saul-proxy.test/discovery', { signal: AbortSignal.timeout(3000) })).text());",
    );
    const { stdout } = await promisify(execFile)(join(root, 'bin', 'saul-chatgpt-host'), [], {
      env,
    });
    expect(stdout.trim()).toBe('proxy reached');
    expect(requests).toEqual(['saul-proxy.test:80']);
  } finally {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
});

it('does not expose damaged credential-file contents or replace the damaged file', async () => {
  const { writeFileSync } = await import('node:fs');
  const path = join(directory, 'accounts.json');
  for (const raw of [
    '{"access_token":"SECRET-TOKEN", BROKEN',
    JSON.stringify({ version: 1, hostId: 'host', accounts: [null] }),
  ]) {
    writeFileSync(path, raw, { mode: 0o600 });
    const auth = new PlanAuth(store, { jwks });
    await expect(auth.accounts()).rejects.toThrow(/credential (file|store)/);
    try {
      await auth.accounts();
    } catch (error) {
      expect(error.message).not.toContain('SECRET-TOKEN');
    }
    expect(readFileSync(path, 'utf8')).toBe(raw);
  }
});
it('validates replies by operation instead of treating missing fields as empty results', async () => {
  const { validatePlanResult } = await import('../native/plan-protocol.mjs');
  expect(() => validatePlanResult({ action: 'accounts' }, { type: 'result' })).toThrow(
    'invalid reply',
  );
  expect(() => validatePlanResult({ action: 'models' }, { type: 'result', accounts: [] })).toThrow(
    'invalid reply',
  );
  expect(() =>
    validatePlanResult({ action: 'models' }, { type: 'result', models: [null] }),
  ).toThrow('invalid reply');
  expect(() =>
    validatePlanResult({ action: 'login' }, { type: 'result', account: { id: 'account' } }),
  ).toThrow('invalid reply');
  expect(() =>
    validatePlanResult({ action: 'accounts' }, { type: 'result', accounts: [] }),
  ).not.toThrow();
  expect(() => validatePlanRequest({ action: 'toString' })).toThrow('Unsupported');
});
it('bounds whole SSE records across lines and chunks, not batches of complete records', async () => {
  const { eventData } = await import('../native/sse.mjs');
  const body = new ReadableStream({
    start(c) {
      for (let i = 0; i < 8; i++) c.enqueue(new TextEncoder().encode('data: abcdef\n'));
      c.close();
    },
  });
  await expect(collect(eventData(body, 40))).rejects.toMatchObject({ reason: 'event-too-large' });
  const batch = new Response('data: ok\n\n'.repeat(20));
  expect(await collect(eventData(batch.body, 40))).toEqual(Array(20).fill('ok'));
});

it('reports reasoning activity without exposing its content and includes refusal text', async () => {
  expect(
    await collect(
      responseEvents(
        sse(
          { type: 'response.created' },
          {
            type: 'response.output_item.added',
            item: { type: 'reasoning', content: 'not retained' },
          },
          { type: 'response.refusal.delta', delta: 'I cannot help with that.' },
          { type: 'response.completed' },
        ),
      ),
    ),
  ).toEqual([
    { type: 'activity', phase: 'waiting' },
    { type: 'activity', phase: 'thinking' },
    { type: 'delta', text: 'I cannot help with that.' },
    { type: 'complete' },
  ]);
});
it('finishes at response.completed even while the HTTP connection stays open', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          'data: {"type":"response.output_text.delta","delta":"Done"}\n\n' +
            'data: {"type":"response.completed"}\n\n',
        ),
      );
    },
    cancel,
  });
  expect(await collect(responseEvents(new Response(body)))).toEqual([
    { type: 'delta', text: 'Done' },
    { type: 'complete' },
  ]);
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});
