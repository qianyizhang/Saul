import { useEffect, useState } from 'react';
import type { UserSettings } from '../types';
import { credentialCall } from '../native/credentials';
import { useMinimumMode } from './useMinimumMode';

export function SharedCredentialSettings({
  owner,
  disabled,
  visible,
  change,
}: {
  owner: UserSettings['sharedCredentials'];
  disabled: boolean;
  visible: boolean;
  change: (owner: 'saul' | 'disconnected') => Promise<void>;
}) {
  const { minimum } = useMinimumMode();
  const [connected, setConnected] = useState<boolean | undefined>();
  const [retired, setRetired] = useState<boolean | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible || owner !== 'saul') return;
    let active = true;
    setConnected(undefined);
    void credentialCall({ action: 'api-key-status' })
      .then((result) => {
        if (typeof result.apiConnected !== 'boolean')
          throw new Error('Saul returned an invalid key status.');
        if (active) {
          setConnected(result.apiConnected);
          setRetired(typeof result.retired === 'boolean' ? result.retired : undefined);
          setError('');
        }
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Cannot load Saul credentials.');
      });
    return () => {
      active = false;
    };
  }, [visible, owner]);
  const remove = async () => {
    if (
      !window.confirm(
        'Remove the shared OpenAI API key from Saul and EZ? ChatGPT sign-in stays connected.',
      )
    )
      return;
    setBusy(true);
    try {
      await credentialCall({ action: 'api-key-remove' });
      setConnected(false);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cannot remove the shared API key.');
    } finally {
      setBusy(false);
    }
  };
  const cleanup = async () => {
    setBusy(true);
    try {
      const result = await credentialCall({ action: 'migration-verified' });
      if (typeof result.retired !== 'boolean')
        throw new Error('Saul returned an invalid cleanup status.');
      setRetired(result.retired);
      setError(result.retired ? '' : 'Connect EZ to Saul before retiring the old records.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Old credential cleanup is incomplete.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="row">
        <strong>{owner === 'saul' ? 'Shared Saul connection' : 'Saul credentials'}</strong>
        <button
          type="button"
          className="btn"
          disabled={disabled || busy}
          title={
            owner === 'saul'
              ? 'Disconnect Saul in Chrome; keep shared credentials for EZ.'
              : 'Use Saul’s shared Keychain sign-in and OpenAI key in this app.'
          }
          onClick={() => void change(owner === 'saul' ? 'disconnected' : 'saul')}
        >
          {owner === 'saul' ? 'Disconnect app' : 'Connect to Saul'}
        </button>
      </div>
      {!minimum && (
        <p className="small">
          The signed Saul helper keeps credentials in this Mac’s Keychain. Sign-out and key removal
          affect Saul and EZ.
        </p>
      )}
      {owner === 'saul' && (
        <div className="row">
          <span>
            {connected === undefined
              ? 'Loading API connection…'
              : connected
                ? 'OpenAI API key saved'
                : 'OpenAI API key required'}
          </span>
          {connected && (
            <button
              type="button"
              className="btn"
              disabled={disabled || busy}
              onClick={() => void remove()}
            >
              Remove key
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {owner === 'saul' && retired === false && (
        <div className="row">
          <span>Connected · old credential cleanup pending</span>
          <button
            type="button"
            className="btn"
            disabled={disabled || busy}
            onClick={() => void cleanup()}
          >
            Retry cleanup
          </button>
        </div>
      )}
    </div>
  );
}
