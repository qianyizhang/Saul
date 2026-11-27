import type { AnnotationOperation } from '../../shared/protocol/annotations.ts';
import { request } from '../platform/chrome/messages';
import {
  ANNOTATION_TARGET,
  type AnnotationMessage,
  type AnnotationAction,
  type AnnotationReply,
  type AnnotationRequestFor,
} from './messages';

export function annotationMessage<K extends AnnotationAction>(
  message: AnnotationRequestFor<K>,
): Promise<AnnotationReply<K>>;
export async function annotationMessage(
  message: AnnotationRequestFor,
): Promise<AnnotationReply<AnnotationAction>> {
  return request(
    { target: ANNOTATION_TARGET, ...message } satisfies AnnotationMessage,
    'Annotation service did not respond.',
  );
}

export const annotations = (url: string, operation: AnnotationOperation) =>
  annotationMessage({ action: 'operate', url, operation });
