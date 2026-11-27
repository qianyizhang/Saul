import {
  OPEN_SOURCE_TARGET,
  READING_TARGET,
  type ReadingMessage,
  type ReadingRequest,
  type ReadingResultFor,
} from './contract';
import { request } from '../platform/chrome/messages';

export function sendReadingMessage<T extends ReadingRequest>(
  message: T,
): Promise<ReadingResultFor<T>> {
  return request({ target: READING_TARGET, message } satisfies ReadingMessage);
}
export async function openHistorySource(selectionId: string): Promise<void> {
  await request({ target: OPEN_SOURCE_TARGET, selectionId } satisfies ReadingMessage);
}
