import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { storagePort } from './helpers/storage-port';
import { scopedCall } from '../src/native/config-transport';
import { HistoryConfigService } from '../native/storage/service.mts';
import { SharedPresetsStore } from '../native/storage/shared-presets.mts';
import type { StorageHelperRequest } from '../shared/protocol/storage-protocol.mts';
import { validateCallEditorState } from '../src/calls/contract';
import { actionHash } from '../native/action-store.mts';

afterEach(() => vi.unstubAllGlobals());

it('saves and reloads valid fragmented Call settings; a lost write reply does not resend', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'saul-storage-transport-'));
  const store = new SharedPresetsStore(join(dir, 'settings.json'));
  const service = new HistoryConfigService(store);
  const library = [1, 2, 3].map((n) => {
    const module = {
      contractVersion: 1 as const,
      language: 'typescript' as const,
      description: 'A valid fixture',
      name: 'Large Call ' + n,
      source: '/*' + 'x'.repeat(45_000) + '*/\nexport default () => "ok";',
    };
    return {
      presetId: 'preset-' + n,
      revision: { ...module, revision: actionHash(module), createdAt: 1 },
    };
  });
  const value = { library };
  validateCallEditorState(value);
  let saves = 0;
  let loseReply = false;
  vi.stubGlobal('chrome', {
    runtime: {
      connectNative: storagePort<StorageHelperRequest>(async (host, { request }) => {
        expect(host).toBe('com.saul.chatgpt');
        if (request.action === 'config-save') saves++;
        let reply;
        await service.run(request, (event) => {
          reply = event;
        });
        if (loseReply) throw new Error('Host disconnected after commit.');
        return { event: reply };
      }),
    },
  });
  try {
    const read = () => scopedCall({ action: 'config-read', section: 'calls' });
    const save = (revision: number) =>
      scopedCall({ action: 'config-save', section: 'calls', revision, value });
    await expect(read()).resolves.toEqual({ revision: 0 });
    await expect(save(0)).resolves.toEqual({ revision: 1, value });
    await expect(read()).resolves.toEqual({ revision: 1, value });
    loseReply = true;
    await expect(save(1)).rejects.toThrow('unavailable');
    expect(saves).toBe(2);
    loseReply = false;
    await expect(read()).resolves.toEqual({ revision: 2, value });
  } finally {
    service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
