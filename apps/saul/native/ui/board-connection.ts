import type { CallToolResult } from '@modelcontextprotocol/client';
import { createHostAdapter } from './host-adapter.ts';
import { AppDiagnostics, plainMessageFlow } from './diagnostics.ts';
import { isRecord } from '../value.mts';

export const standalone = Boolean(document.querySelector('#saul-web')) && window.parent === window;
let state = 'starting';
export const diagnostics = new AppDiagnostics({
  name: 'Saul Tab board',
  version: '1.4.0',
  build: 'Content-addressed resource URI in server Info',
  mode: standalone ? 'standalone' : 'hosted',
  info: () => ({
    connection: state,
    standalone: standalone
      ? 'Local browser operations; Copy message never sends to Codex'
      : undefined,
  }),
  flows: [
    plainMessageFlow,
    {
      name: 'Selected browser context · fixture',
      steps: [
        'App freezes text and the opted-in session, revision and selected tab IDs',
        'App → Host: ui/message',
        'Host → App: acknowledgment',
        'Main conversation may use selected IDs to request scoped browser state',
        'A proposed layout still requires the user to click Apply',
      ],
      request: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Group these tabs\n\nSelected browser context (data):\n{"session":"fixture","revision":"fixture","selectedTabIds":[12,13]}',
          },
        ],
      },
      reads: ['No automatic evidence read; the agent chooses tools relevant to the message'],
    },
  ],
});
function checked(value: unknown): CallToolResult {
  if (!isRecord(value) || !Array.isArray(value.content))
    throw new Error('Malformed board response');
  if (value.isError)
    throw new Error(
      value.content.find((item: unknown) => isRecord(item) && typeof item.text === 'string')
        ?.text ?? 'Board request rejected',
    );
  return value as unknown as CallToolResult;
}
export function createBoardConnection(callbacks: Parameters<typeof createHostAdapter>[0]) {
  const sdk = standalone
    ? undefined
    : createHostAdapter(
        {
          ...callbacks,
          onClose: () => {
            state = 'closed';
            callbacks?.onClose?.();
          },
        },
        {
          observe: (method, request, action) =>
            method.startsWith('diagnostics_')
              ? action()
              : diagnostics.observe(method, request, action),
        },
      );
  const controller = new AbortController();
  const token = standalone ? location.hash.slice(1) : '';
  async function call(name: string, args: Record<string, unknown>) {
    if (sdk) return sdk.callTool(name, args);
    if (state === 'closed') throw new Error('Local connection closed');
    const response = await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, arguments: args }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
    });
    const result: unknown = await response.json();
    if (!response.ok) throw new Error(`Local board request failed (${response.status})`);
    return result;
  }
  diagnostics.remote = async (name, args) => {
    const result = await call(name, args);
    return checked(result).structuredContent;
  };
  return {
    async connect() {
      state = 'connecting';
      try {
        const capabilities = sdk ? await sdk.connect() : { serverTools: {} };
        state = 'connected';
        return capabilities;
      } catch (error) {
        state = 'closed';
        throw error;
      }
    },
    async callTool(name: string, args: Record<string, unknown>) {
      if (sdk) return sdk.callTool(name, args);
      return checked(
        await diagnostics.observe(name, { name, arguments: args }, () => call(name, args)),
      );
    },
    sendMessage(text: string) {
      if (sdk) return sdk.sendMessage(text);
      const request = { role: 'user', content: [{ type: 'text', text }] };
      return diagnostics.observe(
        standalone ? 'clipboard/write' : 'ui/message',
        request,
        async () => {
          await navigator.clipboard.writeText(text);
          return { copied: true };
        },
      );
    },
    resize(height: number) {
      sdk?.resize(height);
    },
    async close() {
      state = 'closed';
      controller.abort();
      await sdk?.close();
    },
  };
}
