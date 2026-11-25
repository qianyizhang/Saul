import { HistoryEntry } from '../reading/ui/HistoryEntry';
import { ActionLabel } from '../ui/ActionLabel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, Download } from 'lucide-react';
import { useRefreshOnFocus } from '../ui/useRefreshOnFocus';
import {
  fetchHistory,
  deleteHistorySelection,
  restoreHistorySelection,
  purgeHistorySelection,
  clearAllHistory,
  exportKnowledgeMarkdown,
  setHistoryBookmark,
  sendDbMessage,
} from '../storage/history-client';
import { openHistorySource } from '../reading/client';
import type { HistoryItem, RunResult } from '../../shared/protocol/history-types.ts';
import { downloadMarkdown } from '../reading/ui/history-format';

export function Library({
  compact = false,
  refreshKey = 0,
  minimum = true,
  deleted = false,
}: {
  compact?: boolean;
  refreshKey?: number;
  minimum?: boolean;
  deleted?: boolean;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState('');
  const [bookmarks, setBookmarks] = useState(false);
  const [cursors, setCursors] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const cursor = cursors.at(-1);
  const page = cursors.length;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const request = useRef(0);
  const expandedRequest = useRef(0);
  const size = compact ? 10 : 30;
  useRefreshOnFocus(useCallback(() => refresh((n) => n + 1), []));
  useEffect(() => {
    const id = ++request.current;
    setBusy(true);
    setError('');
    const timer = setTimeout(
      () => {
        fetchHistory(size, cursor, query, bookmarks && !deleted, deleted ? 'masked' : 'visible')
          .then(({ items, cursor: next }) => {
            if (request.current !== id) return;
            if (!items.length && cursor !== undefined) {
              setCursors((previous) => previous.slice(0, -1));
              return;
            }
            setItems(items);
            setNextCursor(next);
          })
          .catch((err) => {
            if (request.current === id) setError(err.message);
          })
          .finally(() => {
            if (request.current === id) setBusy(false);
          });
      },
      query ? 180 : 0,
    );
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [query, bookmarks, deleted, cursor, revision, size, refreshKey]);
  async function expand(item: HistoryItem) {
    const revision = ++expandedRequest.current;
    if (expanded === item.selectionId) {
      setExpanded(null);
      return;
    }
    setExpanded(item.selectionId);
    setRuns([]);
    try {
      if (item.completed)
        await sendDbMessage({
          type: 'DB_VIEW',
          payload: { selectionId: item.selectionId, runId: item.completed.id },
        });
      const runs = await sendDbMessage({
        type: 'DB_RUNS',
        payload: { selectionId: item.selectionId },
      });
      if (revision !== expandedRequest.current) return;
      setRuns(runs);
      refresh((n) => n + 1);
      setItems((rows) =>
        rows.map((row) =>
          row.selectionId === item.selectionId && row.completed?.id === item.completed?.id
            ? { ...row, unread: false }
            : row,
        ),
      );
    } catch (e) {
      if (revision === expandedRequest.current) setError((e as Error).message);
    }
  }
  async function action(fn: () => Promise<unknown>) {
    setActionBusy(true);
    setError('');
    try {
      await fn();
      refresh((n) => n + 1);
    } catch (err) {
      setError(String(err));
    } finally {
      setActionBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="row between standard-only">
        <div>
          <h2 className="view-title">{deleted ? 'Recently deleted' : 'History'}</h2>
          {!deleted && (
            <p className="muted small">
              Select text on a page, then choose Explain. Find it here alongside EZ history.
            </p>
          )}
        </div>
      </div>
      <div className="row library-search">
        <input
          className="search grow"
          aria-label={deleted ? 'Search recently deleted' : 'Search history'}
          placeholder={deleted ? 'Search recently deleted' : 'Search history'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursors([]);
          }}
        />
        {!deleted && (
          <button
            className="btn icon"
            aria-label="Bookmarks"
            title="Bookmarks"
            aria-pressed={bookmarks}
            onClick={() => {
              setBookmarks(!bookmarks);
              setCursors([]);
            }}
          >
            <Bookmark size={16} fill={bookmarks ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}{' '}
          <button className="btn" onClick={() => refresh((n) => n + 1)}>
            Refresh
          </button>
        </div>
      )}
      {busy && !items.length ? (
        <p role="status" className="muted">
          Loading history…
        </p>
      ) : !error && !items.length ? (
        <div className="empty">
          <p>
            {deleted
              ? query
                ? 'No matching deleted records.'
                : 'No recently deleted records.'
              : query
                ? 'No matching highlights.'
                : bookmarks
                  ? 'No bookmarks yet.'
                  : 'No highlights recorded yet.'}
          </p>
          {!deleted && (
            <p className="muted small standard-only">
              {query
                ? 'Try another word, source title, or phrase.'
                : bookmarks
                  ? 'Use the bookmark button on a saved explanation.'
                  : 'Highlight text on a webpage and click Explain, or press Alt+Shift+E.'}
            </p>
          )}
        </div>
      ) : (
        !error && (
          <div className="stack history-list" aria-busy={busy}>
            {items.map((item) =>
              deleted ? (
                <article className="history-entry" key={item.selectionId}>
                  <p className="history-preview">{item.selectedText}</p>
                  <p className="small muted">{item.pageTitle || item.pageUrl}</p>
                  {item.maskedAt !== undefined && (
                    <p className="small muted">
                      Deleted {new Date(item.maskedAt).toLocaleDateString()}
                    </p>
                  )}
                  <div className="row wrap">
                    <button
                      className="btn"
                      disabled={actionBusy || busy}
                      onClick={() => void action(() => restoreHistorySelection(item))}
                    >
                      Restore
                    </button>
                    <button
                      className="btn danger"
                      disabled={actionBusy || busy}
                      onClick={() => {
                        if (
                          window.confirm('Permanently delete this saved record from Saul and EZ?')
                        )
                          void action(() => purgeHistorySelection(item));
                      }}
                    >
                      Delete permanently
                    </button>
                  </div>
                </article>
              ) : (
                <HistoryEntry
                  key={item.selectionId}
                  item={item}
                  expanded={expanded === item.selectionId}
                  minimum={minimum}
                  busy={actionBusy || busy}
                  runs={runs}
                  onExpand={() => void expand(item)}
                  onBookmark={() => void action(() => setHistoryBookmark(item))}
                  onDelete={() => void action(() => deleteHistorySelection(item))}
                  onOpenSource={() => void action(() => openHistorySource(item.selectionId))}
                />
              ),
            )}
          </div>
        )
      )}
      {(page > 0 || nextCursor) && (
        <div className="row between">
          <button
            className="btn"
            disabled={!page || busy}
            onClick={() => setCursors((previous) => previous.slice(0, -1))}
          >
            Previous
          </button>
          <span className="small muted">Page {page + 1}</span>
          <button
            className="btn"
            disabled={!nextCursor || busy}
            onClick={() => nextCursor && setCursors((previous) => [...previous, nextCursor])}
          >
            Next
          </button>
        </div>
      )}
      {!deleted && (
        <details className="library-tools">
          <summary aria-label="Export and manage history" title="Export and manage history">
            <ActionLabel short="Manage" full="Export and manage history" />
          </summary>
          <div className="row between">
            <button
              className="btn"
              disabled={actionBusy}
              aria-label="Export to Markdown"
              title="Export to Markdown"
              onClick={() => action(async () => downloadMarkdown(await exportKnowledgeMarkdown()))}
            >
              <Download size={16} />
              <ActionLabel short="Export" full="Export to Markdown" />
            </button>
            <button
              className="btn danger"
              disabled={actionBusy}
              onClick={() => {
                if (
                  window.confirm(
                    'Permanently clear saved and recently deleted Library records from Saul and EZ on this Mac? Active Saul reading attempts will stop.',
                  )
                )
                  action(async () => {
                    await clearAllHistory();
                    setCursors([]);
                  });
              }}
              aria-label="Clear History"
              title="Clear History"
            >
              Clear History
            </button>
          </div>
          <p className="small muted standard-only">Export includes all saved Library records.</p>
        </details>
      )}
    </div>
  );
}
