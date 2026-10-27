import { useMemo, useState } from 'react';

// Keep only one bounded page of source text in the DOM, even for very large prompts.
export function textPages(text: string): string[] {
  const pages: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + 6000, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end - 1);
      if (newline > offset + 3000) end = newline + 1;
      else if (/^[\uDC00-\uDFFF]$/.test(text[end]!)) end--;
    }
    pages.push(text.slice(offset, end));
    offset = end;
  }
  return pages;
}
export function InspectionText({
  label,
  text,
  response = false,
}: {
  label: string;
  text: string;
  response?: boolean;
}) {
  const [copied, setCopied] = useState<{ text: string; notice: string }>();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const pages = useMemo(() => textPages(text), [text]);
  const results = useMemo(() => {
    const lower = query.toLocaleLowerCase();
    // Include neighbouring pages in search so a match across a boundary is found.
    return pages.flatMap((part, index) =>
      !lower ||
      (part + (pages[index + 1] || '').slice(0, Math.max(0, lower.length - 1)))
        .toLocaleLowerCase()
        .includes(lower)
        ? [index]
        : [],
    );
  }, [pages, query]);
  const current = Math.min(page, Math.max(0, results.length - 1));
  const section = pages[results[current] ?? -1] || '';
  const part =
    query && !section.toLocaleLowerCase().includes(query.toLocaleLowerCase())
      ? section.slice(-256) + (pages[(results[current] ?? -2) + 1] || '').slice(0, 256)
      : section;
  const marked = useMemo(() => {
    if (!query) return part;
    const pieces: React.ReactNode[] = [];
    const lower = part.toLocaleLowerCase(),
      needle = query.toLocaleLowerCase();
    let offset = 0,
      next = lower.indexOf(needle);
    while (next !== -1) {
      pieces.push(
        part.slice(offset, next),
        <mark key={next}>{part.slice(next, next + query.length)}</mark>,
      );
      offset = next + query.length;
      next = lower.indexOf(needle, offset);
    }
    pieces.push(part.slice(offset));
    return pieces;
  }, [part, query]);
  return (
    <section className="saul-inspection-block" data-response={response} aria-label={label}>
      <div className="saul-inspection-heading">
        <strong>{label}</strong>
        <button
          type="button"
          disabled={!text}
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied({ text, notice: 'Copied' });
            } catch {
              setCopied({ text, notice: 'Could not copy. Select the text and copy it manually.' });
            }
          }}
        >
          Copy
        </button>
      </div>
      {copied?.text === text && <p role="status">{copied.notice}</p>}
      {pages.length > 1 && (
        <>
          <p className="saul-inspection-note">
            {text.length.toLocaleString()} characters · Copy includes all text
          </p>
          <label className="saul-inspection-search">
            Search {label}
            <input
              type="search"
              value={query}
              maxLength={256}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <div className="saul-inspection-pages">
            <button type="button" disabled={!current} onClick={() => setPage(current - 1)}>
              Previous
            </button>
            <span aria-live="polite">
              {results.length
                ? `Section ${results[current]! + 1} of ${pages.length}${query ? ` · match ${current + 1} of ${results.length}` : ''}`
                : 'No matches'}
            </span>
            <button
              type="button"
              disabled={current + 1 >= results.length}
              onClick={() => setPage(current + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
      {text ? (
        <pre tabIndex={0} aria-label={`${label} text`}>
          {marked || (query ? 'No matching text.' : '')}
        </pre>
      ) : (
        <p className="saul-inspection-note">No text recorded.</p>
      )}
    </section>
  );
}
