import type { Reply } from '../../../shared/protocol/history-types.ts';

export async function request<T>(
  message: unknown,
  unavailable = 'Saul did not respond. Reload the extension and retry.',
): Promise<T> {
  const reply: Reply<T> | undefined = await chrome.runtime.sendMessage(message);
  if (!reply) throw new Error(unavailable);
  if (!reply.success) throw new Error(reply.error || unavailable);
  return reply.result;
}
