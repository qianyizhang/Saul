import { AnnotationRunner } from '../../src/annotations/runner';
import { DigestRunner } from '../../src/calls/execution/batch-runner';
import { captureSummarySource } from '../../src/calls/capture/source';
import { sharedDb as db } from '../../src/storage/history';
import type { RunnerRequest } from '../../src/platform/chrome/runner';
import { ReadingRunner } from '../../src/reading/runner';
import { backgroundSender } from '../../src/platform/chrome/sender';
import { CallEditor } from '../../src/calls/editor';
import { callEditorStorage, prepareCallPreset } from '../../src/calls/editor-client';

const changed = (url: string) => {
  void chrome.runtime.sendMessage({ target: 'saul-events', url }).catch(() => undefined);
};
const annotations = new AnnotationRunner(db, undefined, undefined, (url) => {
  void chrome.runtime
    .sendMessage({ target: 'saul-annotation', action: 'updated', url })
    .catch(() => undefined);
});
const digest = new DigestRunner(db, captureSummarySource);
// Chrome offscreen documents expose runtime only. Trusted storage stays behind the background.
const callEditor = new CallEditor({ db, storage: callEditorStorage, prepare: prepareCallPreset });
const runner = new ReadingRunner(db, changed);
chrome.runtime.onMessage.addListener(
  (message: RunnerRequest & { target?: string }, sender, reply) => {
    if (message?.target !== 'saul-offscreen') return false;
    if (!backgroundSender(sender)) {
      reply({ success: false, error: 'Background only' });
      return false;
    }
    (async () => {
      switch (message.operation) {
        case 'annotation':
          return annotations.request(message.message, message.prepared);
        case 'digest':
          return digest.request(message.message, message.snapshot, message.credential);
        case 'action':
          return callEditor.request(message.message);
        case 'submit':
          return runner.submit(message.submission, message.credential);
        case 'stop':
          return runner.stop(message.selectionId);
        case 'delete':
          return runner.remove(message.selectionId);
        case 'db': {
          const request = message.message;
          switch (request.type) {
            case 'DB_ANNOTATION':
              return annotations.operate(request.payload);
            case 'DB_ANNOTATION_STATUS':
              return annotations.observedStatus(request.payload);
            case 'DB_ANNOTATION_URLS':
            case 'DB_ANNOTATION_IMAGE':
              return db(request);
            case 'DB_DIGEST_GET':
              return digest.request({ action: 'get', id: request.payload.id });
            case 'DB_READING_RESOLVE':
              return runner.resolveReuse(request.payload);
            case 'DB_VIEW':
            case 'DB_SET_BOOKMARK':
              return runner.updateReadState(request);
            case 'DB_GET_HISTORY':
            case 'DB_RUNS':
            case 'DB_PAGE':
            case 'DB_PASSAGE':
            case 'DB_CONTEXT':
            case 'DB_INPUT':
            case 'DB_IMAGE':
            case 'DB_UNREAD':
            case 'DB_EXPORT_MARKDOWN':
              return runner.query(request);
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
  },
);
