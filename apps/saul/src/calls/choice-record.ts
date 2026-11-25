import { callChoiceKey, type CallChoice } from '../../shared/model/custom-call.ts';
import { isRecord as record } from '../../shared/model/value.mts';
import { validateCallEditorState, type CallChoices } from './contract';

export const LEGACY_CHOICE_FIELDS = ['library', 'selected', 'previous'] as const;
const CHOICE_FIELDS = [...LEGACY_CHOICE_FIELDS, 'builtinPresetId'];
const STORED_FIELDS = [...CHOICE_FIELDS, 'schema'];

export function validatePart(value: unknown, keys: readonly string[]) {
  validateCallEditorState(value);
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error('Invalid Call data.');
}

export function legacyChoices(value: unknown): CallChoices {
  validatePart(value, LEGACY_CHOICE_FIELDS);
  const choices = value as CallChoices;
  const library = new Map((choices.library ?? []).map((choice) => [callChoiceKey(choice), choice]));
  for (const choice of [choices.previous, choices.selected]) {
    if (choice) library.set(callChoiceKey(choice), choice);
  }
  const migrated = { ...choices, library: [...library.values()] };
  validateCallEditorState(migrated);
  return migrated;
}

/** The library owns each custom choice. Slots persist only references to its entries. */
export function serializeChoices(choices: CallChoices): Record<string, unknown> {
  validatePart(choices, CHOICE_FIELDS);
  const { builtinPresetId, library, selected, previous } = choices;
  const stored = {
    schema: 2,
    library: library ?? [],
    ...(builtinPresetId === undefined ? {} : { builtinPresetId }),
    ...(selected && { selected: callChoiceKey(selected) }),
    ...(previous && { previous: callChoiceKey(previous) }),
  };
  deserializeChoices(stored);
  return stored;
}

export function deserializeChoices(value: unknown): CallChoices {
  if (
    !record(value) ||
    value.schema !== 2 ||
    !Array.isArray(value.library) ||
    Object.keys(value).some((key) => !STORED_FIELDS.includes(key))
  )
    throw new Error('Invalid Call data.');
  const { library, builtinPresetId, selected, previous } = value;
  validateCallEditorState({ library, builtinPresetId });
  const choices = new Map(
    (library as CallChoice[]).map((choice) => [callChoiceKey(choice), choice]),
  );
  const resolve = (key: unknown) => {
    if (key === undefined) return undefined;
    if (typeof key !== 'string' || !choices.has(key))
      throw new Error('A saved Call choice is missing from the library.');
    return choices.get(key);
  };
  return {
    library,
    builtinPresetId: builtinPresetId as string | undefined,
    selected: resolve(selected),
    previous: resolve(previous),
  };
}

/** Preserve readable entries when the user explicitly resets a damaged selection. */
export function recoverChoices(value: unknown): CallChoices | undefined {
  if (!record(value)) return { library: [] };
  const current = Object.hasOwn(value, 'schema');
  const fields: readonly string[] = current ? STORED_FIELDS : LEGACY_CHOICE_FIELDS;
  if ((current && value.schema !== 2) || Object.keys(value).some((key) => !fields.includes(key)))
    return undefined;
  const library = new Map<string, CallChoice>();
  function add(choice: unknown) {
    if (choice === undefined) return undefined;
    try {
      const entry: unknown = { selected: choice };
      validateCallEditorState(entry);
      if (!entry.selected) return undefined;
      const key = callChoiceKey(entry.selected);
      if (!library.has(key) && library.size >= 128) return undefined;
      library.set(key, entry.selected);
      return entry.selected;
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value.library)) for (const choice of value.library) add(choice);
  const resolve = (choice: unknown) =>
    current ? (typeof choice === 'string' ? library.get(choice) : undefined) : add(choice);
  const previous = resolve(value.previous);
  const selected = resolve(value.selected);
  let builtinPresetId: string | undefined;
  try {
    const entry: unknown = { builtinPresetId: value.builtinPresetId };
    validateCallEditorState(entry);
    builtinPresetId = entry.builtinPresetId;
  } catch {
    // The damaged built-in reference can be chosen again after recovery.
  }
  return { library: [...library.values()], previous, selected, builtinPresetId };
}
