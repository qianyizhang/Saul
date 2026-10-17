import { useState } from 'react';
import type { ReadingConfiguration, Recipe } from '../types';
import {
  DEFAULT_RECIPE_SYSTEM_PROMPT,
  parseTemplate,
  TEMPLATE_FIELDS,
} from '../models/configuration';

export function RecipeSettings({
  configuration,
  presetId,
  onChange,
}: {
  configuration: ReadingConfiguration;
  presetId: string;
  onChange: (value: ReadingConfiguration) => void;
}) {
  const [selectedId, setSelectedId] = useState(configuration.selectedRecipeId);
  const [error, setError] = useState('');
  const recipe =
    configuration.recipes.find((item) => item.id === selectedId) || configuration.recipes[0]!;
  let templateError = '';
  try {
    parseTemplate(recipe.template);
  } catch (error) {
    templateError = (error as Error).message;
  }
  function update(patch: Partial<Recipe>) {
    onChange({
      ...configuration,
      recipes: configuration.recipes.map((item) =>
        item.id === recipe.id ? { ...item, ...patch } : item,
      ),
    });
    setError('');
  }
  function add() {
    const id = crypto.randomUUID();
    let name = 'New recipe';
    for (
      let suffix = 2;
      configuration.recipes.some((item) => item.name.toLowerCase() === name.toLowerCase());
      suffix++
    )
      name = `New recipe ${suffix}`;
    onChange({
      ...configuration,
      recipes: [
        ...configuration.recipes,
        {
          id,
          name,
          presetId,
          template: '{{text}}',
          systemPrompt: DEFAULT_RECIPE_SYSTEM_PROMPT,
        },
      ],
    });
    setSelectedId(id);
    setError('');
  }
  function remove() {
    if (recipe.id === configuration.selectedRecipeId) {
      setError('Choose another default recipe before removing this one.');
      return;
    }
    onChange({
      ...configuration,
      recipes: configuration.recipes.filter((item) => item.id !== recipe.id),
    });
    setSelectedId(configuration.selectedRecipeId);
    setError('');
  }
  return (
    <section className="panel settings-section" aria-label="Recipes">
      <div className="row between">
        <h3>Recipes</h3>
        <button className="btn" disabled={configuration.recipes.length >= 32} onClick={add}>
          Add recipe
        </button>
      </div>
      <label className="field">
        Default recipe
        <select
          aria-label="Default recipe"
          value={configuration.selectedRecipeId}
          onChange={(event) => onChange({ ...configuration, selectedRecipeId: event.target.value })}
        >
          {configuration.recipes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Edit recipe
        <select
          aria-label="Edit recipe"
          value={recipe.id}
          onChange={(event) => {
            setSelectedId(event.target.value);
            setError('');
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
        <p className="small muted">{TEMPLATE_FIELDS.map((field) => `{{${field}}}`).join(' · ')}</p>
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
          onClick={remove}
        >
          Remove recipe
        </button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
