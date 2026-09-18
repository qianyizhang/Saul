import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, ExternalLink, Trash2, Download, ChevronDown } from 'lucide-react';
import { useRefreshOnFocus } from './useRefreshOnFocus';
import {
  fetchHistory,
  deleteHistorySelection,
  clearAllHistory,
  exportKnowledgeMarkdown,
  setHistoryBookmark,
} from '../storage/client';
import type { HistoryItem } from '../types/storage';
import { AnnotatedTextView } from '../surface/AnnotatedTextView';
import { TagStreamParser } from '../parser/tag-stream-parser';
import { downloadMarkdown, safeSource } from './format';

export function Library({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState('');
  const [bookmarks, setBookmarks] = useState(false);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const request = useRef(0);
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
  }, [query, bookmarks, page, revision, size]);
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
      <div className="row between">
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Reading history</h2>
          <p className="muted small">
            Explanations save automatically. Bookmark the ones to keep close.
          </p>
        </div>
        {!compact && <span className="badge">Stored on this device</span>}
      </div>
      <div className="row">
        <input
          className="search grow"
          aria-label="Search reading history"
          placeholder="Search reading history"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <button
          className="btn"
          aria-pressed={bookmarks}
          onClick={() => {
            setBookmarks(!bookmarks);
            setPage(0);
          }}
        >
          <Bookmark size={16} fill={bookmarks ? 'currentColor' : 'none'} />
          Bookmarks
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
      {busy ? (
        <p role="status" className="muted">
          Loading reading history…
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
          <p className="muted small">
            {query
              ? 'Try another word, source title, or phrase.'
              : bookmarks
                ? 'Use the bookmark button on a saved explanation.'
                : 'Highlight text on a webpage and click Explain, or press Alt+Shift+E.'}
          </p>
        </div>
      ) : (
        !error && (
          <div className="stack">
            {items.map((item) => (
              <article className="history-entry" key={item.selectionId}>
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <button
                    className="history-title grow"
                    aria-expanded={expanded === item.selectionId}
                    onClick={() =>
                      setExpanded(expanded === item.selectionId ? null : item.selectionId)
                    }
                  >
                    "{item.selectedText}" <ChevronDown size={14} style={{ display: 'inline' }} />
                  </button>
                  <button
                    className="btn icon"
                    disabled={actionBusy}
                    aria-label={item.bookmarked ? 'Remove bookmark' : 'Bookmark'}
                    aria-pressed={item.bookmarked}
                    onClick={() =>
                      action(() => setHistoryBookmark(item.selectionId, !item.bookmarked))
                    }
                  >
                    <Bookmark size={16} fill={item.bookmarked ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    className="btn icon danger"
                    title="Delete"
                    aria-label="Delete highlight"
                    disabled={actionBusy}
                    onClick={() => action(() => deleteHistorySelection(item.selectionId))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="row between small muted" style={{ marginTop: 8 }}>
                  {safeSource(item.pageUrl) ? (
                    <a href={safeSource(item.pageUrl)} target="_blank" rel="noreferrer">
                      {item.pageTitle || item.pageUrl}{' '}
                      <ExternalLink size={12} style={{ display: 'inline' }} />
                    </a>
                  ) : (
                    <span>{item.pageTitle || item.pageUrl}</span>
                  )}
                  <time>{new Date(item.createdAt).toLocaleDateString()}</time>
                </div>
                {expanded === item.selectionId && (
                  <div className="answer">
                    <AnnotatedTextView segments={new TagStreamParser().feed(item.responseRaw)} />
                    <p className="small muted" style={{ marginTop: 12 }}>
                      {item.model}
                      {item.latencyMs ? ` · ${(item.latencyMs / 1000).toFixed(1)}s` : ''}
                    </p>
                  </div>
                )}
              </article>
            ))}
          </div>
        )
      )}
      <div className="row between">
        <button className="btn" disabled={!page || busy} onClick={() => setPage((n) => n - 1)}>
          Previous
        </button>
        <span className="small muted">Page {page + 1}</span>
        <button className="btn" disabled={!more || busy} onClick={() => setPage((n) => n + 1)}>
          Next
        </button>
      </div>
      <div className="row between">
        <button
          className="btn"
          disabled={actionBusy}
          onClick={() => action(async () => downloadMarkdown(await exportKnowledgeMarkdown()))}
        >
          <Download size={16} />
          Export to Markdown
        </button>
        <button
          className="btn danger"
          disabled={actionBusy}
          onClick={() => {
            if (window.confirm('Delete all reading history and bookmarks from this device?'))
              action(async () => {
                await clearAllHistory();
                setPage(0);
              });
          }}
        >
          Clear All
        </button>
      </div>
      <p className="small muted">
        Export includes the entire library, regardless of the current filter.
      </p>
    </div>
  );
}
