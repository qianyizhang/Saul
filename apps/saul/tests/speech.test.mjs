import { expect, it, vi } from 'vitest';
import { PlanService } from '../native/plan-service.mjs';
import { validatePlanRequest, validatePlanResult } from '../native/plan-protocol.mjs';
const request = { action: 'speech', accountId: 'fixture', input: 'Hello.', voice: 'coral' };
it('bounds speech input and rejects arbitrary endpoints, models and voices', () => {
  expect(() => validatePlanRequest(request)).not.toThrow();
  for (const patch of [
    { input: ' ' },
    { input: 'a'.repeat(513) },
    { voice: 'unknown' },
    { url: 'https://example.com' },
    { model: 'other' },
  ])
    expect(() => validatePlanRequest({ ...request, ...patch })).toThrow();
});
it('uses selected OAuth account and returns bounded audio without exposing credentials', async () => {
  const auth = { accessToken: vi.fn(async () => 'secret-fixture') };
  const fetcher = vi.fn(
    async () =>
      new Response(new Uint8Array([73, 68, 51, 0]), { headers: { 'content-type': 'audio/mpeg' } }),
  );
  const events = [];
  await new PlanService(auth, fetcher).run(request, (event) => events.push(event));
  expect(auth.accessToken).toHaveBeenCalledWith('fixture', undefined);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/audio/speech');
  expect(options.redirect).toBe('error');
  expect(options.headers.Authorization).toBe('Bearer secret-fixture');
  expect(JSON.parse(options.body)).toEqual({
    model: 'gpt-4o-mini-tts',
    voice: 'coral',
    input: 'Hello.',
    response_format: 'mp3',
  });
  expect(events).toEqual([{ type: 'result', mimeType: 'audio/mpeg', audioBase64: 'SUQzAA==' }]);
  expect(() => validatePlanResult(request, events[0])).not.toThrow();
});
it('preserves route rejection without retry, credential removal or billing fallback', async () => {
  const fetcher = vi.fn(async () =>
    Response.json(
      { error: { code: 'subscription_sharing_route_not_supported', message: 'secret-fixture' } },
      { status: 403 },
    ),
  );
  const service = new PlanService({ accessToken: async () => 'secret-fixture' }, fetcher);
  await expect(service.run(request, () => {})).rejects.toThrow('HTTP 403');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(service.run(request, () => {})).rejects.not.toThrow('secret-fixture');
});
it('rejects empty, non-audio and oversized responses', async () => {
  for (const response of [
    new Response('bad'),
    new Response('', { headers: { 'content-type': 'audio/mpeg' } }),
    new Response(new Uint8Array(600001), { headers: { 'content-type': 'audio/mpeg' } }),
  ]) {
    const service = new PlanService({ accessToken: async () => 'fixture' }, async () => response);
    await expect(service.run(request, () => {})).rejects.toThrow();
  }
  expect(() =>
    validatePlanResult(request, { type: 'result', mimeType: 'audio/mpeg', audioBase64: '???' }),
  ).toThrow();
});
it('passes cancellation through to the speech request', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(async (_url, options) => {
    controller.abort();
    options.signal.throwIfAborted();
  });
  await expect(
    new PlanService({ accessToken: async () => 'fixture' }, fetcher).run(
      request,
      () => {},
      controller.signal,
    ),
  ).rejects.toThrow();
});
