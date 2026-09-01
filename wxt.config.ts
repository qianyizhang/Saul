import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Saul - AI Concept & Reading Explorer',
    description: 'Local-first AI concept explorer with inline term tooltips and customizable models.',
    permissions: ['storage', 'unlimitedStorage', 'offscreen'],
    host_permissions: ['<all_urls>'],
    action: {},
  },
});
