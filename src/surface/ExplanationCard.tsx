import { useRef, useState } from 'react';
import { X, Copy, Check, RefreshCw, Pin, Bookmark, Square } from 'lucide-react';
import type { Passage, RunResult, RunStatus } from '../types/storage';
import { TagStreamParser } from '../parser/tag-stream-parser';
import { AnnotatedTextView } from './AnnotatedTextView';
import { useAnchoredPosition } from './useAnchoredPosition';
export const runLabel = (status: RunStatus) =>
  ({
    queued: 'Queued',
    running: 'Explaining…',
    saving: 'Saving…',
    completed: 'Ready · saved on this device',
    failed: 'Incomplete · needs attention',
    interrupted: 'Incomplete · interrupted',
    cancelled: 'Incomplete · stopped',
  })[status];
interface Props {
  range: Range | null;
  passage: Passage;
  pinned: boolean;
  busy: boolean;
  onRetry: (instruction?: string) => void;
  onClose: () => void;
  onStop: () => void;
  onPin: () => void;
  onBookmark: () => void;
  loadRuns: () => Promise<RunResult[]>;
}
export function ExplanationCard({
  range,
  passage,
  pinned,
  busy,
  onRetry,
  onClose,
  onStop,
  onPin,
  onBookmark,
  loadRuns,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const anchored = useAnchoredPosition(range, ref);
  const style = range
    ? anchored
    : { position: 'fixed' as const, right: 24, bottom: 76, zIndex: 2147483647 };
  const [copied, setCopied] = useState(false),
    [error, setError] = useState('');
  const [runs, setRuns] = useState<RunResult[] | null>(null);
  const latest = passage.latest,
    answer = passage.completed || latest;
  const active = ['queued', 'running', 'saving'].includes(latest.status);
  const segments = new TagStreamParser().feed(answer.responseRaw);
  const iconClass =
    'p-2 text-slate-500 hover:bg-slate-100 rounded-md focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-40';
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        segments.map((s) => (s.type === 'text' ? s.text : s.term)).join(''),
      );
      setCopied(true);
      setError('');
    } catch {
      setError('Could not copy. Select the explanation and copy it manually.');
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
        <span className="text-sm font-semibold truncate pl-2" title={passage.snapshot.text}>
          {passage.snapshot.text}
        </span>
        <div className="flex shrink-0">
          <button
            className={iconClass}
            aria-label={pinned ? 'Unpin explanation' : 'Pin explanation'}
            aria-pressed={pinned}
            onClick={onPin}
          >
            <Pin size={16} fill={pinned ? 'currentColor' : 'none'} />
          </button>
          <button className={iconClass} aria-label="Close explanation" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="p-4 overflow-y-auto min-h-16">
        {!range && (
          <p className="text-xs text-slate-500 mb-3">
            Source location unavailable on this page. Your explanation is still saved.
          </p>
        )}
        {latest.error && (
          <p role="alert" className="text-sm text-rose-700 bg-rose-50 p-3 rounded-lg mb-3">
            {latest.error}
          </p>
        )}
        {answer.id !== latest.id && (
          <p className="text-xs text-slate-500 mb-2">Previous completed explanation</p>
        )}
        {segments.length ? (
          <AnnotatedTextView segments={segments} isStreaming={answer.status === 'running'} />
        ) : (
          <p className="text-sm text-slate-500">
            {active
              ? 'You can keep reading while Saul explains.'
              : 'No explanation text was returned.'}
          </p>
        )}
        {answer.id !== latest.id && latest.responseRaw && (
          <details className="text-sm mt-3">
            <summary>Latest attempt · {runLabel(latest.status)}</summary>
            <AnnotatedTextView segments={new TagStreamParser().feed(latest.responseRaw)} />
          </details>
        )}
        {error && (
          <p role="alert" className="text-sm text-rose-700 mt-2">
            {error}
          </p>
        )}
        {runs && (
          <div className="mt-3 text-sm border-t border-slate-100">
            {runs.map((run) => (
              <details key={run.id} className="mt-2">
                <summary>
                  {runLabel(run.status)} · {new Date(run.createdAt).toLocaleString()}
                </summary>
                {run.error && <p>{run.error}</p>}
                <AnnotatedTextView segments={new TagStreamParser().feed(run.responseRaw)} />
              </details>
            ))}
          </div>
        )}
      </div>
      <div className="px-3 pb-3 flex flex-wrap items-center gap-1">
        {active ? (
          <button
            className={`${iconClass} flex items-center gap-1 text-sm`}
            disabled={busy || latest.status === 'saving'}
            onClick={onStop}
          >
            <Square size={14} />
            {latest.status === 'saving' ? 'Saving…' : 'Stop'}
          </button>
        ) : (
          <>
            <button
              className={`${iconClass} flex items-center gap-1 text-sm`}
              aria-label={latest.status === 'completed' ? 'Regenerate' : 'Retry explanation'}
              disabled={busy}
              onClick={() => {
                setRuns(null);
                onRetry();
              }}
            >
              <RefreshCw size={16} />
              {latest.status === 'completed' ? 'Regenerate' : 'Retry'}
            </button>
            {segments.length > 0 && (
              <button className={iconClass} aria-label="Copy explanation" onClick={copy}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            )}
            {passage.completed &&
              ['Simpler', 'Give an example', 'Go deeper'].map((label) => (
                <button
                  className="px-2 py-1 text-xs rounded-md border border-slate-200 hover:bg-indigo-50"
                  key={label}
                  disabled={busy}
                  onClick={() => {
                    setRuns(null);
                    onRetry(label);
                  }}
                >
                  {label}
                </button>
              ))}
          </>
        )}
        <button
          className={iconClass}
          aria-label={passage.bookmarked ? 'Remove bookmark' : 'Bookmark'}
          aria-pressed={passage.bookmarked}
          disabled={busy}
          onClick={onBookmark}
        >
          <Bookmark size={16} fill={passage.bookmarked ? 'currentColor' : 'none'} />
        </button>
        <button
          className="text-xs p-2 text-slate-500"
          onClick={() => {
            if (runs) setRuns(null);
            else
              void loadRuns()
                .then(setRuns)
                .catch((e) => setError(e.message));
          }}
        >
          Past attempts
        </button>
      </div>
      <footer className="px-4 py-2 bg-slate-50 rounded-b-xl text-xs text-slate-500 border-t border-slate-100">
        <span role="status">{runLabel(latest.status)}</span>
        {latest.latencyMs ? ` · ${(latest.latencyMs / 1000).toFixed(1)}s` : ''}
        {['queued', 'running'].includes(latest.status) && (
          <p className="mt-1">Close to keep reading; generation continues.</p>
        )}
      </footer>
    </div>
  );
}
