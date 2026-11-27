import { ANNOTATION_TARGET, type AnnotationMessage } from '../../src/annotations/messages';
import { READING_EVENTS_TARGET, type ReadingMessage } from '../../src/reading/contract';
import { AnnotationRunner } from '../../src/annotations/runner';
import { holdConnection } from '../../src/connections/credential-hold';
import { CallBatchRunner } from '../../src/calls/execution/batch-runner';
import { captureSummarySource } from '../../src/calls/capture/source';
import { sharedDb as db } from '../../src/storage/history';
import type { DbOperations } from '../../shared/protocol/history-types.ts';
import {
  RUNNER_TARGET,
  validateRunnerRequest,
  type RunnerResult,
} from '../../src/platform/chrome/runner';
import { isRecord } from '../../shared/model/value.mts';
import { ReadingRunner } from '../../src/reading/runner';
import { backgroundSender } from '../../src/platform/chrome/sender';
import { CallEditor } from '../../src/calls/editor';
import { callEditorStorage, prepareCallPreset } from '../../src/calls/editor-client';

const changed = (url: string) => {
  void chrome.runtime
    .sendMessage({ target: READING_EVENTS_TARGET, url } satisfies ReadingMessage)
    .catch(() => undefined);
};
const annotations = new AnnotationRunner(db, undefined, undefined, (url) => {
  void chrome.runtime
    .sendMessage({ target: ANNOTATION_TARGET, action: 'updated', url } satisfies AnnotationMessage)
    .catch(() => undefined);
});
const calls = new CallBatchRunner(db, captureSummarySource, undefined, holdConnection);
// Chrome offscreen documents expose runtime only. Trusted storage stays behind the background.
const callEditor = new CallEditor({ db, storage: callEditorStorage, prepare: prepareCallPreset });
const runner = new ReadingRunner(db, changed);
chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (!isRecord(message) || message.target !== RUNNER_TARGET) return false;
  if (!backgroundSender(sender)) {
    reply({ success: false, error: 'Background only' });
    return false;
  }
  (async () => {
    validateRunnerRequest(message);
    switch (message.operation) {
      case 'annotation':
        return annotations.request(message.message, message.prepared) satisfies Promise<
          RunnerResult<typeof message>
        >;
      case 'digest':
        return calls.request(
          message.message,
          message.snapshot,
          message.credential,
        ) satisfies Promise<RunnerResult<typeof message>>;
      case 'action':
        return callEditor.request(message.message) satisfies Promise<RunnerResult<typeof message>>;
      case 'submit':
        return runner.submit(message.submission, message.credential) satisfies Promise<
          RunnerResult<typeof message>
        >;
      case 'stop':
        return runner.stop(message.selectionId) satisfies Promise<RunnerResult<typeof message>>;
      case 'delete':
        return runner.remove(
          message.selectionId,
          message.expectedRevision,
          message.stopRunId,
        ) satisfies Promise<RunnerResult<typeof message>>;
      case 'db': {
        const request = message.message;
        switch (request.type) {
          case 'DB_ANNOTATION':
            return annotations.operate(request.payload) satisfies Promise<
              DbOperations[typeof request.type]['result']
            >;
          case 'DB_ANNOTATION_STATUS':
            return annotations.observedStatus(request.payload) satisfies Promise<
              DbOperations[typeof request.type]['result']
            >;
          case 'DB_ANNOTATION_URLS':
          case 'DB_ANNOTATION_IMAGE':
            return db(request) satisfies Promise<DbOperations[typeof request.type]['result']>;
          case 'DB_DIGEST_GET':
            return calls.request({ action: 'get', id: request.payload.id }) satisfies Promise<
              DbOperations[typeof request.type]['result']
            >;
          case 'DB_READING_RESOLVE':
            return runner.resolveReuse(request.payload) satisfies Promise<
              DbOperations[typeof request.type]['result']
            >;
          case 'DB_RESTORE_SELECTION':
          case 'DB_PURGE_SELECTION':
          case 'DB_VIEW':
          case 'DB_SET_BOOKMARK':
            return runner.updateReadState(request) satisfies Promise<
              DbOperations[typeof request.type]['result']
            >;
          case 'DB_HISTORY_PAGE':
          case 'DB_GET_HISTORY':
          case 'DB_RUNS':
          case 'DB_PAGE':
          case 'DB_PASSAGE':
          case 'DB_CONTEXT':
          case 'DB_INPUT':
          case 'DB_IMAGE':
          case 'DB_UNREAD':
          case 'DB_EXPORT_MARKDOWN':
            return runner.query(request) satisfies Promise<
              DbOperations[typeof request.type]['result']
            >;
          default:
            throw new Error('Unknown workspace storage operation');
        }
      }
      default:
        throw new Error('Unknown runner operation');
    }
  })().then(
    (result) => reply({ success: true, result }),
    (error) =>
      reply({ success: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
});
