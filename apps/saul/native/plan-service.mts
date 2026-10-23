import type { PlanAuth } from './plan-auth.mts';
import type { PlanModel, PlanEvent } from './plan-protocol.mts';
import { isRecord } from './value.mts';
import { validatePlanRequest } from './plan-protocol.mts';
import { RESOURCE } from './plan-auth.mts';
import { planError, responsesBody, responseEvents } from './responses.mts';
import { planModels, planModelIssue } from './plan-models.mts';

const changedCatalog = () =>
  new Error('ChatGPT model choices changed while preparing this request. Retry.');

export class PlanService {
  auth: Pick<PlanAuth, 'accounts' | 'login' | 'logout' | 'accessToken'>;
  fetcher: typeof fetch;
  blocked: Set<string>;
  catalogs: Map<string, PlanModel[]>;
  loadingCatalogs: Map<string, { controller: AbortController; promise?: Promise<PlanModel[]> }>;
  constructor(auth: PlanService['auth'], fetcher = fetch) {
    this.auth = auth;
    this.fetcher = fetcher;
    this.blocked = new Set();
    this.catalogs = new Map();
    this.loadingCatalogs = new Map();
  }
  invalidateCatalog(accountId: string) {
    this.catalogs.delete(accountId);
    this.loadingCatalogs.get(accountId)?.controller.abort();
    this.loadingCatalogs.delete(accountId);
  }
  loadModels(accountId: string, token: string) {
    this.invalidateCatalog(accountId);
    const controller = new AbortController();
    const operation: { controller: AbortController; promise?: Promise<PlanModel[]> } = {
      controller,
    };
    this.loadingCatalogs.set(accountId, operation);
    // Discovery is read-only and shared by concurrent jobs. Each caller checks
    // its own cancellation before inference; one caller cannot cancel another.
    operation.promise = this.fetchModels(
      token,
      AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    )
      .then((models) => {
        if (this.loadingCatalogs.get(accountId) !== operation) throw changedCatalog();
        this.catalogs.set(accountId, models);
        return models;
      })
      .catch((error) => {
        if (this.loadingCatalogs.get(accountId) !== operation) throw changedCatalog();
        throw error;
      })
      .finally(() => {
        if (this.loadingCatalogs.get(accountId) === operation)
          this.loadingCatalogs.delete(accountId);
      });
    return operation.promise;
  }
  async fetchModels(token: string, signal: AbortSignal) {
    const response = await this.fetcher(`${RESOURCE}/models`, {
      method: 'GET',
      redirect: 'error',
      signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) throw planError(data, response.status, response.headers.get('x-request-id'));
    return planModels(isRecord(data) ? data.models : undefined);
  }
  async run(request: unknown, emit: (event: PlanEvent) => void, signal?: AbortSignal) {
    validatePlanRequest(request);
    switch (request.action) {
      case 'accounts':
        emit({ type: 'result', accounts: await this.auth.accounts() });
        return;
      case 'login': {
        const account = await this.auth.login(
          request,
          (url) => emit({ type: 'authorize', url }),
          signal,
        );
        this.blocked.delete(account.id);
        this.invalidateCatalog(account.id);
        emit({ type: 'result', account });
        return;
      }
      case 'logout': {
        const result = await this.auth.logout(request.accountId);
        this.invalidateCatalog(request.accountId);
        emit({ type: 'result', ...result });
        return;
      }
    }
    if (request.action === 'generate' && this.blocked.has(request.accountId))
      throw new Error(
        'ChatGPT plan requests are paused after a usage limit. Manage usage, then refresh models in Settings to retry.',
      );
    const token = await this.auth.accessToken(request.accountId, signal);
    if (request.action === 'speech') {
      const response = await this.fetcher(`${RESOURCE}/audio/speech`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([
          signal || new AbortController().signal,
          AbortSignal.timeout(60_000),
        ]),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          input: request.input,
          voice: request.voice,
          response_format: 'mp3',
        }),
      });
      if (!response.ok)
        throw planError(
          await response.json().catch(() => null),
          response.status,
          response.headers.get('x-request-id'),
        );
      if (
        !response.headers.get('content-type')?.toLowerCase().startsWith('audio/mpeg') ||
        !response.body
      ) {
        await response.body?.cancel();
        throw new Error('Speech endpoint returned no MP3 audio.');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 600_000)
          throw new Error('Speech audio exceeded the widget’s size limit. Try shorter text.');
        chunks.push(chunk);
      }
      signal?.throwIfAborted();
      if (!size) throw new Error('Speech endpoint returned empty audio.');
      emit({
        type: 'result',
        mimeType: 'audio/mpeg',
        audioBase64: Buffer.concat(chunks).toString('base64'),
      });
      return;
    }
    if (request.action === 'models') {
      const models = await this.loadModels(request.accountId, token);
      signal?.throwIfAborted();
      if (this.catalogs.get(request.accountId) !== models) throw changedCatalog();
      this.blocked.delete(request.accountId);
      emit({ type: 'result', models });
      return;
    }
    const models =
      this.catalogs.get(request.accountId) ??
      (await (this.loadingCatalogs.get(request.accountId)?.promise ??
        this.loadModels(request.accountId, token)));
    signal?.throwIfAborted();
    if (this.catalogs.get(request.accountId) !== models) throw changedCatalog();
    const issue = planModelIssue(request, models);
    if (issue) throw new Error(issue);
    const model = models.find((option) => option.slug === request.model);
    const response = await this.fetcher(`${RESOURCE}/responses`, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(responsesBody(request, request.fast ? model!.fastTier : 'default')),
    });
    try {
      for await (const event of responseEvents(response)) emit(event);
    } catch (error) {
      if (isRecord(error) && error.reason === 'subscription_sharing_usage_limit_exceeded')
        this.blocked.add(request.accountId);
      throw error;
    }
  }
}
