import type { FullConfig } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createSandbox } from './support.ts';

// Run once before any tests, including focused runs. A startup failure must not
// cause every test to launch another browser under the same broken conditions.
export default async function browserPreflight(config: FullConfig) {
  const project = config.projects[0];
  if (!project) throw new Error('Browser startup check requires a configured Playwright project.');
  const artifactsDir = path.join(project.outputDir, 'browser-preflight');
  const sandbox = await createSandbox({ headless: !process.env.HEADED, artifactsDir });
  let failed = true;
  try {
    await sandbox.launch();
    failed = false;
  } catch (cause) {
    await writeFile(
      path.join(artifactsDir, 'startup-error.log'),
      cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
    ).catch(() => {}); // Preserve the startup error even if diagnostics cannot be written.
    throw new Error(
      'Browser startup check failed; the suite did not run. Inspect the original error ' +
        'before retrying. On macOS, LaunchServices/WindowServer permission denials or ' +
        'an immediate registration abort can require approved execution outside the ' +
        'command sandbox. Keep the disposable profile; do not retry unchanged. ' +
        `Diagnostics: ${artifactsDir}`,
      { cause },
    );
  } finally {
    await sandbox.close(failed);
  }
}
