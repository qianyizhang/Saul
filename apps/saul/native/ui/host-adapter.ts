import type { CallToolResult, CallToolRequest, Transport } from '@modelcontextprotocol/client';
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { isRecord } from '../value.mts';
interface HostCallbacks {
  onResult?: (result: CallToolResult) => void;
  onContext?: (context: McpUiHostContext) => void;
  onClose?: () => void;
  onError?: (error: unknown) => void;
}
import './csp-validation.ts';
import { App } from '@modelcontextprotocol/ext-apps';

const uncertain =
  'Connection lost or timed out. Refresh to inspect the current state; do not repeat an uncertain action.';

/** Own the host lifecycle; board actions never handle protocol IDs or notifications. */
export function createHostAdapter(
  { onResult, onContext, onClose, onError }: HostCallbacks = {},
  options: {
    app?: App;
    timeout?: number;
    observe?: <T>(method: string, request: unknown, action: () => Promise<T>) => Promise<T>;
  } = {},
) {
  const app =
    options.app ??
    new App(
      { name: 'Saul Tab board', version: '1.4.0' },
      { availableDisplayModes: ['inline', 'fullscreen'] },
      { autoResize: false },
    );
  let state: 'new' | 'connecting' | 'connected' | 'closed' = 'new';
  const abort = new AbortController();
  const requestOptions = () => ({ timeout: options.timeout ?? 120000, signal: abort.signal });
  const stop = () => {
    if (state === 'closed') return;
    state = 'closed';
    abort.abort();
    onClose?.();
  };
  app.ontoolresult = (result) => {
    if (state === 'closed') return;
    try {
      onResult?.(result);
    } catch (error) {
      onError?.(error);
    }
  };
  app.onhostcontextchanged = (context) => {
    if (state !== 'closed') onContext?.(context);
  };
  app.onteardown = () => {
    stop();
    // The SDK sends the teardown response before the host removes the frame.
    return {};
  };
  app.onclose = stop;
  app.onerror = (error) => onError?.(error);

  const observe =
    options.observe ??
    (<T>(_method: string, _request: unknown, action: () => Promise<T>) => action());
  function requireCapability(name: 'serverTools' | 'message') {
    if (state !== 'connected') throw new Error('The Saul host connection is not available.');
    if (!app.getHostCapabilities()?.[name])
      throw new Error(
        `This host does not support ${name === 'message' ? 'sending messages' : 'Saul tool calls'}.`,
      );
  }
  async function perform<T extends { isError?: boolean }>(
    name: 'serverTools' | 'message',
    operation: () => Promise<T>,
  ): Promise<T> {
    requireCapability(name);
    try {
      const result = await operation();
      if (state !== 'connected') throw new Error(uncertain);
      if (result?.isError)
        throw new Error(
          ('content' in result &&
            Array.isArray(result.content) &&
            result.content.find((item: unknown) => isRecord(item) && item.type === 'text')?.text) ||
            'The host could not complete the request.',
        );
      return result;
    } catch (error) {
      if (
        abort.signal.aborted ||
        (isRecord(error) &&
          typeof error.code === 'string' &&
          ['REQUEST_TIMEOUT', 'CONNECTION_CLOSED'].includes(error.code))
      )
        throw new Error(uncertain, { cause: error });
      throw error;
    }
  }
  return {
    async connect(transport?: Transport) {
      if (state !== 'new') throw new Error('The host connection has already been started.');
      state = 'connecting';
      try {
        await app.connect(transport, requestOptions());
        if (abort.signal.aborted) throw new Error('The host closed during initialization.');
        state = 'connected';
        onContext?.(app.getHostContext() ?? {});
        return app.getHostCapabilities() ?? {};
      } catch (error) {
        stop();
        throw error;
      }
    },
    callTool(name: string, args: CallToolRequest['params']['arguments']) {
      return perform('serverTools', () =>
        observe(name, { name, arguments: args }, () =>
          app.callServerTool({ name, arguments: args }, requestOptions()),
        ),
      );
    },
    sendMessage(text: string) {
      return perform('message', () =>
        observe('ui/message', { role: 'user', content: [{ type: 'text', text }] }, () =>
          app.sendMessage({ role: 'user', content: [{ type: 'text', text }] }, requestOptions()),
        ),
      );
    },
    resize(height: number) {
      if (state === 'connected')
        void app.sendSizeChanged({ height }).catch((error) => onError?.(error));
    },
    async close() {
      stop();
      await app.close();
    },
  };
}
