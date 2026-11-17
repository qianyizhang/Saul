import { Bookmark, ExternalLink, Trash2, ChevronDown } from 'lucide-react';
import type { HistoryItem, RunResult } from '../../../shared/protocol/history-types.ts';
import { safeSource } from './history-format';
import { runLabel } from './run-status';
import { PastAttemptContent } from './PastAttemptContent';
import { GeneratedImageView } from './GeneratedImageView';
import { AnnotatedTextView } from './AnnotatedTextView';
import { TagStreamParser } from '../../../shared/model/tag-stream-parser.ts';
import { RunDetails } from '../../ui/RunDetails';
import { InputOutputInspector } from '../../ui/InputOutputInspector';

export function HistoryEntry({
  item,
  expanded,
  minimum,
  busy,
  runs,
  onExpand,
  onBookmark,
  onDelete,
  onOpenSource,
}: {
  item: HistoryItem;
  expanded: boolean;
  minimum: boolean;
  busy: boolean;
  runs: RunResult[];
  onExpand: () => void;
  onBookmark: () => void;
  onDelete: () => void;
  onOpenSource: () => void;
}) {
  return (
    <article className="history-entry">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <button className="history-title grow" aria-expanded={expanded} onClick={onExpand}>
          <span className="history-preview">{item.selectedText}</span>
          {item.unread && <span className="badge">New</span>}{' '}
          <ChevronDown size={14} className="disclosure-icon" />
        </button>
        <button
          className="btn icon"
          disabled={busy}
          aria-label={item.bookmarked ? 'Remove bookmark' : 'Bookmark'}
          aria-pressed={item.bookmarked}
          onClick={onBookmark}
        >
          <Bookmark size={16} fill={item.bookmarked ? 'currentColor' : 'none'} />
        </button>
        {!minimum && (
          <button
            className="btn icon danger"
            title="Delete"
            aria-label="Delete highlight"
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <div className="row between small muted" style={{ marginTop: 8 }}>
        {safeSource(item.pageUrl) ? (
          <button
            className="source-link"
            onClick={onOpenSource}
            title="View source and explanation"
          >
            {item.pageTitle || item.pageUrl}{' '}
            <ExternalLink size={12} style={{ display: 'inline' }} />
          </button>
        ) : (
          <span>{item.pageTitle || item.pageUrl}</span>
        )}
        <time className="standard-only">{new Date(item.createdAt).toLocaleDateString()}</time>
      </div>
      {expanded && (
        <div className="answer">
          <p className="small muted" role="status">
            {runLabel(item.latest.status)}
            {item.completed && item.completed.id !== item.latest.id ? ' · Previous answer' : ''}
          </p>
          {item.latest.error && (
            <p className="notice error" role="alert">
              {item.latest.error}
            </p>
          )}
          {(item.completed || item.latest).inspection?.followUpQuestion && (
            <p style={{ whiteSpace: 'pre-wrap', fontWeight: 600 }}>
              {(item.completed || item.latest).inspection?.followUpQuestion}
            </p>
          )}
          {item.hasImage && (
            <GeneratedImageView
              key={(item.completed || item.latest).id}
              selectionId={item.selectionId}
              runId={(item.completed || item.latest).id}
              workspace
            />
          )}
          <AnnotatedTextView segments={new TagStreamParser().feed(item.responseRaw)} />
          <RunDetails
            key={`details-${(item.completed || item.latest).id}`}
            run={item.completed || item.latest}
          >
            {minimum && (
              <InputOutputInspector
                key={(item.completed || item.latest).id}
                run={item.completed || item.latest}
              />
            )}
          </RunDetails>
          {!minimum && (
            <InputOutputInspector
              key={(item.completed || item.latest).id}
              run={item.completed || item.latest}
            />
          )}
          <details className="history-more">
            <summary>More</summary>
            {runs
              .filter((run) => run.id !== (item.completed || item.latest).id)
              .map((run) => (
                <details key={run.id}>
                  <summary>
                    {runLabel(run.status)} · {new Date(run.createdAt).toLocaleString()}
                  </summary>
                  <PastAttemptContent run={run} selectionId={item.selectionId} workspace />
                </details>
              ))}
            {minimum && (
              <button
                className="btn danger"
                aria-label="Delete highlight"
                disabled={busy}
                onClick={onDelete}
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
          </details>
        </div>
      )}
    </article>
  );
}
