import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { format } from 'prettier';

// Use the web app's pinned icons; native builds consume only generated Swift.
const require = createRequire(new URL('../apps/saul/package.json', import.meta.url));
const { icons } = require('lucide-react') as { icons: Record<string, unknown> };
const { createElement } = require('react') as {
  createElement: (type: unknown, props: Record<string, unknown>) => unknown;
};
const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (element: unknown) => string;
};
interface SymbolDefinition {
  id: string;
  label: string;
  meaning: string;
  web: string;
  native: string;
}
const input: unknown = JSON.parse(await readFile(new URL('symbols.json', import.meta.url), 'utf8'));
if (!Array.isArray(input) || !input.length) throw new Error('Expected a nonempty symbol list.');
const symbols: SymbolDefinition[] = [];
for (const value of input) {
  if (
    !value ||
    typeof value !== 'object' ||
    !['id', 'label', 'meaning', 'web', 'native'].every(
      (key) => typeof value[key] === 'string' && value[key].trim(),
    ) ||
    !/^[a-z][a-zA-Z]*$/.test(value.id) ||
    !/^[a-z.0-9]+$/.test(value.native) ||
    !Object.hasOwn(icons, value.web) ||
    symbols.some((symbol) => symbol.id === value.id)
  )
    throw new Error('Invalid, duplicate or unknown control symbol.');
  symbols.push(value as SymbolDefinition);
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );
const svg = Object.fromEntries(
  symbols.map((symbol) => [
    symbol.id,
    renderToStaticMarkup(
      createElement(icons[symbol.web], { size: 20, 'aria-hidden': true, focusable: false }),
    ),
  ]),
);
const banner = 'Generated from design/symbols.json. Run pnpm design:generate; do not edit.';
const license = await readFile(
  new URL('../apps/saul/node_modules/lucide-react/LICENSE', import.meta.url),
  'utf8',
);
const typescript = await format(
  `// ${banner}\n/* ${license} */\nexport const controlSymbols = ${JSON.stringify(
    Object.fromEntries(
      symbols.map((symbol) => [symbol.id, { label: symbol.label, svg: svg[symbol.id] }]),
    ),
  )} as const;\nexport type ControlSymbol = keyof typeof controlSymbols;\n`,
  {
    parser: 'typescript',
    singleQuote: true,
    printWidth: 100,
  },
);
const swift = `// ${banner}\nimport SwiftUI\n\nenum ControlSymbol: String, CaseIterable {\n${symbols.map((symbol) => `case ${symbol.id}`).join('\n')}\nvar label: String {\nswitch self {\n${symbols.map((symbol) => `case .${symbol.id}: return ${JSON.stringify(symbol.label)}`).join('\n')}\n}\n}\nvar systemImage: String {\nswitch self {\n${symbols.map((symbol) => `case .${symbol.id}: return "${symbol.native}"`).join('\n')}\n}\n}\n}\n`;
const html = await format(
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shared control symbols · Little Clarity</title>
<style>:root{color-scheme:light dark;font:16px system-ui;background:light-dark(#fafaf7,#1e1e1e);color:light-dark(#242722,#e8e8e8)}body{max-width:1050px;margin:32px auto;padding:0 20px}h1{font:500 28px Georgia,serif}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid light-dark(#d7dcd1,#484848)}td:first-child{width:40px;color:light-dark(#296e59,#6ec2a1)}code{font-size:12px}p{max-width:78ch;line-height:1.6}.table{overflow:auto}button{font:inherit;padding:8px 12px}button:focus-visible{outline:2px solid #296e59}svg{vertical-align:middle}small{display:block;margin-top:4px;color:light-dark(#62685d,#b5b5b5)}</style>
<h1>Shared control symbols</h1><p>EZ and Saul share meanings and accessible names. Native controls use SF Symbols; web controls use Lucide. Copy, Send, Refresh and sidebar toggles show symbols in both modes. Other familiar controls may show symbols in Min Mode. Menus and consequential actions keep clear text when needed.</p>
<p>Every symbol button needs a full accessible name and tooltip. Refresh never regenerates; Reuse never sends; closing never stops work. The sidebar symbol is a toggle; opening the main window uses a window symbol.</p>
<div class="table"><table><thead><tr><th>Web</th><th>Action</th><th>Meaning</th><th>Native / web name</th></tr></thead><tbody>${symbols.map((symbol) => `<tr><td>${svg[symbol.id]}</td><td>${escape(symbol.label)}</td><td>${escape(symbol.meaning)}</td><td><code>${escape(symbol.native)}</code><small>${escape(symbol.web)}</small></td></tr>`).join('')}</tbody></table></div>
<p>Native sidebar visibility uses the system toolbar toggle. Run (EZ), Explain (Saul selection) and Send (message/follow-up) retain distinct names. A symbol does not change execution, permission or billing.</p><footer><small>${banner}</small><details><summary>Lucide license</summary><pre>${escape(license)}</pre></details></footer></html>`,
  { parser: 'html', printWidth: 100 },
);
const outputs = [
  ['../apps/saul/src/design/control-symbols.ts', typescript],
  ['../apps/saul/native/ui/control-symbols.ts', typescript],
  ...(process.argv.includes('--web-only')
    ? []
    : [
        [
          '../apps/ez/Sources/EZ/ControlSymbol.swift',
          execFileSync(
            'xcrun',
            [
              'swift-format',
              'format',
              '--configuration',
              new URL('../apps/ez/.swift-format', import.meta.url).pathname,
              '-',
            ],
            { input: swift, encoding: 'utf8' },
          ),
        ] as const,
      ]),
  ['symbols.html', html],
] as const;
for (const [file, expected] of outputs) {
  const url = new URL(file, import.meta.url);
  if (process.argv.includes('--check')) {
    if ((await readFile(url, 'utf8')) !== expected)
      throw new Error(`Generated symbols are stale: ${file}`);
  } else await writeFile(url, expected);
}
