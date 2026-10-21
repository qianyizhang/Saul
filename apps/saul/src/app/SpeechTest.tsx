import { useEffect, useRef, useState } from 'react';
import { planCall } from '../models/chatgpt-plan';
import type { PlanAccount } from '../../native/plan-protocol.mjs';

export function SpeechTest({
  account,
  disabled,
  onBusyChange,
}: {
  account?: PlanAccount;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [input, setInput] = useState(
    'Hello from Saul. This is a speech test using my ChatGPT sign-in.',
  );
  const [voice, setVoice] = useState('coral');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [audio, setAudio] = useState('');
  const controller = useRef<AbortController | null>(null);
  const audioURL = useRef('');
  useEffect(
    () => () => {
      controller.current?.abort();
      URL.revokeObjectURL(audioURL.current);
      onBusyChange(false);
    },
    [onBusyChange],
  );
  const run = async () => {
    if (!account?.planEnabled || controller.current || busy || disabled || !input.trim()) return;
    const operation = new AbortController();
    controller.current = operation;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setMessage('Requesting speech…');
    URL.revokeObjectURL(audioURL.current);
    audioURL.current = '';
    setAudio('');
    try {
      const result = await planCall(
        { action: 'speech', accountId: account.id, input, voice },
        operation.signal,
      );
      operation.signal.throwIfAborted();
      const bytes = Uint8Array.from(atob(result.audioBase64), (char) => char.charCodeAt(0));
      audioURL.current = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
      setAudio(audioURL.current);
      setMessage('Speech received using ChatGPT sign-in. Press Play to listen.');
    } catch (cause) {
      if (!operation.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Speech request failed.');
        setMessage('');
      }
    } finally {
      if (!operation.signal.aborted) {
        controller.current = null;
        setBusy(false);
        onBusyChange(false);
      }
    }
  };
  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    onBusyChange(false);
    setMessage('Stopped.');
  };
  return (
    <details>
      <summary>Speech test · experimental</summary>
      <div className="stack">
        <p className="small muted">
          Test speech with the selected ChatGPT account. Availability is unconfirmed; no API-key
          fallback. Audio is AI-generated.
        </p>
        <label className="field">
          Speech text
          <textarea
            rows={3}
            maxLength={512}
            value={input}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <label className="field">
          Speech voice
          <select value={voice} disabled={busy} onChange={(event) => setVoice(event.target.value)}>
            {['coral', 'alloy', 'marin', 'cedar'].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {busy ? (
          <button className="btn" onClick={cancel}>
            Stop speech request
          </button>
        ) : (
          <button
            className="btn"
            disabled={disabled || !account?.signedIn || !account.planEnabled || !input.trim()}
            onClick={() => void run()}
          >
            Test speech
          </button>
        )}
        {!account?.planEnabled && (
          <p className="small">Sign in and enable plan usage above to test speech.</p>
        )}
        {message && <p role="status">{message}</p>}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {audio && (
          <audio controls src={audio} aria-label="Generated speech" style={{ width: '100%' }} />
        )}
        <p className="small muted">
          Uses gpt-4o-mini-tts at /v1/audio/speech. This Speech API model is scheduled to shut down
          January 6, 2027. Text and audio are not saved to history.
        </p>
      </div>
    </details>
  );
}
