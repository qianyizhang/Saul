import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPosition } from './useAnchoredPosition';
export function TooltipPopover({
  anchorEl,
  term,
  note,
  id,
}: {
  anchorEl: HTMLElement | null;
  term: string;
  note: string;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const style = useAnchoredPosition(anchorEl, ref, 'top');
  if (!anchorEl || !note) return null;
  const root = anchorEl.getRootNode();
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      style={style}
      className="saul-tooltip max-w-xs rounded-control border border-line bg-surface p-3 saul-elevated text-ink text-sm leading-relaxed select-text"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <strong className="block text-accent mb-1">{term}</strong>
      <p>{note}</p>
    </div>,
    root instanceof ShadowRoot ? root : document.body,
  );
}
