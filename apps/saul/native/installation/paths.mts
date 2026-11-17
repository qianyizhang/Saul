import { errorCode } from '../../shared/model/value.mts';
import { readFileSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve the action revisions outside the immutable helper generation. */
export function actionRevisionDirectory(moduleUrl: string | URL) {
  const file = fileURLToPath(moduleUrl);
  const directory = dirname(file);
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(join(directory, 'installation-root.json'), 'utf8'));
  } catch (error) {
    if (
      errorCode(error) === 'ENOENT' &&
      !/[/\\]generations[/\\]g-[a-f\d-]{36}[/\\]actions$/.test(directory)
    )
      return join(directory, file.endsWith('.mts') ? '../..' : '..', 'actions', 'revisions');
    throw new Error('Invalid helper installation data root.', { cause: error });
  }
  if (metadata?.version !== 1 || !isAbsolute(metadata.root ?? ''))
    throw new Error('Invalid helper installation data root.');
  return join(metadata.root, 'actions', 'revisions');
}
