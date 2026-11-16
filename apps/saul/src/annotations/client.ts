import type { AnnotationAttempt } from './attempts';
import type { AnnotationOperation, AnnotationResult } from './contract';
export async function annotationMessage<T>(message: Record<string, unknown>): Promise<T> {
  const result = await chrome.runtime.sendMessage({ target: 'saul-annotation', ...message });
  if (!result?.success) throw new Error(result?.error || 'Annotation service did not respond.');
  return result.result;
}
export const annotations = (url: string, operation: AnnotationOperation) =>
  annotationMessage<AnnotationResult>({ action: 'operate', url, operation });
export const attempts = (annotationId: string) =>
  annotationMessage<AnnotationAttempt[]>({ action: 'attempts', annotationId });
