import React, { useState } from 'react';
import type { TagSegment } from '../types';
import { TooltipPopover } from './TooltipPopover';

interface AnnotatedTextViewProps {
  segments: TagSegment[];
  isStreaming?: boolean;
}

export const AnnotatedTextView: React.FC<AnnotatedTextViewProps> = ({
  segments,
  isStreaming,
}) => {
  const [hoveredTerm, setHoveredTerm] = useState<{
    el: HTMLElement;
    term: string;
    note: string;
  } | null>(null);

  return (
    <div className="text-sm leading-relaxed text-slate-800 font-normal select-text">
      {segments.map((seg) => {
        if (seg.type === 'text') {
          return <span key={seg.id}>{seg.text}</span>;
        }

        // Term Segment
        return (
          <span
            key={seg.id}
            onMouseEnter={(e) => {
              if (seg.note) {
                setHoveredTerm({
                  el: e.currentTarget,
                  term: seg.term || 'Concept',
                  note: seg.note,
                });
              }
            }}
            onMouseLeave={() => {
              setHoveredTerm(null);
            }}
            className={`inline-block relative px-1 py-0.5 rounded transition-all duration-200 cursor-help ${
              seg.complete
                ? 'bg-indigo-50/80 text-indigo-900 border-b-2 border-indigo-400 font-medium hover:bg-indigo-100 hover:border-indigo-600'
                : 'bg-indigo-50/50 text-indigo-700 border-b-2 border-indigo-300 border-dashed animate-pulse'
            }`}
          >
            {seg.term || '...'}
          </span>
        );
      })}

      {isStreaming && (
        <span className="inline-block w-1.5 h-4 ml-1 bg-indigo-600 align-middle animate-pulse rounded-sm" />
      )}

      {hoveredTerm && (
        <TooltipPopover
          anchorEl={hoveredTerm.el}
          term={hoveredTerm.term}
          note={hoveredTerm.note}
          onClose={() => setHoveredTerm(null)}
        />
      )}
    </div>
  );
};
