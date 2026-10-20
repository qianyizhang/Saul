import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseTemplate, renderRecipePrompt } from '../src/models/configuration';

const fixture = JSON.parse(
  readFileSync(new URL('../../../contracts/fixtures/templates.json', import.meta.url), 'utf8'),
) as {
  version: number;
  valid: { name: string; template: string; values: { text: string }; output: string }[];
  invalid: string[];
  missing: { template: string; values: { text?: string } }[];
};
const recipe = (template: string) => ({
  id: 'contract',
  name: 'Contract',
  presetId: 'fixture',
  systemPrompt: '',
  template,
});

it('implements shared literal template semantics through the production preparation interface', () => {
  expect(fixture.version).toBe(1);
  for (const entry of fixture.valid) {
    expect(
      renderRecipePrompt(recipe(entry.template), {
        selection: entry.values.text,
        pageTitle: '',
        pageUrl: '',
      }),
      entry.name,
    ).toBe(entry.output);
  }
  for (const template of fixture.invalid) expect(() => parseTemplate(template)).toThrow();
  for (const entry of fixture.missing) {
    expect(() =>
      renderRecipePrompt(recipe(entry.template), {
        selection: entry.values.text ?? '',
        pageTitle: '',
        pageUrl: '',
      }),
    ).toThrow();
  }
});
