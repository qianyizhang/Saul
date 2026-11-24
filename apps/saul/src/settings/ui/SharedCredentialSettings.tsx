import { useEffect, useState } from 'react';
import type { Configuration } from '../../configuration/definition';
import { credentialCall } from '../../native/credentials';

export function SharedCredentialSettings({
  owner,
  disabled,
  visible,
  change,
}: {
  owner: Configuration['sharedCredentials'];
  disabled: boolean;
  visible: boolean;
  change: (owner: 'saul' | 'disconnected') => Promise<void>;
}) {
  const [connected, setConnected] = useState<boolean | undefined>();
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
      <p className="small standard-only">
        The signed Saul helper keeps credentials in this Mac’s Keychain. Sign-out and key removal
        affect Saul and EZ.
      </p>
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
    </div>
  );
}
