import type { AnnotationRequest, AnnotationResult } from './contract';
export interface AnnotationAttempt {
  id: string;
  annotationId: string;
  url: string;
  revision: number;
  status: 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'unsaved';
  createdAt: number;
  input: import('../types/storage').RunInput;
  evidence: string;
  image?: string;
  raw: string;
  calls?: { instructions: string; input: string; raw: string; complete: boolean }[];
  error?: string;
  callRevision?: string;
  currentText?: string;
}
export interface AnnotationDbOperations {
  DB_ANNOTATION_IMAGE: { payload: { id: string; image?: string; error?: string }; result: void };
  DB_ANNOTATION: { payload: AnnotationRequest; result: AnnotationResult };
  DB_ANNOTATION_ATTEMPT: {
    payload: {
      action: 'save' | 'read' | 'recover';
      attempt?: AnnotationAttempt;
      id?: string;
      annotationId?: string;
    };
    result: AnnotationAttempt[];
  };
}
