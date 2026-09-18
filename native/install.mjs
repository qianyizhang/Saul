#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mkdirSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { parseArgs } from 'node:util';
import { HOST_NAME } from './protocol.mjs';
import { secureDirectory } from './transport.mjs';

export const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
export function installationPlan({
  extensionId,
  browser = 'chrome',
  installDir,
  manifestDir,
  platform = process.platform,
  home = homedir(),
}) {
  if (!/^[a-p]{32}$/.test(extensionId ?? ''))
    throw new Error('--extension-id must be the 32-letter ID shown in chrome://extensions');
  const browsers = {
    darwin: {
      chrome: 'Library/Application Support/Google/Chrome',
      chromium: 'Library/Application Support/Chromium',
      edge: 'Library/Application Support/Microsoft Edge',
      brave: 'Library/Application Support/BraveSoftware/Brave-Browser',
    },
    linux: {
      chrome: '.config/google-chrome',
      chromium: '.config/chromium',
      edge: '.config/microsoft-edge',
      brave: '.config/BraveSoftware/Brave-Browser',
    },
  };
  if (!browsers[platform]?.[browser])
    throw new Error('Supported: macOS/Linux; chrome, chromium, edge, brave');
  const root = resolve(installDir ?? join(home, '.saul'));
  const bin = join(root, 'bin');
  const runtime = join(root, 'bridge');
  const manifestPath = join(
    resolve(manifestDir ?? join(home, browsers[platform][browser], 'NativeMessagingHosts')),
    `${HOST_NAME}.json`,
  );
  return {
    root,
    bin,
    runtime,
    manifestPath,
    manifest: {
      name: HOST_NAME,
      description: 'Saul local tab bridge',
      path: join(bin, 'saul-native-host'),
      type: 'stdio',
      allowed_origins: [`chrome-extension://${extensionId}/`],
    },
  };
}
function main() {
  const { values } = parseArgs({
    options: {
      'extension-id': { type: 'string' },
      browser: { type: 'string', default: 'chrome' },
      'install-dir': { type: 'string' },
      'manifest-dir': { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node native/install.mjs --extension-id <ID> [--browser chrome] [--dry-run]\nAdvanced: --install-dir <directory> --manifest-dir <NativeMessagingHosts directory>',
    );
    return;
  }
  const plan = installationPlan({
    extensionId: values['extension-id'],
    browser: values.browser,
    installDir: values['install-dir'],
    manifestDir: values['manifest-dir'],
  });
  if (values['dry-run']) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (existsSync(plan.manifestPath)) {
    const existing = JSON.parse(readFileSync(plan.manifestPath, 'utf8'));
    if (existing.path !== plan.manifest.path || existing.name !== HOST_NAME)
      throw new Error(
        'Existing host registration belongs to another installation; refusing to overwrite',
      );
    plan.manifest.allowed_origins = [
      ...new Set([...existing.allowed_origins, ...plan.manifest.allowed_origins]),
    ];
  }
  secureDirectory(plan.root);
  secureDirectory(plan.bin);
  secureDirectory(plan.runtime);
  const source = dirname(fileURLToPath(import.meta.url));
  for (const name of [
    'protocol.mjs',
    'transport.mjs',
    'host.mjs',
    'client.mjs',
    'cli.mjs',
    'mcp.mjs',
  ]) {
    copyFileSync(join(source, name), join(plan.runtime, name));
    chmodSync(join(plan.runtime, name), 0o600);
  }
  for (const [name, script] of [
    ['saul-native-host', 'host.mjs'],
    ['saul', 'cli.mjs'],
  ]) {
    const path = join(plan.bin, name);
    writeFileSync(
      path,
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(join(plan.runtime, script))} "$@"\n`,
      { mode: 0o700 },
    );
    chmodSync(path, 0o700);
  }
  mkdirSync(dirname(plan.manifestPath), { recursive: true });
  writeFileSync(plan.manifestPath, JSON.stringify(plan.manifest, null, 2) + '\n', { mode: 0o600 });
  console.log(
    `Installed ${plan.manifestPath}\nCLI: ${join(plan.bin, 'saul')}\nReload Saul and enable Codex tab access in its popup.\nRegister MCP:\ncodex mcp add saul-tabs -- ${shellQuote(process.execPath)} ${shellQuote(join(plan.runtime, 'mcp.mjs'))}`,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
