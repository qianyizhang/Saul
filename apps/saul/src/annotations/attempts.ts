import type { AnnotationRequest, AnnotationResult } from './contract';
export interface AnnotationAttempt {
  id: string;
  annotationId: string;
  url: string;
  revision: number;
  status: 'queued' | 'running' | 'saving' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  createdAt: number;
  input: import('../providers/request').ModelRequest;
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
    payload:
      | { action: 'admit'; attempts: AnnotationAttempt[] }
      | { action: 'save'; attempt: AnnotationAttempt }
      | { action: 'complete'; attempt: AnnotationAttempt; revision: number }
      | { action: 'read'; id?: string; annotationId?: string }
      | { action: 'recover' };
    result: AnnotationAttempt[];
  };
}
export function activeAnnotationAttempt(attempt: AnnotationAttempt) {
  return ['queued', 'running', 'saving'].includes(attempt.status);
}
