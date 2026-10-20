import { useRef, useState } from 'react';
import { X, Copy, Check, RefreshCw, Pin, Bookmark, Square, ChevronDown } from 'lucide-react';
import type { Passage, RunResult, RunStatus } from '../types/storage';
import { TagStreamParser } from '../parser/tag-stream-parser';
import { AnnotatedTextView } from './AnnotatedTextView';
import { useAnchoredPosition } from './useAnchoredPosition';
import { InputOutputInspector } from './InputOutputInspector';
export const runLabel = (status: RunStatus) =>
  ({
    queued: 'Waiting…',
    running: 'Explaining…',
    saving: 'Saving…',
    completed: 'Saved',
    failed: 'Incomplete',
    interrupted: 'Interrupted',
    cancelled: 'Stopped',
  })[status];
interface Props {
  range: Range | null;
  passage: Passage;
  pinned: boolean;
  busy: boolean;
  minimum: boolean;
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
  minimum,
  onRetry,
  onClose,
  onStop,
  onPin,
  onBookmark,
  loadRuns,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const anchored = useAnchoredPosition(range, ref);
  const style = range
    ? anchored
    : { position: 'fixed' as const, right: 12, bottom: 76, zIndex: 2147483647 };
  const [copied, setCopied] = useState(false),
    [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const [runs, setRuns] = useState<RunResult[] | null>(null);
  const latest = passage.latest,
    answer = passage.completed || latest;
  const active = ['queued', 'running', 'saving'].includes(latest.status);
  const segments = new TagStreamParser().feed(answer.responseRaw);
  const activity = latest.activity || (latest.responseRaw ? 'generating' : 'waiting');
  const activityLabel = {
    connecting: 'Connecting…',
    waiting: 'Waiting for answer…',
    thinking: 'Thinking…',
    generating: 'Generating response…',
  }[activity];
  const statusLabel = latest.status === 'running' ? activityLabel : runLabel(latest.status);
  const iconClass =
    'p-2 text-muted hover:bg-subtle rounded-control focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40';
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
  const copyButton = segments.length > 0 && (
    <button
      className={`${iconClass} flex items-center gap-1 text-sm`}
      aria-label="Copy explanation"
      onClick={copy}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
  return (
    <div
      ref={ref}
      role="region"
      aria-label="Saul explanation"
      data-minimum={minimum}
      style={style}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(event) => {
        if (
          event.key !== 'Escape' ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          event.repeat
        )
          return;
        const target = event.target instanceof Element ? event.target : null;
        const openDetails = [
          ...(ref.current?.querySelectorAll<HTMLDetailsElement>('details[open]') || []),
        ];
        const details = target?.closest<HTMLDetailsElement>('details[open]') || openDetails.at(-1);
        if (details) {
          event.preventDefault();
          event.stopPropagation();
          details.open = false;
          details.querySelector<HTMLElement>(':scope > summary')?.focus();
        } else if (minimum && more) {
          event.preventDefault();
          event.stopPropagation();
          setMore(false);
          moreButton.current?.focus();
        }
      }}
      className="saul-card w-96 max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] flex flex-col bg-surface rounded-panel border border-line saul-elevated text-ink font-sans"
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-2">
        <span className="saul-subject truncate" title={passage.snapshot.text}>
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
      <div
        className="saul-activity-divider"
        data-activity={latest.status === 'running' ? activity : undefined}
        aria-hidden="true"
      />
      <div className="px-4 py-3 overflow-y-auto min-h-16">
        {!range && <p className="text-xs text-muted mb-3">Source location unavailable.</p>}
        {latest.error && (
          <p role="alert" className="text-sm text-danger bg-danger-wash p-3 rounded-control mb-3">
            {latest.error}
          </p>
        )}
        {answer.id !== latest.id && <p className="text-xs text-muted mb-2">Previous answer</p>}
        {segments.length ? (
          <AnnotatedTextView segments={segments} isStreaming={answer.status === 'running'} />
        ) : (
          <p className="text-sm text-muted">
            {active ? 'The response will appear here.' : 'No explanation text was returned.'}
          </p>
        )}
        {answer.id !== latest.id && (
          <details className="text-sm mt-3">
            <summary>Latest attempt · {runLabel(latest.status)}</summary>
            <AnnotatedTextView segments={new TagStreamParser().feed(latest.responseRaw)} />
            <InputOutputInspector key={latest.id} run={latest} />
          </details>
        )}
        <InputOutputInspector key={answer.id} run={answer} />
        {error && (
          <p role="alert" className="text-sm text-danger mt-2">
            {error}
          </p>
        )}
        {(!minimum || more) && (
          <div className="mt-4 text-sm saul-more">
            {!active && passage.completed && (
              <div className="flex flex-wrap gap-2 mb-3" aria-label="Follow-up explanations">
                {['Simpler', 'Give an example', 'Go deeper'].map((label) => (
                  <button
                    className="px-2 py-1.5 text-xs rounded-control border border-line hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
                    key={label}
                    disabled={busy}
                    onClick={() => {
                      setRuns(null);
                      setMore(false);
                      onRetry(label);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <button
              className={`${iconClass} text-xs`}
              aria-expanded={runs !== null}
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
            {runs &&
              runs.map((run) => (
                <details key={run.id} className="mt-2">
                  <summary>
                    {runLabel(run.status)} · {new Date(run.createdAt).toLocaleString()}
                  </summary>
                  {run.error && <p>{run.error}</p>}
                  <AnnotatedTextView segments={new TagStreamParser().feed(run.responseRaw)} />
                  <InputOutputInspector run={run} />
                </details>
              ))}
            <details className="text-xs text-muted mt-2">
              <summary>Details</summary>
              <p>
                {answer.recipe?.name}
                {answer.preset?.name ? ` · ${answer.preset.name}` : ''}
              </p>
              <p>
                {answer.model}
                {answer.latencyMs ? ` · ${(answer.latencyMs / 1000).toFixed(1)}s` : ''}
              </p>
              {answer.provider === 'chatgpt-plan' && (
                <p>
                  ChatGPT plan ·{' '}
                  <a
                    href="https://chatgpt.com/settings/usage"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Manage usage
                  </a>
                </p>
              )}
            </details>
          </div>
        )}
      </div>
      <div className="px-3 pb-1 flex flex-wrap items-center gap-1">
        {!active && copyButton}
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
        )}
        {active && copyButton}
        <button
          className={iconClass}
          aria-label={passage.bookmarked ? 'Remove bookmark' : 'Bookmark'}
          aria-pressed={passage.bookmarked}
          disabled={busy}
          onClick={onBookmark}
        >
          <Bookmark size={16} fill={passage.bookmarked ? 'currentColor' : 'none'} />
        </button>
        {minimum && (
          <button
            ref={moreButton}
            className={`${iconClass} ml-auto flex items-center gap-1 text-xs`}
            aria-expanded={more}
            onClick={() => setMore(!more)}
          >
            More <ChevronDown size={14} className={more ? 'rotate-180' : ''} />
          </button>
        )}
      </div>
      <footer className="px-4 pb-3 text-xs text-muted">
        <span role="status">{statusLabel}</span>
      </footer>
    </div>
  );
}
