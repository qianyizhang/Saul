import { annotateRange } from '../../annotations/capture';
import { useReadingSession } from '../content-session';
import { FloatingTrigger } from './FloatingTrigger';
import { ExplanationCard } from './ExplanationCard';
import { runLabel } from './run-status';

export function SaulRoot({ isContextValid }: { isContextValid: () => boolean }) {
  const {
    active,
    attachment,
    captured,
    dismissSelection,
    busy,
    recipes,
    recipeChoice,
    defaultRecipeId,
    outputFormat,
    setOutputFormat,
    chooseRecipe,
    explain,
    pinned,
    minimum,
    reuse,
    togglePinned,
    close,
    action,
    followUpDrafts,
    setFollowUpDrafts,
    loadRuns,
    passages,
    list,
    open,
    toggleList,
    toast,
    dismissToast,
    errorsMuted,
    muting,
    muteErrors,
    unread,
    attachmentState,
  } = useReadingSession(isContextValid);
  return (
    <>
      {captured && !busy && (
        <FloatingTrigger
          range={captured.range}
          onAnnotate={() => {
            annotateRange(captured.range);
            dismissSelection();
          }}
          onTrigger={() => void explain(captured, false, 'open')}
          recipes={recipes}
          recipeId={recipeChoice || defaultRecipeId}
          onRecipe={chooseRecipe}
          outputFormat={
            outputFormat ??
            recipes.find((r) => r.id === (recipeChoice || defaultRecipeId))?.outputFormat ??
            'png'
          }
          onOutputFormat={setOutputFormat}
        />
      )}
      {active && (
        <ExplanationCard
          key={active.snapshot.id}
          range={attachment?.state === 'attached' ? attachment.range : null}
          passage={active}
          pinned={pinned}
          busy={busy}
          minimum={minimum}
          reuse={
            reuse?.id === active.snapshot.id
              ? reuse.comparison || { fields: [], error: 'Checking current input…' }
              : undefined
          }
          onRunCurrent={
            reuse?.id === active.snapshot.id
              ? () => void explain(reuse.selection, true, 'open')
              : undefined
          }
          onPin={togglePinned}
          onClose={close}
          onStop={() => void action({ action: 'stop', selectionId: active.snapshot.id })}
          onBookmark={() =>
            void action({
              action: 'bookmark',
              selectionId: active.snapshot.id,
              bookmarked: !active.bookmarked,
            })
          }
          followUpDraft={followUpDrafts[active.snapshot.id] || ''}
          onFollowUpDraft={(value) =>
            setFollowUpDrafts((drafts) => ({ ...drafts, [active.snapshot.id]: value }))
          }
          onRetry={async (instruction) => {
            const result = await action({
              action: 'regenerate',
              submissionId: crypto.randomUUID(),
              selectionId: active.snapshot.id,
              instruction,
              runId: (active.completed || active.latest).id,
            });
            return !!result && 'reused' in result && !result.reused;
          }}
          loadRuns={() => loadRuns(active.snapshot.id)}
        />
      )}
      {(passages.length > 0 || list) && (
        <div
          className="fixed bottom-3 right-3 font-sans text-xs text-muted"
          style={{ zIndex: 2147483646 }}
        >
          {list && (
            <section
              aria-label="Page explanations"
              className="mb-2 w-72 max-h-80 overflow-auto bg-surface border border-line rounded-control saul-elevated p-3"
            >
              <h2 className="font-semibold mb-2">On this page</h2>
              {!passages.length && <p>No explanations yet.</p>}
              {passages.map((p) => (
                <button
                  className="block text-left w-full p-2 rounded hover:bg-subtle focus-visible:outline-2 focus-visible:outline-accent"
                  key={p.snapshot.id}
                  onClick={() => open(p.snapshot.id, true)}
                >
                  <span className="block truncate font-medium">{p.snapshot.text}</span>
                  <span>
                    {p.unread ? 'New · ' : ''}
                    {runLabel(p.latest.status)}
                    {attachmentState(p.snapshot.id) !== 'attached' ? ' · location unavailable' : ''}
                  </span>
                </button>
              ))}
            </section>
          )}
          <button
            className="bg-surface border border-line rounded-full px-3 py-1.5 saul-elevated"
            aria-label="Page explanations"
            aria-expanded={list}
            onClick={toggleList}
          >
            Saul · {passages.length}
            {unread ? ` · ${unread} new` : ''}
          </button>
        </div>
      )}
      {toast && !list && (!toast.error || errorsMuted === false) && (
        <div
          role={toast.error ? 'alert' : 'status'}
          className="fixed bottom-14 right-3 max-w-xs bg-surface text-ink font-sans text-sm border border-line rounded-control saul-elevated px-3 py-2"
          style={{ zIndex: 2147483647 }}
        >
          <span>{toast.text}</span>
          {toast.error && (
            <button
              className="ml-3 text-accent underline"
              aria-label="Mute error notifications"
              title="Mute error toasts on all pages. Turn them back on in Saul Settings."
              disabled={muting}
              onClick={() => void muteErrors()}
            >
              {muting ? 'Muting…' : 'Mute'}
            </button>
          )}
          {toast.id && (
            <button className="ml-3 text-accent underline" onClick={() => open(toast.id!, true)}>
              View
            </button>
          )}
          <button
            className="ml-3 text-muted"
            aria-label="Dismiss notification"
            onClick={dismissToast}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
