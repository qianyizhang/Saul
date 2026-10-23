import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, symlink, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileDesign, generate } from '../design/generate.mts';

// A small independent contract keeps legitimate edits to the user's identity from breaking fixtures.
const contract = `---
name: Fixture Identity
colors:
  primary: '#296e59'
  primary-dark: '#6ec2a1'
  on-primary: '#ffffff'
  on-primary-dark: '#14251d'
typography:
  subject:
    fontFamily: 'ui-serif, Georgia, serif'
    fontSize: 24px
    fontWeight: 500
  body:
    fontFamily: 'system-ui, sans-serif'
    fontSize: 15px
    fontWeight: 400
    lineHeight: '1.65'
rounded:
  control: 8px
spacing:
  md: 12px
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
  button-primary-dark:
    backgroundColor: '{colors.primary-dark}'
    textColor: '{colors.on-primary-dark}'
---
## Overview
An independent, portable fixture.
`;

describe('portable design application', () => {
  it('carries an edited identity into both appearances and native font roles', () => {
    const source = contract.replace('#296e59', '#245b80').replace('#6ec2a1', '#8ac9e8');
    const result = compileDesign(source, { native: true });
    expect(result.css).toContain('light-dark(#245b80, #8ac9e8)');
    expect(result.css).toContain('--design-leading-body: 1.65;');
    expect(result.swift).toContain('design: .serif');
    expect(result.swift).toContain('design: .default');
    expect(JSON.parse(result.typescript.split(' = ')[1]!.split(' as const')[0]!).primary).toBe(
      '#245b80',
    );
    expect(result.hash).not.toBe(compileDesign(contract).hash);
  });

  it('rejects broken references, unreadable text and unsupported native font mappings', () => {
    expect(() => compileDesign(contract.replace('{colors.primary}', '{colors.missing}'))).toThrow();
    expect(() => compileDesign(contract.replace('#ffffff', '#296e59'))).toThrow(/contrast/i);
    expect(() =>
      compileDesign(contract.replace('ui-serif, Georgia, serif', 'CustomBrandFont'), {
        native: true,
      }),
    ).toThrow(/map this font/);
  });

  it('applies to an unrelated project and detects stale artifacts without rewriting them', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'saul-design-'));
    try {
      const source = path.join(root, 'DESIGN.md');
      const css = path.join(root, 'assets/theme.css');
      await writeFile(source, contract.replace('Fixture Identity', 'Another Project'));
      const args = { source, outputs: [{ type: 'css' as const, path: css }] };
      await generate(args);
      const original = await readFile(css, 'utf8');
      await generate({ ...args, check: true });
      await writeFile(source, contract.replace('#296e59', '#245b80'));
      await expect(generate({ ...args, check: true })).rejects.toThrow(/stale/);
      expect(await readFile(css, 'utf8')).toBe(original);
      await generate(args);
      expect(await readFile(css, 'utf8')).toContain('light-dark(#245b80, #6ec2a1)');
      await expect(generate({ source, outputs: [{ type: 'css', path: source }] })).rejects.toThrow(
        /must not replace/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('protects the authoring contract from aliased output paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'saul-design-alias-'));
    try {
      const source = path.join(root, 'DESIGN.md');
      await writeFile(source, contract);
      for (const [name, alias] of [
        ['symbolic', symlink],
        ['hard', link],
      ] as const) {
        const output = path.join(root, `${name}.css`);
        await alias(source, output);
        await expect(
          generate({ source, outputs: [{ type: 'css', path: output }] }),
        ).rejects.toThrow(/replace|alias/);
        expect(await readFile(source, 'utf8')).toBe(contract);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('escapes Swift keywords and rejects conflicting native member names', () => {
    const keyword = compileDesign(
      contract
        .replace('  primary:', '  class:')
        .replace('{colors.primary}', '{colors.class}')
        .replace('  primary-dark:', '  class-dark:')
        .replace('{colors.primary-dark}', '{colors.class-dark}'),
      { native: true },
    );
    expect(keyword.swift).toContain('static let `class`');
    const collision = contract
      .replace('  primary:', '  body:')
      .replace('{colors.primary}', '{colors.body}')
      .replace('  primary-dark:', '  body-dark:')
      .replace('{colors.primary-dark}', '{colors.body-dark}');
    expect(() => compileDesign(collision, { native: true })).toThrow(/collide/);
  });
});
