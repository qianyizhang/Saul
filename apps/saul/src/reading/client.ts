import type { ReadingRequest, ReadingResultFor } from './contract';
import { request } from '../platform/chrome/messages';

export function sendReadingMessage<T extends ReadingRequest>(
  message: T,
): Promise<ReadingResultFor<T>> {
  return request({ target: 'saul-reading', message });
}
export async function openHistorySource(selectionId: string): Promise<void> {
  await request({ target: 'saul-open-source', selectionId });
}
