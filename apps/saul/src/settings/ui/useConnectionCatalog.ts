import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readLocalCatalog } from '../../providers/local-catalog';
import { credentialCall } from '../../native/credentials';
import {
  validConnectionCatalog,
  type ConnectionCatalog,
} from '../../../shared/protocol/connections-contract.mts';

type Source =
  { kind: 'managed'; key: string } | { kind: 'local'; baseUrl: string; apiKey?: string };
type Intent = 'display' | 'check';

/** Catalog freshness and cross-app serialization belong to the credential owner. */
export function useConnectionCatalog(
  key: string | undefined,
  enabled = true,
  local?: { baseUrl: string; apiKey: string },
) {
  const baseUrl = local?.baseUrl,
    apiKey = local?.apiKey;
  const source = useMemo<Source | undefined>(
    () =>
      enabled
        ? baseUrl
          ? { kind: 'local', baseUrl, apiKey }
          : key
            ? { kind: 'managed', key }
            : undefined
        : undefined,
    [key, enabled, baseUrl, apiKey],
  );
  const [state, setState] = useState<{
    source: Source;
    catalog?: ConnectionCatalog;
    pending?: Intent;
  }>();
  const active = useRef<{ source: Source; intent: Intent; controller: AbortController } | null>(
    null,
  );

  const load = useCallback(
    async (intent: Intent) => {
      if (!source || (intent === 'check' && source.kind !== 'managed')) return;
      if (
        intent === 'display' &&
        active.current?.source === source &&
        active.current.intent === 'check'
      )
        return;
      active.current?.controller.abort();
      const controller = new AbortController();
      const job = { source, intent, controller };
      active.current = job;
      setState((current) => ({
        source,
        catalog: current?.source === source ? current.catalog : undefined,
        pending: intent,
      }));
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
      try {
        const { catalog } =
          source.kind === 'local'
            ? await readLocalCatalog(source, signal)
            : await credentialCall(
                { action: 'connection-catalog', connectionKey: source.key, intent },
                signal,
              );
        if (!validConnectionCatalog(catalog)) throw new Error('Invalid connection catalog.');
        if (!controller.signal.aborted) setState({ source, catalog });
      } catch (cause) {
        if (!controller.signal.aborted)
          setState((current) => ({
            source,
            catalog: {
              models: current?.source === source ? (current.catalog?.models ?? []) : [],
              fetchedAt: current?.source === source ? (current.catalog?.fetchedAt ?? 0) : 0,
              error: cause instanceof Error ? cause.message : 'Couldn’t refresh models.',
            },
          }));
      } finally {
        if (active.current === job) active.current = null;
      }
    },
    [source],
  );

  useEffect(() => {
    void load('display');
    return () => {
      if (active.current?.source === source) active.current?.controller.abort();
    };
  }, [source, load]);

  const current = state?.source === source ? state : undefined;
  return {
    catalog: current?.catalog,
    loading: !!source && (!current || !!current.pending),
    checking: current?.pending === 'check',
    check: () => void load('check'),
  };
}
