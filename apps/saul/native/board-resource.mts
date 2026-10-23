import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const asset = (name: string) => readFileSync(new URL(`./ui/${name}`, import.meta.url), 'utf8');
// Freeze the delivered document for this process. Installed processes stay on their generation.
export const BOARD_HTML = asset('workspace.html')
  .replace('/* SAUL_STYLE */', () => `${asset('design-tokens.css')}\n${asset('workspace.css')}`)
  .replace('/* SAUL_SCRIPT */', () => asset('workspace.bundle.js'));
export const BOARD_URI = `ui://saul/workspace-${createHash('sha256').update(BOARD_HTML).digest('hex').slice(0, 16)}.html`;
export const BOARD_RESOURCE = {
  uri: BOARD_URI,
  name: 'Saul Tab board',
  mimeType: 'text/html;profile=mcp-app',
  description: 'Inspect Chrome windows and review a proposed layout before applying it.',
};
