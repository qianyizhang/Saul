import { validatePlanRequest } from './plan-protocol.mjs';
import { RESOURCE } from './plan-auth.mjs';
import { planError, responsesBody, responseEvents } from './responses.mjs';

export class PlanService {
  constructor(auth, fetcher = fetch) {
    this.auth = auth;
    this.fetcher = fetcher;
    this.blocked = new Set();
  }
  async run(request, emit, signal) {
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
        emit({ type: 'result', account });
        return;
      }
      case 'logout':
        emit({ type: 'result', ...(await this.auth.logout(request.accountId)) });
        return;
    }
    if (request.action === 'generate' && this.blocked.has(request.accountId))
      throw new Error(
        'ChatGPT plan requests are paused after a usage limit. Manage usage, then refresh models in Settings to retry.',
      );
    const token = await this.auth.accessToken(request.accountId, signal);
    const response = await this.fetcher(
      `${RESOURCE}/${request.action === 'models' ? 'models' : 'responses'}`,
      {
        method: request.action === 'models' ? 'GET' : 'POST',
        redirect: 'error',
        signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(request.action === 'generate' ? { body: JSON.stringify(responsesBody(request)) } : {}),
      },
    );
    if (request.action === 'models') {
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw planError(data, response.status, response.headers.get('x-request-id'));
      if (!Array.isArray(data?.models))
        throw new Error('OpenAI returned an invalid account model catalog.');
      const models = data.models
        .filter(
          (m) =>
            m &&
            m.visibility === 'list' &&
            typeof m.slug === 'string' &&
            typeof m.display_name === 'string',
        )
        .map(({ slug, display_name }) => ({ slug, display_name }));
      this.blocked.delete(request.accountId);
      emit({ type: 'result', models });
      return;
    }
    try {
      for await (const event of responseEvents(response)) emit(event);
    } catch (error) {
      if (error.reason === 'subscription_sharing_usage_limit_exceeded')
        this.blocked.add(request.accountId);
      throw error;
    }
  }
}
