import { getSettings, initStorageSecurity } from '../src/storage/settings';
import { recordExplanationRun, ensureOffscreenDocument } from '../src/storage/client';
import { renderExplainPrompt, DEFAULT_SYSTEM_PROMPT } from '../src/models/prompts';
import { streamOpenAICompatible } from '../src/models/openai-compatible';
import { streamChromeAiOffscreen } from '../src/models/chrome-ai-bridge';
import { TagStreamParser } from '../src/parser/tag-stream-parser';
import type { PortRequest, PortResponse } from '../src/types';
import { initNativeBridge } from '../src/native/bridge';
import { workspaceCall } from '../src/native/workspace';

export default defineBackground(() => {
  console.log('[Saul] Background service worker initialized');
  initStorageSecurity();
  initNativeBridge();

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.type === 'WORKSPACE_TABS') {
      if (!_sender.url?.startsWith(chrome.runtime.getURL('/'))) {
        sendResponse({ success: false, error: 'Extension pages only' });
        return false;
      }
      workspaceCall(request).then(
        (result) => sendResponse({ success: true, result }),
        (error) => sendResponse({ success: false, error: error.message }),
      );
      return true;
    }
    if (request?.type === 'GET_CONTEXT_POLICY') {
      getSettings().then((settings) => sendResponse({ contextPolicy: settings.contextPolicy }));
      return true;
    }
    if (request?.target !== 'saul-background') return false;
    (async () => {
      await ensureOffscreenDocument();
      return chrome.runtime.sendMessage({ ...request.message, target: 'saul-offscreen' });
    })().then(sendResponse, (error) => sendResponse({ success: false, error: error.message }));
    return true;
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
          const language = settings.responseLanguage
            ? `Respond in ${settings.responseLanguage}.`
            : 'Respond in the language of the selected text.';
          const userPrompt = renderExplainPrompt(
            msg.payload.context,
            [msg.payload.customPrompt, language].filter(Boolean).join('\n'),
          );

          let streamGenerator: AsyncGenerator<string, void, unknown>;
          let activeProviderName = settings.activeProvider;
          let activeModelName =
            settings.activeProvider === 'chrome-ai'
              ? 'gemini-nano'
              : settings.openaiCompatible.model;

          if (settings.activeProvider === 'chrome-ai') {
            streamGenerator = streamChromeAiOffscreen(
              settings.chromeAi,
              systemPrompt,
              userPrompt,
              signal,
            );
          } else {
            if (
              !settings.openaiCompatible.apiKey &&
              !settings.openaiCompatible.baseUrl.includes('localhost') &&
              !settings.openaiCompatible.baseUrl.includes('127.0.0.1')
            ) {
              throw new Error(
                'API Key is missing. Please configure your API Key in Saul Settings (Extension Popup).',
              );
            }
            streamGenerator = streamOpenAICompatible(
              settings.openaiCompatible,
              systemPrompt,
              userPrompt,
              signal,
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

            port.postMessage({ type: 'SAVING' });
            // Persist run to SQLite WASM via Offscreen Worker
            await recordExplanationRun({
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
              throw new Error(
                'Explanation generated, but history could not be saved: ' + dbErr.message,
              );
            });

            const doneResponse: PortResponse = {
              type: 'DONE',
              payload: {
                fullText: fullRaw,
                segments,
                usage: { latencyMs },
              },
            };
            port.postMessage(doneResponse);
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
          if (currentAbortController?.signal === signal) currentAbortController = null;
        }
      }
    });
  });
});
