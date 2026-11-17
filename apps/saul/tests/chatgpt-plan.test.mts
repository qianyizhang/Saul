import { expect, it, vi } from 'vitest';
import { validatePlanRequest } from '../shared/protocol/credential-plan.mts';
import { responsesBody, responseEvents } from '../shared/protocol/responses.mts';

const generate = {
  action: 'generate',
  accountId: 'oaiapp_one',
  model: 'eligible-model',
  systemPrompt: 'Explain briefly.',
  userPrompt: 'A gradient.',
};
async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out = [];
  for await (const event of stream) out.push(event);
  return out;
}
const sse = (...events: unknown[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
it('uses only allowed Responses fields and requires a terminal completed event', async () => {
  const extraOptions = { ...generate, temperature: 0.3, maxTokens: 32 };
  expect(responsesBody(extraOptions)).toEqual({
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
        sse(
          { type: 'response.output_text.delta', delta: 'Hello' },
          { type: 'response.completed', response: { status: 'completed' } },
        ),
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
it('does not treat a Responses completed event without successful status as success', async () => {
  for (const response of [undefined, {}, { status: 'failed' }])
    await expect(
      collect(responseEvents(sse({ type: 'response.completed', response }))),
    ).rejects.toMatchObject({ reason: 'incomplete' });
});
it('handles byte-split UTF-8, CRLF and terminal errors after partial text', async () => {
  const bytes = new TextEncoder().encode(
    'data: {"type":"response.output_text.delta","delta":"研究"}\r\n\r\ndata: {"type":"response.completed","response":{"status":"completed"}}\r\n\r\n',
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
  const result: unknown[] = [];
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
it('validates bounded PDF URL attachments and emits Responses file_url input without uploading bytes', () => {
  const attachment = { type: 'pdf-url' as const, url: 'https://example.com/download?id=49' };
  const request = { ...generate, attachments: [attachment] };
  expect(() => validatePlanRequest(request)).not.toThrow();
  if (request.attachments[0]?.type !== 'pdf-url') throw new Error('Expected PDF URL');
  // Validate/narrow the external shape before crossing the typed helper interface.
  validatePlanRequest(request);
  expect(responsesBody(request).input).toEqual([
    {
      role: 'user',
      content: [
        { type: 'input_text', text: generate.userPrompt },
        { type: 'input_file', file_url: attachment.url },
      ],
    },
  ]);
  for (const attachments of [
    [],
    [attachment, attachment],
    null,
    'url',
    [{ ...attachment, url: 'file:///private.pdf' }],
    [{ ...attachment, url: 'javascript:alert(1)' }],
    [{ ...attachment, url: 'https://name:secret@example.com/a.pdf' }],
    [{ ...attachment, url: 'https://example.com/' + 'x'.repeat(16384) }],
    [{ ...attachment, file_data: 'bytes' }],
    [{ type: 'image', url: attachment.url }],
  ])
    expect(() => validatePlanRequest({ ...generate, attachments })).toThrow();
});
it('validates replies by operation instead of treating missing fields as empty results', async () => {
  const { validatePlanResult } = await import('../shared/protocol/credential-plan.mts');
  expect(() => validatePlanResult({ action: 'accounts' }, { type: 'result' })).toThrow(
    'invalid reply',
  );
  expect(() =>
    validatePlanResult(
      { action: 'models', accountId: 'fixture' },
      { type: 'result', accounts: [] },
    ),
  ).toThrow('invalid reply');
  expect(() =>
    validatePlanResult(
      { action: 'models', accountId: 'fixture' },
      { type: 'result', models: [null] },
    ),
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
  const { eventData } = await import('../shared/protocol/sse.mts');
  const body = new ReadableStream({
    start(c) {
      for (let i = 0; i < 8; i++) c.enqueue(new TextEncoder().encode('data: abcdef\n'));
      c.close();
    },
  });
  await expect(collect(eventData(body, 40))).rejects.toMatchObject({ reason: 'event-too-large' });
  const batch = new Response('data: ok\n\n'.repeat(20));
  expect(await collect(eventData(batch.body!, 40))).toEqual(Array(20).fill('ok'));
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
          { type: 'response.completed', response: { status: 'completed' } },
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
            'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
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
