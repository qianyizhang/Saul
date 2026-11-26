import type {
  CredentialEvent,
  CredentialRequest,
} from '../../shared/protocol/credentials-contract.mts';
import { credentialEvents } from '../native/credentials';

type HoldRequest = Extract<
  CredentialRequest,
  { action: 'connection-run-hold' | 'connection-setup-hold' }
>;
type Held = Extract<CredentialEvent, { type: 'connection-held' }>;

export async function holdConnection(request: HoldRequest, signal?: AbortSignal, direct = false) {
  const lifetime = new AbortController();
  const ready = Promise.withResolvers<Held>();
  const source = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
  const timer = setTimeout(
    () => lifetime.abort(new Error('The signed helper did not confirm connection protection.')),
    15_000,
  );
  const work = (async () => {
    try {
      for await (const event of credentialEvents(request, source, direct)) {
        if (
          event.type !== 'connection-held' ||
          (request.action === 'connection-run-hold' ? !event.generation : !event.token)
        )
          throw new Error('The signed helper returned invalid connection protection.');
        clearTimeout(timer);
        ready.resolve(event);
      }
      throw new Error('Connection protection ended. Review this connection and retry.');
    } catch (error) {
      ready.reject(error);
      lifetime.abort(error);
    } finally {
      clearTimeout(timer);
    }
  })();
  const evidence = await ready.promise;
  source.throwIfAborted();
  return {
    evidence,
    signal: lifetime.signal,
    async close() {
      lifetime.abort();
      await work;
    },
  };
}
