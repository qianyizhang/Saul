import { annotationMessage } from './client';
import type { AnnotationTarget, Annotation, AnnotationSummary, AnnotationResult } from './contract';
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
export async function captureAnnotation(target: AnnotationTarget) {
  if (capturing) return;
  capturing = true;
  const id = crypto.randomUUID();
  const hosts = [
    ...document.querySelectorAll<HTMLElement>(
      'saul-root,saul-annotation-overlay,saul-annotation-markers,saul-annotation-notice',
    ),
  ];
  const hidden = hosts.map((h) => h.style.cssText);
  hosts.forEach((h) => h.style.setProperty('display', 'none', 'important'));
  try {
    const result = await annotationMessage<{ panelError?: string }>({
      action: 'capture',
      capture: {
        id,
        url: location.href,
        title: document.title.slice(0, 1000),
        target,
        comment: '',
      },
    });
    showNotice(
      result.panelError
        ? 'Saved. Open the annotation editor to add your comment.'
        : 'Annotation saved.',
      id,
    );
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
  if (el)
    void captureAnnotation(targetFor(el, 'text', range.getBoundingClientRect(), range.toString()));
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
}
function editable(): boolean {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return (
    !!el?.closest('input,textarea,select,[role="textbox"]') ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}
export function resolveTarget(a: Pick<Annotation, 'url' | 'target'>): DOMRect | undefined {
  if (location.href !== a.url || a.target.kind === 'area' || !a.target.selector) return;
  try {
    const matches = document.querySelectorAll(a.target.selector);
    if (matches.length !== 1) return;
    const el = matches[0]!;
    if (a.target.kind === 'text' && a.target.text) {
      const text = el.textContent ?? '',
        exact = a.target.text,
        start = text.indexOf(exact);
      if (start < 0 || text.indexOf(exact, start + 1) >= 0) return;
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
  const position = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (disposed) return;
      markerRoot.replaceChildren();
      for (const a of saved) {
        const r = resolveTarget(a);
        if (!r || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth)
          continue;
        const button = document.createElement('button');
        button.textContent = String(a.number);
        button.setAttribute('aria-label', `Open annotation ${a.number}`);
        button.style.cssText = `position:fixed;z-index:2147483645;left:${Math.max(0, Math.min(innerWidth - 28, r.right))}px;top:${Math.max(0, r.top)}px;background:Canvas;color:CanvasText;border:2px solid #1967d2;border-radius:50%;min-width:28px;min-height:28px;font:14px system-ui;`;
        button.onclick = () =>
          void annotationMessage({ action: 'open', id: a.id }).catch((e) =>
            showNotice(String(e), a.id),
          );
        markerRoot.append(button);
      }
    });
  };
  const refresh = () => {
    const url = location.href;
    void annotationMessage<AnnotationResult>({ action: 'page-markers' }).then(
      (r) => {
        if (!disposed && url === location.href) {
          saved = r.records ?? [];
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
    message: { type?: string; annotation?: Annotation },
    _sender: chrome.runtime.MessageSender,
    reply: (value: unknown) => void,
  ) => {
    if (message.type === 'SAUL_ANNOTATIONS_CHANGED') refresh();
    if (message.type === 'SAUL_ANNOTATE') {
      start();
      reply({});
    }
    if (message.type === 'SAUL_ANNOTATION_STATE')
      reply(JSON.stringify({ url: location.href, viewport: viewport() }));
    if (message.type === 'SAUL_ANNOTATION_LOCATE' && message.annotation) {
      const rect = resolveTarget(message.annotation);
      reply({ available: !!rect });
      if (rect) {
        const el = document.querySelector(message.annotation.target.selector!);
        el?.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => {
    disposed = true;
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
