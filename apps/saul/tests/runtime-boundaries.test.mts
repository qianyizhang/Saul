import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const lint = new ESLint({ cwd: fileURLToPath(new URL('../', import.meta.url)) });
const sharedFile = 'shared/model/boundary-probe.ts';

it.each([
  "export { createBoardSession } from '../../board/board-session';",
  "export { tabLabel } from '../../browser/tab-label';",
  "import '../../src/app/Tabs';",
  "import '../../native/storage/db';",
  "import '../../entrypoints/background';",
  "export { readFile } from 'node:fs';",
  "export { readFile } from 'fs';",
  "export const load = () => import('../../board/board-session');",
])('rejects a shared dependency on a runtime implementation: %s', async (source) => {
  const [result] = await lint.lintText(source, { filePath: sharedFile });
  expect(
    result!.messages.some((message) =>
      ['no-restricted-imports', 'no-restricted-syntax'].includes(message.ruleId ?? ''),
    ),
  ).toBe(true);
});

it.each([
  'document',
  'window',
  'navigator',
  'localStorage',
  'HTMLElement',
  'process',
  'Buffer',
  'globalThis.document',
  "globalThis['document']",
  'globalThis.process',
])('rejects a host-only global in shared code: %s', async (expression) => {
  const [result] = await lint.lintText(`export const probe = () => ${expression};`, {
    filePath: sharedFile,
  });
  expect(result!.messages.some((message) => message.ruleId === 'no-restricted-globals')).toBe(true);
});

it('allows portable APIs and local names without granting access to host globals', async () => {
  const [result] = await lint.lintText(
    `
    import { isRecord } from './value.mts';
    export const encode = (value: unknown) => isRecord(value) && new TextEncoder().encode(JSON.stringify(value));
    export const url = (value: string) => new URL(value);
    export const label = (document: { title: string }) => document.title;
  `,
    { filePath: sharedFile },
  );
  expect(result!.messages).toEqual([]);
});

it.each(['board/boundary-probe.ts', 'browser/boundary-probe.ts'])(
  'allows DOM access in browser-owned code: %s',
  async (filePath) => {
    const [result] = await lint.lintText('export const title = () => document.title;', {
      filePath,
    });
    expect(result!.messages).toEqual([]);
  },
);

it('keeps Node storage from importing browser presentation', async () => {
  const [result] = await lint.lintText("export { tabLabel } from '../../browser/tab-label';", {
    filePath: 'native/storage/boundary-probe.ts',
  });
  expect(result!.messages.some((message) => message.ruleId === 'no-restricted-imports')).toBe(true);
});

it.each([
  ['src/calls/execution/probe.ts', "import '../../reading/input-change';"],
  ['src/calls/probe.ts', "export const load = () => import('../annotations/routing');"],
  ['src/annotations/probe.ts', "export { editCall } from '../calls/client';"],
  ['src/custom-actions/probe.ts', "import '../calls/editor';"],
  ['src/reading/probe.ts', "import '../calls/client';"],
  ['src/configuration/definition.ts', "import '../reading/prompts';"],
  ['src/configuration/codec.ts', "import './store';"],
  ['src/configuration/resolver.ts', "import '../reading/prompts';"],
])('enforces one-way feature dependencies from %s', async (filePath, source) => {
  const [result] = await lint.lintText(source, { filePath });
  expect(
    result!.messages.some((message) =>
      ['no-restricted-imports', 'no-restricted-syntax'].includes(message.ruleId ?? ''),
    ),
  ).toBe(true);
});
