import { errorCode } from './value.mts';
import { readFileSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Installed generations retain the original credential directory; source execution keeps its existing default. */
export function chatgptDirectory(moduleUrl: string | URL) {
  const directory = dirname(fileURLToPath(moduleUrl));
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(join(directory, 'installation-root.json'), 'utf8'));
  } catch (error) {
    if (
      errorCode(error) === 'ENOENT' &&
      !/[/\\]generations[/\\]g-[a-f\d-]{36}[/\\]chatgpt$/.test(directory)
    )
      return join(directory, '..', 'chatgpt');
    throw new Error('Invalid helper installation data root.', { cause: error });
  }
  if (metadata?.version !== 1 || !isAbsolute(metadata.root ?? ''))
    throw new Error('Invalid helper installation data root.');
  return join(metadata.root, 'chatgpt');
}
