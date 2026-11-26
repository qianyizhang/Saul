import { compareText, type TextChange } from '../../shared/model/text-change.ts';
export interface InputComparison {
  text?: TextChange;
  fields: string[];
  error?: string;
}
export function compareRunInput(
  before: import('../../shared/protocol/history-types.ts').RunInput,
  after: import('../../shared/protocol/history-types.ts').RunInput,
): InputComparison {
  const fields: string[] = [];
  if (before.systemPrompt !== after.systemPrompt) fields.push('Instructions');
  if (JSON.stringify(before.context) !== JSON.stringify(after.context)) fields.push('Page context');
  const profile = (input: import('../../shared/protocol/history-types.ts').RunInput) =>
    JSON.stringify([
      input.provider,
      input.credentialOwner ?? input.remote.credentialOwner ?? 'local',
      input.preset?.connectionKey,
      input.preset?.profileId,
      input.preset?.imageOptions,
      input.provider === 'chatgpt-plan'
        ? input.plan
        : input.provider === 'chrome-ai'
          ? input.local
          : input.remote,
    ]);
  if (profile(before) !== profile(after)) fields.push('Model settings');
  return { text: compareText(before.userPrompt, after.userPrompt), fields };
}
