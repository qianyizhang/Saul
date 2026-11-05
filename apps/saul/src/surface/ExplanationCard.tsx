import { sendReadingMessage } from '../storage/client';
import { GeneratedImageView } from './GeneratedImageView';
import { useRef, useState } from 'react';
import { X, Copy, Check, RefreshCw, Pin, Bookmark, Square } from 'lucide-react';
import type { Passage, RunResult, RunStatus } from '../types/storage';
import { TagStreamParser } from '../parser/tag-stream-parser';
import { AnnotatedTextView } from './AnnotatedTextView';
import { useAnchoredPosition } from './useAnchoredPosition';
import { InputOutputInspector } from './InputOutputInspector';
import { RunDetails } from './RunDetails';
import { changeLabel, type InputComparison } from '../reading/input-change';
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
  reuse?: InputComparison;
  onRunCurrent?: () => void;
  range: Range | null;
  passage: Passage;
  pinned: boolean;
  busy: boolean;
  minimum: boolean;
  onRetry: (instruction?: string) => Promise<boolean>;
  followUpDraft: string;
  onFollowUpDraft: (value: string) => void;
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
  followUpDraft,
  onFollowUpDraft,
  onClose,
  onStop,
  onPin,
  onBookmark,
  loadRuns,
  reuse,
  onRunCurrent,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [savingImage, setSavingImage] = useState(false);
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
  const earlierRuns = runs?.filter((run) => run.id !== answer.id && run.id !== latest.id);
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
      {!minimum && (copied ? <Check size={16} /> : <Copy size={16} />)}
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
        {reuse && (
          <aside className="saul-reuse" aria-label="Saved result reused">
            <strong>{active ? 'Existing request reopened' : 'Saved result reused'}</strong>
            <p>No new model request.</p>
            <p>
              {reuse.error ||
                (reuse.text ? changeLabel(reuse.text) : 'Current input not verified.')}
            </p>
            {reuse.fields.length > 0 && <p>Also changed: {reuse.fields.join(', ')}</p>}
            {!active && onRunCurrent && (
              <button
                type="button"
                disabled={busy}
                onClick={onRunCurrent}
                aria-label="Run again with current input"
                title="Run again with current input"
              >
                {minimum ? 'Regenerate' : 'Run again with current input'}
              </button>
            )}
          </aside>
        )}
        {!range && <p className="text-xs text-muted mb-3">Source location unavailable.</p>}
        {latest.error && (
          <p role="alert" className="text-sm text-danger bg-danger-wash p-3 rounded-control mb-3">
            {latest.error}
          </p>
        )}
        {latest.reason === 'save-failed' && latest.hasImage && (
          <div>
            {answer.id !== latest.id && (
              <GeneratedImageView selectionId={passage.snapshot.id} runId={latest.id} />
            )}
            <button
              className="px-2 py-1.5 text-sm rounded-control border border-line hover:bg-wash"
              disabled={savingImage}
              onClick={() => {
                setSavingImage(true);
                setError('');
                void sendReadingMessage({ action: 'save-image', selectionId: passage.snapshot.id })
                  .catch((e) => setError(String(e)))
                  .finally(() => setSavingImage(false));
              }}
            >
              {savingImage ? 'Saving…' : 'Retry saving image'}
            </button>
          </div>
        )}
        {answer.id !== latest.id && <p className="text-xs text-muted mb-2">Previous answer</p>}
        {answer.inspection?.followUpQuestion && (
          <p className="text-sm font-medium mb-3 whitespace-pre-wrap">
            {answer.inspection.followUpQuestion}
          </p>
        )}
        {answer.hasImage ? (
          <GeneratedImageView selectionId={passage.snapshot.id} runId={answer.id} />
        ) : segments.length ? (
          <AnnotatedTextView segments={segments} isStreaming={answer.status === 'running'} />
        ) : (
          <p className="text-sm text-muted">
            {active ? 'The response will appear here.' : 'No explanation text was returned.'}
          </p>
        )}
        {answer.id !== latest.id && (
          <details className="text-sm mt-3">
            <summary>Latest attempt · {runLabel(latest.status)}</summary>
            {latest.inspection?.followUpQuestion && (
              <p className="whitespace-pre-wrap">{latest.inspection.followUpQuestion}</p>
            )}
            {latest.hasImage ? (
              <GeneratedImageView selectionId={passage.snapshot.id} runId={latest.id} />
            ) : (
              <AnnotatedTextView segments={new TagStreamParser().feed(latest.responseRaw)} />
            )}
            <RunDetails run={latest} />
            <InputOutputInspector key={latest.id} run={latest} />
          </details>
        )}
        <RunDetails key={`details-${answer.id}`} run={answer}>
          {minimum && <InputOutputInspector key={answer.id} run={answer} />}
        </RunDetails>
        {!minimum && <InputOutputInspector key={answer.id} run={answer} />}
        {error && (
          <p role="alert" className="text-sm text-danger mt-2">
            {error}
          </p>
        )}
        {(!minimum || more) && (
          <div className="mt-4 text-sm saul-more">
            {!active && passage.completed && answer.capability !== 'draw' && (
              <div className="flex flex-wrap gap-2 mb-3" aria-label="Follow-up explanations">
                {['Simpler', 'Give an example', 'Go deeper'].map((label) => (
                  <button
                    className="px-2 py-1.5 text-xs rounded-control border border-line hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
                    key={label}
                    aria-label={label}
                    title={label}
                    disabled={busy}
                    onClick={() => {
                      setRuns(null);
                      setMore(false);
                      void onRetry(label);
                    }}
                  >
                    {minimum
                      ? { Simpler: 'Simpler', 'Give an example': 'Example', 'Go deeper': 'Deeper' }[
                          label
                        ]
                      : label}
                  </button>
                ))}
              </div>
            )}
            <button
              className={`${iconClass} text-xs`}
              aria-label="Past attempts"
              title="Past attempts"
              aria-expanded={runs !== null}
              onClick={() => {
                if (runs) setRuns(null);
                else
                  void loadRuns()
                    .then(setRuns)
                    .catch((e) => setError(e.message));
              }}
            >
              {minimum ? 'Attempts' : 'Past attempts'}
            </button>
            {earlierRuns?.length === 0 && (
              <p className="text-xs text-muted">No earlier attempts.</p>
            )}
            {earlierRuns?.map((run) => (
              <details key={run.id} className="mt-2">
                <summary>
                  {runLabel(run.status)} · {new Date(run.createdAt).toLocaleString()}
                </summary>
                {run.error && <p>{run.error}</p>}
                {run.inspection?.followUpQuestion && (
                  <p className="whitespace-pre-wrap">{run.inspection.followUpQuestion}</p>
                )}
                {run.hasImage ? (
                  <GeneratedImageView selectionId={passage.snapshot.id} runId={run.id} />
                ) : (
                  <AnnotatedTextView segments={new TagStreamParser().feed(run.responseRaw)} />
                )}
                <RunDetails run={run} />
                <InputOutputInspector run={run} />
              </details>
            ))}
          </div>
        )}
      </div>
      {passage.completed && answer.capability !== 'draw' && (
        <form
          className="px-4 pb-2 flex items-end gap-2"
          aria-label="Ask a follow-up"
          onSubmit={(event) => {
            event.preventDefault();
            if (active || busy || !followUpDraft.trim()) return;
            void onRetry(followUpDraft).then((sent) => {
              if (sent) {
                onFollowUpDraft('');
                setRuns(null);
              }
            });
          }}
        >
          <label className="flex-1 min-w-0 text-xs text-muted">
            Ask a follow-up
            <textarea
              className="mt-1 block w-full resize-none rounded-control border border-line bg-surface p-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
              rows={2}
              maxLength={2000}
              value={followUpDraft}
              onChange={(event) => onFollowUpDraft(event.target.value)}
              disabled={active || busy}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  (event.metaKey || event.ctrlKey) &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </label>
          <button
            className={iconClass}
            type="submit"
            aria-label="Send follow-up"
            disabled={active || busy || !followUpDraft.trim()}
          >
            Send
          </button>
        </form>
      )}
      <div className="px-3 pb-1 flex flex-wrap items-center gap-1">
        {!active && copyButton}
        {active ? (
          <button
            className={`${iconClass} flex items-center gap-1 text-sm`}
            disabled={busy || latest.status === 'saving'}
            onClick={onStop}
          >
            {!minimum && <Square size={14} />}
            {latest.status === 'saving' ? 'Saving…' : 'Stop'}
          </button>
        ) : (
          (!minimum || more || latest.status !== 'completed') && (
            <button
              className={`${iconClass} flex items-center gap-1 text-sm`}
              aria-label={latest.status === 'completed' ? 'Regenerate' : 'Retry explanation'}
              disabled={busy}
              onClick={() => {
                setRuns(null);
                void onRetry();
              }}
            >
              {!minimum && <RefreshCw size={16} />}
              {latest.status === 'completed' ? 'Regenerate' : 'Retry'}
            </button>
          )
        )}
        {active && copyButton}
        {(!minimum || more) && (
          <button
            className={iconClass}
            aria-label={passage.bookmarked ? 'Remove bookmark' : 'Bookmark'}
            aria-pressed={passage.bookmarked}
            disabled={busy}
            onClick={onBookmark}
          >
            <Bookmark size={16} fill={passage.bookmarked ? 'currentColor' : 'none'} />
          </button>
        )}
        {minimum && (
          <button
            ref={moreButton}
            className={`${iconClass} ml-auto flex items-center gap-1 text-xs`}
            aria-expanded={more}
            onClick={() => setMore(!more)}
          >
            More
          </button>
        )}
      </div>
      <footer className="px-4 pb-3 text-xs text-muted">
        <span role="status">{statusLabel}</span>
      </footer>
    </div>
  );
}
