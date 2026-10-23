#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  installationPlan,
  installHelpers,
  restoreGeneration,
  shellQuote,
} from './installation.mts';
import { errorMessage } from './transport.mts';

async function main() {
  const { values } = parseArgs({
    options: {
      'extension-id': { type: 'string' },
      browser: { type: 'string', default: 'chrome' },
      'install-dir': { type: 'string' },
      'manifest-dir': { type: 'string' },
      'restore-generation': { type: 'string' },
      components: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'migrate-legacy': { type: 'boolean' },
      chatgpt: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: pnpm native:install --extension-id <ID> [--components tabs,chatgpt] [--chatgpt] [--dry-run]\nAdvanced: --browser chrome --install-dir <directory> --manifest-dir <NativeMessagingHosts directory>\nLegacy upgrades require a disconnect/reconnect maintenance window and --migrate-legacy.\nExplicit recovery: --install-dir <directory> --restore-generation <printed generation ID>.',
    );
    return;
  }
  if (values['restore-generation']) {
    if (
      !values['install-dir'] ||
      values.components ||
      values.chatgpt ||
      values['extension-id'] ||
      values['manifest-dir'] ||
      values['dry-run'] ||
      values['migrate-legacy']
    )
      throw new Error('Recovery uses only --install-dir and --restore-generation.');
    const restored = restoreGeneration(values['install-dir'], values['restore-generation']);
    console.log(
      `Selected retained generation ${restored.generation}. Reconnect helpers to use it; running work is unchanged.`,
    );
    return;
  }
  if (values.components && values.chatgpt)
    throw new Error('Choose --components or --chatgpt, not both.');
  const options = {
    extensionId: values['extension-id'],
    browser: values.browser,
    installDir: values['install-dir'],
    manifestDir: values['manifest-dir'],
    migrateLegacy: values['migrate-legacy'],
    components: values.components?.split(',') ?? [values.chatgpt ? 'chatgpt' : 'tabs'],
  };
  const plans = options.components.map((component) => {
    if (!['tabs', 'chatgpt'].includes(component))
      throw new Error('Choose helper components: tabs,chatgpt.');
    return installationPlan({ ...options, chatgpt: component === 'chatgpt' });
  });
  if (values['dry-run']) {
    console.log(JSON.stringify(plans.length === 1 ? plans[0] : plans, null, 2));
    return;
  }
  const result = await installHelpers(options);
  console.log(
    `Installed ${result.components.join(', ')} as ${result.generation}.\nReconnect helpers to use the new generation. Existing work stays on its original generation.`,
  );
  if (options.components.includes('tabs'))
    console.log(
      `CLI: ${result.root}/bin/saul\nRegister MCP only when needed:\ncodex mcp add saul-tabs -- ${shellQuote(process.execPath)} ${shellQuote(`${result.root}/bridge/mcp.mjs`)}`,
    );
  if (result.previous)
    console.log(
      `Previous generation retained: ${result.previous}\nExplicit recovery: pnpm native:install --install-dir ${shellQuote(result.root)} --restore-generation ${result.previous}`,
    );
  if (result.legacyBackup)
    console.log(
      `Legacy files retained at ${result.root}/${result.legacyBackup}. Credentials stayed in their existing directory.`,
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
