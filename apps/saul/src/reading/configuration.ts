import type { ResolvedContext, UserSettings } from '../types';
import type { RunInput } from '../types/storage';
import { configurationFor, renderRecipePrompt, settingsForPreset } from '../models/configuration';
import { isLoopbackEndpoint, validateProviderSettings } from '../storage/settings';

function credentialForFrozenInput(settings: UserSettings, input: RunInput): string {
  if (input.provider === 'chatgpt-plan') {
    validateProviderSettings({
      ...settings,
      activeProvider: 'chatgpt-plan',
      chatgptPlan: input.plan,
    });
    return '';
  }
  if (input.provider === 'chrome-ai') {
    validateProviderSettings({ ...settings, activeProvider: 'chrome-ai' });
    return '';
  }
  const endpoint = new URL(input.remote.baseUrl);
  if (!input.preset) {
    if (isLoopbackEndpoint(endpoint)) return '';
    throw new Error(
      'This older request has no saved connection reference. Select the text and choose an action to run again.',
    );
  }
  const connection = settingsForPreset(settings, input.preset);
  const currentEndpoint = validateProviderSettings(connection)!;
  if (currentEndpoint.href !== endpoint.href)
    throw new Error(
      'The saved connection endpoint has changed. Choose a recipe to create a new request.',
    );
  const key = connection.openaiCompatible.apiKey;
  if (!key && !isLoopbackEndpoint(endpoint))
    throw new Error('API key is missing. Configure it in Saul Settings.');
  return key;
}

export function prepareRecipeRun(
  settings: UserSettings,
  context: ResolvedContext,
  recipeId: string,
  inspectOnly = false,
): { input: RunInput; credential: string } {
  const configuration = configurationFor(settings);
  const recipe = configuration.recipes.find((item) => item.id === recipeId);
  if (!recipe) throw new Error('This action no longer exists. Choose an action in Settings.');
  const preset = configuration.presets.find((item) => item.id === recipe.presetId);
  if (!preset)
    throw new Error(`Action “${recipe.name}” needs its default preset. Choose one in Settings.`);
  const selected = settingsForPreset(settings, preset);
  if (!inspectOnly) validateProviderSettings(selected);
  const remote = {
    baseUrl: selected.openaiCompatible.baseUrl,
    model: selected.openaiCompatible.model,
    temperature: selected.openaiCompatible.temperature,
  };
  const language = settings.responseLanguage
    ? `Respond in ${settings.responseLanguage}.`
    : 'Respond in the language of the selected text.';
  const input: RunInput = {
    provider: selected.activeProvider,
    remote,
    local: structuredClone(selected.chromeAi),
    ...(selected.activeProvider === 'chatgpt-plan'
      ? { plan: structuredClone(selected.chatgptPlan) }
      : {}),
    context: structuredClone(context),
    systemPrompt: recipe.systemPrompt,
    userPrompt: renderRecipePrompt(recipe, context, language),
    recipe: structuredClone(recipe),
    preset: structuredClone(preset),
  };
  return { input, credential: inspectOnly ? '' : credentialForFrozenInput(settings, input) };
}

export function prepareFrozenRun(
  settings: UserSettings,
  original: RunInput,
): { input: RunInput; credential: string } {
  const input = structuredClone(original);
  return { input, credential: credentialForFrozenInput(settings, input) };
}

export function prepareFollowUpRun(
  settings: UserSettings,
  original: RunInput,
  answer: string,
  question: string,
): { input: RunInput; credential: string } {
  if (!question.trim() || question.length > 2000)
    throw new Error('Enter a follow-up question of up to 2,000 characters.');
  if (!answer.trim()) throw new Error('Wait for a completed answer before asking a follow-up.');
  const prepared = prepareFrozenRun(settings, original);
  prepared.input.userPrompt += `\n\n--- Previous answer ---\n${answer}\n\n--- Follow-up question ---\n${question}\n\nAnswer the follow-up question directly using the saved context above.`;
  if (prepared.input.userPrompt.length > 120000)
    throw new Error('This conversation is too long. Start a new explanation.');
  prepared.input.followUpQuestion = question;
  return prepared;
}
