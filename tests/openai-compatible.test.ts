import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamOpenAICompatible } from '../src/models/openai-compatible';

const config = { baseUrl: 'http://localhost:11434/v1', model: 'test-model', apiKey: '' };
const delta = (content: string) => JSON.stringify({ choices: [{ delta: { content } }] });
const encoder = new TextEncoder();

function respond(chunks: Uint8Array[], keepOpen = false) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (!keepOpen) controller.close();
    },
    cancel,
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  return { cancel, body };
}

async function collect() {
  let text = '';
  for await (const event of streamOpenAICompatible(config, 'System', 'Explain'))
    if (event.type === 'delta') text += event.text;
  return text;
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI-compatible streams', () => {
  it('preserves UTF-8 and multiline SSE events across byte boundaries and line endings', async () => {
    const text =
      ': keepalive\r\nevent: message\r\n' +
      'data:{"choices":\r\ndata: [{"delta":{"content":"你好 🌍"}}]}\r\n\r\n' +
      `data: ${delta('!')}\r\rdata:[DONE]\n\n`;
    respond(Array.from(encoder.encode(text), (byte) => new Uint8Array([byte])));
    await expect(collect()).resolves.toBe('你好 🌍!');
  });

  it('surfaces provider errors after partial output and closes the response', async () => {
    const { cancel, body } = respond(
      [
        encoder.encode(
          `data: ${delta('Partial')}\n\ndata: {"error":{"message":"Quota exceeded"}}\n\n`,
        ),
      ],
      true,
    );
    const stream = streamOpenAICompatible(config, 'System', 'Explain');
    await expect(stream.next()).resolves.toMatchObject({
      value: { type: 'delta', text: 'Partial' },
      done: false,
    });
    await expect(stream.next()).rejects.toThrow('Quota exceeded');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it.each([
    ['data: {invalid}\n\n', 'invalid streaming response'],
    ['data: {"choices":[{"delta":{"content":42}}]}\n\n', 'non-text content'],
    [`data: ${delta('unfinished')}`, 'incomplete event'],
  ])('rejects invalid or truncated events: %s', async (event, message) => {
    respond([encoder.encode(event)]);
    await expect(collect()).rejects.toThrow(message);
  });

  it('cancels the response at DONE without consuming later output', async () => {
    const { cancel, body } = respond(
      [encoder.encode(`data: ${delta('Done')}\n\ndata: [DONE]\n\ndata: {invalid}\n\n`)],
      true,
    );
    await expect(collect()).resolves.toBe('Done');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('cancels the response when the consumer stops early', async () => {
    const { cancel, body } = respond([encoder.encode(`data: ${delta('Partial')}\n\n`)], true);
    for await (const chunk of streamOpenAICompatible(config, 'System', 'Explain')) {
      expect(chunk).toEqual({ type: 'delta', text: 'Partial' });
      break;
    }
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('rejects bare EOF even after complete events and a trailing keepalive comment', async () => {
    respond([encoder.encode(`data: ${delta('Complete')}\n\n: keepalive`)]);
    await expect(collect()).rejects.toThrow('without a completion signal');
  });
});

it.each(['length', 'content_filter', 'tool_calls'])(
  'retains partial text but rejects finish reason %s',
  async (reason) => {
    respond([
      encoder.encode(
        `data: ${delta('Partial')}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`,
      ),
    ]);
    const stream = streamOpenAICompatible(config, 'System', 'Explain');
    expect((await stream.next()).value).toEqual({ type: 'delta', text: 'Partial' });
    await expect(stream.next()).rejects.toThrow(reason);
  },
);
it('accepts an explicit stop followed by EOF', async () => {
  respond([
    encoder.encode(
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Complete' }, finish_reason: 'stop' }] })}\n\n`,
    ),
  ]);
  await expect(collect()).resolves.toBe('Complete');
});
