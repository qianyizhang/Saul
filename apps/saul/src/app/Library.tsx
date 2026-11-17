import { HistoryEntry } from '../reading/ui/HistoryEntry';
import { ActionLabel } from '../ui/ActionLabel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, Download } from 'lucide-react';
import { useRefreshOnFocus } from '../ui/useRefreshOnFocus';
import {
  fetchHistory,
  deleteHistorySelection,
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
}: {
  compact?: boolean;
  refreshKey?: number;
  minimum?: boolean;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState('');
  const [bookmarks, setBookmarks] = useState(false);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
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
        fetchHistory(size + 1, page * size, query, bookmarks)
          .then((rows) => {
            if (request.current !== id) return;
            if (!rows.length && page > 0) {
              setPage(page - 1);
              return;
            }
            setItems(rows.slice(0, size));
            setMore(rows.length > size);
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
  }, [query, bookmarks, page, revision, size, refreshKey]);
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
      setItems((rows) =>
        rows.map((row) => (row.selectionId === item.selectionId ? { ...row, unread: false } : row)),
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
          <h2 className="view-title">History</h2>
          <p className="muted small">
            Select text on a page, then choose Explain. Find it here alongside EZ history.
          </p>
        </div>
      </div>
      <div className="row library-search">
        <input
          className="search grow"
          aria-label="Search history"
          placeholder="Search history"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <button
          className="btn icon"
          aria-label="Bookmarks"
          title="Bookmarks"
          aria-pressed={bookmarks}
          onClick={() => {
            setBookmarks(!bookmarks);
            setPage(0);
          }}
        >
          <Bookmark size={16} fill={bookmarks ? 'currentColor' : 'none'} />
        </button>
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}{' '}
          <button className="btn" onClick={() => refresh((n) => n + 1)}>
            Retry
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
            {query
              ? 'No matching highlights.'
              : bookmarks
                ? 'No bookmarks yet.'
                : 'No highlights recorded yet.'}
          </p>
          <p className="muted small standard-only">
            {query
              ? 'Try another word, source title, or phrase.'
              : bookmarks
                ? 'Use the bookmark button on a saved explanation.'
                : 'Highlight text on a webpage and click Explain, or press Alt+Shift+E.'}
          </p>
        </div>
      ) : (
        !error && (
          <div className="stack history-list" aria-busy={busy}>
            {items.map((item) => (
              <HistoryEntry
                key={item.selectionId}
                item={item}
                expanded={expanded === item.selectionId}
                minimum={minimum}
                busy={actionBusy}
                runs={runs}
                onExpand={() => void expand(item)}
                onBookmark={() =>
                  void action(() => setHistoryBookmark(item.selectionId, !item.bookmarked))
                }
                onDelete={() => void action(() => deleteHistorySelection(item.selectionId))}
                onOpenSource={() => void action(() => openHistorySource(item.selectionId))}
              />
            ))}
          </div>
        )
      )}
      {(page > 0 || more) && (
        <div className="row between">
          <button className="btn" disabled={!page || busy} onClick={() => setPage((n) => n - 1)}>
            Previous
          </button>
          <span className="small muted">Page {page + 1}</span>
          <button className="btn" disabled={!more || busy} onClick={() => setPage((n) => n + 1)}>
            Next
          </button>
        </div>
      )}
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
                window.confirm('Delete saved history and bookmarks from EZ and Saul on this Mac?')
              )
                action(async () => {
                  await clearAllHistory();
                  setPage(0);
                });
            }}
            aria-label="Clear All"
            title="Clear All"
          >
            <ActionLabel short="Clear" full="Clear All" />
          </button>
        </div>
        <p className="small muted standard-only">
          Export includes the entire library, regardless of the current filter.
        </p>
      </details>
    </div>
  );
}
