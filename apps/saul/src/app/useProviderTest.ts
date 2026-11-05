import { useEffect, useRef, useState } from 'react';
import type { UserSettings } from '../types';
import { streamModel } from '../models/provider';
import { preparePreset } from '../models/preset-resolution';
import { configurationFor, presetFromSettings } from '../models/configuration';
export function useProviderTest() {
  const [testing, setTesting] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  async function test(mode: 'endpoint' | 'generation', draft: UserSettings, presetId?: string) {
    if (controller.current) return;
    const settings = structuredClone(draft);
    const ac = new AbortController();
    controller.current = ac;
    setError('');
    setNotice('');
    setTesting(true);
    const timeout = setTimeout(
      () => ac.abort(),
      settings.activeProvider === 'openai-compatible' ? 20000 : 120000,
    );
    try {
      const preset = presetId
        ? configurationFor(settings).presets.find((p) => p.id === presetId)
        : presetFromSettings(settings, 'test-current', 'Current');
      if (!preset) throw new Error('Choose an existing preset.');
      const prepared = preparePreset(settings, preset);
      if (mode === 'endpoint' && prepared.choices.provider === 'openai-compatible') {
        const base = prepared.choices.remote.baseUrl
          .replace(/\/+$/, '')
          .replace(/\/chat\/completions$/, '');
        const res = await fetch(`${base}/models`, {
          signal: ac.signal,
          headers: prepared.credential ? { Authorization: `Bearer ${prepared.credential}` } : {},
        });
        if (!res.ok)
          throw new Error(
            `Endpoint returned ${res.status}. Generation may still work if this server does not expose a model list.`,
          );
        if (mounted.current)
          setNotice('Endpoint reachable. Use Test generation to check the selected model.');
      } else {
        let answer = '';
        for await (const event of streamModel(
          {
            ...prepared.choices,
            systemPrompt: 'Reply briefly.',
            userPrompt: 'Say hello.',
            context: { selection: '', pageTitle: '', pageUrl: '' },
          },
          prepared.credential,
          ac.signal,
          { maxTokens: 32 },
        ))
          if (event.type === 'delta') answer += event.text;
        if (ac.signal.aborted) throw new Error('Stopped');
        if (!answer.trim())
          throw new Error('The model returned no text. Check the model and endpoint.');
        if (mounted.current) setNotice(`Generation succeeded: ${answer.slice(0, 120)}`);
      }
    } catch (e) {
      if (mounted.current)
        setError(
          ac.signal.aborted
            ? 'Test stopped or timed out. Try again when the provider is ready.'
            : (e as Error).message,
        );
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      if (mounted.current) {
        setTesting(false);
      }
    }
  }
  return {
    testing,
    notice,
    error,
    test,
    stop: () => controller.current?.abort(),
    clear: () => {
      setError('');
      setNotice('');
    },
  };
}
