import type { Recipe } from '../../shared/model/presets.ts';
import { parseTemplate, type TemplateField } from '../configuration/definition';
import type { ResolvedContext } from '../../shared/model/reading.ts';

function renderReadingContext(context: ResolvedContext): string {
  const parts: string[] = [];

  if (context.pageTitle || context.pageUrl) {
    parts.push(`--- Page Info ---`);
    if (context.pageTitle) parts.push(`Title: ${context.pageTitle}`);
    if (context.pageUrl) parts.push(`URL: ${context.pageUrl}`);
  }

  if (context.heading) {
    parts.push(`Section: ${context.heading}`);
  }

  if (context.paragraph) {
    parts.push(`\n--- Surrounding Context ---\n${context.paragraph}`);
  } else if (context.surroundingText) {
    parts.push(`\n--- Surrounding Context ---\n${context.surroundingText}`);
  }

  return parts.join('\n');
}

export function renderRecipePrompt(
  recipe: Recipe,
  context: ResolvedContext,
  instruction?: string,
): string {
  const parsed = parseTemplate(recipe.template);
  const values: Record<TemplateField, string | undefined> = {
    text: context.selection,
    context: renderReadingContext(context),
    'page title': context.pageTitle,
    'page url': context.pageUrl,
    heading: context.heading,
    paragraph: context.paragraph,
  };
  for (const field of parsed.fields) {
    if (!values[field]?.trim())
      throw new Error(
        `“${recipe.name}” needs {{${field}}}, but it is not available from this selection and its enabled context.`,
      );
  }
  const selection = parsed.parts
    .map((part) => ('text' in part ? part.text : values[part.field]))
    .join('');
  // Keep existing context assembly byte-for-byte for migrated {{text}} recipes.
  // Context that a template already placed is not appended a second time.
  const remaining = parsed.fields.includes('context')
    ? { selection, pageTitle: '', pageUrl: '' }
    : {
        ...context,
        selection,
        ...(parsed.fields.includes('page title') ? { pageTitle: '' } : {}),
        ...(parsed.fields.includes('page url') ? { pageUrl: '' } : {}),
        ...(parsed.fields.includes('heading') ? { heading: undefined } : {}),
        ...(parsed.fields.includes('paragraph')
          ? { paragraph: undefined, surroundingText: undefined }
          : {}),
      };
  const surrounding = renderReadingContext(remaining);
  const parts = surrounding ? [surrounding, selection] : [selection];
  if (instruction) parts.push(`\nAdditional Instruction: ${instruction}`);
  return parts.join('\n');
}
