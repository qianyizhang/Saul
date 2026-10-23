import { isRecord } from '../native/value.mts';
import type { PlanModel } from '../native/plan-protocol.mts';
import { errorMessage } from '../native/transport.mts';
interface ProbeResult {
  endpoint: string;
  httpStatus: number;
  model?: string;
  contentType?: string | null;
  error?: string;
  bytes?: number;
  imageReturned?: boolean;
  dimensions?: number;
  output?: string;
  completed?: boolean;
}
// Explicit live endpoint experiment. Uses one Saul OAuth access token throughout.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { PlanAuth } from '../native/plan-auth.mts';
import { PlanStore } from '../native/plan-store.mts';
import { PlanService } from '../native/plan-service.mts';
import { planError } from '../native/responses.mts';

const auth = new PlanAuth(new PlanStore(join(homedir(), '.saul', 'chatgpt')));
const accounts = (await auth.accounts()).filter(
  (account) => account.signedIn && account.planEnabled,
);
if (accounts.length !== 1) throw new Error('Probe requires exactly one plan-enabled Saul account.');
const signal = AbortSignal.timeout(180_000);
const token = await auth.accessToken(accounts[0].id, signal);
const directory = new URL('../../../.artifacts/saul/capability-probe/', import.meta.url);
await mkdir(directory, { recursive: true });
const receipt: { at: string; authentication: string; results: ProbeResult[]; error?: string } = {
  at: new Date().toISOString(),
  authentication: 'Same Saul ChatGPT OAuth access token for all requests',
  results: [],
};
const service = new PlanService(
  {
    accounts: () => auth.accounts(),
    login: (...args) => auth.login(...args),
    logout: (...args) => auth.logout(...args),
    accessToken: async () => token,
  },
  async (url, options) => {
    const response = await fetch(url, options);
    receipt.results.push({
      endpoint: new URL(url instanceof Request ? url.url : url).pathname,
      httpStatus: response.status,
    });
    return response;
  },
);
try {
  let models: PlanModel[] = [];
  await service.run(
    { action: 'models', accountId: accounts[0].id },
    (event) => {
      if (event.type === 'result' && 'models' in event) models = event.models;
    },
    signal,
  );
  const model =
    models.find((candidate) => candidate.slug === 'gpt-6-luna') ||
    models.find((candidate) => candidate.isDefault) ||
    models[0];
  if (!model) throw new Error('No available model.');
  let completed = false,
    text = '';
  await service.run(
    {
      action: 'generate',
      accountId: accounts[0].id,
      model: model.slug,
      systemPrompt: '',
      userPrompt: 'Reply with exactly OK.',
      ...(model.defaultReasoningEffort ? { effort: model.defaultReasoningEffort } : {}),
    },
    (event) => {
      if (event.type === 'delta') text += event.text;
      if (event.type === 'complete') completed = true;
    },
    signal,
  );
  Object.assign(receipt.results.at(-1)!, { model: model.slug, completed, output: text });
  if (!completed)
    throw new Error('Responses did not complete. Stop and diagnose auth/inference first.');
  const probes = [
    {
      endpoint: '/audio/speech',
      body: {
        model: 'gpt-4o-mini-tts',
        voice: 'coral',
        input: 'Hello from Saul.',
        response_format: 'mp3',
      },
      file: 'speech.mp3',
    },
    {
      endpoint: '/images/generations',
      body: {
        model: 'gpt-image-2.5-flare',
        prompt: 'A small green circle on a plain white background.',
        n: 1,
        size: '1024x1024',
        quality: 'low',
      },
      file: 'image.png',
    },
    {
      endpoint: '/embeddings',
      body: {
        model: 'text-embedding-3-small',
        input: 'Hello from Saul.',
        encoding_format: 'float',
      },
    },
    {
      endpoint: '/chat/completions',
      body: {
        model: model.slug,
        messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
        store: false,
      },
    },
  ];
  for (const probe of probes) {
    const response = await fetch(`https://api.openai.com/v1${probe.endpoint}`, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(probe.body),
    });
    const result: ProbeResult = {
      endpoint: `/v1${probe.endpoint}`,
      model: probe.body.model,
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
    };
    receipt.results.push(result);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      result.error = planError(body, response.status, response.headers.get('x-request-id')).message;
      continue;
    }
    if (probe.endpoint === '/audio/speech') {
      const audio = Buffer.from(await response.arrayBuffer());
      result.bytes = audio.length;
      await writeFile(new URL(probe.file!, directory), audio, { mode: 0o600 });
    } else if (probe.endpoint === '/images/generations') {
      const body = await response.json();
      const first = isRecord(body) && Array.isArray(body.data) ? body.data[0] : undefined;
      const encoded = isRecord(first) ? first.b64_json : undefined;
      result.imageReturned = typeof encoded === 'string';
      if (typeof encoded === 'string' && encoded)
        await writeFile(new URL(probe.file!, directory), Buffer.from(encoded, 'base64'), {
          mode: 0o600,
        });
    } else {
      const body = await response.json();
      if (probe.endpoint === '/embeddings') {
        const first = isRecord(body) && Array.isArray(body.data) ? body.data[0] : undefined;
        if (isRecord(first) && Array.isArray(first.embedding))
          result.dimensions = first.embedding.length;
      } else {
        const first = isRecord(body) && Array.isArray(body.choices) ? body.choices[0] : undefined;
        if (isRecord(first) && isRecord(first.message) && typeof first.message.content === 'string')
          result.output = first.message.content;
      }
    }
  }
} catch (error) {
  receipt.error = errorMessage(error);
} finally {
  await writeFile(new URL('result.json', directory), JSON.stringify(receipt, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(receipt, null, 2));
}
