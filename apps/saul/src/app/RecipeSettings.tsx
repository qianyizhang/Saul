import type { ReadingConfiguration, Recipe } from '../types';
import type { SettingsEdit } from '../models/settings-draft';
import { parseTemplate, TEMPLATE_FIELDS } from '../models/configuration';

export function RecipeSettings({
  configuration,
  recipeId,
  onEdit,
}: {
  configuration: ReadingConfiguration;
  recipeId: string;
  onEdit: (edit: SettingsEdit) => void;
}) {
  const recipe =
    configuration.recipes.find((item) => item.id === recipeId) || configuration.recipes[0]!;
  let templateError = '';
  try {
    parseTemplate(recipe.template);
  } catch (error) {
    templateError = (error as Error).message;
  }
  function update(patch: Partial<Recipe>) {
    onEdit({ type: 'recipe', patch });
  }
  return (
    <details>
      <summary>Edit recipes</summary>
      <div className="stack settings-disclosure">
        <p className="small muted">Recipes tell Saul what to do with your selection.</p>
        <div className="row between">
          <button
            className="btn"
            disabled={configuration.recipes.length >= 32}
            onClick={() => onEdit({ type: 'add-recipe', id: crypto.randomUUID() })}
          >
            Add recipe
          </button>
        </div>
        <label className="field">
          Edit recipe
          <select
            aria-label="Edit recipe"
            value={recipe.id}
            onChange={(event) => {
              onEdit({ type: 'select-recipe', id: event.target.value });
            }}
          >
            {configuration.recipes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Recipe name
          <input
            maxLength={80}
            value={recipe.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <label className="field">
          Default preset
          <select
            aria-label="Default preset"
            value={recipe.presetId}
            onChange={(event) => update({ presetId: event.target.value })}
          >
            {configuration.presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Prompt template
          <textarea
            aria-label="Prompt template"
            rows={5}
            value={recipe.template}
            onChange={(event) => update({ template: event.target.value })}
          />
        </label>
        {templateError && (
          <p className="notice error" role="alert">
            {templateError}
          </p>
        )}
        <details>
          <summary>Template syntax</summary>
          <p className="small muted">
            {TEMPLATE_FIELDS.map((field) => `{{${field}}}`).join(' · ')}
          </p>
          <p className="small muted">
            Text is required. Other fields use enabled page context and must be available when
            referenced. Values are inserted literally. Context already used in the template is not
            repeated.
          </p>
        </details>
        <details>
          <summary>System instructions</summary>
          <label className="field">
            <span className="sr-only">Recipe system instructions</span>
            <textarea
              aria-label="Recipe system instructions"
              rows={8}
              value={recipe.systemPrompt}
              onChange={(event) => update({ systemPrompt: event.target.value })}
            />
          </label>
        </details>
        <div className="row">
          <button
            className="btn danger"
            disabled={configuration.recipes.length <= 1}
            onClick={() => onEdit({ type: 'remove-recipe' })}
          >
            Remove recipe
          </button>
        </div>
      </div>
    </details>
  );
}
