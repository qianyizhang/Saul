import { useId, useState } from 'react';
import type { TagSegment } from '../types';
import { TooltipPopover } from './TooltipPopover';
export function AnnotatedTextView({
  segments,
  isStreaming,
}: {
  segments: TagSegment[];
  isStreaming?: boolean;
}) {
  const [term, setTerm] = useState<{
    el: HTMLElement;
    id: string;
    term: string;
    note: string;
    pinned?: boolean;
  } | null>(null);
  const tooltipId = useId();
  return (
    <div className="text-sm leading-relaxed text-slate-800 font-normal select-text whitespace-pre-wrap">
      {segments.map((seg) =>
        seg.type === 'text' ? (
          <span key={seg.id}>{seg.text}</span>
        ) : (
          <button
            type="button"
            key={seg.id}
            aria-describedby={term?.id === seg.id ? tooltipId : undefined}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              setTerm((current) =>
                current?.pinned ? current : { el, id: seg.id, term: seg.term, note: seg.note },
              );
            }}
            onMouseLeave={() => setTerm((current) => (current?.pinned ? current : null))}
            onFocus={(e) =>
              setTerm({ el: e.currentTarget, id: seg.id, term: seg.term, note: seg.note })
            }
            onBlur={() => setTerm((current) => (current?.pinned ? current : null))}
            onClick={(e) => {
              const el = e.currentTarget;
              setTerm((current) =>
                current?.id === seg.id && current.pinned
                  ? null
                  : {
                      el,
                      id: seg.id,
                      term: seg.term,
                      note: seg.note,
                      pinned: true,
                    },
              );
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setTerm(null);
              }
            }}
            className={`inline rounded-sm border-0 border-b border-indigo-400 bg-indigo-50 text-indigo-900 font-medium cursor-help focus-visible:outline-2 focus-visible:outline-indigo-600 ${seg.complete ? '' : 'animate-pulse'}`}
            style={{ font: 'inherit', padding: '0 2px' }}
          >
            {seg.term || '…'}
          </button>
        ),
      )}
      {isStreaming && (
        <span
          aria-hidden="true"
          className="inline-block w-1 h-4 ml-1 bg-indigo-600 align-middle animate-pulse"
        />
      )}
      {term && (
        <TooltipPopover id={tooltipId} anchorEl={term.el} term={term.term} note={term.note} />
      )}
    </div>
  );
}
