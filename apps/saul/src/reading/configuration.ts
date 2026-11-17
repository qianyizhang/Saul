import type { ResolvedContext } from '../../shared/model/reading.ts';
import type { Configuration } from '../configuration/definition';
import type { RunInput } from '../../shared/protocol/history-types.ts';
import { configurationFor, renderRecipePrompt } from '../configuration/definition';
import { preparePreset, prepareFrozenPreset } from '../configuration/resolve';
import { validateModelPrompts } from '../../shared/model/execution-route.ts';
import { isRecord } from '../../shared/model/value.mts';

export function prepareRecipeRun(
  settings: Configuration,
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
  const prepared = preparePreset(settings, preset, recipe.capability ?? 'write', inspectOnly);
  const language = settings.responseLanguage
    ? `Respond in ${settings.responseLanguage}.`
    : 'Respond in the language of the selected text.';
  const input: RunInput = {
    ...prepared.choices,
    context: structuredClone(context),
    systemPrompt: recipe.systemPrompt,
    userPrompt: renderRecipePrompt(recipe, context, language),
    recipe: structuredClone(recipe),
    preset: structuredClone(prepared.choices.preset!),
  };
  return { input, credential: prepared.credential };
}

export function prepareFrozenRun(
  settings: Configuration,
  original: RunInput,
): { input: RunInput; credential: string } {
  validateModelPrompts(original);
  const context: unknown = original.context;
  const recipe: unknown = original.recipe;
  const required = ['selection', 'pageTitle', 'pageUrl'];
  const contextFields = [...required, 'surroundingText', 'paragraph', 'heading'];
  const recipeFields = ['id', 'name', 'presetId', 'systemPrompt', 'template'];
  if (
    !isRecord(context) ||
    required.some((key) => typeof context[key] !== 'string') ||
    Object.keys(context).some(
      (key) =>
        !contextFields.includes(key) ||
        (context[key] !== undefined && typeof context[key] !== 'string'),
    ) ||
    (recipe !== undefined &&
      (!isRecord(recipe) ||
        recipeFields.some((key) => typeof recipe[key] !== 'string') ||
        Object.keys(recipe).some((key) => key !== 'capability' && !recipeFields.includes(key)) ||
        (recipe.capability !== undefined &&
          recipe.capability !== 'write' &&
          recipe.capability !== 'draw'))) ||
    (original.followUpQuestion !== undefined && typeof original.followUpQuestion !== 'string')
  )
    throw new Error('Invalid saved reading input. Start a new explanation.');
  return prepareFrozenPreset(settings, original);
}

export function prepareFollowUpRun(
  settings: Configuration,
  original: RunInput,
  answer: string,
  question: string,
): { input: RunInput; credential: string } {
  if (original.preset?.capability === 'draw')
    throw new Error('Select the passage and Illustrate to create another image.');
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
