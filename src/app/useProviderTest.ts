import { useEffect, useRef, useState } from 'react';
import type { UserSettings } from '../types';
import { streamModel } from '../models/provider';
import { chromeAiAvailability, prepareChromeAi, CHROME_AI_ENABLED } from '../models/chrome-ai';
import { validateProviderSettings } from '../storage/settings';
export function useProviderTest(provider: UserSettings['activeProvider']) {
  const [testing, setTesting] = useState(false),
    [preparing, setPreparing] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [availability, setAvailability] = useState('Checking…');
  const controller = useRef<AbortController | null>(null),
    mounted = useRef(true);
  const availabilityRevision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      availabilityRevision.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    availabilityRevision.current++;
    if (provider === 'chrome-ai' && CHROME_AI_ENABLED) void refreshAvailability();
  }, [provider]);
  async function refreshAvailability(clearError = true) {
    const revision = ++availabilityRevision.current;
    if (clearError) setError('');
    setAvailability('Checking…');
    try {
      const value = await chromeAiAvailability();
      if (mounted.current && availabilityRevision.current === revision) setAvailability(value);
    } catch (e) {
      if (mounted.current && availabilityRevision.current === revision) {
        setAvailability('check failed');
        setError(`Could not check Chrome on-device AI: ${(e as Error).message}`);
      }
    }
  }
  async function test(mode: 'endpoint' | 'generation' | 'prepare', draft: UserSettings) {
    if (controller.current) return;
    const settings = structuredClone(draft),
      ac = new AbortController();
    controller.current = ac;
    setError('');
    setNotice('');
    setTesting(true);
    setPreparing(mode === 'prepare');
    const timeout =
      mode === 'prepare'
        ? undefined
        : setTimeout(
            () => ac.abort(),
            settings.activeProvider === 'openai-compatible' ? 20000 : 120000,
          );
    try {
      validateProviderSettings(settings);
      if (settings.activeProvider === 'chrome-ai' && mode === 'prepare') {
        const availability = await prepareChromeAi(ac.signal, (progress) => {
          if (mounted.current && !ac.signal.aborted)
            setNotice(`Downloading model: ${Math.round(progress * 100)}%`);
        });
        if (ac.signal.aborted) throw new Error('Stopped');
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
      if (settings.activeProvider === 'chrome-ai') await refreshAvailability(false);
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      if (mounted.current) {
        setTesting(false);
        setPreparing(false);
      }
    }
  }
  return {
    testing,
    preparing,
    notice,
    error,
    availability,
    test,
    refreshAvailability,
    stop: () => controller.current?.abort(),
    clear: () => {
      setError('');
      setNotice('');
    },
  };
}
