import { requestConnection } from '../src/connections/client';
import type { ConnectionResult } from '../src/connections/messages';
import type { DeepDiveMessage, DeepDiveResults } from '../src/deep-dives/model';

export function checkConnectionMessages() {
  const catalog: Promise<ConnectionResult<'accounts'>> = requestConnection({ action: 'accounts' });
  // @ts-expect-error A release needs its setup fence.
  requestConnection({ action: 'release', id: 'setup' });
  // @ts-expect-error An account list requires the accounts field.
  const wrong: ConnectionResult<'accounts'> = { items: [] };
  return { catalog, wrong };
}

export function checkDeepDiveMessages() {
  // @ts-expect-error Deep Dive operations have their own Chrome target.
  const route: DeepDiveMessage = { target: 'saul-connection', message: { action: 'list' } };
  const input: DeepDiveMessage = {
    target: 'saul-deep-dives',
    // @ts-expect-error Saving an instruction requires the expected value.
    message: { action: 'save-instruction', value: 'new' },
  };
  // @ts-expect-error The instruction result is text.
  const output: DeepDiveResults['instruction'] = { value: 'new' };
  return { route, input, output };
}
