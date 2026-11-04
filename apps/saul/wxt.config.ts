import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appSourceFingerprint, createBuildInfo } from '../../scripts/build-identity.mts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
let buildSource: string;

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    async 'build:before'() {
      buildSource = await appSourceFingerprint(repo, 'saul');
    },
    async 'build:manifestGenerated'(_wxt, manifest) {
      buildSource ??= await appSourceFingerprint(repo, 'saul');
      const identity = createBuildInfo('saul', manifest.version, buildSource, process.version);
      manifest.version_name = `${manifest.version} (${identity.build.slice(0, 12)})`;
    },
    async 'build:done'(wxt) {
      if (buildSource !== (await appSourceFingerprint(repo, 'saul')))
        throw new Error('Saul source changed during the build; rebuild before delivery.');
      const { version } = JSON.parse(
        await readFile(new URL('./package.json', import.meta.url), 'utf8'),
      );
      await writeFile(
        join(wxt.config.outDir, 'build-info.json'),
        JSON.stringify(createBuildInfo('saul', version, buildSource, process.version)) + '\n',
      );
    },
    async 'build:publicAssets'(_wxt, files) {
      // Text extraction can need built-in CMaps/fonts. Ship these with PDF.js,
      // including their licenses, rather than fetching runtime code or assets.
      const root = new URL('./node_modules/pdfjs-dist/', import.meta.url);
      for (const folder of ['cmaps', 'standard_fonts']) {
        for (const name of await readdir(new URL(folder + '/', root)))
          files.push({
            absoluteSrc: fileURLToPath(new URL(folder + '/' + name, root)),
            relativeDest: 'pdf/' + folder + '/' + name,
          });
      }
      files.push({
        absoluteSrc: fileURLToPath(new URL('LICENSE', root)),
        relativeDest: 'pdf/LICENSE',
      });
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  }),
  manifest: {
    name: 'Saul - AI Concept & Reading Explorer',
    description:
      'Local-first AI concept explorer with inline term tooltips and customizable models.',
    permissions: [
      'contextMenus',
      'sidePanel',
      'storage',
      'unlimitedStorage',
      'offscreen',
      'nativeMessaging',
      'scripting',
      'tabs',
      'tabGroups',
      'alarms',
    ],
    host_permissions: ['<all_urls>'],
    action: {},
    side_panel: { default_path: 'summary-panel.html' },
    commands: {
      'saul-summary-close': {
        suggested_key: { default: 'Alt+Shift+W', mac: 'MacCtrl+W' },
        description: 'Close Saul summary panel',
      },
      'saul-summarize': {
        suggested_key: { default: 'Alt+Shift+S', mac: 'MacCtrl+S' },
        description: 'Call Saul',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
