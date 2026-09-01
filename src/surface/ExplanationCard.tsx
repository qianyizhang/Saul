import React, { useEffect, useRef, useState } from 'react';
import { computePosition, offset, flip, shift } from '@floating-ui/dom';
import { Sparkles, X, Copy, Check, RefreshCw, AlertCircle } from 'lucide-react';
import type { SelectionSnapshot, TagSegment } from '../types';
import { AnnotatedTextView } from './AnnotatedTextView';

interface ExplanationCardProps {
  range: Range;
  snapshot: SelectionSnapshot;
  segments: TagSegment[];
  isStreaming: boolean;
  error?: string | null;
  latencyMs?: number;
  onRetry: () => void;
  onClose: () => void;
}

export const ExplanationCard: React.FC<ExplanationCardProps> = ({
  range,
  snapshot,
  segments,
  isStreaming,
  error,
  latencyMs,
  onRetry,
  onClose,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!cardRef.current) return;

    const virtualElement = {
      getBoundingClientRect: () => range.getBoundingClientRect(),
    };

    computePosition(virtualElement as any, cardRef.current, {
      placement: 'bottom-start',
      middleware: [
        offset(8),
        flip({ fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
        shift({ padding: 16 }),
      ],
    }).then(({ x, y }) => {
      setPos({ x, y });
    });
  }, [range]);

  const handleCopy = () => {
    const rawText = segments
      .map((s) => (s.type === 'text' ? s.text : s.term))
      .join('');
    if (rawText) {
      navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      ref={cardRef}
      style={{
        position: 'fixed',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        zIndex: 2147483647,
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-96 max-w-[calc(100vw-32px)] bg-white/95 backdrop-blur-md rounded-xl border border-slate-200/80 shadow-2xl overflow-hidden transition-all duration-200 text-slate-800 font-sans"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50/80 border-b border-slate-100">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="p-1 rounded-md bg-indigo-100 text-indigo-600">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-700 truncate">
            {snapshot.text}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {segments.length > 0 && !isStreaming && (
            <button
              onClick={handleCopy}
              title="Copy explanation"
              className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded transition-colors"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {!isStreaming && (
            <button
              onClick={onRetry}
              title="Regenerate"
              className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={onClose}
            title="Close"
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 max-h-72 overflow-y-auto">
        {error ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200/80 text-rose-700 text-xs leading-relaxed">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Failed to explain</p>
              <p className="mt-0.5 text-rose-600">{error}</p>
            </div>
          </div>
        ) : segments.length === 0 && isStreaming ? (
          <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
            <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <span>Connecting to model...</span>
          </div>
        ) : (
          <AnnotatedTextView segments={segments} isStreaming={isStreaming} />
        )}
      </div>

      {/* Footer info */}
      <div className="px-3.5 py-1.5 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
        <span>Hover underlined terms for concept notes</span>
        {latencyMs ? <span>{(latencyMs / 1000).toFixed(2)}s</span> : null}
      </div>
    </div>
  );
};
