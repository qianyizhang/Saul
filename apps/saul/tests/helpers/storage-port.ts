import { Fragments, packets } from '../../shared/protocol/fragments.mts';
import { decodeNativeFrame } from './storage-frame';

type Envelope<T> = { id: string; request: T };

/** Simulate Chrome's native port and the native message boundaries; handler owns state only. */
export function storagePort<T>(
  handle: (host: string, message: Envelope<T>) => unknown | Promise<unknown>,
) {
  return (host: string) => {
    const input = new Fragments();
    const messages: ((packet: unknown) => void)[] = [];
    const disconnects: (() => void)[] = [];
    let closed = false;
    return {
      onMessage: { addListener: (listener: (packet: unknown) => void) => messages.push(listener) },
      onDisconnect: { addListener: (listener: () => void) => disconnects.push(listener) },
      disconnect: () => {
        closed = true;
      },
      postMessage: (packet: unknown) => {
        const request = input.accept(decodeNativeFrame(packet)) as Envelope<T> | undefined;
        if (!request || !request.request) return;
        void Promise.resolve()
          .then(async () => {
            const result = await handle(host, request);
            if (!closed)
              for (const frame of packets({ id: request.id, ...(result as object) })) {
                const message = decodeNativeFrame(frame);
                for (const listener of messages) listener(message);
              }
          })
          .catch(() => {
            if (!closed) for (const listener of disconnects) listener();
          });
      },
    };
  };
}
