import type { TabSnapshot } from '../protocol.mts';
import type { ProjectedWindow } from '../workspace-contract.mts';

type DropTarget = {
  destination: string | number;
  card: HTMLElement;
  label: string;
  beforeId?: number;
  groupId?: number;
  list?: HTMLOListElement;
  markerY?: number;
};
interface PointerDrag {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  item: HTMLLIElement;
  tabId: number;
  frame?: number;
  ghost?: HTMLLIElement;
  indicator?: HTMLDivElement;
  badge?: HTMLDivElement;
  previousTime?: number;
  target?: DropTarget;
}
interface WindowDrag {
  id: number;
  x: number;
  y: number;
  card: HTMLElement;
  ghost?: HTMLElement;
  target?: HTMLElement;
}

interface DragOptions {
  layout(): { source: TabSnapshot | null | undefined; windows: ProjectedWindow[] };
  canEdit(): boolean;
  canReorder(): boolean;
  onWindowStart(): void;
  onSelect(tabId: number): void;
  onMove(
    tabId: number,
    destination: string | number,
    beforeId?: number,
    groupId?: number,
    sourceGroupId?: number,
  ): void;
  onReorder(from: string, to: string): void;
  onCancelled(): void;
  onEnd(): void;
}

// Gesture state and its DOM resources live together. Layout and committed effects
// stay with the board; ending a gesture releases deferred board updates.
export function createBoardDrag(options: DragOptions) {
  let pointerDrag: PointerDrag | undefined;
  let draggedTab: number | undefined;
  let windowDrag: WindowDrag | undefined;
  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string) {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  }
  function endDrag() {
    if (pointerDrag) {
      if (pointerDrag.frame !== undefined) cancelAnimationFrame(pointerDrag.frame);
      pointerDrag.ghost?.remove();
      pointerDrag.indicator?.remove();
    }
    document.body.classList.remove('is-dragging');
    draggedTab = undefined;
    pointerDrag = undefined;
    document.querySelectorAll('.dragging, .drop-target').forEach((node) => {
      node.classList.remove('dragging', 'drop-target');
    });
    options.onEnd();
  }
  function dragDestination(x: number, y: number): DropTarget | undefined {
    const hit = document.elementFromPoint(x, y);
    const card = hit?.closest<HTMLElement>('[data-drop-window]');
    if (!card || !hit) return;
    if (card.id === 'new-window') return { destination: 'new', card, label: 'Create a new window' };
    const { source, windows } = options.layout();
    const window = windows.find((w) => String(w.id) === card.dataset.dropWindow);
    if (!window || !source) return;
    const ids = window.tabIds.filter(
      (id) => id !== draggedTab && !source.tabs.find((t) => t.id === id)!.pinned,
    );
    const groupHead = hit.closest<HTMLElement>('[data-group-id]');
    if (groupHead)
      return {
        destination: window.id,
        groupId: Number(groupHead.dataset.groupId),
        card,
        label: window.title + ' · ' + groupHead.textContent,
      };
    const list = card.querySelector<HTMLOListElement>('.tabs');
    if (!list) return;
    const rows = [...list.querySelectorAll<HTMLLIElement>('.tab[data-movable="true"]')].filter(
      (row) => Number(row.dataset.tabId) !== draggedTab,
    );
    const bounds = list.getBoundingClientRect();
    let beforeId: number | undefined,
      markerY = bounds.bottom;
    const footer = hit.closest('.window-end');
    if (list.hidden) return { destination: window.id, card, label: `${window.title} · at the end` };
    if (hit.closest('.window-head')) {
      beforeId = ids[0];
      const first = rows[0]?.getBoundingClientRect();
      markerY = first ? Math.max(bounds.top, first.top) : bounds.bottom;
    } else if (!footer) {
      const next = rows.find((row) => {
        const rect = row.getBoundingClientRect();
        return y < rect.top + rect.height / 2;
      });
      if (next) {
        beforeId = Number(next.dataset.tabId);
        markerY = next.getBoundingClientRect().top;
      } else if (rows.length) {
        const last = rows.at(-1)!;
        beforeId = ids[ids.indexOf(Number(last.dataset.tabId)) + 1];
        markerY = last.getBoundingClientRect().bottom;
      }
    }
    markerY = Math.max(bounds.top, Math.min(bounds.bottom, markerY));
    const index = beforeId === undefined ? ids.length : ids.indexOf(beforeId);
    return {
      destination: window.id,
      beforeId,
      groupId:
        beforeId === undefined
          ? undefined
          : (source.tabs.find((t) => t.id === beforeId)?.groupId ?? -1) >= 0
            ? source.tabs.find((t) => t.id === beforeId)!.groupId
            : undefined,
      card,
      list,
      markerY,
      label: `${window.title} · ${index === ids.length ? 'at the end' : `position ${index + 1}`}`,
    };
  }
  function updateDrag() {
    const drag = pointerDrag;
    if (!drag?.ghost || !drag.badge || !drag.indicator || drag.previousTime === undefined) return;
    const { x, y } = drag;
    drag.ghost.style.transform = `translate3d(${Math.min(x + 16, innerWidth - drag.ghost.offsetWidth - 8)}px, ${Math.max(8, Math.min(y + 14, innerHeight - drag.ghost.offsetHeight - 8))}px, 0)`;
    const target = dragDestination(x, y);
    if (drag.target?.card !== target?.card) {
      drag.target?.card.classList.remove('drop-target');
      target?.card.classList.add('drop-target');
    }
    drag.target = target;
    drag.badge.textContent = target ? target.label : 'Outside a window · release to cancel';
    drag.ghost.classList.toggle('invalid-drop', !target);
    drag.indicator.hidden = !target?.list;
    if (target?.list) {
      const rect = target.list.getBoundingClientRect();
      Object.assign(drag.indicator.style, {
        left: `${rect.left + 8}px`,
        top: `${target.markerY! - 6}px`,
        width: `${rect.width - 16}px`,
      });
    }
  }
  function startDrag(item: HTMLLIElement, tabId: number) {
    draggedTab = tabId;
    item.classList.add('dragging');
    document.body.classList.add('is-dragging');
    if (!pointerDrag) return;
    const ghost = item.cloneNode(true) as HTMLLIElement;
    ghost.className = 'tab drag-ghost';
    ghost.removeAttribute('data-tab-id');
    ghost.removeAttribute('data-focus-key');
    ghost.removeAttribute('title');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.querySelectorAll('button').forEach((button) => button.remove());
    ghost.style.width = `${Math.min(320, item.getBoundingClientRect().width)}px`;
    const badge = element('div', 'drag-destination');
    ghost.append(badge);
    const indicator = element('div', 'drop-indicator');
    indicator.setAttribute('aria-hidden', 'true');
    document.body.append(ghost, indicator);
    Object.assign(pointerDrag, { ghost, indicator, badge, previousTime: performance.now() });
    updateDrag();
    const tick = (time: number) => {
      const drag = pointerDrag;
      if (!drag?.ghost || !drag.badge || !drag.indicator || drag.previousTime === undefined) return;
      const elapsed = Math.min(32, time - drag.previousTime);
      drag.previousTime = time;
      const hit = document.elementFromPoint(drag.x, drag.y);
      const list = hit?.closest('.tabs');
      const velocity = (position: number, start: number, end: number) => {
        const edge = Math.min(56, (end - start) / 3);
        if (position < start + edge)
          return -14 * Math.min(1, (start + edge - position) / edge) ** 2;
        if (position > end - edge) return 14 * Math.min(1, (position - end + edge) / edge) ** 2;
        return 0;
      };
      if (list) {
        const rect = list.getBoundingClientRect();
        list.scrollTop += (velocity(drag.y, rect.top, rect.bottom) * elapsed) / 16;
      }
      window.scrollBy(0, (velocity(drag.y, 0, innerHeight) * elapsed) / 16);
      updateDrag();
      drag.frame = requestAnimationFrame(tick);
    };
    pointerDrag.frame = requestAnimationFrame(tick);
  }
  function pointerSource(item: HTMLLIElement, tabId: number, sourceGroupId?: number) {
    item.addEventListener('pointerdown', (event) => {
      if (
        !options.canEdit() ||
        event.button !== 0 ||
        !event.isPrimary ||
        (event.target instanceof Element && event.target.closest('button, input, select'))
      )
        return;
      // Touch scrolling stays native; number buttons expose tap-based moves.
      if (event.pointerType === 'touch') return;
      event.preventDefault();
      pointerDrag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        item,
        tabId,
      };
      item.setPointerCapture(event.pointerId);
    });
    item.addEventListener('pointermove', (event) => {
      const drag = pointerDrag;
      if (!drag || drag.id !== event.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (draggedTab === undefined && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 6)
        startDrag(item, tabId);
    });
    item.addEventListener('pointerup', (event) => {
      if (pointerDrag?.id !== event.pointerId) return;
      pointerDrag.x = event.clientX;
      pointerDrag.y = event.clientY;
      updateDrag();
      const target = pointerDrag.target;
      const moved = draggedTab !== undefined;
      endDrag();
      if (moved && target)
        options.onMove(tabId, target.destination, target.beforeId, target.groupId, sourceGroupId);
      else if (moved) options.onCancelled();
      else if (sourceGroupId === undefined) {
        options.onSelect(tabId);
      }
    });
    item.addEventListener('pointercancel', endDrag);
    item.addEventListener('lostpointercapture', () => {
      if (pointerDrag) endDrag();
    });
  }
  function endWindowDrag(commit = false) {
    const drag = windowDrag;
    if (!drag) return;
    drag.ghost?.remove();
    drag.card.classList.remove('dragging');
    drag.target?.classList.remove('window-drop-target');
    document.body.classList.remove('is-dragging');
    windowDrag = undefined;
    if (commit && drag.target) {
      options.onReorder(drag.card.dataset.windowId!, drag.target.dataset.windowId!);
    }
    options.onEnd();
  }
  function windowPointerSource(head: HTMLElement, card: HTMLElement) {
    head.addEventListener('pointerdown', (event) => {
      if (
        event.button !== 0 ||
        !event.isPrimary ||
        (event.target instanceof Element && event.target.closest('button, input')) ||
        !options.canReorder()
      )
        return;
      options.onWindowStart();
      windowDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, card };
      head.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    head.addEventListener('pointermove', (event) => {
      const drag = windowDrag;
      if (drag?.id !== event.pointerId) return;
      if (!drag.ghost && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      if (!drag.ghost) {
        drag.ghost = head.cloneNode(true) as HTMLElement;
        drag.ghost.className = 'window-head window-ghost';
        drag.ghost.setAttribute('aria-hidden', 'true');
        drag.ghost.style.width = `${card.offsetWidth}px`;
        drag.ghost.style.setProperty(
          '--window-color',
          card.style.getPropertyValue('--window-color'),
        );
        document.body.append(drag.ghost);
        card.classList.add('dragging');
        document.body.classList.add('is-dragging');
      }
      drag.ghost.style.transform = `translate(${Math.max(8, Math.min(event.clientX - 40, innerWidth - card.offsetWidth - 8))}px, ${Math.max(8, event.clientY - 20)}px)`;
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('.window');
      drag.target?.classList.remove('window-drop-target');
      drag.target = target && target !== card ? target : undefined;
      drag.target?.classList.add('window-drop-target');
    });
    head.addEventListener('pointerup', () => endWindowDrag(true));
    head.addEventListener('pointercancel', () => endWindowDrag());
    head.addEventListener('lostpointercapture', () => endWindowDrag());
  }

  return {
    get active() {
      return Boolean(pointerDrag || windowDrag);
    },
    get tabActive() {
      return Boolean(pointerDrag);
    },
    get windowActive() {
      return Boolean(windowDrag);
    },
    attachTab: pointerSource,
    attachWindow: windowPointerSource,
    cancelTab: endDrag,
    cancelWindow: endWindowDrag,
  };
}
