import { useEffect, useRef, useState } from 'react';
import { requestSpeech } from '../speech/client';
import type { ModelPreset } from '../types';

export function SpeechTest({
  preset,
  saved,
  disabled,
  onBusyChange,
}: {
  preset: ModelPreset;
  saved: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [input, setInput] = useState('Hello from Saul. This is a speech preview.');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [audio, setAudio] = useState('');
  const controller = useRef<AbortController | null>(null),
    audioURL = useRef('');
  useEffect(
    () => () => {
      controller.current?.abort();
      URL.revokeObjectURL(audioURL.current);
      onBusyChange(false);
    },
    [onBusyChange],
  );
  useEffect(() => {
    URL.revokeObjectURL(audioURL.current);
    audioURL.current = '';
    setAudio('');
    setMessage('');
    setError('');
  }, [preset.model, preset.speechOptions?.voice]);
  const run = async () => {
    if (controller.current || !saved || disabled || !input.trim()) return;
    const operation = new AbortController();
    controller.current = operation;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setMessage('Generating speech…');
    URL.revokeObjectURL(audioURL.current);
    audioURL.current = '';
    setAudio('');
    try {
      const blob = await requestSpeech(
        {
          presetId: preset.id,
          connectionKey: preset.connectionKey ?? '',
          model: preset.model,
          voice: preset.speechOptions?.voice ?? 'marin',
          input,
        },
        operation.signal,
      );
      operation.signal.throwIfAborted();
      audioURL.current = URL.createObjectURL(blob);
      setAudio(audioURL.current);
      setMessage('Speech ready. Press Play to listen.');
    } catch (cause) {
      if (!operation.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Speech failed.');
        setMessage('');
      }
    } finally {
      if (controller.current === operation) {
        controller.current = null;
        setBusy(false);
        onBusyChange(false);
      }
    }
  };
  return (
    <div className="stack speech-preview" role="region" aria-label="Speech preview">
      <label className="field">
        Speech text
        <textarea
          rows={3}
          maxLength={512}
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
        />
      </label>
      <p className="small muted">AI-generated audio · OpenAI API billing</p>
      {!saved && <p role="status">Save changes before generating speech.</p>}
      {busy ? (
        <button
          className="btn"
          aria-label="Stop speech request"
          onClick={() => {
            controller.current?.abort();
            controller.current = null;
            setBusy(false);
            onBusyChange(false);
            setMessage('Stopped.');
          }}
        >
          Stop
        </button>
      ) : (
        <button
          className="btn"
          aria-label="Generate speech"
          title="Generate speech using OpenAI API billing"
          disabled={!saved || disabled || !input.trim()}
          onClick={() => void run()}
        >
          Generate
        </button>
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
      <p className="small muted standard-only">
        Text and audio stay in memory until you leave this preview. Realtime reads the text using a
        generative model; exact wording is not guaranteed.
      </p>
    </div>
  );
}
