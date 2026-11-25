import type {
  Annotation,
  AnnotationReply,
  AnnotationRequest,
  AnnotationResult,
  AnnotationScope,
} from './annotations.ts';
import { annotationIdSchema, pageUrl } from './annotations.ts';
import { z } from 'zod';
export interface AnnotationAttempt {
  id: string;
  annotationId: string;
  url: string;
  revision: number;
  status: 'queued' | 'running' | 'saving' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  createdAt: number;
  maskedAt?: number;
  input: import('../model/execution-route.ts').ModelRequest;
  evidence: string;
  image?: string;
  raw: string;
  calls?: { instructions: string; input: string; raw: string; complete: boolean }[];
  error?: string;
  callRevision?: string;
  currentText?: string;
}
export interface AnnotationAttemptStatus {
  id: string;
  status: AnnotationAttempt['status'];
  presetName?: string;
  error?: string;
}
export interface AnnotationStatusKey {
  revision: number;
  capture: 'available' | 'unavailable' | 'none';
}
export type AnnotationEditorRecord = Omit<Annotation, 'image' | 'imageError' | 'operations'>;
export type AnnotationEditorCapture =
  { kind: 'available'; image: string } | { kind: 'unavailable'; error: string } | { kind: 'none' };
export type AnnotationEditorStatus =
  | { kind: 'missing' }
  | {
      kind: 'found';
      key: AnnotationStatusKey;
      record?: AnnotationEditorRecord;
      capture?: AnnotationEditorCapture;
      attempts: AnnotationAttemptStatus[];
    };
export const annotationStatusSchema = z
  .object({
    url: pageUrl,
    id: annotationIdSchema,
    visibility: z.literal('masked').optional(),
    known: z
      .object({
        revision: z.number().int().positive(),
        capture: z.enum(['available', 'unavailable', 'none']),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AnnotationStatusRequest = z.infer<typeof annotationStatusSchema>;
export interface AnnotationDbOperations {
  DB_ANNOTATION_ACTIVITY: {
    payload: { annotationId: string; limit?: number; cursor?: string };
    result: { items: AnnotationAttempt[]; cursor?: string };
  };
  DB_ANNOTATION_CONVERSATION: {
    payload: { scope: AnnotationScope; id: string; limit?: number; cursor?: string };
    result: { items: AnnotationReply[]; cursor?: string };
  };
  DB_ANNOTATION_URLS: { payload: { url: string; visibility?: 'masked' }; result: string[] };
  DB_ANNOTATION_IMAGE: { payload: { id: string; image?: string; error?: string }; result: void };
  DB_ANNOTATION: { payload: AnnotationRequest & { external?: true }; result: AnnotationResult };
  DB_ANNOTATION_STATUS: { payload: AnnotationStatusRequest; result: AnnotationEditorStatus };
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
export function activeAnnotationAttempt(attempt: Pick<AnnotationAttempt, 'status'>) {
  return ['queued', 'running', 'saving'].includes(attempt.status);
}
