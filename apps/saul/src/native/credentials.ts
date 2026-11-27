import {
  CREDENTIALS_HOST,
  CREDENTIALS_VERSION,
  CREDENTIALS_PORT,
  validateCredentialEvent,
  validateCredentialResult,
  type CredentialResult,
  type CredentialResultRequest,
  type NativeCredentialEnvelope,
  validateCredentialRequest,
  type CredentialRequest,
  type CredentialEvent,
} from '../../shared/protocol/credentials-contract.mts';
import { Fragments } from '../../shared/protocol/fragments.mts';
import { workspaceSender } from '../platform/chrome/sender';

export class CredentialRequestError extends Error {
  constructor(
    message: string,
    readonly reason?: string,
  ) {
    super(message);
  }
}

export async function* credentialEvents(
  request: CredentialRequest,
  signal?: AbortSignal,
  direct = false,
): AsyncGenerator<CredentialEvent> {
  validateCredentialRequest(request);
  signal?.throwIfAborted();
  const port = direct
    ? chrome.runtime.connectNative(CREDENTIALS_HOST)
    : chrome.runtime.connect({ name: CREDENTIALS_PORT });
  const id = direct ? crypto.randomUUID() : undefined;
  const packets = direct ? new Fragments() : undefined;
  const queue: CredentialEvent[] = [];
  let ended = false,
    wake = () => {};
  const abort = () => {
    ended = true;
    wake();
    try {
      port.postMessage(
        id
          ? ({ version: CREDENTIALS_VERSION, id, cancel: true } satisfies NativeCredentialEnvelope)
          : { cancel: true },
      );
    } catch {
      /* Disconnected. */
    }
    port.disconnect();
  };
  port.onMessage.addListener((packet: unknown) => {
    try {
      let event = packet;
      if (packets) {
        const reply = packets.accept(packet);
        if (reply === undefined) return;
        if (
          !reply ||
          typeof reply !== 'object' ||
          !('id' in reply) ||
          reply.id !== id ||
          !('event' in reply)
        )
          throw new Error('Invalid credential reply.');
        event = reply.event;
      }
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
    port.postMessage(
      id
        ? ({ version: CREDENTIALS_VERSION, id, request } satisfies NativeCredentialEnvelope)
        : request,
    );
    while (!ended) {
      if (!queue.length)
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      signal?.throwIfAborted();
      const event = queue.shift();
      if (!event) continue;
      if (event.type === 'error') throw new CredentialRequestError(event.message, event.reason);
      if (event.type === 'complete' || event.type === 'result') ended = true;
      yield event;
    }
  } finally {
    ended = true;
    signal?.removeEventListener('abort', abort);
    port.disconnect();
  }
}
export async function credentialCall<T extends CredentialResultRequest>(
  request: T,
  signal?: AbortSignal,
): Promise<CredentialResult<T>> {
  for await (const event of credentialEvents(request, signal)) {
    if (event.type === 'result') {
      validateCredentialResult(request, event);
      return event;
    }
  }
  throw new Error('Saul returned no credential result.');
}

/** Background-only control route. It cannot start sign-in, generation or return a long-lived secret. */
type NativeCredentialRequest = Exclude<
  CredentialResultRequest,
  {
    action: 'login' | 'api-realtime' | 'api-image';
  }
>;
export async function nativeCredentialCall<T extends NativeCredentialRequest>(
  request: T,
): Promise<CredentialResult<T>> {
  validateCredentialRequest(request);
  const id = crypto.randomUUID();
  const port = chrome.runtime.connectNative(CREDENTIALS_HOST);
  return new Promise((resolve, reject) => {
    let ended = false;
    const fragments = new Fragments();
    const finish = (error?: Error, value?: CredentialResult<T>) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      port.disconnect();
      if (error) reject(error);
      else if (value) resolve(value);
      else reject(new Error('Saul returned no credential result.'));
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
        if (reply.event.type === 'error')
          finish(new CredentialRequestError(reply.event.message, reply.event.reason));
        else if (reply.event.type === 'result') {
          validateCredentialResult(request, reply.event);
          finish(undefined, reply.event);
        } else finish(new Error('Unexpected credential control reply.'));
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Invalid credential reply.'));
      }
    });
    try {
      port.postMessage({
        version: CREDENTIALS_VERSION,
        id,
        request,
      } satisfies NativeCredentialEnvelope);
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
    const cancel = () => {
      if (closed) return;
      try {
        native?.postMessage({
          version: CREDENTIALS_VERSION,
          id,
          cancel: true,
        } satisfies NativeCredentialEnvelope);
      } catch {
        /* Disconnected. */
      }
      finish();
    };
    port.onMessage.addListener((message: unknown) => {
      if (started) {
        if (
          message &&
          typeof message === 'object' &&
          'cancel' in message &&
          message.cancel === true
        )
          cancel();
        return;
      }
      started = true;
      try {
        validateCredentialRequest(message);
        if (
          offscreen &&
          !(
            ['generate', 'api-chat', 'api-image', 'connection-run-hold'].includes(message.action) ||
            (message.action === 'connection-catalog' &&
              (message.intent === 'display' || (message.intent === undefined && !message.force)))
          )
        )
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
        if (
          message.action !== 'connection-run-hold' &&
          message.action !== 'connection-setup-hold'
        ) {
          timer = setTimeout(
            () => {
              try {
                native?.postMessage({
                  version: CREDENTIALS_VERSION,
                  id,
                  cancel: true,
                } satisfies NativeCredentialEnvelope);
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
        }
        native.postMessage({
          version: CREDENTIALS_VERSION,
          id,
          request: message,
        } satisfies NativeCredentialEnvelope);
      } catch (error) {
        finish({
          type: 'error',
          message: error instanceof Error ? error.message : 'Cannot connect to Saul credentials.',
        });
      }
    });
    port.onDisconnect.addListener(cancel);
  });
}
