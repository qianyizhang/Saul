import { requestConnection } from '../src/connections/client';
import type { ConnectionResult } from '../src/connections/messages';
import type { DeepDiveMessage, DeepDiveResults } from '../src/deep-dives/model';
import { sendAnnotationTab, type AnnotationTabReply } from '../src/annotations/messages';
import type { OpenSourceMessage, OpenSourceReply } from '../src/reading/contract';
import type { ActionHostResult, ActionWorkerMessage } from '../shared/protocol/action-protocol.mts';
import { actionHost } from '../src/custom-actions/host-client';
import type { SpeechEvent } from '../src/speech/realtime';

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

export function checkTabMessages() {
  const state: Promise<string> = sendAnnotationTab(1, { type: 'SAUL_ANNOTATION_STATE' });
  // @ts-expect-error URL confirmation requires the current URL and the candidate URLs.
  sendAnnotationTab(1, { type: 'SAUL_ANNOTATION_URLS', urls: [] });
  // @ts-expect-error The viewport acknowledgement is encoded as JSON text on the wire.
  const wrong: AnnotationTabReply<'SAUL_ANNOTATION_STATE'> = { url: 'https://example.test/' };
  // @ts-expect-error The reading source message requires a selection ID.
  const reopen: OpenSourceMessage = { type: 'SAUL_OPEN' };
  // @ts-expect-error A reading source acknowledgement contains a boolean.
  const receipt: OpenSourceReply = { received: 'yes' };
  return { state, wrong, reopen, receipt };
}

export function checkPortMessages() {
  const result: Promise<{ type: 'result'; text: string }> = actionHost({
    action: 'run',
    revision: 'example',
    source: { title: 'Article', url: 'https://example.test/', coverage: 'Visible text' },
  });
  // @ts-expect-error Model callbacks cannot omit both the value and error.
  const worker: ActionWorkerMessage = { id: 'run', callId: 1 };
  // @ts-expect-error Run requires terminal text.
  const terminal: ActionHostResult<{ action: 'run'; revision: string; source: never }> = {
    type: 'result',
  };
  // @ts-expect-error The speech reply must be a supported audio format.
  const speech: SpeechEvent = { result: { audioBase64: '', mimeType: 'audio/mp3' } };
  return { result, worker, terminal, speech };
}
