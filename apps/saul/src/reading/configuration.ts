import type { ResolvedContext, UserSettings } from '../types';
import type { RunInput } from '../types/storage';
import { configurationFor, renderRecipePrompt } from '../models/configuration';
import { preparePreset, prepareFrozenPreset } from '../models/preset-resolution';

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
  const prepared = preparePreset(settings, preset, 'write', inspectOnly);
  const language = settings.responseLanguage
    ? `Respond in ${settings.responseLanguage}.`
    : 'Respond in the language of the selected text.';
  const input: RunInput = {
    ...prepared.choices,
    context: structuredClone(context),
    systemPrompt: recipe.systemPrompt,
    userPrompt: renderRecipePrompt(recipe, context, language),
    recipe: structuredClone(recipe),
    preset: structuredClone(preset),
  };
  return { input, credential: prepared.credential };
}

export function prepareFrozenRun(
  settings: UserSettings,
  original: RunInput,
): { input: RunInput; credential: string } {
  return prepareFrozenPreset(settings, original);
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
