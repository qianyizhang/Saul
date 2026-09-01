import type { ResolvedContext } from '../types';

export const DEFAULT_SYSTEM_PROMPT = `You are Saul, an expert AI reading companion and concept explainer.
Your goal is to provide a clear, concise, and insightful explanation of the selected text within its surrounding context.

Formatting Rules:
1. Provide a direct, well-structured explanation (2-4 sentences).
2. Identify 1 to 4 key technical terms, underlying mechanisms, or domain concepts in your explanation that the reader might want elaborated.
3. For each of these key terms, wrap it in an inline XML tag: <term note="Concise, plain-English 1-2 sentence definition or explanation of this specific term">exact term</term>.
4. Do NOT nest <term> tags.
5. Do NOT output markdown code fences around the text. Output plain text with inline <term note="...">...</term> tags directly.`;

export function renderExplainPrompt(context: ResolvedContext, customInstruction?: string): string {
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

  parts.push(`\n--- Selected Text to Explain ---\n"${context.selection}"`);

  if (customInstruction) {
    parts.push(`\nAdditional Instruction: ${customInstruction}`);
  } else {
    parts.push(`\nPlease explain this concept clearly in context and annotate key sub-concepts with <term note="...">...</term>.`);
  }

  return parts.join('\n');
}
