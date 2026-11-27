import type {
  AnnotationAttempt,
  AnnotationEditorStatus,
  AnnotationStatusRequest,
} from '../../shared/protocol/annotation-attempts.ts';
import type {
  Annotation,
  AnnotationCapture,
  AnnotationChange,
  AnnotationOperation,
  AnnotationResult,
  ReviewedAnnotation,
} from '../../shared/protocol/annotations.ts';
import type { ModelPreset } from '../../shared/model/presets.ts';
import type { ActionChoice } from '../../shared/model/custom-action.ts';
import type { AnnotationDraftMutation } from './draft';

type WorkspaceOperation<Q, R> = { input: Q; result: R };
export type AnnotationOperations = {
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
  choices: WorkspaceOperation<object, { presets: ModelPreset[]; calls: ActionChoice[] }>;
  'start-capture': WorkspaceOperation<object, Record<string, never>>;
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

export const ANNOTATION_TARGET = 'saul-annotation';
export type AnnotationAction = keyof AnnotationOperations;
export type AnnotationRequestFor<K extends AnnotationAction = AnnotationAction> = {
  [P in K]: { action: P } & AnnotationOperations[P]['input'];
}[K];
export type AnnotationReply<K extends AnnotationAction> = AnnotationOperations[K]['result'];
export type AnnotationMessage = { target: typeof ANNOTATION_TARGET } & (
  AnnotationRequestFor | { action: 'updated'; url: string }
);

type TargetForReview = Pick<Annotation, 'id' | 'url' | 'title' | 'target' | 'comment'>;
type AnnotationTabOperations = {
  SAUL_ANNOTATION_STATE: { input: object; result: string };
  SAUL_ANNOTATION_URLS: { input: { url: string; urls: string[] }; result: { urls: string[] } };
  SAUL_ANNOTATIONS_CHANGED: { input: object; result: undefined };
  SAUL_ANNOTATE: { input: { fromPanel?: boolean }; result: Record<string, never> };
  SAUL_ANNOTATION_REVIEW: {
    input: { annotation: TargetForReview };
    result: { available: boolean } | undefined;
  };
  SAUL_ANNOTATION_LOCATE: {
    input: { annotation: Pick<Annotation, 'url' | 'target'> };
    result: { available: boolean } | undefined;
  };
};
type AnnotationTabAction = keyof AnnotationTabOperations;
type AnnotationTabMessage = {
  [K in AnnotationTabAction]: { type: K } & AnnotationTabOperations[K]['input'];
}[AnnotationTabAction];
export type AnnotationTabReply<K extends AnnotationTabAction> =
  AnnotationTabOperations[K]['result'];

export async function sendAnnotationTab<T extends AnnotationTabMessage>(
  tabId: number,
  message: T,
  options?: chrome.tabs.MessageSendOptions,
): Promise<AnnotationTabReply<T['type']>> {
  return options
    ? chrome.tabs.sendMessage(tabId, message, options)
    : chrome.tabs.sendMessage(tabId, message);
}
