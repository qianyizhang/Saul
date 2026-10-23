import type { CallToolResult } from '@modelcontextprotocol/client';
import type { McpUiHostCapabilities } from '@modelcontextprotocol/ext-apps';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { createHostAdapter } from '../native/ui/host-adapter.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

function fixture({
  capabilities = { serverTools: {}, message: {} },
  callbacks = {},
  timeout = 1000,
  rejectInitialization = false,
}: {
  capabilities?: McpUiHostCapabilities;
  callbacks?: Parameters<typeof createHostAdapter>[0];
  timeout?: number;
  rejectInitialization?: boolean;
} = {}) {
  const app = new App({ name: 'Board fixture', version: '1' }, {}, { autoResize: false });
  const bridge = new AppBridge(null, { name: 'Independent host', version: '1' }, capabilities, {
    hostContext: { theme: 'light' },
  });
  const [viewTransport, hostTransport] = InMemoryTransport.createLinkedPair();
  const traffic: { direction: string; id?: string | number; method?: string }[] = [];
  for (const [direction, transport] of [
    ['view', viewTransport],
    ['host', hostTransport],
  ] as const) {
    const send = transport.send.bind(transport);
    transport.send = async (message, options) => {
      traffic.push({ direction, ...message });
      await send(
        rejectInitialization &&
          direction === 'host' &&
          'result' in message &&
          message.result.protocolVersion
          ? {
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32000, message: 'Initialization refused' },
            }
          : message,
        options,
      );
    };
  }
  const adapter = createHostAdapter(callbacks, { app, timeout });
  cleanup.push(
    () => adapter.close(),
    () => bridge.close(),
  );
  return {
    adapter,
    bridge,
    traffic,
    async connect() {
      await bridge.connect(hostTransport);
      return adapter.connect(viewTransport);
    },
  };
}

it('distinguishes a host teardown from an outstanding app request with the same ID', async () => {
  const onClose = vi.fn();
  const f = fixture({ callbacks: { onClose } });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finish!: (result: CallToolResult) => void;
  f.bridge.oncalltool = async () => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  await f.connect();
  // The host's first request and the app's initialization each consume ID 0.
  await f.bridge.request({ method: 'ping' }, z.object({}));
  const call = f.adapter.callTool('saul_workspace_apply', {}).catch((error) => error);
  await entered;
  await expect(f.bridge.teardownResource({}, { timeout: 1000 })).resolves.toEqual({});
  const request = f.traffic.find((m) => m.direction === 'view' && m.method === 'tools/call');
  const teardown = f.traffic.find(
    (m) => m.direction === 'host' && m.method === 'ui/resource-teardown',
  );
  expect(request!.id).toBe(teardown!.id);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(await call).toBeInstanceOf(Error);
  finish({ content: [] });
  await expect(f.adapter.callTool('saul_workspace_apply', {})).rejects.toThrow('not available');
  expect(f.traffic.filter((m) => m.method === 'tools/call')).toHaveLength(1);
});

it('delivers notifications, checks capabilities and preserves host error outcomes', async () => {
  const onResult = vi.fn(),
    onContext = vi.fn();
  const f = fixture({ callbacks: { onResult, onContext } });
  const failed: CallToolResult = {
    isError: true,
    content: [{ type: 'text', text: 'Approval expired' }],
  };
  f.bridge.oncalltool = async () => failed;
  f.bridge.onmessage = async () => ({ isError: true });
  await f.connect();
  expect(onContext).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light' }));
  await f.bridge.sendToolResult({ content: [{ type: 'text', text: 'Updated proposal' }] });
  f.bridge.setHostContext({ theme: 'dark' });
  await vi.waitFor(() =>
    expect(onContext).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' })),
  );
  expect(onResult).toHaveBeenCalledTimes(1);
  await expect(f.adapter.callTool('saul_workspace_apply', {})).rejects.toThrow('Approval expired');
  await expect(f.adapter.sendMessage('Review this proposal')).rejects.toThrow('could not complete');

  const unsupported = fixture({ capabilities: {} });
  await unsupported.connect();
  await expect(unsupported.adapter.callTool('saul_workspace_state', {})).rejects.toThrow(
    'does not support',
  );
  await expect(unsupported.adapter.sendMessage('hello')).rejects.toThrow('does not support');
  expect(
    unsupported.traffic.some((m) => ['tools/call', 'ui/message'].includes(m.method ?? '')),
  ).toBe(false);
});

it('retains uncertainty after a timeout without resending an action', async () => {
  const f = fixture({ timeout: 25 });
  let finish!: (result: CallToolResult) => void;
  f.bridge.oncalltool = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await f.connect();
  await expect(f.adapter.callTool('saul_workspace_apply', {})).rejects.toThrow('do not repeat');
  finish({ content: [] });
  expect(f.traffic.filter((m) => m.method === 'tools/call')).toHaveLength(1);
});

it('closes a rejected initialization and never sends a tool request', async () => {
  const onClose = vi.fn();
  const f = fixture({ callbacks: { onClose }, rejectInitialization: true });
  await expect(f.connect()).rejects.toThrow('Initialization refused');
  expect(onClose).toHaveBeenCalledTimes(1);
  await expect(f.adapter.callTool('saul_workspace_state', {})).rejects.toThrow('not available');
  expect(f.traffic.some((m) => m.method === 'tools/call')).toBe(false);
});
