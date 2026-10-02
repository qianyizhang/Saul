import { useEffect, useRef, useState } from 'react';
import type { UserSettings } from '../types';
import { streamModel } from '../models/provider';
import { chromeAiAvailability, prepareChromeAi } from '../models/chrome-ai';
import { validateProviderSettings } from '../storage/settings';
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
      settings.activeProvider === 'chrome-ai'
        ? undefined
        : setTimeout(() => ac.abort(), settings.activeProvider === 'chatgpt-plan' ? 120000 : 20000);
    try {
      validateProviderSettings(settings);
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
      } else if (mode === 'endpoint' && settings.activeProvider === 'openai-compatible') {
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
        for await (const event of streamModel(
          {
            provider: settings.activeProvider,
            remote: settings.openaiCompatible,
            local: settings.chromeAi,
            plan: settings.chatgptPlan,
            systemPrompt: 'Reply briefly.',
            userPrompt: 'Say hello.',
            context: { selection: '', pageTitle: '', pageUrl: '' },
          },
          settings.activeProvider === 'openai-compatible' ? settings.openaiCompatible.apiKey : '',
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
