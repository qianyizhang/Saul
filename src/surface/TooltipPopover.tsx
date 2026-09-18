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
      className="max-w-xs rounded-lg border border-indigo-200 bg-white p-3 shadow-xl text-slate-800 text-sm leading-relaxed select-text"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <strong className="block text-indigo-700 mb-1">{term}</strong>
      <p>{note}</p>
    </div>,
    root instanceof ShadowRoot ? root : document.body,
  );
}
