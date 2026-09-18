import { useRef, useState } from 'react';
import { X, Copy, Check, RefreshCw, Pin, Bookmark, Square } from 'lucide-react';
import type { SelectionSnapshot, TagSegment } from '../types';
import { AnnotatedTextView } from './AnnotatedTextView';
import { useAnchoredPosition } from './useAnchoredPosition';
export type ExplanationStatus =
  | 'connecting'
  | 'streaming'
  | 'saving'
  | 'saved'
  | 'stopped'
  | 'error';
interface Props {
  range: Range;
  snapshot: SelectionSnapshot;
  segments: TagSegment[];
  isStreaming: boolean;
  error?: string | null;
  latencyMs?: number;
  pinned: boolean;
  bookmarked: boolean;
  status: ExplanationStatus;
  onRetry: (instruction?: string) => void;
  onClose: () => void;
  onStop: () => void;
  onPin: () => void;
  onBookmark: () => void;
}
export function ExplanationCard({
  range,
  snapshot,
  segments,
  isStreaming,
  error,
  latencyMs,
  pinned,
  bookmarked,
  status,
  onRetry,
  onClose,
  onStop,
  onPin,
  onBookmark,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const style = useAnchoredPosition(range, ref);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const iconClass =
    'p-2 text-slate-500 hover:bg-slate-100 rounded-md focus-visible:outline-2 focus-visible:outline-indigo-600';
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        segments.map((s) => (s.type === 'text' ? s.text : s.term)).join(''),
      );
      setCopied(true);
      setCopyError('');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError('Could not copy. Select the explanation and copy it manually.');
    }
  }
  return (
    <div
      ref={ref}
      role="region"
      aria-label="Saul explanation"
      style={style}
      onClick={(e) => e.stopPropagation()}
      className="w-96 max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] flex flex-col bg-white rounded-xl border border-slate-200 shadow-xl text-slate-800 font-sans"
    >
      <header className="flex items-center justify-between p-2 border-b border-slate-100">
        <span className="text-sm font-semibold truncate pl-2" title={snapshot.text}>
          {snapshot.text}
        </span>
        <div className="flex shrink-0">
          <button
            className={iconClass}
            title={pinned ? 'Unpin explanation' : 'Pin explanation'}
            aria-label={pinned ? 'Unpin explanation' : 'Pin explanation'}
            aria-pressed={pinned}
            onClick={onPin}
          >
            <Pin size={16} fill={pinned ? 'currentColor' : 'none'} />
          </button>
          <button
            className={iconClass}
            title="Close"
            aria-label="Close explanation"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="p-4 overflow-y-auto min-h-16">
        {error && (
          <div role="alert" className="text-sm text-rose-700 bg-rose-50 p-3 rounded-lg mb-3">
            <strong>Failed to explain</strong>
            <p>{error}</p>
          </div>
        )}
        {segments.length === 0 && isStreaming ? (
          <p className="text-sm text-slate-500" role="status">
            Connecting to model…
          </p>
        ) : (
          <AnnotatedTextView segments={segments} isStreaming={status === 'streaming'} />
        )}
        {copyError && (
          <p role="alert" className="text-sm text-rose-700 mt-2">
            {copyError}
          </p>
        )}
      </div>
      <div className="px-3 pb-3 flex flex-wrap items-center gap-1">
        {isStreaming ? (
          <button
            className={`${iconClass} flex items-center gap-1 text-sm`}
            disabled={status === 'saving'}
            onClick={onStop}
          >
            <Square size={14} />
            {status === 'saving' ? 'Saving…' : 'Stop'}
          </button>
        ) : (
          <>
            <button
              className={iconClass}
              title="Regenerate"
              aria-label="Regenerate"
              onClick={() => onRetry()}
            >
              <RefreshCw size={16} />
            </button>
            {segments.length > 0 && (
              <button
                className={iconClass}
                title="Copy explanation"
                aria-label="Copy explanation"
                onClick={copy}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            )}
            {status === 'saved' && (
              <button
                className={iconClass}
                aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark'}
                aria-pressed={bookmarked}
                onClick={onBookmark}
              >
                <Bookmark size={16} fill={bookmarked ? 'currentColor' : 'none'} />
              </button>
            )}
            {segments.length > 0 &&
              ['Simpler', 'Give an example', 'Go deeper'].map((label) => (
                <button
                  className="px-2 py-1 text-xs rounded-md border border-slate-200 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-600"
                  key={label}
                  onClick={() => onRetry(label)}
                >
                  {label}
                </button>
              ))}
          </>
        )}
      </div>
      <footer className="px-4 py-2 bg-slate-50 rounded-b-xl text-xs text-slate-500 border-t border-slate-100">
        <span role="status">
          {status === 'saved'
            ? 'Saved to history'
            : status === 'saving'
              ? 'Saving to history…'
              : status === 'stopped'
                ? 'Stopped · partial explanation not saved'
                : status === 'error'
                  ? 'Needs attention'
                  : 'Explaining…'}
        </span>
        {latencyMs ? ` · ${(latencyMs / 1000).toFixed(1)}s` : ''}
        <p className="mt-1">Hover, focus, or click underlined terms for notes.</p>
      </footer>
    </div>
  );
}
