import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

type NativeCheck = 'design' | 'core' | 'state' | 'credentials' | 'install';
type Plan = Record<'docs' | 'smoke' | 'native' | NativeCheck, boolean>;

const docsFile =
  /^(?:(?:docs|apps\/(?:saul|ez)\/docs)\/.+\.md|(?:apps\/(?:saul|ez)\/)?(?:AGENTS|GLOSSARY|README|CONTRIBUTING)\.md)$/u;
const workspaceTooling =
  /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|eslint\.config\.mjs|tsconfig\.json|vitest\.config\.ts)$/u;

const nativePaths = [
  [/^apps\/ez\/(?:Sources\/EZ\/|Tests\/EZ(?:State|UI)Checks\/)/u, ['state']],
  [/^apps\/ez\/(?:Sources\/EZCore\/|Tests\/EZChecks\/)/u, ['core', 'state']],
  [/^apps\/ez\/(?:scripts\/|Resources\/|integrations\/|Tests\/Tooling\/)/u, ['install']],
  [/^apps\/ez\/Tests\/Previews\//u, []],
] as const satisfies ReadonlyArray<readonly [RegExp, readonly NativeCheck[]]>;

const fullPlan: Plan = {
  docs: false,
  smoke: true,
  native: true,
  design: true,
  core: true,
  state: true,
  credentials: true,
  install: true,
};

export function selectChecks(paths: readonly string[] | undefined): Plan {
  if (!paths?.length) return { ...fullPlan };
  const plan: Plan = {
    docs: true,
    smoke: false,
    native: false,
    design: false,
    core: false,
    state: false,
    credentials: false,
    install: false,
  };
  for (const path of paths) {
    if (docsFile.test(path)) continue;
    plan.docs = false;
    if (path.startsWith('apps/saul/') || workspaceTooling.test(path)) {
      plan.smoke = true;
      continue;
    }
    if (path.startsWith('native/credentials/')) {
      // These boundaries are consumed by both applications.
      plan.smoke = plan.native = plan.credentials = true;
      if (
        /^native\/credentials\/(?:Package\.swift|Sources\/Saul(?:NativeValues|CredentialClient)\/|Tests\/Support\/)/u.test(
          path,
        )
      ) {
        plan.core = plan.state = true;
      }
      // Core's provider adapter integration tests drive the real owner from EZ.
      if (
        /^native\/credentials\/(?:Sources\/SaulCredentialOwner\/|Tests\/OwnerSupport\/)/u.test(path)
      ) {
        plan.core = true;
      }
      continue;
    }
    const rule = nativePaths.find(([pattern]) => pattern.test(path));
    if (rule) {
      plan.native = true;
      for (const check of rule[1]) plan[check] = true;
      continue;
    }
    // Unknown or shared inputs (including design, contracts and CI itself) run both lanes.
    return { ...fullPlan };
  }
  return plan;
}

export function pullRequestPaths(
  base: string | undefined,
  cwd = process.cwd(),
): string[] | undefined {
  if (!base || !/^[a-f0-9]{40}$/u.test(base)) return undefined;
  try {
    // Compare the exact checked-out merge tree against its first parent. Deletion and
    // rename-out paths must count, even when the destination would select fewer checks.
    const parent = execFileSync('git', ['rev-parse', 'HEAD^1'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (parent !== base) return undefined;
    const diff = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new TextDecoder('utf-8', { fatal: true }).decode(diff).split('\0').filter(Boolean);
  } catch {
    return undefined;
  }
}

if (import.meta.main) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error('Missing GITHUB_OUTPUT');
  const paths = pullRequestPaths(process.env.PR_BASE_SHA);
  const plan = selectChecks(paths);
  if (!paths?.length) console.log('No reliable PR diff; selecting both platforms.');
  for (const [key, selected] of Object.entries(plan)) {
    console.log(`${key}=${selected}`);
    appendFileSync(output, `${key}=${selected}\n`);
  }
}
