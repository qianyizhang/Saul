import { isRecord } from './value.mts';
import type { PlanStore, StoredAccount, PlanTokens } from './plan-store.mts';
import type { PlanAccount } from './plan-protocol.mts';
class TokenRequestError extends Error {
  terminalRefresh = false;
  oauthCode: unknown;
}
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { accountSummary } from './plan-store.mts';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
const TOKEN_ENDPOINT = `${ISSUER}/api/accounts/oauth/token`;
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const terminalRefresh = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);
const random = () => randomBytes(32).toString('base64url');
const clearTokens = (account: StoredAccount) => {
  delete account.tokens;
};
export class PlanAuth {
  store: PlanStore;
  fetcher: typeof fetch;
  jwks: Parameters<typeof jwtVerify>[1];
  constructor(
    store: PlanStore,
    {
      fetcher = fetch,
      jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`)),
    }: { fetcher?: typeof fetch; jwks?: Parameters<typeof jwtVerify>[1] } = {},
  ) {
    this.store = store;
    this.fetcher = fetcher;
    this.jwks = jwks;
  }
  async accounts() {
    return this.store.locked((data) => data.accounts.map(accountSummary));
  }
  async tokenRequest(form: Record<string, string>, signal?: AbortSignal) {
    const response = await this.fetcher(TOKEN_ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([
        signal || new AbortController().signal,
        AbortSignal.timeout(20_000),
      ]),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...form, resource: RESOURCE }),
    });
    const value: unknown = await response.json().catch(() => null);
    const body = isRecord(value) ? value : {};
    if (!response.ok) {
      const code =
        typeof body?.error === 'string'
          ? body.error
          : isRecord(body.error)
            ? body.error.code
            : undefined;
      const error = new TokenRequestError(
        typeof code === 'string' && terminalRefresh.has(code)
          ? 'ChatGPT session expired. Continue with ChatGPT to sign in again.'
          : `ChatGPT token request failed (HTTP ${response.status}). Try again later.`,
      );
      error.terminalRefresh = typeof code === 'string' && terminalRefresh.has(code);
      error.oauthCode = code;
      throw error;
    }
    return value;
  }
  tokens(body: unknown, previous?: PlanTokens): PlanTokens {
    if (!isRecord(body) || (body.scope !== undefined && typeof body.scope !== 'string'))
      throw new Error('OpenAI returned invalid granted scopes. Sign in again.');
    const scopes = body.scope === undefined ? previous?.scopes || [] : body.scope.split(/\s+/);
    const planEnabled = scopes.includes('chatgpt.tokens.use.direct');
    if (
      (planEnabled || body.access_token !== undefined) &&
      (typeof body.access_token !== 'string' ||
        !body.access_token ||
        typeof body.token_type !== 'string' ||
        body.token_type.toLowerCase() !== 'bearer' ||
        typeof body.expires_in !== 'number' ||
        !Number.isFinite(body.expires_in) ||
        body.expires_in <= 0)
    )
      throw new Error('OpenAI returned an invalid token response. Sign in again.');
    return {
      accessToken: typeof body.access_token === 'string' ? body.access_token : undefined,
      refreshToken:
        typeof body.refresh_token === 'string' ? body.refresh_token : previous?.refreshToken,
      idToken: typeof body.id_token === 'string' ? body.id_token : previous?.idToken,
      expiresAt: body.access_token ? Date.now() + (body.expires_in as number) * 1000 : 0,
      scopes,
    };
  }
  async identity(idToken: string, clientId: string, nonce?: string) {
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: ISSUER,
      audience: clientId,
      algorithms: ['RS256', 'ES256'],
      requiredClaims: ['sub', 'exp', 'iat'],
      clockTolerance: 5,
    });
    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.iat !== 'number' ||
      payload.iat > Date.now() / 1000 + 5 ||
      (nonce !== undefined && payload.nonce !== nonce)
    )
      throw new Error('ChatGPT identity could not be verified.');
    return payload;
  }
  async login(
    { accountId, consent }: { accountId?: string; consent?: boolean },
    authorize: (url: string) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<PlanAccount> {
    const { hostId, selected } = await this.store.locked((data) => {
      const selected = data.accounts.find((a) => a.clientId === accountId);
      if (accountId && !selected) throw new Error('ChatGPT account registration was not found.');
      this.store.write(data); // Persist host identity before starting authorization.
      return { hostId: data.hostId, selected: selected && structuredClone(selected) };
    });
    signal?.throwIfAborted();
    const state = random(),
      nonce = random(),
      verifier = random();
    const server = createServer();
    const controller = new AbortController();
    const combined = AbortSignal.any([
      signal || controller.signal,
      controller.signal,
      AbortSignal.timeout(300_000),
    ]);
    let consumed = false;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const redirectUri = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/auth/callback`;
      const url = new URL(`${ISSUER}/api/accounts/authorize`);
      url.search = new URLSearchParams({
        client_id: selected?.clientId || 'dynamic_agent_client',
        ...(selected ? {} : { agent_name_hint: 'Saul' }),
        ext_agent_host_id: hostId,
        ...(selected?.tokens?.idToken ? { id_token_hint: selected.tokens.idToken } : {}),
        ...(selected?.email ? { login_hint: selected.email } : {}),
        ...(consent ? { prompt: 'consent' } : {}),
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: SCOPES,
        resource: RESOURCE,
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      }).toString();
      return await new Promise<PlanAccount>((resolve, reject) => {
        const abort = () => reject(new Error('ChatGPT sign-in stopped or timed out.'));
        combined.addEventListener('abort', abort, { once: true });
        if (combined.aborted) {
          abort();
          return;
        }
        server.on('request', (req, res) => {
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
          let callback;
          try {
            callback = new URL(req.url ?? '', redirectUri);
          } catch {
            res.writeHead(400).end('Invalid callback URL.');
            return;
          }
          if (
            req.method !== 'GET' ||
            callback.pathname !== '/auth/callback' ||
            req.headers.host !== new URL(redirectUri).host
          ) {
            res.writeHead(404).end();
            return;
          }
          if (
            consumed ||
            callback.searchParams.getAll('state').length !== 1 ||
            callback.searchParams.get('state') !== state
          ) {
            res.writeHead(400).end('Sign-in could not be verified.');
            return;
          }
          consumed = true;
          void (async () => {
            if (callback.searchParams.has('error'))
              throw new Error('ChatGPT sign-in was declined. You can try again in Settings.');
            const clientId = callback.searchParams.get('client_id') || selected?.clientId;
            if (
              !clientId ||
              clientId === 'dynamic_agent_client' ||
              (selected && selected.clientId !== clientId)
            )
              throw new Error('ChatGPT returned a different or missing client registration.');
            const code = callback.searchParams.get('code');
            if (!code) throw new Error('ChatGPT did not return an authorization code.');
            // Registration succeeds before token exchange. Keep the issued ID
            // even if exchange fails so retry does not create another app.
            await this.store.locked((data) => {
              combined.throwIfAborted();
              if (!data.accounts.some((a) => a.clientId === clientId)) {
                data.accounts.push({ clientId });
                this.store.write(data);
              }
            });
            const body = await this.tokenRequest(
              {
                grant_type: 'authorization_code',
                client_id: clientId,
                code,
                code_verifier: verifier,
                redirect_uri: redirectUri,
              },
              combined,
            );
            if (!isRecord(body) || typeof body.id_token !== 'string')
              throw new Error('ChatGPT did not return an identity token.');
            const identity = await this.identity(body.id_token, clientId, nonce);
            if (selected?.subject && identity.sub !== selected.subject)
              throw new Error('ChatGPT signed in a different account. Add it separately.');
            const account = {
              clientId,
              subject: identity.sub,
              email: typeof identity.email === 'string' ? identity.email : undefined,
              tokens: this.tokens(body),
            };
            combined.throwIfAborted();
            await this.store.locked((data) => {
              combined.throwIfAborted();
              const existing = data.accounts.find((a) => a.clientId === clientId);
              if (existing?.subject && existing.subject !== identity.sub)
                throw new Error('ChatGPT account identity mismatch.');
              data.accounts = [...data.accounts.filter((a) => a.clientId !== clientId), account];
              this.store.write(data);
            });
            res.end('Signed in to Saul. You may close this tab and return to Saul Settings.', () =>
              resolve(accountSummary(account)),
            );
          })().catch((error) => {
            if (error.oauthCode === 'invalid_grant')
              error.message =
                'ChatGPT authorization code expired. Registration was retained; select it and Continue with ChatGPT again.';
            res
              .writeHead(400)
              .end('Sign-in failed. Return to Saul Settings for details.', () => reject(error));
          });
        });
        Promise.resolve(authorize(url.href)).catch(reject);
      });
    } finally {
      controller.abort();
      server.close();
      server.closeAllConnections();
    }
  }
  async accessToken(accountId: string, signal?: AbortSignal): Promise<string> {
    return this.store.locked(async (data) => {
      signal?.throwIfAborted();
      const account = data.accounts.find((a) => a.clientId === accountId);
      if (!account?.tokens) throw new Error('Continue with ChatGPT in Settings to sign in.');
      if (!account.tokens.scopes.includes('chatgpt.tokens.use.direct'))
        throw new Error('ChatGPT plan permission is disabled. Enable it in Saul Settings.');
      if (account.tokens.expiresAt < Date.now() + 60_000) {
        if (!account.tokens.refreshToken)
          throw new Error('ChatGPT session expired. Sign in again.');
        try {
          const body = await this.tokenRequest(
            {
              grant_type: 'refresh_token',
              client_id: account.clientId,
              refresh_token: account.tokens.refreshToken,
            },
            signal,
          );
          if (isRecord(body) && typeof body.id_token === 'string' && body.id_token) {
            const identity = await this.identity(body.id_token, account.clientId);
            if (identity.sub !== account.subject)
              throw new Error('Refreshed ChatGPT identity did not match.');
          }
          account.tokens = this.tokens(body, account.tokens);
          this.store.write(data);
        } catch (e) {
          if (e instanceof TokenRequestError && e.terminalRefresh) {
            clearTokens(account);
            this.store.write(data);
          }
          throw e;
        }
      }
      if (!account.tokens.scopes.includes('chatgpt.tokens.use.direct'))
        throw new Error('ChatGPT plan permission is disabled. Enable it in Saul Settings.');
      if (!account.tokens.accessToken)
        throw new Error('ChatGPT access token is missing. Sign in again.');
      return account.tokens.accessToken;
    });
  }
  async logout(accountId: string) {
    return this.store.locked(async (data) => {
      const account = data.accounts.find((a) => a.clientId === accountId);
      if (!account) throw new Error('ChatGPT account not found.');
      let warning;
      if (account.tokens?.refreshToken) {
        try {
          const discovery = await this.fetcher(`${ISSUER}/.well-known/openid-configuration`, {
            signal: AbortSignal.timeout(10_000),
            redirect: 'error',
          });
          const config: unknown = await discovery.json();
          if (!isRecord(config) || typeof config.revocation_endpoint !== 'string')
            throw new Error('Invalid discovery');
          const endpoint = new URL(config.revocation_endpoint);
          if (!discovery.ok || config.issuer !== ISSUER || endpoint.origin !== ISSUER)
            throw new Error('Invalid discovery');
          const response = await this.fetcher(endpoint, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(10_000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: account.tokens.refreshToken,
              token_type_hint: 'refresh_token',
              client_id: account.clientId,
            }),
          });
          if (response.status !== 200) throw new Error('Revocation failed');
        } catch {
          warning =
            'Signed out locally. Remote revocation was not confirmed; disconnect Saul in ChatGPT Settings → Usage.';
        }
      }
      clearTokens(account);
      this.store.write(data);
      return { account: accountSummary(account), warning };
    });
  }
}
