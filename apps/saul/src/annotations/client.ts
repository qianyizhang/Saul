import type {
  AnnotationAttempt,
  AnnotationEditorStatus,
  AnnotationStatusRequest,
} from '../../shared/protocol/annotation-attempts.ts';
import type {
  AnnotationCapture,
  AnnotationChange,
  AnnotationOperation,
  AnnotationResult,
  ReviewedAnnotation,
} from '../../shared/protocol/annotations.ts';
import type { ModelPreset } from '../../shared/model/presets.ts';
import type { CallChoice } from '../../shared/model/custom-call.ts';
import { request } from '../platform/chrome/messages';
import type { AnnotationDraftMutation } from './draft';

type WorkspaceOperation<Q, R> = { input: Q; result: R };
type Operations = {
  'page-index': WorkspaceOperation<
    { url: string; tabId: number; filter: 'open' | 'all' | 'deleted' | 'done' },
    AnnotationResult
  >;
  'card-read': WorkspaceOperation<{ url: string; id: string }, AnnotationResult>;
  'card-change': WorkspaceOperation<{ url: string; change: AnnotationChange }, AnnotationResult>;
  operate: WorkspaceOperation<{ url: string; operation: AnnotationOperation }, AnnotationResult>;
  status: WorkspaceOperation<AnnotationStatusRequest, AnnotationEditorStatus>;
  draft: WorkspaceOperation<{ mutation: AnnotationDraftMutation }, void>;
  inspect: WorkspaceOperation<{ id: string }, AnnotationAttempt[]>;
  stop: WorkspaceOperation<{ id: string }, void>;
  open: WorkspaceOperation<{ id?: string }, void>;
  capture: WorkspaceOperation<{ capture: AnnotationCapture }, AnnotationResult>;
  choices: WorkspaceOperation<object, { presets: ModelPreset[]; calls: CallChoice[] }>;
  'start-capture': WorkspaceOperation<object, void>;
  'page-markers': WorkspaceOperation<object, AnnotationResult>;
  respond: WorkspaceOperation<
    {
      options: {
        url: string;
        targets: ReviewedAnnotation[];
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
  return request({ target: 'saul-annotation', ...message }, 'Annotation service did not respond.');
}

export const annotations = (url: string, operation: AnnotationOperation) =>
  annotationMessage({ action: 'operate', url, operation });
