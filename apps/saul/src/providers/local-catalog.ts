import { officialOpenAI } from '../../shared/protocol/credentials-contract.mts';
import type { ConnectionCatalog } from '../../shared/protocol/connections-contract.mts';

// Family policy describes the app's supported protocols, not a provider allowlist.
export function modelCapabilities(
  endpoint: string,
  id: string,
): ConnectionCatalog['models'][number]['capabilities'] {
  if (!officialOpenAI(endpoint)) return ['write'];
  if (id.startsWith('gpt-image-')) return ['draw'];
  if (id.startsWith('gpt-realtime')) return ['speak'];
  if (id.startsWith('gpt-') || /^o[0-9]/.test(id)) return ['write'];
  return [];
}

export async function readLocalCatalog(
  { baseUrl, apiKey }: { baseUrl: string; apiKey?: string },
  signal: AbortSignal,
) {
  if (!apiKey && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname))
    throw new Error('Save an API key before loading this connection’s models.');
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/models`,
    {
      signal,
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    },
  );
  if (!response.ok)
    throw new Error(
      `Couldn’t refresh models (HTTP ${response.status}). The endpoint may not support discovery.`,
    );
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('Model catalog is too large.');
  const body: unknown = JSON.parse(text);
  if (
    !body ||
    typeof body !== 'object' ||
    !('data' in body) ||
    !Array.isArray(body.data) ||
    body.data.length > 10_000 ||
    ('has_more' in body && body.has_more === true)
  )
    throw new Error('A complete model catalog is unavailable.');
  const ids = new Set<string>();
  const models = body.data.map((item: unknown) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !('id' in item) ||
      typeof item.id !== 'string' ||
      !item.id ||
      new TextEncoder().encode(item.id).length > 256
    )
      throw new Error('Invalid model identifier.');
    const id = item.id;
    if (ids.has(id)) throw new Error('The model catalog contains duplicate IDs.');
    ids.add(id);
    return {
      id,
      name: id,
      capabilities: modelCapabilities(baseUrl, id),
      efforts: [],
      defaultEffort: '',
    };
  });
  return { catalog: { models, fetchedAt: Date.now() / 1000 } };
}
