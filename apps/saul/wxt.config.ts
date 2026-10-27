import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
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
        description: 'Saul Summarize',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
