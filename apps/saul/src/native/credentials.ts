import {
  CREDENTIALS_HOST,
  CREDENTIALS_PORT,
  validateCredentialEvent,
  validateCredentialRequest,
  type CredentialRequest,
  type CredentialEvent,
} from '../../native/credentials-contract.mts';
import { Fragments } from '../../native/fragments.mts';
import { workspaceSender } from '../contracts/reading';

export async function* credentialEvents(
  request: CredentialRequest,
  signal?: AbortSignal,
): AsyncGenerator<CredentialEvent> {
  validateCredentialRequest(request);
  signal?.throwIfAborted();
  const port = chrome.runtime.connect({ name: CREDENTIALS_PORT });
  const queue: CredentialEvent[] = [];
  let ended = false,
    wake = () => {};
  const abort = () => {
    ended = true;
    wake();
    try {
      port.postMessage({ cancel: true });
    } catch {
      /* Disconnected. */
    }
    port.disconnect();
  };
  port.onMessage.addListener((event: unknown) => {
    try {
      validateCredentialEvent(event);
      queue.push(event);
    } catch {
      queue.push({ type: 'error', message: 'Saul returned an invalid credential reply.' });
    }
    wake();
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (!ended)
      queue.push({
        type: 'error',
        message: 'Saul credentials disconnected. Install or update the signed helper, then retry.',
      });
    wake();
  });
  signal?.addEventListener('abort', abort, { once: true });
  try {
    port.postMessage(request);
    while (!ended) {
      if (!queue.length)
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      signal?.throwIfAborted();
      const event = queue.shift();
      if (!event) continue;
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'complete' || event.type === 'result') ended = true;
      yield event;
    }
  } finally {
    ended = true;
    signal?.removeEventListener('abort', abort);
    port.disconnect();
  }
}
export async function credentialCall(
  request: CredentialRequest,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  for await (const event of credentialEvents(request, signal))
    if (event.type === 'result') return event;
  throw new Error('Saul returned no credential result.');
}

/** Background-only control route. It cannot start sign-in, generation or return a long-lived secret. */
export async function nativeCredentialCall(
  request: Exclude<
    CredentialRequest,
    { action: 'login' | 'generate' | 'api-chat' | 'api-realtime' | 'api-image' }
  >,
): Promise<Record<string, unknown>> {
  validateCredentialRequest(request);
  const id = crypto.randomUUID();
  const port = chrome.runtime.connectNative(CREDENTIALS_HOST);
  return new Promise((resolve, reject) => {
    let ended = false;
    const fragments = new Fragments();
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      port.disconnect();
      if (error) reject(error);
      else resolve(value ?? {});
    };
    const timer = setTimeout(
      () => finish(new Error('Saul credential operation timed out. Reload before retrying.')),
      190_000,
    );
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      finish(new Error('Install or update the signed Saul credential helper, then retry.'));
    });
    port.onMessage.addListener((packet: unknown) => {
      try {
        const reply: unknown = fragments.accept(packet);
        if (reply === undefined) return;
        if (
          !reply ||
          typeof reply !== 'object' ||
          !('id' in reply) ||
          reply.id !== id ||
          !('event' in reply)
        )
          throw new Error('Invalid credential reply.');
        validateCredentialEvent(reply.event);
        if (reply.event.type === 'error') finish(new Error(reply.event.message));
        else if (reply.event.type === 'result') finish(undefined, reply.event);
        else finish(new Error('Unexpected credential control reply.'));
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Invalid credential reply.'));
      }
    });
    try {
      port.postMessage({ version: 1, id, request });
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Cannot connect to Saul credentials.'));
    }
  });
}

export function initCredentialBridge() {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== CREDENTIALS_PORT) return;
    const sender = port.sender;
    const workspace = !!sender && workspaceSender(sender);
    const offscreen =
      sender?.id === chrome.runtime.id &&
      !sender.tab &&
      sender.url === chrome.runtime.getURL('offscreen.html');
    if (!workspace && !offscreen) {
      port.disconnect();
      return;
    }
    let native: chrome.runtime.Port | undefined,
      id = '',
      timer: ReturnType<typeof setTimeout> | undefined;
    let started = false,
      login = false,
      closed = false;
    const finish = (event?: CredentialEvent) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (event) {
        try {
          port.postMessage(event);
        } catch {
          /* The settings view may have closed. */
        }
      }
      native?.disconnect();
    };
    port.onMessage.addListener((message: unknown) => {
      if (started) {
        if (
          message &&
          typeof message === 'object' &&
          'cancel' in message &&
          message.cancel === true
        ) {
          try {
            native?.postMessage({ version: 1, id, cancel: true });
          } catch {
            /* Disconnected. */
          }
          finish();
        }
        return;
      }
      started = true;
      try {
        validateCredentialRequest(message);
        if (offscreen && !['generate', 'api-chat', 'api-image'].includes(message.action))
          throw new Error('The runner may only generate text or images.');
        login = message.action === 'login';
        id = crypto.randomUUID();
        native = chrome.runtime.connectNative(CREDENTIALS_HOST);
        const fragments = new Fragments();
        native.onMessage.addListener((packet: unknown) => {
          if (closed) return;
          try {
            const reply: unknown = fragments.accept(packet);
            if (reply === undefined) return;
            if (
              !reply ||
              typeof reply !== 'object' ||
              !('id' in reply) ||
              reply.id !== id ||
              !('event' in reply)
            )
              throw new Error();
            validateCredentialEvent(reply.event);
            const event = reply.event;
            if (event.type === 'authorize') {
              const url = new URL(event.url);
              if (
                !login ||
                url.origin !== 'https://auth.openai.com' ||
                url.pathname !== '/api/accounts/authorize' ||
                url.username ||
                url.password
              )
                throw new Error();
              void chrome.tabs
                .create({ url: event.url })
                .catch(() => finish({ type: 'error', message: 'Could not open Saul sign-in.' }));
            } else if (['result', 'complete', 'error'].includes(event.type)) {
              if (event.type === 'result' && ['login', 'logout'].includes(message.action))
                void chrome.runtime.sendMessage({ type: 'saul-plan-accounts' }).catch(() => {});
              finish(event);
            } else port.postMessage(event);
          } catch {
            finish({ type: 'error', message: 'Saul returned an invalid credential reply.' });
          }
        });
        native.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          finish({
            type: 'error',
            message:
              'Saul credential helper disconnected or is not installed. Update it and retry.',
          });
        });
        timer = setTimeout(
          () => {
            try {
              native?.postMessage({ version: 1, id, cancel: true });
            } catch {
              /* Disconnected. */
            }
            finish({
              type: 'error',
              message: 'Saul credential operation timed out. Retry explicitly.',
            });
          },
          login ? 320_000 : 190_000,
        );
        native.postMessage({ version: 1, id, request: message });
      } catch (error) {
        finish({
          type: 'error',
          message: error instanceof Error ? error.message : 'Cannot connect to Saul credentials.',
        });
      }
    });
    port.onDisconnect.addListener(() => {
      if (!login) finish();
    });
  });
}
