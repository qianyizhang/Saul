import type { Configuration } from '../configuration/definition';
import type { PlanAccount } from '../../native/plan-protocol.mts';

export interface SummaryConnection {
  key: string;
  name: string;
  accountId?: string;
  available: boolean;
}

/** Public connections bind the signed owner’s account selection. */
export function summaryConnections(settings: Configuration, accounts: PlanAccount[]) {
  const eligible = accounts.filter((a) => a.signedIn && a.planEnabled);
  if (settings.sharedCredentials !== 'saul')
    return {
      choices: [],
      chosen: '',
      error: 'Connect this app in Settings → Preferences → Integrations.',
    };
  const choices: SummaryConnection[] = settings.connections
    .filter((c) => c.kind === 'chatgpt-plan')
    .map((c) => ({
      key: c.key,
      name: c.name,
      accountId: c.accountId,
      available: eligible.some((a) => a.id === c.accountId),
    }));
  const saved = settings.summaryConnectionKey;
  // A saved unavailable choice must never fall through to another account.
  if (saved) {
    const choice = choices.find((c) => c.key === saved);
    return {
      choices,
      chosen: choice?.available ? saved : '',
      error: choice?.available
        ? ''
        : 'The saved summary connection is unavailable. Repair it in Connections or choose another connection.',
    };
  }
  // A legacy account choice is not an invitation to select a different
  // shared registration on the first run after connecting.
  if (settings.chatgptPlan?.accountId) {
    return {
      choices,
      chosen: '',
      error: 'Choose a shared connection for this Summary.',
    };
  }
  const preferred = choices.find((c) => c.key === 'gpt-plan');
  const chosen = preferred
    ? preferred.available
      ? preferred.key
      : ''
    : choices.length === 1 && choices[0]!.available
      ? choices[0]!.key
      : '';
  return {
    choices,
    chosen,
    error: choices.some((c) => c.available)
      ? ''
      : 'Sign in with ChatGPT and enable plan usage in Connections to summarize tabs.',
  };
}

/** Check the binding again at admission; an editor's stale account must not retarget a new run. */
export function validateSummaryConnection(
  settings: Configuration,
  accountId: string,
  key?: string,
) {
  if (settings.sharedCredentials !== 'saul')
    throw new Error('Connect this app in Settings → Preferences → Integrations.');
  const connection = settings.connections.find((c) => c.key === key);
  if (
    !connection ||
    connection.kind !== 'chatgpt-plan' ||
    !connection.accountId ||
    connection.accountId !== accountId
  )
    throw new Error('The summary connection changed. Reopen Call Saul and choose a connection.');
}
