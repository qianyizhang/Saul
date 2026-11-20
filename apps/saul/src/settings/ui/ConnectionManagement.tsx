import { useEffect, useRef, useState } from 'react';
import type { Configuration } from '../../configuration/definition';
import type { ConnectionDefinition } from '../../../shared/protocol/shared-presets-contract.mts';
import {
  compatibleDestination,
  connectionManagementLabel,
  presetsUsingConnection,
  type ConnectionChange,
} from '../connection-management';

export type ConnectionManagementAction = ConnectionChange['action'];

export function ConnectionManagement({
  action,
  connection,
  settings,
  disabled,
  commit,
  close,
  openMove,
}: {
  action: ConnectionManagementAction;
  connection: ConnectionDefinition;
  settings: Configuration;
  disabled: boolean;
  commit: (change: ConnectionChange) => Promise<void>;
  close: () => void;
  openMove: () => void;
}) {
  const [name, setName] = useState(connection.name);
  const [destinationKey, setDestinationKey] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const linked = presetsUsingConnection(settings, connection.key);
  const destinations = settings.connections.filter(
    (candidate) =>
      candidate.key !== connection.key &&
      linked.some((preset) => compatibleDestination(preset, candidate)),
  );
  const destination = destinations.find((candidate) => candidate.key === destinationKey);
  const eligible = linked.filter(
    (preset) => destination && compatibleDestination(preset, destination),
  );
  const moving = eligible.filter((preset) => selected.has(preset.id));
  const title =
    action === 'rename'
      ? 'Rename connection'
      : action === 'move'
        ? 'Move presets'
        : 'Delete connection';
  const change: ConnectionChange =
    action === 'rename'
      ? { action, key: connection.key, name }
      : action === 'move'
        ? {
            action,
            key: connection.key,
            destination: destinationKey,
            presets: moving.map((preset) => preset.id),
          }
        : { action, key: connection.key };
  const ready =
    action === 'rename'
      ? !!name.trim() && name.trim() !== connection.name
      : action === 'move'
        ? moving.length > 0
        : linked.length === 0;

  async function save() {
    setError('');
    setSaving(true);
    try {
      await commit(change);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the connection change.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="stack settings-fields"
      aria-labelledby="connection-management-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !disabled && !saving) void save();
      }}
    >
      <h3 ref={heading} tabIndex={-1} id="connection-management-title">
        {title}
      </h3>
      <p className="small">{connectionManagementLabel(connection)}</p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <fieldset className="stack settings-fields" disabled={saving}>
        {action === 'rename' && (
          <label className="field">
            Connection name
            <input
              name="name"
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        {action === 'move' &&
          (destinations.length ? (
            <>
              <label className="field">
                Move to
                <select
                  name="destination"
                  value={destinationKey}
                  onChange={(event) => {
                    const candidate = destinations.find((item) => item.key === event.target.value);
                    setDestinationKey(event.target.value);
                    setSelected(
                      new Set(
                        candidate
                          ? linked
                              .filter((preset) => compatibleDestination(preset, candidate))
                              .map((preset) => preset.id)
                          : [],
                      ),
                    );
                  }}
                >
                  <option value="">Choose a connection</option>
                  {destinations.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {connectionManagementLabel(candidate)}
                    </option>
                  ))}
                </select>
              </label>
              {destination && (
                <fieldset className="stack settings-fields">
                  <legend>Presets to move</legend>
                  {linked.map((preset) => {
                    const supported = eligible.includes(preset);
                    return (
                      <label key={preset.id} className="row">
                        <input
                          type="checkbox"
                          name="preset"
                          value={preset.id}
                          disabled={!supported}
                          checked={supported && selected.has(preset.id)}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSelected((current) => {
                              const next = new Set(current);
                              if (checked) next.add(preset.id);
                              else next.delete(preset.id);
                              return next;
                            });
                          }}
                        />
                        <span>
                          {preset.name}
                          {!supported && ' · Unsupported by this destination'}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              )}
              <p className="small">
                Moved presets use the destination’s billing. Their models and options stay saved and
                may need review.
              </p>
            </>
          ) : (
            <p className="small">
              {linked.length
                ? 'Add a compatible destination connection first.'
                : 'No presets use this connection.'}
            </p>
          ))}
        {action === 'delete' &&
          (linked.length ? (
            <>
              <p>Move these presets before deleting this connection.</p>
              <ul>
                {linked.map((preset) => (
                  <li key={preset.id}>{preset.name}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              This removes the saved connection from Settings. Its credentials are managed
              separately.
            </p>
          ))}
        <div className="row">
          {action === 'delete' && linked.length > 0 ? (
            <button type="button" className="btn primary" onClick={openMove}>
              Move presets
            </button>
          ) : (
            <button
              type="submit"
              className={`btn ${action === 'delete' ? 'danger' : 'primary'}`}
              disabled={!ready || disabled}
            >
              {action === 'rename' ? 'Save name' : title}
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}
