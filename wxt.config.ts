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
      'storage',
      'unlimitedStorage',
      'offscreen',
      'nativeMessaging',
      'tabs',
      'tabGroups',
      'alarms',
    ],
    host_permissions: ['<all_urls>'],
    action: {},
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
