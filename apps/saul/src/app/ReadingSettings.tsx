import { ActionLabel } from '../surface/ActionLabel';
import { AppVersion } from './AppVersion';
import { RecipeSettings } from './RecipeSettings';
import type { ReadingConfiguration, Configuration } from '../configuration/definition';
import type { SettingsEdit, SettingsPreferences } from '../settings/draft';
import type { SettingsSection } from './settings-sections';

export function ReadingSettings({
  section,
  configuration,
  recipeId,
  responseLanguage,
  contextPolicy,
  onEdit,
  update,
  onSectionChange,
}: {
  section: SettingsSection;
  configuration: ReadingConfiguration;
  recipeId: string;
  responseLanguage: Configuration['responseLanguage'];
  contextPolicy: Configuration['contextPolicy'];
  onEdit: (edit: SettingsEdit) => void;
  update: (patch: Partial<Pick<SettingsPreferences, 'responseLanguage' | 'contextPolicy'>>) => void;
  onSectionChange: (section: SettingsSection) => void;
}) {
  return (
    <section
      hidden={section !== 'overview' && section !== 'reading'}
      className="settings-section"
      aria-label={section === 'overview' ? 'Overview' : 'Actions'}
    >
      <h2 className="view-title">{section === 'overview' ? 'Settings' : 'Actions'}</h2>
      <div className="settings-pair">
        <label className="field">
          Default action
          <select
            aria-label="Default action"
            value={configuration.selectedRecipeId}
            onChange={(event) => onEdit({ type: 'default-recipe', id: event.target.value })}
          >
            {configuration.recipes.map((recipe) => (
              <option key={recipe.id} value={recipe.id}>
                {recipe.name}
                {configuration.presets.length > 1 &&
                  ` · ${configuration.presets.find((preset) => preset.id === recipe.presetId)?.name || 'Unavailable preset'}`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Response language
          <select
            aria-label="Response language"
            value={responseLanguage || ''}
            onChange={(e) => update({ responseLanguage: e.target.value })}
          >
            <option value="">Match selected text</option>
            <option value="English">English</option>
            <option value="Chinese">中文</option>
            <option value="Spanish">Español</option>
            <option value="Japanese">日本語</option>
            <option value="French">Français</option>
            <option value="German">Deutsch</option>
          </select>
        </label>
      </div>
      <div hidden={section !== 'overview'} className="settings-overview">
        <AppVersion />
        <button className="settings-link" onClick={() => onSectionChange('models')}>
          <span>Presets</span>
          <span>
            {configuration.presets.length}
            <span aria-hidden="true"> ›</span>
          </span>
        </button>
        <button className="settings-link" onClick={() => onSectionChange('reading')}>
          <span>Actions</span>
          <span>
            {configuration.recipes.length}
            <span aria-hidden="true"> ›</span>
          </span>
        </button>
        <button className="settings-link" onClick={() => onSectionChange('calls')}>
          <span>Calls</span>
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <div hidden={section !== 'reading'} className="stack">
        <details>
          <summary aria-label="Include with selected text" title="Include with selected text">
            <ActionLabel short="Context" full="Include with selected text" />
          </summary>
          <div className="stack settings-disclosure">
            <p className="small muted standard-only">
              Checked page information is sent to your model with the selection.
            </p>
            {(
              [
                ['includeContainingParagraph', 'Surrounding paragraph'],
                ['includeContainingHeading', 'Section heading'],
                ['includePageMetadata', 'Page title and URL'],
              ] as const
            ).map(([key, label]) => (
              <label className="toggle" key={key}>
                {label}
                <input
                  type="checkbox"
                  checked={contextPolicy[key]}
                  onChange={(e) =>
                    update({
                      contextPolicy: { ...contextPolicy, [key]: e.target.checked },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </details>
        <RecipeSettings configuration={configuration} recipeId={recipeId} onEdit={onEdit} />
      </div>
    </section>
  );
}
