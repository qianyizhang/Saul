import { getSettings, initStorageSecurity } from '../src/storage/settings';
import { recordExplanationRun, ensureOffscreenDocument } from '../src/storage/client';
import { renderExplainPrompt, DEFAULT_SYSTEM_PROMPT } from '../src/models/prompts';
import { streamOpenAICompatible } from '../src/models/openai-compatible';
import { streamChromeAi } from '../src/models/chrome-ai';
import { TagStreamParser } from '../src/parser/tag-stream-parser';
import type { PortRequest, PortResponse } from '../src/types';

export default defineBackground(() => {
  console.log('[Saul] Background service worker initialized');
  initStorageSecurity();
  ensureOffscreenDocument().catch((err) => {
    console.warn('[Saul] Offscreen doc preload error:', err);
  });

  // Handle streaming ports from content scripts or popup
  chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
    if (port.name !== 'saul-stream') return;

    let currentAbortController: AbortController | null = null;

    port.onDisconnect.addListener(() => {
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }
    });

    port.onMessage.addListener(async (msg: PortRequest) => {
      if (msg.type === 'ABORT') {
        if (currentAbortController) {
          currentAbortController.abort();
          currentAbortController = null;
        }
        return;
      }

      if (msg.type === 'START_EXPLAIN') {
        if (currentAbortController) {
          currentAbortController.abort();
        }
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;

        const startTime = Date.now();
        const parser = new TagStreamParser();

        try {
          const settings = await getSettings();
          const systemPrompt = settings.customPromptTemplate || DEFAULT_SYSTEM_PROMPT;
          const userPrompt = renderExplainPrompt(msg.payload.context, msg.payload.customPrompt);

          let streamGenerator: AsyncGenerator<string, void, unknown>;
          let activeProviderName = settings.activeProvider;
          let activeModelName =
            settings.activeProvider === 'chrome-ai' ? 'gemini-nano' : settings.openaiCompatible.model;

          if (settings.activeProvider === 'chrome-ai') {
            streamGenerator = streamChromeAi(
              settings.chromeAi,
              systemPrompt,
              userPrompt,
              signal
            );
          } else {
            if (
              !settings.openaiCompatible.apiKey &&
              !settings.openaiCompatible.baseUrl.includes('localhost') &&
              !settings.openaiCompatible.baseUrl.includes('127.0.0.1')
            ) {
              throw new Error(
                'API Key is missing. Please configure your API Key in Saul Settings (Extension Popup).'
              );
            }
            streamGenerator = streamOpenAICompatible(
              settings.openaiCompatible,
              systemPrompt,
              userPrompt,
              signal
            );
          }

          for await (const chunk of streamGenerator) {
            if (signal.aborted) break;

            const segments = parser.feed(chunk);
            const response: PortResponse = {
              type: 'CHUNK',
              payload: {
                rawDelta: chunk,
                accumulatedRaw: parser.getRaw(),
                segments,
              },
            };
            port.postMessage(response);
          }

          if (!signal.aborted) {
            const latencyMs = Date.now() - startTime;
            const fullRaw = parser.getRaw();
            const segments = parser.getSegments();

            const doneResponse: PortResponse = {
              type: 'DONE',
              payload: {
                fullText: fullRaw,
                segments,
                usage: { latencyMs },
              },
            };
            port.postMessage(doneResponse);

            // Persist run to SQLite WASM via Offscreen Worker
            recordExplanationRun({
              snapshot: msg.payload.snapshot,
              context: msg.payload.context,
              provider: activeProviderName,
              model: activeModelName,
              promptVersion: '1.0.0',
              systemPrompt,
              responseRaw: fullRaw,
              segments,
              latencyMs,
            }).catch((dbErr) => {
              console.error('[Saul] Failed to persist selection run to SQLite:', dbErr);
            });
          }
        } catch (err: any) {
          if (!signal.aborted) {
            console.error('[Saul] Stream execution error:', err);
            const errorResponse: PortResponse = {
              type: 'ERROR',
              payload: {
                message: err.message || 'An unexpected error occurred during generation.',
              },
            };
            port.postMessage(errorResponse);
          }
        } finally {
          currentAbortController = null;
        }
      }
    });
  });
});
