import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pullRequestPaths, selectChecks } from '../scripts/ci-scope.mts';

describe('PR check scope', () => {
  it('does not provision Chromium or macOS for documentation edits', () => {
    expect(selectChecks(['README.md', 'apps/ez/docs/releasing.md'])).toMatchObject({
      docs: true,
      smoke: false,
      native: false,
    });
  });

  it('keeps browser and workspace dependency changes on Linux', () => {
    expect(
      selectChecks(['package.json', 'pnpm-lock.yaml', 'apps/saul/package.json', 'docs/setup.md']),
    ).toMatchObject({ docs: false, smoke: true, native: false });
  });

  it('checks native state or installation only when those inputs change', () => {
    expect(selectChecks(['apps/ez/Sources/EZ/Lookup/LookupDraft.swift'])).toMatchObject({
      smoke: false,
      native: true,
      state: true,
      install: false,
    });
    expect(selectChecks(['apps/ez/scripts/install-app.sh'])).toMatchObject({
      smoke: false,
      native: true,
      state: false,
      install: true,
    });
  });

  it('combines both apps for shared inputs and when the diff cannot be trusted', () => {
    expect(selectChecks(['native/credentials/Package.swift'])).toMatchObject({
      smoke: true,
      native: true,
      credentials: true,
    });
    for (const paths of [undefined, [], ['design/tokens.md'], ['.github/workflows/pr.yml']]) {
      expect(selectChecks(paths)).toMatchObject({
        docs: false,
        smoke: true,
        native: true,
        design: true,
        credentials: true,
      });
    }
  });

  it('selects the extracted credential checks and their EZ consumers', () => {
    expect(
      selectChecks(['native/credentials/Sources/SaulCredentialOwner/ConnectionCatalogOwner.swift']),
    ).toMatchObject({ credentials: true, core: true, state: false });
    expect(
      selectChecks(['native/credentials/Sources/SaulNativeValues/ConnectionCatalog.swift']),
    ).toMatchObject({ credentials: true, core: true, state: true });
    for (const path of [
      'native/credentials/Sources/CSQLite/module.modulemap',
      'native/credentials/Sources/SaulConnectionCoordination/ConnectionCoordination.swift',
    ]) {
      expect(selectChecks([path])).toMatchObject({ credentials: true, core: true, state: true });
    }
    expect(
      selectChecks(['native/credentials/Tests/CredentialOwnerChecks/PlanCatalogChecks.swift']),
    ).toMatchObject({ credentials: true, core: false, state: false });
  });

  it('keeps both paths when production code is renamed out to a docs directory', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'saul-ci-scope-'));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.test', ...args],
        {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ).trim();
    try {
      git('init', '-b', 'main');
      mkdirSync(join(cwd, 'apps/ez/Sources/EZ'), { recursive: true });
      writeFileSync(join(cwd, 'apps/ez/Sources/EZ/Example.swift'), 'struct Example {}\n');
      git('add', '.');
      git('commit', '-m', 'Base');
      const base = git('rev-parse', 'HEAD');
      git('switch', '-c', 'topic');
      mkdirSync(join(cwd, 'docs'));
      renameSync(join(cwd, 'apps/ez/Sources/EZ/Example.swift'), join(cwd, 'docs/example.md'));
      git('add', '-A');
      git('commit', '-m', 'Rename out of the app');
      git('switch', 'main');
      git('merge', '--no-ff', '--no-edit', 'topic');
      const paths = pullRequestPaths(base, cwd);
      expect(paths).toEqual(['apps/ez/Sources/EZ/Example.swift', 'docs/example.md']);
      expect(selectChecks(paths)).toMatchObject({ docs: false, native: true, state: true });
      expect(pullRequestPaths(git('rev-parse', 'HEAD^2'), cwd)).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('PR verdict', () => {
  const env = {
    SCOPE_RESULT: 'success',
    CHECKS_RESULT: 'success',
    SMOKE_SELECTED: 'true',
    SMOKE_RESULT: 'success',
    NATIVE_SELECTED: 'false',
    NATIVE_RESULT: 'skipped',
  };
  const verdict = (values: NodeJS.ProcessEnv) =>
    spawnSync('bash', ['scripts/ci-verdict.sh'], {
      env: { ...process.env, ...env, ...values },
      encoding: 'utf8',
    });

  it('reports expected skips and successful selected jobs', () => {
    const result = verdict({});
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('macOS checks: skipped (outside PR scope)');
  });

  it.each([
    { SMOKE_RESULT: 'skipped' },
    { NATIVE_SELECTED: 'true', NATIVE_RESULT: 'cancelled' },
    { NATIVE_SELECTED: '' },
    { CHECKS_RESULT: 'failure' },
    { SCOPE_RESULT: 'failure' },
  ])('rejects missing, failed, or unexpected job results: %j', (values) => {
    expect(verdict(values).status).toBe(1);
  });
});
