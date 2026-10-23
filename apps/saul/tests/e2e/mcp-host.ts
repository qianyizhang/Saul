import '../../native/ui/csp-validation.js';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { McpUiHostCapabilities } from '@modelcontextprotocol/ext-apps';

declare global {
  interface Window {
    workspaceCall: (
      name: string,
      args: unknown,
    ) => Promise<Awaited<ReturnType<AppBridge['callTool']>>>;
    recordMessage: (message: unknown) => Promise<void>;
    fixtureHost: {
      connect: (capabilities?: McpUiHostCapabilities) => Promise<void>;
      teardown: () => Promise<Record<string, unknown>>;
      result: (result: Parameters<AppBridge['sendToolResult']>[0]) => Promise<void>;
      theme: (theme: 'light' | 'dark') => void;
    };
  }
}

let bridge: AppBridge;
window.fixtureHost = {
  async connect(capabilities = { serverTools: {}, message: {} }) {
    await bridge?.close();
    const frame = document.querySelector('iframe')!;
    bridge = new AppBridge(null, { name: 'Independent SDK host', version: '1.0.0' }, capabilities, {
      hostContext: { theme: 'light' },
    });
    bridge.oncalltool = (params) => window.workspaceCall(params.name, params.arguments ?? {});
    bridge.onmessage = async (message) => {
      await window.recordMessage(message);
      return {};
    };
    await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
  },
  teardown: () => bridge.teardownResource({}, { timeout: 3000 }),
  result: (result) => bridge.sendToolResult(result),
  theme: (theme) => bridge.setHostContext({ theme }),
};
