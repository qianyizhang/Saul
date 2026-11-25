import { sourcePage, workspaceSender } from '../platform/chrome/sender';
import { runnerRequest } from '../platform/chrome/runner';
import {
  annotationStatusSchema,
  type AnnotationEditorStatus,
} from '../../shared/protocol/annotation-attempts.ts';
import { mutateAnnotationDraft } from './draft';
import {
  requestSchema,
  captureSchema,
  changeSchema,
  annotationIdSchema,
  MAX_ANNOTATION_BATCH,
  reviewedAnnotationSchema,
  pageUrl,
  type AnnotationCapture,
  type AnnotationResult,
  type AnnotationRequest,
} from '../../shared/protocol/annotations.ts';
import { prepareWritePreset } from '../configuration/resolve';
import { configurationFor } from '../configuration/definition';
import { callStore } from '../calls/store';
import type { Configuration } from '../configuration/definition';
import { z } from 'zod';

import { annotationPanelKey, annotationVersionKey } from './routing';
export async function operateAnnotations(
  request: AnnotationRequest,
  external?: true,
): Promise<AnnotationResult> {
  const parsed = requestSchema.parse(request);
  const result = await runnerRequest<AnnotationResult>({
    operation: 'db',
    message: { type: 'DB_ANNOTATION', payload: { ...parsed, ...(external && { external }) } },
  });
  if (['create', 'change'].includes(parsed.operation.action)) {
    await chrome.storage.session.set({ [annotationVersionKey]: crypto.randomUUID() });
    const urls = new Set([
      ...parsed.scope.urls,
      ...(result.outcomes ?? []).flatMap((o) => (o.record ? [o.record.url] : [])),
    ]);
    for (const tab of await chrome.tabs.query({}))
      if (
        tab.id &&
        tab.url &&
        [...urls].some((url) => url.split('#')[0] === tab.url!.split('#')[0]) &&
        !tab.incognito
      )
        void chrome.tabs
          .sendMessage(tab.id, { type: 'SAUL_ANNOTATIONS_CHANGED' })
          .catch(() => undefined);
  }
  return result;
}
export async function agentAnnotations(request: unknown) {
  const parsed = requestSchema.parse(request);
  parsed.author = { kind: 'agent', name: parsed.author.name };
  return operateAnnotations(parsed, true);
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
type ViewportEvidence =
  { kind: 'available'; screenshot: string } | { kind: 'unavailable'; error: string };

async function takeViewportEvidence(
  capture: AnnotationCapture & { tabId: number },
  windowId: number,
  active: boolean,
): Promise<ViewportEvidence> {
  const { tabId, documentId, url, target } = capture;
  const state = () =>
    chrome.tabs.sendMessage(
      tabId,
      { type: 'SAUL_ANNOTATION_STATE' },
      { documentId },
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
    if (!active) throw new Error('Activate the source tab before capture.');
    const image = await new Promise<string>((resolve, reject) => {
      chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 }, (data) => {
        const error = chrome.runtime.lastError;
        if (error || !data) {
          reject(new Error(error?.message || 'Screenshot unavailable.'));
          return;
        }
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
      after.url !== url ||
      currentState.url !== url
    )
      throw new Error('Page changed during capture. Image was discarded.');
    if (
      currentState.viewport.scrollX !== target.viewport.scrollX ||
      currentState.viewport.scrollY !== target.viewport.scrollY ||
      currentState.viewport.scale !== target.viewport.scale
    )
      throw new Error('Page scrolled or zoomed during capture. Image was discarded.');
    return { kind: 'available', screenshot: image };
  } catch (e) {
    return { kind: 'unavailable', error: (e as Error).message };
  } finally {
    chrome.tabs.onActivated.removeListener(activated);
    chrome.tabs.onUpdated.removeListener(updated);
    chrome.tabs.onZoomChange.removeListener(zoomed);
  }
}
let capturing = false;
async function capture(request: unknown, sender: chrome.runtime.MessageSender) {
  const url = sourcePage(sender);
  const tab = sender.tab!;
  if (tab.incognito) throw new Error('Incognito capture is unavailable.');
  const { id, title, target, comment, url: capturedUrl } = captureSchema.parse(request);
  if (capturedUrl !== url) throw new Error('Page changed before capture. Select the target again.');
  const c = { id, title, target, comment, url, tabId: tab.id!, documentId: sender.documentId };
  const windowId = tab.windowId;
  const evidence =
    target.kind === 'area' ? await takeViewportEvidence(c, windowId, tab.active) : undefined;
  const result = await operateAnnotations({
    scope: { urls: [url], ids: [] },
    author: { kind: 'user', name: 'You' },
    operation: { action: 'create', capture: c },
  });
  if (!evidence) return result;
  let marked: string | undefined,
    error = evidence.kind === 'unavailable' ? evidence.error : undefined;
  try {
    if (evidence.kind === 'available')
      marked = await markedImage(evidence.screenshot, c, result.records![0]!.number);
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
  return result;
}
async function confirmedUrls(tabId: number, url: string, candidates: string[]) {
  const related = candidates.filter(
    (candidate) => candidate !== url && candidate.split('#')[0] === url.split('#')[0],
  );
  if (!related.length) return [url];
  const confirmation = await chrome.tabs
    .sendMessage(tabId, { type: 'SAUL_ANNOTATION_URLS', url, urls: related })
    .catch(() => undefined);
  const confirmed = new Set(confirmation?.urls);
  return [url, ...related.filter((candidate) => confirmed.has(candidate))];
}
async function pageIndex(tabId: number, url: string, filter: 'open' | 'done' | 'all' | 'deleted') {
  const candidates = await runnerRequest<string[]>({
    operation: 'db',
    message: {
      type: 'DB_ANNOTATION_URLS',
      payload: { url, visibility: filter === 'deleted' ? 'masked' : undefined },
    },
  });
  const records = [];
  const stored = new Set(candidates);
  for (const original of await confirmedUrls(tabId, url, candidates)) {
    if (!stored.has(original)) continue;
    let offset: number | undefined = 0;
    do {
      const result: AnnotationResult = await operateAnnotations({
        scope: { urls: [original], ids: [] },
        author: { kind: 'user', name: 'You' },
        operation: { action: 'list', url: original, filter, offset },
      });
      records.push(...(result.records ?? []));
      offset = result.nextOffset;
    } while (offset !== undefined);
  }
  if ((await chrome.tabs.get(tabId)).url !== url)
    throw new Error('Page changed. Refresh the index.');
  return { records: records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) };
}
export function initAnnotations(settings: () => Promise<Configuration>) {
  chrome.tabs.onUpdated.addListener((id, change, tab) => {
    if (change.url && !tab.incognito && /^https?:/.test(change.url))
      void chrome.tabs.sendMessage(id, { type: 'SAUL_ANNOTATIONS_CHANGED' }).catch(() => undefined);
  });
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
          if (tab.id && tab.url?.split('#')[0] === request.url.split('#')[0] && !tab.incognito)
            void chrome.tabs
              .sendMessage(tab.id, { type: 'SAUL_ANNOTATIONS_CHANGED' })
              .catch(() => undefined);
        return {};
      }
      if (request.action === 'page-markers') {
        const url = sourcePage(sender);
        if (sender.tab?.incognito) throw new Error('Incognito annotations unavailable.');
        return pageIndex(sender.tab!.id!, url, 'all');
      }
      if (request.action === 'card-read' || request.action === 'card-change') {
        const current = sourcePage(sender);
        const url = pageUrl.parse(request.url);
        if (
          sender.tab?.incognito ||
          !(await confirmedUrls(sender.tab!.id!, current, [url])).includes(url) ||
          (await chrome.tabs.get(sender.tab!.id!)).url !== current
        )
          throw new Error('Page changed. Reopen the annotation.');
        if (request.action === 'card-read')
          return operateAnnotations({
            scope: { urls: [url], ids: [] },
            author: { kind: 'user', name: 'You' },
            operation: { action: 'read', id: annotationIdSchema.parse(request.id), image: false },
          });
        const change = changeSchema.parse(request.change);
        if (!['edit', 'append', 'complete', 'reopen'].includes(change.action))
          throw new Error('Unavailable in the page card.');
        return operateAnnotations({
          scope: { urls: [url], ids: [] },
          author: { kind: 'user', name: 'You' },
          operation: { action: 'change', changes: [change] },
        });
      }
      if (request.action === 'capture') {
        if (capturing) throw new Error('Another capture is in progress. Try again after it saves.');
        capturing = true;
        try {
          return await capture(request.capture, sender);
        } finally {
          capturing = false;
        }
      }
      if (request.action === 'open') {
        const url = sourcePage(sender);
        void url;
        return openPanel(sender.tab!.windowId, annotationIdSchema.optional().parse(request.id));
      }
      if (!workspaceSender(sender)) throw new Error('Annotation editor only.');
      if (request.action === 'page-index') {
        const tab = await chrome.tabs.get(z.number().int().parse(request.tabId));
        if (tab.incognito || tab.url !== request.url)
          throw new Error('Page changed. Refresh the index.');
        return pageIndex(
          tab.id!,
          pageUrl.parse(tab.url),
          z.enum(['open', 'done', 'all', 'deleted']).parse(request.filter),
        );
      }
      if (request.action === 'draft') return mutateAnnotationDraft(request.mutation);
      if (request.action === 'operate')
        return operateAnnotations({
          scope: { urls: [request.url], ids: [] },
          author: { kind: 'user', name: 'You' },
          operation: request.operation,
        });
      if (request.action === 'status')
        return runnerRequest<AnnotationEditorStatus>({
          operation: 'db',
          message: {
            type: 'DB_ANNOTATION_STATUS',
            payload: annotationStatusSchema.parse({
              url: request.url,
              id: request.id,
              known: request.known,
              visibility: request.visibility,
            }),
          },
        });
      if (request.action === 'start-capture') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || tab.incognito) throw new Error('Choose an ordinary web page.');
        return chrome.tabs.sendMessage(tab.id, { type: 'SAUL_ANNOTATE', fromPanel: true });
      }
      if (request.action === 'choices') {
        const s = await settings();
        const calls = await callStore.readChoices(settings);
        return {
          presets: configurationFor(s).presets.filter((p) => (p.capability ?? 'write') === 'write'),
          calls: calls.state === 'ready' ? (calls.choices.library ?? []) : [],
        };
      }
      if (request.action === 'respond') {
        const p = z
          .object({
            url: pageUrl,
            targets: z.array(reviewedAnnotationSchema).min(1).max(MAX_ANNOTATION_BATCH),
            presetId: annotationIdSchema,
            textOnly: z.boolean(),
            current: z.boolean(),
            callRevision: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
          })
          .strict()
          .parse(request.options);
        const s = await settings(),
          prepared = prepareWritePreset(s, p.presetId);
        if (p.callRevision) {
          const calls = await callStore.readChoices(settings);
          if (
            calls.state !== 'ready' ||
            !calls.choices.library?.some((c) => c.revision.revision === p.callRevision)
          )
            throw new Error('Choose an approved Call.');
        }
        const related = p.targets.flatMap((t) => (t.url ? [t.url] : []));
        if (related.length) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id || tab.incognito || tab.url !== p.url)
            throw new Error('Activate the annotation page.');
          const allowed = await confirmedUrls(tab.id, p.url, related);
          if (related.some((url) => !allowed.includes(url)))
            throw new Error('Annotation belongs to another page.');
        }
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
      if (request.action === 'inspect') {
        const result = await runnerRequest<{ attempts: unknown[] }>({
          operation: 'annotation',
          message: {
            action: 'attempts',
            id: annotationIdSchema.parse(request.id),
          },
        });
        return result.attempts;
      }
      if (request.action === 'stop')
        return runnerRequest({
          operation: 'annotation',
          message: { action: request.action, id: annotationIdSchema.parse(request.id) },
        });
      throw new Error('Unknown annotation action.');
    })().then(
      (result) => reply({ success: true, result }),
      (error) => reply({ success: false, error: (error as Error).message }),
    );
    return true;
  });
  // Cleanup happens through the store on use. No page-reading timer or model request is started.
}
