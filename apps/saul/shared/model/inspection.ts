import type { RunInput, RunResult } from '../protocol/history-types.ts';

// Only model text belongs on reading surfaces; never project connection/account settings.
export function inspectionInput(input: RunInput): NonNullable<RunResult['inspection']> {
  const { selection, pageTitle, pageUrl, heading, paragraph, surroundingText } = input.context;
  return {
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    ...(input.followUpQuestion ? { followUpQuestion: input.followUpQuestion } : {}),
    context: { selection, pageTitle, pageUrl, heading, paragraph, surroundingText },
  };
}
