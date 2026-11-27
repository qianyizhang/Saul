import type { Reply } from '../../shared/protocol/history-types.ts';

export const NATIVE_RECONNECT = 'NATIVE_RECONNECT';
export type NativeReconnectReply = { success: true } | { success: false; error: string };
export const HISTORY_IDENTITY_TARGET = 'saul-history-identity';
export type HistoryIdentityReply = Reply<string>;
export const CREDENTIAL_MODE_TARGET = 'saul-credential-mode';
export type CredentialModeResult = { mode: 'standalone' | 'saul' | 'disconnected' };

export async function reconnectNative() {
  const reply: NativeReconnectReply | undefined = await chrome.runtime.sendMessage({
    type: NATIVE_RECONNECT,
  });
  if (!reply?.success) throw new Error(reply?.error || 'Reconnect failed');
}
