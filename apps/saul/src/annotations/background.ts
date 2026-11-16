import { sourcePage, workspaceSender } from '../contracts/reading';
import { runnerRequest } from '../storage/client';
import {
  requestSchema,
  captureSchema,
  type AnnotationCapture,
  type AnnotationResult,
  type AnnotationRequest,
} from './contract';
import { prepareActionPreset } from '../actions/configuration';
import { configurationFor } from '../models/configuration';
import { callPresetStorage } from '../storage/call-presets';
import type { UserSettings } from '../types';
import { z } from 'zod';

import { ANNOTATION_ACCESS_KEY, annotationPanelKey, annotationVersionKey } from './routing';
export async function operateAnnotations(request: AnnotationRequest): Promise<AnnotationResult> {
  const parsed = requestSchema.parse(request);
  const result = await runnerRequest<AnnotationResult>({
    operation: 'db',
    message: { type: 'DB_ANNOTATION', payload: parsed },
  });
  if (parsed.operation.action === 'change')
    for (const change of parsed.operation.changes) {
      if (
        ['delete', 'purge'].includes(change.action) &&
        result.outcomes?.some((o) => o.id === change.id && !o.error)
      )
        void runnerRequest({
          operation: 'annotation',
          message: { action: 'cancel-annotation', id: change.id },
        }).catch(() => undefined);
    }
  if (['create', 'change'].includes(parsed.operation.action)) {
    await chrome.storage.session.set({ [annotationVersionKey]: crypto.randomUUID() });
    const urls = new Set([
      ...parsed.scope.urls,
      ...(result.outcomes ?? []).flatMap((o) => (o.record ? [o.record.url] : [])),
    ]);
    for (const tab of await chrome.tabs.query({}))
      if (tab.id && tab.url && urls.has(tab.url) && !tab.incognito)
        void chrome.tabs
          .sendMessage(tab.id, { type: 'SAUL_ANNOTATIONS_CHANGED' })
          .catch(() => undefined);
  }
  return result;
}
export async function agentAnnotations(request: unknown) {
  if ((await chrome.storage.local.get(ANNOTATION_ACCESS_KEY))[ANNOTATION_ACCESS_KEY] !== true)
    throw new Error('Enable Annotation access in Settings → Preferences → Integrations.');
  const parsed = requestSchema.parse(request);
  parsed.author = { kind: 'agent', name: parsed.author.name };
  return operateAnnotations(parsed);
}
async function openPanel(windowId: number, id?: string) {
  // Opening is attempted in the original capture gesture. A visible retry remains if Chrome expires it.
  const opening = chrome.sidePanel.open({ windowId });
  await chrome.storage.session.set({ [annotationPanelKey(windowId)]: { view: 'annotations', id } });
  await opening;
}
async function markedImage(data: string, c: AnnotationCapture, number: number) {
  const bitmap = await createImageBitmap(await (await fetch(data)).blob());
  try {
    const ratio = bitmap.width / bitmap.height;
    if (Math.abs(ratio - c.target.viewport.width / c.target.viewport.height) > 0.03)
      throw new Error('Viewport changed before screenshot. The image was discarded.');
    const scale = Math.min(1, 1600 / bitmap.width, 1200 / bitmap.height);
    const canvas = new OffscreenCanvas(
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
    );
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const sx = canvas.width / c.target.viewport.width,
      sy = canvas.height / c.target.viewport.height,
      r = c.target.rect;
    ctx.strokeStyle = '#1967d2';
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x * sx, r.y * sy, r.width * sx, r.height * sy);
    const x = Math.max(2, Math.min(canvas.width - 36, r.x * sx)),
      y = Math.max(2, Math.min(canvas.height - 28, r.y * sy - 28));
    ctx.fillStyle = '#1967d2';
    ctx.fillRect(x, y, 36, 28);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(String(number), x + 7, y + 20);
    for (const quality of [0.8, 0.6, 0.4]) {
      const bytes = new Uint8Array(
        await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer(),
      );
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const image = 'data:image/jpeg;base64,' + btoa(binary);
      if (image.length <= 450000) return image;
    }
    throw new Error('Screenshot exceeds the saved image limit.');
  } finally {
    bitmap.close();
  }
}
let captureBusy = false;
async function capture(request: unknown, sender: chrome.runtime.MessageSender) {
  const url = sourcePage(sender),
    tabId = sender.tab!.id!,
    windowId = sender.tab!.windowId;
  if (sender.tab!.incognito) throw new Error('Incognito capture is unavailable.');
  const c = captureSchema.parse(request);
  if (c.url !== url) throw new Error('Page changed before capture. Select the target again.');
  c.tabId = tabId;
  c.documentId = sender.documentId;
  delete c.image;
  const state = () =>
    chrome.tabs.sendMessage(
      tabId,
      { type: 'SAUL_ANNOTATION_STATE' },
      { documentId: sender.documentId! },
    ) as Promise<string>;

  let changed = false;
  const activated = () => {
    changed = true;
  };
  const updated = (id: number, change: chrome.tabs.OnUpdatedInfo) => {
    if (id === tabId && (change.url || change.status)) changed = true;
  };
  const zoomed = (info: chrome.tabs.OnZoomChangeInfo) => {
    if (info.tabId === tabId) changed = true;
  };
  chrome.tabs.onActivated.addListener(activated);
  chrome.tabs.onUpdated.addListener(updated);
  chrome.tabs.onZoomChange.addListener(zoomed);
  try {
    if (!sender.tab!.active) throw new Error('Activate the source tab before capture.');
    const image = await new Promise<string>((resolve, reject) => {
      chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 }, (data) => {
        const error = chrome.runtime.lastError;
        if (error || !data) {
          reject(new Error(error?.message || 'Screenshot unavailable.'));
          return;
        }
        // Chrome propagates the initiating gesture through its API callback.
        void openPanel(windowId, c.id).catch(() => undefined);
        resolve(data);
      });
    });
    const after = await chrome.tabs.get(tabId);
    const currentState = JSON.parse(
      await state().catch(() => {
        throw new Error('Page changed during capture. Image was discarded.');
      }),
    ) as { url: string; viewport: AnnotationCapture['target']['viewport'] };
    if (
      changed ||
      !after.active ||
      after.pendingUrl ||
      after.status !== 'complete' ||
      after.url !== c.url ||
      currentState.url !== c.url
    )
      throw new Error('Page changed during capture. Image was discarded.');
    if (
      currentState.viewport.scrollX !== c.target.viewport.scrollX ||
      currentState.viewport.scrollY !== c.target.viewport.scrollY ||
      currentState.viewport.scale !== c.target.viewport.scale
    )
      throw new Error('Page scrolled or zoomed during capture. Image was discarded.');
    c.image = image;
  } catch (e) {
    c.imageError = (e as Error).message;
  } finally {
    chrome.tabs.onActivated.removeListener(activated);
    chrome.tabs.onUpdated.removeListener(updated);
    chrome.tabs.onZoomChange.removeListener(zoomed);
  }
  const rawImage = c.image;
  delete c.image;
  const imageError = c.imageError;
  delete c.imageError;
  const result = await operateAnnotations({
    scope: { urls: [url], ids: [] },
    author: { kind: 'user', name: 'You' },
    operation: { action: 'create', capture: c },
  });
  let marked: string | undefined,
    error = imageError;
  try {
    if (rawImage) marked = await markedImage(rawImage, c, result.records![0]!.number);
  } catch (e) {
    error = (e as Error).message;
  }
  await runnerRequest({
    operation: 'db',
    message: {
      type: 'DB_ANNOTATION_IMAGE',
      payload: {
        id: c.id,
        ...(marked ? { image: marked } : { error: error || 'Screenshot unavailable.' }),
      },
    },
  });
  await chrome.storage.session.set({
    [annotationPanelKey(windowId)]: { view: 'annotations', id: c.id },
    [annotationVersionKey]: crypto.randomUUID(),
  });
  const opened = (
    await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.SIDE_PANEL] })
  ).some((v) => v.windowId === windowId);
  return { ...result, ...(!opened ? { panelError: 'Open the annotation editor.' } : {}) };
}
export function initAnnotations(settings: () => Promise<UserSettings>) {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'saul-annotate' && tab?.id !== undefined && !tab.incognito)
      void chrome.tabs.sendMessage(tab.id, { type: 'SAUL_ANNOTATE' }).catch(() => undefined);
  });
  chrome.runtime.onMessage.addListener((request, sender, reply) => {
    if (request?.target !== 'saul-annotation') return false;
    void (async () => {
      if (request.action === 'updated') {
        if (
          sender.id !== chrome.runtime.id ||
          sender.tab ||
          sender.url !== chrome.runtime.getURL('offscreen.html')
        )
          throw new Error('Runner only.');
        await chrome.storage.session.set({ [annotationVersionKey]: crypto.randomUUID() });
        for (const tab of await chrome.tabs.query({}))
          if (tab.id && tab.url === request.url && !tab.incognito)
            void chrome.tabs
              .sendMessage(tab.id, { type: 'SAUL_ANNOTATIONS_CHANGED' })
              .catch(() => undefined);
        return {};
      }
      if (request.action === 'page-markers') {
        const url = sourcePage(sender);
        if (sender.tab?.incognito) throw new Error('Incognito annotations unavailable.');
        return operateAnnotations({
          scope: { urls: [url], ids: [] },
          author: { kind: 'user', name: 'You' },
          operation: { action: 'list', url, filter: 'open', offset: 0 },
        });
      }
      if (request.action === 'capture') {
        if (captureBusy)
          throw new Error('Another capture is in progress. Try again after it saves.');
        captureBusy = true;
        try {
          return await capture(request.capture, sender);
        } finally {
          captureBusy = false;
        }
      }
      if (request.action === 'open') {
        const url = sourcePage(sender);
        void url;
        return openPanel(sender.tab!.windowId, request.id);
      }
      if (!workspaceSender(sender)) throw new Error('Annotation editor only.');
      if (request.action === 'operate')
        return operateAnnotations({
          scope: { urls: [request.url], ids: [] },
          author: { kind: 'user', name: 'You' },
          operation: request.operation,
        });
      if (request.action === 'start-capture') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || tab.incognito) throw new Error('Choose an ordinary web page.');
        return chrome.tabs.sendMessage(tab.id, { type: 'SAUL_ANNOTATE', fromPanel: true });
      }
      if (request.action === 'choices') {
        const s = await settings();
        const calls = await callPresetStorage().read();
        return {
          presets: configurationFor(s).presets.filter((p) => (p.capability ?? 'write') === 'write'),
          calls: calls.library ?? [],
        };
      }
      if (request.action === 'respond') {
        const p = z
          .object({
            url: z.string(),
            ids: z.array(z.string()).min(1).max(20),
            presetId: z.string(),
            textOnly: z.boolean(),
            current: z.boolean(),
            callRevision: z.string().optional(),
          })
          .strict()
          .parse(request.options);
        const s = await settings(),
          prepared = prepareActionPreset(s, p.presetId);
        if (
          p.callRevision &&
          !(await callPresetStorage().read()).library?.some(
            (c) => c.revision.revision === p.callRevision,
          )
        )
          throw new Error('Choose an approved Call.');
        let currentText: string | undefined;
        if (p.current) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id || tab.incognito || tab.url !== p.url)
            throw new Error('Activate the annotation page before reading current text.');
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => ({ url: location.href, text: document.body.innerText.slice(0, 40000) }),
          });
          if (
            !result?.result ||
            result.result.url !== p.url ||
            (await chrome.tabs.get(tab.id)).url !== p.url
          )
            throw new Error('Page changed during current-text capture.');
          currentText = result.result.text;
        }
        return runnerRequest({
          operation: 'annotation',
          message: { action: 'respond', ...p, ...(currentText ? { currentText } : {}) },
          prepared,
        });
      }
      if (request.action === 'inspect' || request.action === 'attempts') {
        const result = await runnerRequest<{ attempts: unknown[] }>({
          operation: 'annotation',
          message: {
            action: 'attempts',
            ...(request.action === 'inspect'
              ? { id: String(request.id) }
              : { annotationId: String(request.annotationId) }),
          },
        });
        return result.attempts;
      }
      if (request.action === 'stop' || request.action === 'save-result')
        return runnerRequest({
          operation: 'annotation',
          message: { action: request.action, id: String(request.id) },
        });
      if (request.action === 'current-text')
        throw new Error('Current text is captured through the runner.');
      throw new Error('Unknown annotation action.');
    })().then(
      (result) => reply({ success: true, result }),
      (error) => reply({ success: false, error: (error as Error).message }),
    );
    return true;
  });
  // Cleanup happens through the store on use. No page-reading timer or model request is started.
}
