import { expect, it } from 'vitest';
import {
  createSettingsDraft,
  editSettingsDraft,
  settingsFromDraft,
  settingsForSave,
} from '../src/models/settings-draft';
import { reviewSettings } from '../src/models/settings-recovery';
import { DEFAULT_SETTINGS } from '../src/storage/settings';

const baseDraft = () => createSettingsDraft(DEFAULT_SETTINGS);

it('ignores inspection of a bound plan account but reviews an explicit standalone account edit', () => {
  const source = structuredClone(DEFAULT_SETTINGS);
  source.chatgptPlan = { accountId: 'local-A', model: 'saved-model' };
  source.connections.push({
    key: 'bound-plan',
    name: 'Bound plan',
    kind: 'chatgpt-plan',
    accountId: 'bound-B',
  });
  source.configuration!.presets.push({
    id: 'bound',
    name: 'Bound',
    provider: 'chatgpt-plan',
    connectionKey: 'bound-plan',
    model: 'bound-model',
  });
  const base = createSettingsDraft(source);
  const selected = editSettingsDraft(base, { type: 'select-preset', id: 'bound' });
  expect(reviewSettings(base, selected, source).changes).toEqual([]);
  expect(reviewSettings(base, selected, source).apply({}).dirty).toBe(false);
  const mine = editSettingsDraft(selected, { type: 'plan-account', accountId: 'explicit-C' });
  const latest = { ...source, chatgptPlan: { ...source.chatgptPlan, accountId: 'elsewhere-D' } };
  const review = reviewSettings(base, mine, latest);
  expect(review.changes).toHaveLength(1);
  const change = review.changes[0]!;
  expect(change).toMatchObject({
    label: 'Plan account',
    original: 'local-A',
    mine: 'explicit-C',
    latest: 'elsewhere-D',
    conflict: true,
  });
  expect(() => review.apply({})).toThrow('Choose Mine or Latest');
  const applied = review.apply({ [change.id]: 'mine' });
  expect(applied.draft.presetId).toBe('bound');
  expect(settingsForSave(applied.draft).chatgptPlan?.accountId).toBe('explicit-C');
  expect(
    settingsForSave(review.apply({ [change.id]: 'latest' }).draft).chatgptPlan?.accountId,
  ).toBe('elsewhere-D');
  expect(reviewSettings(base, mine, settingsForSave(mine)).apply({}).dirty).toBe(false);
});

it('rebuilds the saved active route from reviewed profile edits and keeps latest transport defaults', () => {
  const base = baseDraft();
  const mine = editSettingsDraft(base, {
    type: 'connection',
    id: 'default',
    patch: { baseUrl: 'https://edited.example.test/v1' },
  });
  const latest = settingsFromDraft(base);
  latest.openaiCompatible = { ...latest.openaiCompatible, model: 'latest-default' };
  latest.scopedConfigRevision = 12;
  const applied = reviewSettings(base, mine, latest).apply({});
  expect(settingsForSave(applied.draft).openaiCompatible).toMatchObject({
    baseUrl: 'https://edited.example.test/v1',
    apiKey: '',
    model: 'latest-default',
  });
  expect(settingsForSave(applied.draft).scopedConfigRevision).toBe(12);
  expect(applied.dirty).toBe(true);
});

it('reapplies only local fields onto latest values and preserves selection', () => {
  const base = baseDraft();
  const mine = editSettingsDraft(base, { type: 'preset-name', name: 'My writing' });
  const latest = editSettingsDraft(base, { type: 'preset', patch: { model: 'new-model' } });
  const review = reviewSettings(base, mine, settingsFromDraft(latest));
  expect(review.changes).toHaveLength(1);
  expect(review.changes[0]).toMatchObject({ mine: 'My writing', conflict: false });
  const result = review.apply({});
  expect(result.draft.values.configuration?.presets[0]).toMatchObject({
    name: 'My writing',
    model: 'new-model',
  });
  expect(result.draft.presetId).toBe(mine.presetId);
  expect(result.dirty).toBe(true);
  expect(base.values.configuration?.presets[0]?.name).not.toBe('My writing');
});

it('requires a choice for a field edited on both sides', () => {
  const base = baseDraft();
  const mine = editSettingsDraft(base, { type: 'preset-name', name: 'Mine' });
  const latest = editSettingsDraft(base, { type: 'preset-name', name: 'Elsewhere' });
  const review = reviewSettings(base, mine, settingsFromDraft(latest));
  const change = review.changes[0]!;
  expect(change.conflict).toBe(true);
  expect(() => review.apply({})).toThrow('Choose Mine or Latest');
  expect(review.apply({ [change.id]: 'mine' }).draft.values.configuration?.presets[0]?.name).toBe(
    'Mine',
  );
  const saved = review.apply({ [change.id]: 'latest' });
  expect(saved.draft.values.configuration?.presets[0]?.name).toBe('Elsewhere');
  expect(saved.dirty).toBe(false);
});

it('recognizes an already delivered save without creating another edit', () => {
  const base = baseDraft(),
    mine = editSettingsDraft(base, { type: 'preset-name', name: 'Already saved' });
  const review = reviewSettings(base, mine, settingsFromDraft(mine));
  expect(review.changes).toEqual([]);
  expect(review.apply({}).dirty).toBe(false);
});

it('does not mistake selecting a preset or a storage revision for an edit', () => {
  const base = editSettingsDraft(baseDraft(), { type: 'add-preset', id: 'second' });
  const mine = editSettingsDraft(base, { type: 'select-preset', id: 'preset-current' });
  const latest = structuredClone(settingsFromDraft(base));
  latest.scopedConfigRevision = 7;
  expect(reviewSettings(base, mine, latest).changes).toEqual([]);
});

it('restores the inspected preset after an identity remap without treating inspection as an edit', () => {
  const base = editSettingsDraft(baseDraft(), { type: 'add-preset', id: 'second' });
  const latest = settingsForSave(base);
  latest.configuration!.presets.find((p) => p.id === 'second')!.id = 'remapped-second';
  latest.scopedConfigRevision = 8;
  const review = reviewSettings(base, base, latest);
  expect(review.changes).toEqual([]);
  const applied = review.apply({});
  expect(applied.draft.presetId).toBe('remapped-second');
  expect(applied.dirty).toBe(false);
});

it('requires an explicit choice before restoring an item deleted elsewhere', () => {
  const base = editSettingsDraft(baseDraft(), { type: 'add-preset', id: 'spare' });
  const mine = editSettingsDraft(base, { type: 'preset-name', name: 'Keep me' });
  const latest = editSettingsDraft(base, { type: 'remove-preset' });
  const review = reviewSettings(base, mine, settingsFromDraft(latest)),
    change = review.changes[0]!;
  expect(change).toMatchObject({ latest: 'Not present', conflict: true });
  expect(() => review.apply({})).toThrow('Choose');
  expect(
    review.apply({ [change.id]: 'mine' }).draft.values.configuration?.presets.at(-1)?.name,
  ).toBe('Keep me');
  expect(
    review
      .apply({ [change.id]: 'latest' })
      .draft.values.configuration?.presets.some((p) => p.id === 'spare'),
  ).toBe(false);
});

it('treats a local item deletion as an explicit choice and rejects broken references', () => {
  const base = editSettingsDraft(baseDraft(), { type: 'add-preset', id: 'spare' });
  const mine = editSettingsDraft(base, { type: 'remove-preset' });
  const unchanged = reviewSettings(base, mine, settingsFromDraft(base));
  expect(unchanged.changes[0]?.conflict).toBe(true);
  const latest = editSettingsDraft(base, { type: 'add-recipe', id: 'new-action' });
  const review = reviewSettings(base, mine, settingsFromDraft(latest)),
    change = review.changes[0]!;
  expect(() => review.apply({ [change.id]: 'mine' })).toThrow();
  expect(
    review
      .apply({ [change.id]: 'latest' })
      .draft.values.configuration?.presets.some((p) => p.id === 'spare'),
  ).toBe(true);
  expect(mine.values.configuration?.presets.some((p) => p.id === 'spare')).toBe(false);
});

it('keeps independent additions and latest ordering', () => {
  const base = baseDraft();
  const mine = editSettingsDraft(base, { type: 'add-preset', id: 'mine' });
  const latest = editSettingsDraft(base, { type: 'add-preset', id: 'theirs' });
  // Real editors choose unique names; resolve that invariant before this review.
  const uniqueMine = editSettingsDraft(mine, { type: 'preset-name', name: 'My new preset' });
  const result = reviewSettings(base, uniqueMine, settingsFromDraft(latest)).apply({});
  expect(result.draft.values.configuration?.presets.slice(-2).map((p) => p.id)).toEqual([
    'theirs',
    'mine',
  ]);
});

it('keeps credentials masked and does not combine a key with a changed endpoint', () => {
  const base = editSettingsDraft(baseDraft(), {
    type: 'connection',
    id: 'default',
    patch: { apiKey: 'old-secret' },
  });
  const mine = editSettingsDraft(base, {
    type: 'connection',
    id: 'default',
    patch: { apiKey: 'new-secret' },
  });
  const latest = editSettingsDraft(base, {
    type: 'connection',
    id: 'default',
    patch: { baseUrl: 'https://elsewhere.test/v1' },
  });
  const review = reviewSettings(base, mine, settingsFromDraft(latest)),
    change = review.changes[0]!;
  expect(review.changes).toHaveLength(1);
  expect(change.conflict).toBe(true);
  expect(JSON.stringify(review.changes)).not.toContain('old-secret');
  expect(JSON.stringify(review.changes)).not.toContain('new-secret');
  expect(review.apply({ [change.id]: 'mine' }).draft.values.profiles?.[0]?.config).toMatchObject({
    baseUrl: base.values.profiles![0]!.config.baseUrl,
    apiKey: 'new-secret',
  });
  expect(review.apply({ [change.id]: 'latest' }).draft.values.profiles?.[0]?.config).toMatchObject({
    baseUrl: 'https://elsewhere.test/v1',
    apiKey: '',
  });
});
