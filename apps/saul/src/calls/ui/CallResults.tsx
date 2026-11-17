import { ActionLabel } from '../../ui/ActionLabel';
import { activeItem, type DigestBatch, type Pair } from '../../../shared/model/call-batch.ts';
import { sourceUrl } from './summary-html';
import { ActionText } from './ActionText';
import { SummaryInspection } from './SummaryInspection';

function Bilingual({ pair }: { pair: Pair }) {
  return (
    <>
      <p lang="en">{pair.en}</p>
      <p lang="zh-Hans" className="translation">
        {pair.zh}
      </p>
    </>
  );
}
/** Renders built-in Summarize and custom Call results; the reader owns execution. */
export function CallResults({ batch, tabIds }: { batch: DigestBatch; tabIds?: number[] }) {
  const singleItem = batch.items.length === 1 ? batch.items[0] : undefined;
  const single = Boolean(singleItem);
  const multipleWindows = new Set(batch.items.map((item) => item.windowId)).size > 1;
  return (
    <>
      {singleItem && (
        <SummaryInspection
          key={batch.id}
          batch={batch}
          item={singleItem}
          tabId={tabIds?.[0] ?? singleItem.tabId}
        />
      )}
      <ol className="summary-items">
        {batch.items.map((item) => (
          <li key={item.index}>
            {!single && (
              <div className="small muted">
                {multipleWindows ? (item.windowTitle || batch.windowTitle) + ' · ' : ''}
                {item.status === 'completed' ? '' : item.status}
              </div>
            )}
            {!single && (
              <h3>
                {sourceUrl(item.url) ? (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </h3>
            )}
            {item.error && (
              <p className={item.status === 'skipped' ? 'small muted' : 'notice error'}>
                {item.error}
              </p>
            )}
            {item.progress && activeItem(item) && (
              <p role="status" className="small muted">
                {item.progress}
              </p>
            )}
            {item.status === 'completed' && item.finalText && <ActionText text={item.finalText} />}
            {item.sourceKind === 'pdf-url' && (
              <p className="small muted">
                PDF URL attachment. Original document contents are not stored; Retry asks OpenAI to
                read the URL again and may use a newer version.
              </p>
            )}
            {!single && (
              <SummaryInspection
                key={batch.id + ':' + item.index}
                batch={batch}
                item={item}
                tabId={tabIds?.[item.index] ?? item.tabId}
              />
            )}
            {item.summary && (
              <>
                <Bilingual pair={item.summary.lead} />
                <ul className="summary-points">
                  {item.summary.points.map((point, i) => (
                    <li key={i}>
                      <Bilingual pair={point} />
                    </li>
                  ))}
                </ul>
                {item.summary.caution && (
                  <aside className="summary-caution">
                    <Bilingual pair={item.summary.caution} />
                  </aside>
                )}
                {(item.summary.flow.length > 0 ||
                  item.summary.terms.length > 0 ||
                  item.summary.question) && (
                  <details>
                    <summary aria-label="Go deeper" title="Go deeper">
                      <ActionLabel short="More" full="Go deeper" />
                    </summary>
                    {[
                      ...item.summary.flow,
                      ...item.summary.terms,
                      ...(item.summary.question ? [item.summary.question] : []),
                    ].map((pair, i) => (
                      <Bilingual key={i} pair={pair} />
                    ))}
                  </details>
                )}
              </>
            )}
            {(item.coverage || item.capturedAt) && (
              <details>
                <summary aria-label="Source coverage" title="Source coverage">
                  <ActionLabel short="Coverage" full="Source coverage" />
                </summary>
                <p className="small muted">{item.coverage}</p>
                {item.capturedAt && (
                  <p className="small muted">
                    {item.sourceKind === 'pdf-url' ? 'Prepared' : 'Captured'}{' '}
                    {new Date(item.capturedAt).toLocaleString()}
                  </p>
                )}
              </details>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
