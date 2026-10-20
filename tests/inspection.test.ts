import { expect, test } from 'vitest';
import { inspectionInput } from '../src/reading/inspection';
import type { RunInput } from '../src/types/storage';

test('reading inspection retains literal model text without projecting account or connection data', () => {
  const input: RunInput = {
    provider: 'chatgpt-plan',
    remote: { baseUrl: 'https://private.example', model: 'unused', temperature: 0.3 },
    local: { topK: 3, temperature: 0.3 },
    plan: { accountId: 'private-account', model: 'example' },
    systemPrompt: 'Instructions\n  preserve spacing',
    userPrompt: '<literal> {{text}}\n\nFollow-up: why?',
    context: { selection: '<literal>', pageTitle: '', pageUrl: '', paragraph: 'source\ntext' },
  };
  const projected = inspectionInput(input)!;
  expect(projected.systemPrompt).toBe(input.systemPrompt);
  expect(projected.userPrompt).toBe(input.userPrompt);
  expect(projected.context).toEqual(input.context);
  expect(Object.keys(projected).sort()).toEqual(['context', 'systemPrompt', 'userPrompt']);
  expect(JSON.stringify(projected)).not.toMatch(/private-account|private.example/);
});
