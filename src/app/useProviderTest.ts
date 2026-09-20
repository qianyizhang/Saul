import { useEffect, useRef, useState } from 'react';
import type { UserSettings } from '../types';
import { streamOpenAICompatible } from '../models/openai-compatible';
import { chromeAiAvailability, prepareChromeAi } from '../models/chrome-ai';
import { validateProvider } from './useSettingsDraft';
export function useProviderTest() {
  const [testing, setTesting] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [availability, setAvailability] = useState('Checking…');
  const controller = useRef<AbortController | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void chromeAiAvailability().then((v) => {
      if (mounted.current) setAvailability(v);
    });
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  async function test(mode: 'endpoint' | 'generation', draft: UserSettings) {
    if (controller.current) return;
    const settings = structuredClone(draft),
      ac = new AbortController();
    controller.current = ac;
    setError('');
    setNotice('');
    setTesting(true);
    const timeout =
      settings.activeProvider === 'chrome-ai' ? undefined : setTimeout(() => ac.abort(), 20000);
    try {
      validateProvider(settings);
      if (settings.activeProvider === 'chrome-ai') {
        await prepareChromeAi(ac.signal, (progress) => {
          if (mounted.current && !ac.signal.aborted)
            setNotice(`Downloading model: ${Math.round(progress * 100)}%`);
        });
        if (ac.signal.aborted) throw new Error('Stopped');
        const availability = await chromeAiAvailability();
        if (mounted.current) {
          setAvailability(availability);
          setNotice('On-device model is ready.');
        }
      } else if (mode === 'endpoint') {
        const base = settings.openaiCompatible.baseUrl
          .replace(/\/+$/, '')
          .replace(/\/chat\/completions$/, '');
        const res = await fetch(`${base}/models`, {
          signal: ac.signal,
          headers: settings.openaiCompatible.apiKey
            ? { Authorization: `Bearer ${settings.openaiCompatible.apiKey}` }
            : {},
        });
        if (!res.ok)
          throw new Error(
            `Endpoint returned ${res.status}. Generation may still work if this server does not expose a model list.`,
          );
        if (mounted.current)
          setNotice('Endpoint reachable. Use Test generation to check the selected model.');
      } else {
        let answer = '';
        for await (const event of streamOpenAICompatible(
          { ...settings.openaiCompatible, maxTokens: 32 },
          'Reply briefly.',
          'Say hello.',
          ac.signal,
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
      if (mounted.current) setTesting(false);
    }
  }
  return {
    testing,
    notice,
    error,
    availability,
    test,
    stop: () => controller.current?.abort(),
    clear: () => {
      setError('');
      setNotice('');
    },
  };
}
