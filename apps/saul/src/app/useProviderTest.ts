import { useEffect, useRef, useState } from 'react';
import type { UserSettings } from '../types';
import { streamModel } from '../models/provider';
import { validateProviderSettings } from '../storage/settings';
import { configurationFor, settingsForPreset } from '../models/configuration';
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
    let settings = structuredClone(draft);
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
      if (presetId) {
        const preset = configurationFor(settings).presets.find((p) => p.id === presetId);
        if (!preset) throw new Error('Choose an existing preset.');
        settings = settingsForPreset(settings, preset);
      }
      validateProviderSettings(settings);
      if (mode === 'endpoint' && settings.activeProvider === 'openai-compatible') {
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
