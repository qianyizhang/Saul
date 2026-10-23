import type { Finding } from '@google/design.md/linter';

export interface DesignOutput {
  type: 'css' | 'swift' | 'typescript';
  path: string;
}
export interface CompiledDesign {
  css: string;
  typescript: string;
  swift: string | undefined;
  hash: string;
  findings: Finding[];
}
import { lint } from '@google/design.md/linter';
import { format } from 'prettier';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const identifier = /^[a-z][a-z0-9-]*$/;
const swiftName = (name: string) =>
  name.replace(/-([a-z])/g, (_: string, char: string) => char.toUpperCase());

// Escape generated member names rather than maintaining a partial list of Swift keywords.
const swiftMember = (name: string) => `\`${swiftName(name)}\``;

async function canonicalPath(file: string): Promise<string> {
  const absolute = path.resolve(file);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    return path.join(await canonicalPath(path.dirname(absolute)), path.basename(absolute));
  }
}

function dimension(value: { value: number; unit: string } | undefined, context: string) {
  if (!value || !Number.isFinite(value.value)) throw new Error(`${context}: missing dimension`);
  if (value.unit !== 'px') throw new Error(`${context}: the native adapter requires px values`);
  if (value.value < 0) throw new Error(`${context}: negative dimensions are unsupported`);
  return value.value;
}

/** Consume Google's resolved model; never independently parse DESIGN.md or its references. */
export function compileDesign(source: string, { native = false } = {}) {
  const report = lint(source);
  const errors = report.findings.filter(
    (finding) => finding.severity === 'error' || finding.rule === 'contrast-ratio',
  );
  if (errors.length)
    throw new Error(errors.map((f) => `${f.path ?? 'document'}: ${f.message}`).join('\n'));
  const model = report.designSystem;
  if (!model.name || !model.colors.size || !model.typography.size)
    throw new Error('A portable contract needs a name, colors, and typography.');
  for (const group of [model.colors, model.typography, model.rounded, model.spacing])
    for (const name of group.keys())
      if (!identifier.test(name)) throw new Error(`Unsupported token name: ${name}`);
  for (const name of model.colors.keys())
    if (name.endsWith('-dark') && !model.colors.has(name.slice(0, -5)))
      throw new Error(`Dark token has no light partner: ${name}`);

  const hash = createHash('sha256').update(source).digest('hex');
  const stamp = `Generated from DESIGN.md · SHA-256 ${hash}. Do not edit.`;
  const css = [`/* ${stamp} */`, ':root,', ':host {', '  color-scheme: light dark;'];
  const color = (value: { hex: string; a?: number }) => {
    if (!value || (value.a !== undefined && value.a !== 1))
      throw new Error('This adapter currently requires opaque sRGB colors.');
    return value.hex;
  };
  for (const [name, value] of model.colors) {
    if (name.endsWith('-dark')) continue;
    const dark = model.colors.get(`${name}-dark`) ?? value;
    css.push(`  --design-color-${name}: light-dark(${color(value)}, ${color(dark)});`);
  }
  for (const [name, value] of model.typography) {
    if (value.fontFamily) {
      if (/[;{}<>\n]/.test(value.fontFamily)) throw new Error(`Invalid font family: ${name}`);
      css.push(`  --design-font-${name}: ${value.fontFamily};`);
    }
    for (const [prop, cssName] of [
      ['fontSize', 'size'],
      ['lineHeight', 'leading'],
      ['letterSpacing', 'tracking'],
    ] as const)
      if (value[prop])
        css.push(`  --design-${cssName}-${name}: ${value[prop].value}${value[prop].unit};`);
    if (value.fontWeight !== undefined) css.push(`  --design-weight-${name}: ${value.fontWeight};`);
  }
  for (const [group, values] of [
    ['radius', model.rounded],
    ['space', model.spacing],
  ] as const)
    for (const [name, value] of values)
      css.push(`  --design-${group}-${name}: ${value.value}${value.unit};`);
  css.push(
    '}',
    ':root[data-theme="light"],',
    ':host([data-theme="light"]) {',
    '  color-scheme: light;',
    '}',
    ':root[data-theme="dark"],',
    ':host([data-theme="dark"]) {',
    '  color-scheme: dark;',
    '}',
    '',
  );

  const colors = Object.fromEntries([...model.colors].map(([name, value]) => [name, color(value)]));
  const typescript = `// ${stamp}\nexport const designColors = ${JSON.stringify(colors, null, 2)} as const;\n`;
  let swift;
  if (native) {
    const names = [
      ...[...model.colors.keys()].filter((name) => !name.endsWith('-dark')),
      ...model.typography.keys(),
      ...[...model.rounded.keys()].map((name) => `radius-${name}`),
      ...[...model.spacing.keys()].map((name) => `space-${name}`),
    ].map(swiftName);
    if (new Set(names).size !== names.length)
      throw new Error(
        'Native token names collide across generated color, font, or dimension roles.',
      );
    const lines = [`// ${stamp}`, 'import SwiftUI', '', 'enum DesignTokens {'];
    const rgb = (value: { r: number; g: number; b: number }) =>
      `NSColor(srgbRed: ${value.r / 255}, green: ${value.g / 255}, blue: ${value.b / 255}, alpha: 1)`;
    for (const [name, value] of model.colors) {
      if (name.endsWith('-dark')) continue;
      lines.push(
        `    static let ${swiftMember(name)} = Color(nsColor: NSColor(name: ${JSON.stringify(`${model.name}.${name}`)}) { appearance in`,
        '        if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {',
        `            return ${rgb(model.colors.get(`${name}-dark`) ?? value)}`,
        '        }',
        `        return ${rgb(value)}`,
        '    })',
      );
    }
    const weights = new Map([
      [100, 'ultraLight'],
      [200, 'thin'],
      [300, 'light'],
      [400, 'regular'],
      [500, 'medium'],
      [600, 'semibold'],
      [700, 'bold'],
      [800, 'heavy'],
      [900, 'black'],
    ]);
    for (const [name, value] of model.typography) {
      const family = value.fontFamily ?? '';
      const design = family.includes('ui-serif')
        ? 'serif'
        : family.includes('system-ui')
          ? 'default'
          : null;
      if (!design) throw new Error(`${name}: explicitly map this font family before native export`);
      const weight = weights.get(value.fontWeight ?? 400);
      if (!weight) throw new Error(`${name}: unsupported native font weight`);
      lines.push(
        `    static let ${swiftMember(name)} = Font.system(size: ${dimension(value.fontSize, name)}, weight: .${weight}, design: .${design})`,
      );
    }
    for (const [group, values] of [
      ['radius', model.rounded],
      ['space', model.spacing],
    ] as const)
      for (const [name, value] of values)
        lines.push(
          `    static let ${swiftMember(`${group}-${name}`)}: CGFloat = ${dimension(value, name)}`,
        );
    lines.push('}', '');
    swift = lines.join('\n');
  }
  return { css: css.join('\n'), typescript, swift, hash, findings: report.findings };
}

export async function generate({
  source,
  outputs,
  check = false,
}: {
  source: string;
  outputs: DesignOutput[];
  check?: boolean;
}) {
  if (!outputs.length)
    throw new Error('Choose at least one output: --css, --swift, or --typescript.');
  const content = await readFile(source, 'utf8');
  const compiled = compileDesign(content, { native: outputs.some((o) => o.type === 'swift') });
  const sourcePath = await canonicalPath(source);
  const paths = await Promise.all(outputs.map((o) => canonicalPath(o.path)));
  if (paths.includes(sourcePath) || new Set(paths).size !== paths.length)
    throw new Error('Output paths must be distinct and must not replace the source contract.');
  const sourceInfo = await stat(source);
  const outputInfo = await Promise.all(
    outputs.map(async (output) => {
      try {
        return await stat(output.path);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        return undefined;
      }
    }),
  );
  const identities = [sourceInfo, ...outputInfo.filter((value) => value !== undefined)].map(
    (info) => `${info.dev}:${info.ino}`,
  );
  if (new Set(identities).size !== identities.length)
    throw new Error('Output paths alias the source or another output file.');
  // All validation and compilation finish before the first output is touched.
  const nativeFormat = async (output: DesignOutput) => {
    let directory = path.dirname(path.resolve(output.path));
    const options = [];
    while (true) {
      const config = path.join(directory, '.swift-format');
      try {
        if ((await stat(config)).isFile()) {
          options.push('--configuration', config);
          break;
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    return execFileSync('xcrun', ['swift-format', 'format', ...options, '-'], {
      input: compiled.swift,
      encoding: 'utf8',
    });
  };
  const formatted = await Promise.all(
    outputs.map(async (output) => ({
      ...output,
      expected:
        output.type === 'swift'
          ? await nativeFormat(output)
          : await format(compiled[output.type], {
              parser: output.type === 'css' ? 'css' : 'typescript',
              singleQuote: true,
              printWidth: 100,
            }),
    })),
  );
  for (const output of formatted) {
    const expected = output.expected;
    if (check) {
      let actual;
      try {
        actual = await readFile(output.path, 'utf8');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      if (actual !== expected) throw new Error(`Generated design is stale: ${output.path}`);
    } else {
      await mkdir(path.dirname(output.path), { recursive: true });
      await writeFile(output.path, expected);
    }
  }
  return compiled;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        source: {
          type: 'string',
          default: fileURLToPath(new URL('../DESIGN.md', import.meta.url)),
        },
        css: { type: 'string', multiple: true },
        swift: { type: 'string' },
        typescript: { type: 'string' },
        check: { type: 'boolean', default: false },
      },
    });
    const outputs: DesignOutput[] = [
      ...(values.css ?? []).map((path) => ({ type: 'css' as const, path })),
      ...(values.swift ? [{ type: 'swift' as const, path: values.swift }] : []),
      ...(values.typescript ? [{ type: 'typescript' as const, path: values.typescript }] : []),
    ];
    const result = await generate({ source: values.source, outputs, check: values.check });
    console.log(
      `${values.check ? 'Verified' : 'Generated'} ${outputs.length} design outputs · ${result.hash.slice(0, 12)}`,
    );
    const warnings = result.findings.filter(
      (f) => f.severity === 'warning' && f.rule !== 'orphaned-tokens',
    );
    for (const warning of warnings)
      console.warn(`${warning.path ?? 'document'}: ${warning.message}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
