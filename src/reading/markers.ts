import { buildTextMap, resolveAnchor, type Attachment } from './anchors';
import type { Passage } from '../types/storage';

// The DOM library predates this native Chrome API. This declares its shape;
// it does not emulate the API or alter host text.
type HitRegistry = HighlightRegistry & {
  highlightsFromPoint(x: number, y: number): { highlight: Highlight; ranges: AbstractRange[] }[];
};
export class PassageMarkers {
  readonly attachments = new Map<string, Attachment>();
  private passages: Passage[] = [];
  private observer: MutationObserver;
  private resize: ResizeObserver;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private anchorKey = '';
  private destroyed = false;
  private sheet = new CSSStyleSheet();
  private registry = CSS.highlights as HitRegistry;
  private names = ['ready', 'pending', 'incomplete'].map(
    (state) => `saul-${state}-${crypto.randomUUID()}`,
  );
  private highlights = this.names.map(() => new Highlight());
  private rangeIds = new WeakMap<AbstractRange, string>();
  constructor(
    private open: (id: string) => void,
    private updated: () => void,
  ) {
    if (typeof this.registry?.highlightsFromPoint !== 'function')
      throw new Error(
        'Update Chrome to display clickable underlines. Saved explanations remain available in the page list.',
      );
    this.sheet.replaceSync(
      this.names
        .map(
          (name, i) =>
            `::highlight(${name}) {text-decoration-line:underline;text-decoration-style:${i === 0 ? 'solid' : 'dotted'};text-decoration-color:rgba(99,102,241,.65);text-decoration-thickness:1px;text-underline-offset:2px;}`,
        )
        .join('\n'),
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.sheet];
    this.names.forEach((name, i) => this.registry.set(name, this.highlights[i]!));
    this.observer = new MutationObserver((records) => {
      if (
        records.every((r) =>
          (r.target instanceof Element ? r.target : r.target.parentElement)?.closest('saul-root'),
        )
      )
        return;
      this.scheduleAttach();
    });
    this.observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open'],
    });
    this.resize = new ResizeObserver(() => {
      if ([...this.attachments.values()].some((a) => a.state !== 'attached')) this.scheduleAttach();
    });
    this.resize.observe(document.body);
    document.addEventListener('click', this.click);
    document.fonts.ready.then(() => {
      if (!this.destroyed) this.attach();
    });
  }
  private scheduleAttach() {
    if (this.timer !== undefined || !this.passages.length) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.attach();
    }, 250);
  }
  set(passages: Passage[]) {
    this.passages = passages;
    const key = JSON.stringify(passages.map((p) => [p.snapshot.id, p.snapshot.anchor]));
    if (key !== this.anchorKey) {
      this.anchorKey = key;
      this.attach();
    } else this.paint();
  }
  private attach() {
    this.attachments.clear();
    if (this.passages.length) {
      const map = buildTextMap();
      for (const p of this.passages)
        this.attachments.set(p.snapshot.id, resolveAnchor(p.snapshot.anchor, map));
    }
    this.paint();
    this.updated();
  }
  private paint() {
    for (const highlight of this.highlights) highlight.clear();
    this.rangeIds = new WeakMap();
    for (const p of this.passages) {
      const attachment = this.attachments.get(p.snapshot.id);
      if (attachment?.state !== 'attached') continue;
      const state =
        p.latest.status === 'completed'
          ? 0
          : ['queued', 'running', 'saving'].includes(p.latest.status)
            ? 1
            : 2;
      this.highlights[state]!.add(attachment.range);
      this.rangeIds.set(attachment.range, p.snapshot.id);
    }
  }
  private click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      !window.getSelection()?.isCollapsed
    )
      return;
    if (
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof Element &&
            node.matches(
              'a,button,input,textarea,select,[role="button"],[contenteditable],saul-root',
            ),
        )
    )
      return;
    const point = document.caretPositionFromPoint(event.clientX, event.clientY);
    const hits = new Set<string>();
    for (const hit of this.registry.highlightsFromPoint(event.clientX, event.clientY))
      for (const range of hit.ranges) {
        const id = this.rangeIds.get(range);
        // Some engines hit-test unclipped range boxes. Verify actual text under
        // the pointer too, so a nested reader cannot intercept adjacent content.
        if (
          id &&
          range instanceof Range &&
          point &&
          range.comparePoint(point.offsetNode, point.offset) === 0
        )
          hits.add(id);
      }
    if (hits.size === 1) this.open([...hits][0]!);
  };
  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.observer.disconnect();
    this.resize.disconnect();
    document.removeEventListener('click', this.click);
    this.names.forEach((name) => this.registry.delete(name));
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (sheet) => sheet !== this.sheet,
    );
  }
}
