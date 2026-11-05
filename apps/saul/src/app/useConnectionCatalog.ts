import { useEffect, useRef, useState } from 'react';
import { credentialCall } from '../native/credentials';
import {
  validConnectionCatalog,
  type ConnectionCatalog,
} from '../../native/connections-contract.mts';

/** Catalog freshness and cross-app serialization belong to the credential owner. */
export function useConnectionCatalog(
  key: string | undefined,
  enabled = true,
  local?: { baseUrl: string; apiKey: string },
) {
  const [catalog, setCatalog] = useState<ConnectionCatalog>();
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const force = useRef(false);
  const localURL = local?.baseUrl,
    localKey = local?.apiKey;
  useEffect(() => {
    setCatalog(undefined);
  }, [key, localURL, localKey]);
  useEffect(() => {
    if ((!key && !localURL) || !enabled) return;
    const ac = new AbortController();
    setLoading(true);
    const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(30_000)]);
    const request = localURL
      ? (async () => {
          if (
            !localKey &&
            !['localhost', '127.0.0.1', '[::1]'].includes(new URL(localURL).hostname)
          )
            throw new Error('Save an API key before loading this connection’s models.');
          const response = await fetch(
            `${localURL.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/models`,
            {
              signal,
              redirect: 'error',
              cache: 'no-store',
              credentials: 'omit',
              headers: localKey ? { Authorization: `Bearer ${localKey}` } : {},
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
            ('has_more' in body && body.has_more === true)
          )
            throw new Error('A complete model catalog is unavailable.');
          return {
            catalog: {
              models: body.data.map((item: unknown) => {
                if (
                  !item ||
                  typeof item !== 'object' ||
                  !('id' in item) ||
                  typeof item.id !== 'string'
                )
                  throw new Error('Invalid model identifier.');
                const id = item.id;
                const capabilities = id.startsWith('gpt-image-')
                  ? ['draw']
                  : id.startsWith('gpt-realtime')
                    ? ['speak']
                    : ['write'];
                return { id, name: id, capabilities, efforts: [], defaultEffort: '' };
              }),
              fetchedAt: Date.now() / 1000,
            },
          };
        })()
      : credentialCall(
          { action: 'connection-catalog', connectionKey: key!, force: force.current },
          signal,
        );
    void request
      .then((result) => {
        if (!validConnectionCatalog(result.catalog)) throw new Error('Invalid connection catalog.');
        if (!ac.signal.aborted) setCatalog(result.catalog);
      })
      .catch((cause) => {
        if (!ac.signal.aborted)
          setCatalog((previous) => ({
            models: previous?.models ?? [],
            fetchedAt: previous?.fetchedAt ?? 0,
            error: cause instanceof Error ? cause.message : 'Couldn’t refresh models.',
          }));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    force.current = false;
    return () => ac.abort();
  }, [key, enabled, revision, localURL, localKey]);
  return {
    catalog,
    loading,
    refresh: () => {
      force.current = true;
      setRevision((v) => v + 1);
    },
  };
}
