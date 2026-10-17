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
  cpSync,
} from 'node:fs';
import { parseArgs } from 'node:util';
import { PLAN_HOST } from './plan-protocol.mjs';
import { HOST_NAME } from './protocol.mjs';
import { errorMessage, secureDirectory } from './transport.mjs';

export const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
export function installationPlan({
  extensionId,
  browser = 'chrome',
  installDir,
  manifestDir,
  platform = process.platform,
  home = homedir(),
  chatgpt = false,
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
    `${chatgpt ? PLAN_HOST : HOST_NAME}.json`,
  );
  return {
    root,
    bin,
    runtime,
    manifestPath,
    manifest: {
      name: chatgpt ? PLAN_HOST : HOST_NAME,
      description: chatgpt ? 'Saul ChatGPT plan provider' : 'Saul local tab bridge',
      path: join(bin, chatgpt ? 'saul-chatgpt-host' : 'saul-native-host'),
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
      chatgpt: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node native/install.mjs --extension-id <ID> [--browser chrome] [--chatgpt] [--dry-run]\nAdvanced: --install-dir <directory> --manifest-dir <NativeMessagingHosts directory>',
    );
    return;
  }
  const plan = installationPlan({
    extensionId: values['extension-id'],
    browser: values.browser,
    installDir: values['install-dir'],
    manifestDir: values['manifest-dir'],
    chatgpt: values.chatgpt,
  });
  if (values['dry-run']) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (existsSync(plan.manifestPath)) {
    const existing = JSON.parse(readFileSync(plan.manifestPath, 'utf8'));
    if (existing.path !== plan.manifest.path || existing.name !== plan.manifest.name)
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
    ...(values.chatgpt
      ? [
          'plan-protocol.mjs',
          'plan-host.mjs',
          'plan-service.mjs',
          'plan-models.mjs',
          'plan-auth.mjs',
          'plan-store.mjs',
          'responses.mjs',
          'sse.mjs',
        ]
      : [
          'host.mjs',
          'client.mjs',
          'cli.mjs',
          'mcp.mjs',
          'app-protocol.mjs',
          'workspace.mjs',
          'window-labels.mjs',
        ]),
  ]) {
    copyFileSync(join(source, name), join(plan.runtime, name));
    chmodSync(join(plan.runtime, name), 0o600);
  }
  if (!values.chatgpt) cpSync(join(source, 'ui'), join(plan.runtime, 'ui'), { recursive: true });
  if (values.chatgpt) {
    const joseRoot = dirname(fileURLToPath(import.meta.resolve('jose/package.json')));
    cpSync(joseRoot, join(plan.runtime, 'node_modules', 'jose'), {
      recursive: true,
      dereference: true,
    });
  }
  for (const [name, script] of [
    ...(values.chatgpt
      ? [['saul-chatgpt-host', 'plan-host.mjs']]
      : [
          ['saul-native-host', 'host.mjs'],
          ['saul', 'cli.mjs'],
        ]),
  ]) {
    const path = join(plan.bin, name);
    // Chrome launches native hosts without the installing shell's environment.
    // Preserve configured proxy routing for OAuth, JWKS and inference together.
    const proxy = values.chatgpt
      ? ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']
          .filter((key) => process.env[key])
          .map((key) => `export ${key}=${shellQuote(process.env[key])}\n`)
          .join('')
      : '';
    writeFileSync(
      path,
      `#!/bin/sh\n${proxy}exec ${shellQuote(process.execPath)} ${values.chatgpt ? '--use-env-proxy ' : ''}${shellQuote(join(plan.runtime, script))} "$@"\n`,
      { mode: 0o700 },
    );
    chmodSync(path, 0o700);
  }
  mkdirSync(dirname(plan.manifestPath), { recursive: true });
  writeFileSync(plan.manifestPath, JSON.stringify(plan.manifest, null, 2) + '\n', { mode: 0o600 });
  if (values.chatgpt) {
    console.log(
      `Installed ${plan.manifestPath}\nOpen Saul Settings → ChatGPT plan → Continue with ChatGPT.`,
    );
    return;
  }
  console.log(
    `Installed ${plan.manifestPath}\nCLI: ${join(plan.bin, 'saul')}\nReload Saul and enable Codex tab access in its popup.\nRegister MCP:\ncodex mcp add saul-tabs -- ${shellQuote(process.execPath)} ${shellQuote(join(plan.runtime, 'mcp.mjs'))}`,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
