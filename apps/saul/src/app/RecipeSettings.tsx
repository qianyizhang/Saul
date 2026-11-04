import { ActionLabel } from '../surface/ActionLabel';
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
      <summary aria-label="Edit actions" title="Edit actions">
        <ActionLabel short="Actions" full="Edit actions" />
      </summary>
      <div className="stack settings-disclosure">
        <p className="small muted standard-only">
          Actions tell Saul what to do with your selection.
        </p>
        <div className="row between">
          <button
            className="btn"
            disabled={configuration.recipes.length >= 32}
            onClick={() => onEdit({ type: 'add-recipe', id: crypto.randomUUID() })}
            aria-label="Add action"
            title="Add action"
          >
            <ActionLabel short="Add" full="Add action" />
          </button>
        </div>
        <label className="field">
          Edit action
          <select
            aria-label="Edit action"
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
          Action name
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
            {!configuration.presets.some((preset) => preset.id === recipe.presetId) && (
              <option value={recipe.presetId}>Unavailable preset</option>
            )}
            {configuration.presets.map((preset) => (
              <option
                key={preset.id}
                value={preset.id}
                disabled={!!preset.capability && preset.capability !== 'write'}
              >
                {preset.name}
                {preset.capability === 'draw' ? ' · Draw unavailable in Saul' : ''}
                {preset.capability === 'speak' ? ' · Speak preview only' : ''}
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
        <details className="standard-only">
          <summary aria-label="Template syntax" title="Template syntax">
            <ActionLabel short="Syntax" full="Template syntax" />
          </summary>
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
          <summary aria-label="System instructions" title="System instructions">
            <ActionLabel short="Instructions" full="System instructions" />
          </summary>
          <label className="field">
            <span className="sr-only">Action system instructions</span>
            <textarea
              aria-label="Action system instructions"
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
            aria-label="Remove action"
            title="Remove action"
          >
            <ActionLabel short="Remove" full="Remove action" />
          </button>
        </div>
      </div>
    </details>
  );
}
