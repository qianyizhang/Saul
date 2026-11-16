import { expect, it } from 'vitest';
import { createSettingsDraft, editSettingsDraft } from '../src/models/settings-draft';
import { reviewSettings } from '../src/models/settings-recovery';
import { DEFAULT_SETTINGS } from '../src/storage/settings';

const baseDraft = () => createSettingsDraft(DEFAULT_SETTINGS);

it('reapplies only local fields onto latest values and preserves selection', () => {
  const base = baseDraft();
  const mine = editSettingsDraft(base, { type: 'preset-name', name: 'My writing' });
  const latest = editSettingsDraft(base, { type: 'preset', patch: { model: 'new-model' } });
  const review = reviewSettings(base, mine, latest.settings);
  expect(review.changes).toHaveLength(1);
  expect(review.changes[0]).toMatchObject({ mine: 'My writing', conflict: false });
  const result = review.apply({});
  expect(result.draft.settings.configuration?.presets[0]).toMatchObject({
    name: 'My writing',
    model: 'new-model',
  });
  expect(result.draft.presetId).toBe(mine.presetId);
  expect(result.dirty).toBe(true);
  expect(base.settings.configuration?.presets[0]?.name).not.toBe('My writing');
});

it('requires a choice for a field edited on both sides', () => {
  const base = baseDraft();
  const mine = editSettingsDraft(base, { type: 'preset-name', name: 'Mine' });
  const latest = editSettingsDraft(base, { type: 'preset-name', name: 'Elsewhere' });
  const review = reviewSettings(base, mine, latest.settings);
  const change = review.changes[0]!;
  expect(change.conflict).toBe(true);
  expect(() => review.apply({})).toThrow('Choose Mine or Latest');
  expect(review.apply({ [change.id]: 'mine' }).draft.settings.configuration?.presets[0]?.name).toBe(
    'Mine',
  );
  const saved = review.apply({ [change.id]: 'latest' });
  expect(saved.draft.settings.configuration?.presets[0]?.name).toBe('Elsewhere');
  expect(saved.dirty).toBe(false);
});

it('recognizes an already delivered save without creating another edit', () => {
  const base = baseDraft(),
    mine = editSettingsDraft(base, { type: 'preset-name', name: 'Already saved' });
  const review = reviewSettings(base, mine, mine.settings);
  expect(review.changes).toEqual([]);
  expect(review.apply({}).dirty).toBe(false);
});

it('does not mistake selecting a preset or a storage revision for an edit', () => {
  const base = editSettingsDraft(baseDraft(), { type: 'add-preset', id: 'second' });
  const mine = editSettingsDraft(base, { type: 'select-preset', id: 'preset-current' });
  const latest = structuredClone(base.settings);
  latest.scopedConfigRevision = 7;
  expect(reviewSettings(base, mine, latest).changes).toEqual([]);
});

it('requires an explicit choice before restoring an item deleted elsewhere', () => {
  const base = editSettingsDraft(baseDraft(), { type: 'add-preset', id: 'spare' });
  const mine = editSettingsDraft(base, { type: 'preset-name', name: 'Keep me' });
  const latest = editSettingsDraft(base, { type: 'remove-preset' });
  const review = reviewSettings(base, mine, latest.settings),
    change = review.changes[0]!;
  expect(change).toMatchObject({ latest: 'Not present', conflict: true });
  expect(() => review.apply({})).toThrow('Choose');
  expect(
    review.apply({ [change.id]: 'mine' }).draft.settings.configuration?.presets.at(-1)?.name,
  ).toBe('Keep me');
  expect(
    review
      .apply({ [change.id]: 'latest' })
      .draft.settings.configuration?.presets.some((p) => p.id === 'spare'),
  ).toBe(false);
});

it('treats a local item deletion as an explicit choice and rejects broken references', () => {
  const base = editSettingsDraft(baseDraft(), { type: 'add-preset', id: 'spare' });
  const mine = editSettingsDraft(base, { type: 'remove-preset' });
  const unchanged = reviewSettings(base, mine, base.settings);
  expect(unchanged.changes[0]?.conflict).toBe(true);
  const latest = editSettingsDraft(base, { type: 'add-recipe', id: 'new-action' });
  const review = reviewSettings(base, mine, latest.settings),
    change = review.changes[0]!;
  expect(() => review.apply({ [change.id]: 'mine' })).toThrow();
  expect(
    review
      .apply({ [change.id]: 'latest' })
      .draft.settings.configuration?.presets.some((p) => p.id === 'spare'),
  ).toBe(true);
  expect(mine.settings.configuration?.presets.some((p) => p.id === 'spare')).toBe(false);
});

it('keeps independent additions and latest ordering', () => {
  const base = baseDraft();
  const mine = editSettingsDraft(base, { type: 'add-preset', id: 'mine' });
  const latest = editSettingsDraft(base, { type: 'add-preset', id: 'theirs' });
  // Real editors choose unique names; resolve that invariant before this review.
  const uniqueMine = editSettingsDraft(mine, { type: 'preset-name', name: 'My new preset' });
  const result = reviewSettings(base, uniqueMine, latest.settings).apply({});
  expect(result.draft.settings.configuration?.presets.slice(-2).map((p) => p.id)).toEqual([
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
  const review = reviewSettings(base, mine, latest.settings),
    change = review.changes[0]!;
  expect(review.changes).toHaveLength(1);
  expect(change.conflict).toBe(true);
  expect(JSON.stringify(review.changes)).not.toContain('old-secret');
  expect(JSON.stringify(review.changes)).not.toContain('new-secret');
  expect(review.apply({ [change.id]: 'mine' }).draft.settings.profiles?.[0]?.config).toMatchObject({
    baseUrl: base.settings.profiles![0]!.config.baseUrl,
    apiKey: 'new-secret',
  });
  expect(
    review.apply({ [change.id]: 'latest' }).draft.settings.profiles?.[0]?.config,
  ).toMatchObject({ baseUrl: 'https://elsewhere.test/v1', apiKey: '' });
});
