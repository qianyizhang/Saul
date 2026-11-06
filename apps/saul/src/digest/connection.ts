import type { UserSettings } from '../types';
import type { PlanAccount } from '../../native/plan-protocol.mts';

export interface SummaryConnection {
  key: string;
  name: string;
  accountId?: string;
  available: boolean;
}

/** Public connections own managed selection; standalone installations retain local accounts. */
export function summaryConnections(settings: UserSettings, accounts: PlanAccount[]) {
  const eligible = accounts.filter((a) => a.signedIn && a.planEnabled);
  const managed = settings.sharedCredentials === 'saul';
  const choices: SummaryConnection[] = managed
    ? settings.connections
        .filter((c) => c.kind === 'chatgpt-plan')
        .map((c) => ({
          key: c.key,
          name: c.name,
          accountId: c.accountId,
          available: eligible.some((a) => a.id === c.accountId),
        }))
    : eligible.map((a) => ({ key: a.id, name: a.label, accountId: a.id, available: true }));
  if (settings.sharedCredentials === 'disconnected')
    return {
      managed,
      choices: [],
      chosen: '',
      error: 'Connect this app in Settings → Preferences → Integrations.',
    };
  const saved = managed ? settings.summaryConnectionKey : settings.chatgptPlan?.accountId;
  // A saved unavailable choice must never fall through to another account.
  if (saved) {
    const choice = choices.find((c) => c.key === saved);
    return {
      managed,
      choices,
      chosen: choice?.available ? saved : '',
      error: choice?.available
        ? ''
        : 'The saved summary connection is unavailable. Repair it in Connections or choose another connection.',
    };
  }
  const preferred = managed ? choices.find((c) => c.key === 'gpt-plan') : undefined;
  const chosen = preferred
    ? preferred.available
      ? preferred.key
      : ''
    : choices.length === 1 && choices[0]!.available
      ? choices[0]!.key
      : '';
  return {
    managed,
    choices,
    chosen,
    error: choices.some((c) => c.available)
      ? ''
      : 'Sign in with ChatGPT and enable plan usage in Connections to summarize tabs.',
  };
}

/** Check the binding again at admission; an editor's stale account must not retarget a new run. */
export function validateSummaryConnection(settings: UserSettings, accountId: string, key?: string) {
  if (settings.sharedCredentials === 'disconnected')
    throw new Error('Connect this app in Settings → Preferences → Integrations.');
  if (settings.sharedCredentials !== 'saul') {
    if (key !== undefined)
      throw new Error('The summary credential route changed. Reopen Call Saul.');
    return;
  }
  const connection = settings.connections.find((c) => c.key === key);
  if (
    !connection ||
    connection.kind !== 'chatgpt-plan' ||
    !connection.accountId ||
    connection.accountId !== accountId
  )
    throw new Error('The summary connection changed. Reopen Call Saul and choose a connection.');
}
