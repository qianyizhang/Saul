import { annotationLabels } from './labels';
import { openAnnotationCard, dismissAnnotationCard } from './page-card';
import { annotationMessage } from './client';
import type {
  AnnotationTarget,
  Annotation,
  AnnotationSummary,
} from '../../shared/protocol/annotations.ts';
export const viewport = () => ({
  width: innerWidth,
  height: innerHeight,
  scrollX,
  scrollY,
  scale: visualViewport?.scale ?? 1,
});
function path(el: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = el; node && parts.length < 15; node = node.parentElement) {
    if (node.id) {
      parts.unshift(`${node.localName}#${CSS.escape(node.id)}`);
      break;
    }
    const siblings = node.parentElement
      ? [...node.parentElement.children].filter((n) => n.localName === node!.localName)
      : [];
    parts.unshift(
      node.localName + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ''),
    );
  }
  return parts.join(' > ');
}
export function targetFor(
  el: Element,
  kind: AnnotationTarget['kind'],
  rect: DOMRect | { x: number; y: number; width: number; height: number },
  text?: string,
): AnnotationTarget {
  return {
    kind,
    label:
      kind === 'area'
        ? 'Selected browser region'
        : (el.getAttribute('aria-label') || text || el.textContent || el.localName)
            .trim()
            .slice(0, 500),
    ...(kind !== 'area'
      ? {
          selector: path(el),
          path: el.localName,
          role: el.getAttribute('role') || el.localName,
          nearbyText: (el.parentElement?.textContent ?? '').trim().slice(0, 2000),
        }
      : {}),
    ...(text ? { text: text.slice(0, 16000) } : {}),
    frame: 'top document',
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: viewport(),
  };
}
let capturing = false;
function locate(a: Pick<Annotation, 'url' | 'target'>) {
  const rect = resolveTarget(a);
  if (rect) {
    const el = a.target.selector && document.querySelector(a.target.selector);
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const current = resolveTarget(a);
    if (current && (current.top < 0 || current.bottom > innerHeight))
      window.scrollBy({ top: current.top - innerHeight / 2, behavior: 'instant' });
  }
  return !!rect;
}
function review(
  a: Pick<Annotation, 'id' | 'url' | 'title' | 'target' | 'comment'>,
  editOnOpen = false,
) {
  locate(a);
  openAnnotationCard({
    capture: { id: a.id, url: a.url, title: a.title, target: a.target, comment: a.comment },
    existing: true,
    editOnOpen,
    rect: () => resolveTarget(a),
    locate: () => locate(a),
  });
}
export async function captureAnnotation(target: AnnotationTarget) {
  if (capturing) return;
  const capture = {
    id: crypto.randomUUID(),
    url: location.href,
    title: document.title.slice(0, 1000),
    target,
    comment: '',
  };
  if (target.kind !== 'area') {
    openAnnotationCard({
      capture,
      rect: () => resolveTarget(capture),
      locate: () => locate(capture),
      saved: () => showNotice('Comment saved.', capture.id),
    });
    return;
  }
  capturing = true;
  const hosts = [
    ...document.querySelectorAll<HTMLElement>(
      'saul-root,saul-annotation-card,saul-annotation-markers,saul-annotation-notice',
    ),
  ];
  const hidden = hosts.map((h) => h.style.cssText);
  hosts.forEach((h) => h.style.setProperty('display', 'none', 'important'));
  try {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const result = await annotationMessage({ action: 'capture', capture });
    const record = result.records?.[0];
    if (record && location.href === capture.url) review(record, true);
  } catch (e) {
    showNotice((e as Error).message);
  } finally {
    hosts.forEach((h, i) => (h.style.cssText = hidden[i]!));
    capturing = false;
  }
}
export function annotateRange(range: Range) {
  const el =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!el) return;
  const target = targetFor(el, 'text', range.getBoundingClientRect(), range.toString());
  const before = range.cloneRange(),
    after = range.cloneRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  after.selectNodeContents(el);
  after.setStart(range.endContainer, range.endOffset);
  target.quoteContext = {
    before: before.toString().slice(-80),
    after: after.toString().slice(0, 80),
  };
  void captureAnnotation(target);
}
function showNotice(text: string, id?: string) {
  document.querySelector('saul-annotation-notice')?.remove();
  const host = document.createElement('saul-annotation-notice');
  const root = host.attachShadow({ mode: 'open' });
  const box = document.createElement('div');
  box.setAttribute('role', 'status');
  box.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:Canvas;color:CanvasText;border:1px solid;padding:12px;font:14px system-ui;max-width:360px;border-radius:8px;';
  const p = document.createElement('p');
  p.textContent = text;
  box.append(p);
  if (id) {
    const open = document.createElement('button');
    open.textContent = 'Open annotation';
    open.onclick = () =>
      void annotationMessage({ action: 'open', id }).then(
        () => host.remove(),
        (e) => (p.textContent = String(e)),
      );
    box.append(open);
  }
  const close = document.createElement('button');
  close.textContent = 'Dismiss';
  close.onclick = () => host.remove();
  box.append(close);
  root.append(box);
  document.documentElement.append(host);
  if (id)
    setTimeout(() => {
      if (!root.activeElement) host.remove();
    }, 5000);
}
function editable(): boolean {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return (
    !!el?.closest('saul-annotation-card,input,textarea,select,[role="textbox"]') ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}
function headingUrl(url: string) {
  const hash = new URL(url).hash;
  if (!hash) return true;
  try {
    const name = decodeURIComponent(hash.slice(1));
    if (!name || /^[!/]/.test(name)) return false;
    const el = document.getElementById(name) ?? document.getElementsByName(name)[0];
    return (
      !!el &&
      (el.matches('h1,h2,h3,h4,h5,h6,[role="heading"]') ||
        !!el.closest('h1,h2,h3,h4,h5,h6,[role="heading"]') ||
        (el.matches('section,article') &&
          !!el.querySelector(
            ':scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > h6',
          )) ||
        (el.matches('a') && !!el.nextElementSibling?.matches('h1,h2,h3,h4,h5,h6')))
    );
  } catch {
    return false;
  }
}
function belongsHere(url: string) {
  return (
    url === location.href ||
    (url.split('#')[0] === location.href.split('#')[0] &&
      headingUrl(url) &&
      headingUrl(location.href))
  );
}
export function resolveTarget(a: Pick<Annotation, 'url' | 'target'>): DOMRect | undefined {
  if (!belongsHere(a.url) || a.target.kind === 'area' || !a.target.selector) return;
  try {
    const matches = document.querySelectorAll(a.target.selector);
    if (matches.length !== 1) return;
    const el = matches[0]!;
    if (a.target.kind === 'text' && a.target.text) {
      const text = el.textContent ?? '',
        exact = a.target.text;
      let start = text.indexOf(exact);
      if (start < 0) return;
      if (text.indexOf(exact, start + 1) >= 0) {
        const context = a.target.quoteContext;
        if (!context) return;
        const full = context.before + exact + context.after;
        const at = text.indexOf(full);
        if (at < 0 || text.indexOf(full, at + 1) >= 0) return;
        start = at + context.before.length;
      }
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null,
        offset = 0;
      const range = document.createRange();
      let begun = false;
      while ((node = walk.nextNode())) {
        const end = offset + (node.textContent?.length ?? 0);
        if (!begun && start < end) {
          range.setStart(node, start - offset);
          begun = true;
        }
        if (begun && start + exact.length <= end) {
          range.setEnd(node, start + exact.length - offset);
          return range.getBoundingClientRect();
        }
        offset = end;
      }
      return;
    }
    if (
      (el.getAttribute('aria-label') || el.textContent || el.localName).trim().slice(0, 500) !==
      a.target.label
    )
      return;
    return el.getBoundingClientRect();
  } catch {
    return;
  }
}
export function installAnnotationCapture() {
  const markers = document.createElement('saul-annotation-markers');
  const markerRoot = markers.attachShadow({ mode: 'open' });
  document.documentElement.append(markers);
  let saved: AnnotationSummary[] = [],
    frame = 0,
    disposed = false;
  const buttons = new Map<string, HTMLButtonElement>();
  const count = document.createElement('button');
  count.style.cssText =
    'position:fixed;bottom:12px;right:12px;z-index:2147483645;padding:5px 9px;border:1px solid;border-radius:16px;color:CanvasText;background:Canvas;font:13px system-ui;cursor:pointer;';
  count.hidden = true;
  count.onclick = (event) => {
    if (event.isTrusted)
      void annotationMessage({ action: 'open' }).catch((e) => showNotice(String(e)));
  };
  markerRoot.append(count);
  const position = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (disposed) return;
      count.hidden = !saved.length;
      count.textContent = 'Annotations ' + saved.length;
      const visible = new Set<string>();
      for (const note of saved) {
        if (note.state !== 'open') continue;
        const rect = resolveTarget(note);
        if (
          !rect ||
          rect.bottom < 0 ||
          rect.top > innerHeight ||
          rect.right < 0 ||
          rect.left > innerWidth
        )
          continue;
        visible.add(note.id);
        let button = buttons.get(note.id);
        if (!button) {
          button = document.createElement('button');
          button.style.cssText =
            'position:fixed;z-index:2147483645;background:Canvas;color:CanvasText;border:2px solid #1967d2;border-radius:50%;min-width:28px;min-height:28px;font:14px system-ui;cursor:pointer;';
          buttons.set(note.id, button);
          markerRoot.append(button);
        }
        button.style.left = Math.max(0, Math.min(innerWidth - 28, rect.right)) + 'px';
        button.style.top = Math.max(0, rect.top) + 'px';
        button.textContent = String(note.number);
        const label = labels.get(note.id)!;
        button.title = label + ' · ' + note.target.label;
        button.setAttribute('aria-label', 'Open annotation ' + label);
        button.onclick = (event) => {
          if (event.isTrusted) review(note);
        };
      }
      for (const [id, button] of buttons)
        if (!visible.has(id)) {
          button.remove();
          buttons.delete(id);
        }
    });
  };
  let labels = new Map<string, string>();
  let version = 0;
  let activeUrl = location.href;
  const refresh = () => {
    const request = ++version;
    if (activeUrl !== location.href) {
      dismissAnnotationCard();
      saved = [];
      position();
      document.querySelector('saul-annotation-notice')?.remove();
      activeUrl = location.href;
    }
    const url = location.href;
    void annotationMessage({ action: 'page-markers' }).then(
      (r) => {
        if (!disposed && request === version && url === location.href) {
          saved = r.records ?? [];
          labels = annotationLabels(saved);
          position();
        }
      },
      () => undefined,
    );
  };
  const observer = new MutationObserver(position);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  addEventListener('scroll', position, { passive: true });
  addEventListener('resize', position);
  addEventListener('popstate', refresh);
  addEventListener('hashchange', refresh);
  refresh();

  let cancel: (() => void) | undefined;
  const start = () => {
    if (editable() || capturing || !/^https?:$/.test(location.protocol)) return;
    cancel?.();
    const previous = document.activeElement;
    const host = document.createElement('saul-annotation-overlay'),
      root = host.attachShadow({ mode: 'open' });
    const overlay = document.createElement('div');
    overlay.tabIndex = 0;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Select an annotation target');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;outline:none;';
    const hint = document.createElement('div');
    hint.textContent =
      'Click an element or drag an area. Arrow keys move the target; Enter captures. Escape cancels.';
    hint.style.cssText =
      'position:absolute;top:8px;left:8px;max-width:70vw;background:Canvas;color:CanvasText;border:1px solid;padding:8px;font:14px system-ui;pointer-events:none;';
    const border = document.createElement('div');
    border.style.cssText = 'position:fixed;border:2px solid #1967d2;pointer-events:none;';
    overlay.append(hint, border);
    root.append(overlay);
    document.documentElement.append(host);
    let origin: { x: number; y: number } | undefined,
      selected: Element = document.body,
      rect = selected.getBoundingClientRect(),
      drag = false;
    const draw = (r: typeof rect) =>
      Object.assign(border.style, {
        left: r.x + 'px',
        top: r.y + 'px',
        width: r.width + 'px',
        height: r.height + 'px',
      });
    const pick = (x: number, y: number) => {
      host.style.display = 'none';
      const el = document.elementFromPoint(x, y);
      host.style.display = '';
      return el;
    };
    cancel = () => {
      host.remove();
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
      cancel = undefined;
    };
    overlay.onpointerdown = (e) => {
      origin = { x: e.clientX, y: e.clientY };
      selected = pick(e.clientX, e.clientY) ?? document.body;
      rect = selected.getBoundingClientRect();
      overlay.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };
    overlay.onpointermove = (e) => {
      if (origin) {
        drag = Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 5;
        rect = new DOMRect(
          Math.min(origin.x, e.clientX),
          Math.min(origin.y, e.clientY),
          Math.abs(e.clientX - origin.x),
          Math.abs(e.clientY - origin.y),
        );
      } else {
        selected = pick(e.clientX, e.clientY) ?? document.body;
        rect = selected.getBoundingClientRect();
      }
      draw(rect);
    };
    overlay.onpointerup = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const suppressClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      window.addEventListener('click', suppressClick, true);
      setTimeout(() => window.removeEventListener('click', suppressClick, true), 0);
      const target = targetFor(
        selected,
        drag ? 'area' : 'element',
        drag ? rect : selected.getBoundingClientRect(),
      );
      cancel?.();
      void captureAnnotation(target);
    };
    overlay.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel?.();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const target = targetFor(selected, 'element', selected.getBoundingClientRect());
        cancel?.();
        void captureAnnotation(target);
        return;
      }
      const next =
        e.key === 'ArrowUp'
          ? selected.parentElement
          : e.key === 'ArrowDown'
            ? selected.firstElementChild
            : e.key === 'ArrowRight'
              ? selected.nextElementSibling
              : e.key === 'ArrowLeft'
                ? selected.previousElementSibling
                : null;
      if (next) {
        e.preventDefault();
        selected = next;
        rect = selected.getBoundingClientRect();
        draw(rect);
      }
    };
    overlay.focus();
    draw(rect);
  };
  const listener = (
    message: { type?: string; annotation?: Annotation; urls?: string[]; url?: string },
    _sender: chrome.runtime.MessageSender,
    reply: (value: unknown) => void,
  ) => {
    if (message.type === 'SAUL_ANNOTATION_URLS')
      reply({ urls: message.url === location.href ? message.urls?.filter(belongsHere) : [] });
    if (message.type === 'SAUL_ANNOTATIONS_CHANGED') refresh();
    if (message.type === 'SAUL_ANNOTATE') {
      start();
      reply({});
    }
    if (message.type === 'SAUL_ANNOTATION_STATE')
      reply(JSON.stringify({ url: location.href, viewport: viewport() }));
    if (message.type === 'SAUL_ANNOTATION_REVIEW' && message.annotation) {
      if (belongsHere(message.annotation.url) && resolveTarget(message.annotation)) {
        review(message.annotation);
        reply({ available: true });
      } else reply({ available: false });
    }
    if (message.type === 'SAUL_ANNOTATION_LOCATE' && message.annotation)
      reply({ available: locate(message.annotation) });
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => {
    disposed = true;
    dismissAnnotationCard();
    cancelAnimationFrame(frame);
    observer.disconnect();
    markers.remove();
    removeEventListener('scroll', position);
    removeEventListener('resize', position);
    removeEventListener('popstate', refresh);
    removeEventListener('hashchange', refresh);
    cancel?.();
    chrome.runtime.onMessage.removeListener(listener);
  };
}
