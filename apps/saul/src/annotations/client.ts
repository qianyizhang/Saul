import type { AnnotationAttempt } from './attempts';
import type { AnnotationCapture, AnnotationOperation, AnnotationResult } from './contract';
import type { ModelPreset } from '../configuration/definition';
import type { CallChoice } from '../calls/contract';
import type { Reply } from '../types/storage';

type WorkspaceOperation<Q, R> = { input: Q; result: R };
type Operations = {
  operate: WorkspaceOperation<{ url: string; operation: AnnotationOperation }, AnnotationResult>;
  attempts: WorkspaceOperation<{ annotationId: string }, AnnotationAttempt[]>;
  inspect: WorkspaceOperation<{ id: string }, AnnotationAttempt[]>;
  stop: WorkspaceOperation<{ id: string }, void>;
  open: WorkspaceOperation<{ id?: string }, void>;
  capture: WorkspaceOperation<
    { capture: AnnotationCapture },
    AnnotationResult & { panelError?: string }
  >;
  choices: WorkspaceOperation<object, { presets: ModelPreset[]; calls: CallChoice[] }>;
  'start-capture': WorkspaceOperation<object, void>;
  'page-markers': WorkspaceOperation<object, AnnotationResult>;
  respond: WorkspaceOperation<
    {
      options: {
        url: string;
        ids: string[];
        presetId: string;
        textOnly: boolean;
        current: boolean;
        callRevision?: string;
      };
    },
    { ids: string[] }
  >;
};

export async function annotationMessage<K extends keyof Operations>(
  message: { action: K } & Operations[K]['input'],
): Promise<Operations[K]['result']> {
  const result: Reply<Operations[K]['result']> | undefined = await chrome.runtime.sendMessage({
    target: 'saul-annotation',
    ...message,
  });
  if (!result?.success) throw new Error(result?.error || 'Annotation service did not respond.');
  return result.result;
}

export const annotations = (url: string, operation: AnnotationOperation) =>
  annotationMessage({ action: 'operate', url, operation });
export const attempts = (annotationId: string) =>
  annotationMessage({ action: 'attempts', annotationId });
