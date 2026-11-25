import { useCallback, useEffect, useRef, useState } from 'react';
import { launchCall, sendDigestMessage } from './client';
import { pendingPanelCallKey, summaryPanelKey, summarySelectionRoute } from './panel-route';
import {
  activeItem,
  MISSING_CALL_BATCH,
  type DigestBatch,
  type DigestComparison,
} from '../../shared/model/call-batch.ts';
import { createStatusObserver, type StatusObserver } from '../observation/status-observer';

type LaunchRequest = Parameters<typeof launchCall>[0];
type Setup = Extract<Awaited<ReturnType<typeof launchCall>>, { kind: 'setup' }>;
type PendingSetup = { outcome: Setup; intent: LaunchRequest };

const pendingSetupKey = 'saul-pending-call-setup';
function restoreSetup(value: unknown, id: string, tabIds: number[]): PendingSetup | undefined {
  const stored = value as PendingSetup | null | undefined;
  if (
    stored?.intent?.id === id &&
    Array.isArray(stored.intent.tabIds) &&
    stored.intent.tabIds.length === tabIds.length &&
    stored.intent.tabIds.every((tabId, index) => tabId === tabIds[index]) &&
    stored.outcome?.kind === 'setup' &&
    typeof stored.outcome.stamp === 'string'
  )
    return stored;
}
function restoreReaderSetup(id: string, tabIds: number[] | undefined) {
  if (!tabIds?.length) return;
  try {
    return restoreSetup(JSON.parse(sessionStorage.getItem(pendingSetupKey) ?? 'null'), id, tabIds);
  } catch {
    // A stale or unreadable draft cannot supply a review stamp.
  }
}

function sourceTabs(state: unknown): number[] | undefined {
  if (!state || typeof state !== 'object' || !('saulSummarySourceTabs' in state)) return;
  const tabIds = state.saulSummarySourceTabs;
  if (Array.isArray(tabIds) && tabIds.length && tabIds.every(Number.isSafeInteger)) return tabIds;
}
function replaceSummaryRoute(id: string, tabIds: number[]) {
  history.replaceState({ saulSummarySourceTabs: tabIds }, '', '#summary/' + encodeURIComponent(id));
}

type SummaryLookup = { kind: 'found'; batch: DigestBatch } | { kind: 'missing' };
async function readSummary(id: string): Promise<SummaryLookup> {
  try {
    return { kind: 'found', batch: await sendDigestMessage({ action: 'get', id }) };
  } catch (cause) {
    if (cause instanceof Error && cause.message === MISSING_CALL_BATCH) return { kind: 'missing' };
    throw cause;
  }
}

export function useSummarySession({
  route,
  panelWindowId,
  visible,
  onResolved,
}: {
  route: string;
  panelWindowId?: number;
  visible: boolean;
  onResolved?: (id: string) => Promise<void>;
}) {
  const [id, setId] = useState(() =>
    decodeURIComponent(route.split('?')[0]!.slice('#summary/'.length)),
  );
  const [requestedTabIds] = useState(() =>
    new URLSearchParams(route.split('?')[1]).get('tabs')?.split(',').map(Number),
  );
  const [sourceTabIds, setSourceTabIds] = useState(
    () => requestedTabIds ?? sourceTabs(history.state),
  );
  const [batch, setBatch] = useState<DigestBatch>();
  const [reused, setReused] = useState(false);
  const [comparisons, setComparisons] = useState<DigestComparison[]>([]);
  const [source, setSource] = useState<{ title: string; url: string }>();
  const [setup, setSetup] = useState(() =>
    panelWindowId === undefined ? restoreReaderSetup(id, requestedTabIds) : undefined,
  );
  const [restoringPanelSetup, setRestoringPanelSetup] = useState(
    panelWindowId !== undefined && Boolean(requestedTabIds?.length),
  );
  const restoredSetup = useRef(Boolean(setup));
  const [preset, setPreset] = useState('');
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const status = useRef<{ id: string; observer: StatusObserver<SummaryLookup> } | null>(null);
  const live = useRef(true);
  const pending = useRef<object | undefined>(undefined);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      pending.current = undefined;
    };
  }, []);
  const adoptBatch = useCallback((next: DigestBatch) => {
    const current = status.current;
    if (current?.id === next.id) {
      void current.observer.invalidate({ kind: 'found', batch: next });
    } else {
      current?.observer.dispose();
      status.current = null;
      setId(next.id);
      setBatch(next);
      setReadError('');
    }
  }, []);
  const runCommand = useCallback(async (work: (current: () => boolean) => Promise<void>) => {
    if (pending.current || !live.current) return;
    const command = {};
    pending.current = command;
    const current = () => live.current && pending.current === command;
    setBusy(true);
    setError('');
    try {
      await work(current);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current()) {
        pending.current = undefined;
        setBusy(false);
      }
    }
  }, []);
  const launch = useCallback(
    async (current: () => boolean, intent: LaunchRequest) => {
      const result = await launchCall(intent);
      if (!current()) return;
      if (result.kind === 'setup') {
        const next = { outcome: result, intent };
        // Reopening can read saved results. Starting from a blocked setup requires review.
        if (!intent.previousBatchId) {
          const blocked = { outcome: result, intent: { id: intent.id, tabIds: intent.tabIds } };
          if (panelWindowId === undefined)
            sessionStorage.setItem(pendingSetupKey, JSON.stringify(blocked));
          else {
            const panelKey = summaryPanelKey(panelWindowId);
            const route = (await chrome.storage.session.get(panelKey))[panelKey];
            if (!current() || route !== summarySelectionRoute(intent.id, intent.tabIds)) return;
            await chrome.storage.session.set({ [pendingPanelCallKey(panelWindowId)]: blocked });
            if (!current()) return;
          }
        }
        setSource(result.source);
        setSetup(next);
        setPreset((selected) =>
          !result.presetId && result.presets.some((option) => option.id === selected)
            ? selected
            : '',
        );
        return;
      }
      if (!intent.previousBatchId && panelWindowId === undefined)
        sessionStorage.removeItem(pendingSetupKey);
      restoredSetup.current = false;
      setSetup(undefined);
      setPreset('');
      adoptBatch(result.batch);
      setReused(result.kind === 'reused');
      setComparisons(result.comparisons);
      setSourceTabIds(intent.tabIds);
      replaceSummaryRoute(result.batch.id, intent.tabIds);
      await onResolved?.(result.batch.id);
    },
    [adoptBatch, onResolved, panelWindowId],
  );
  useEffect(() => {
    if (!restoringPanelSetup || panelWindowId === undefined || !requestedTabIds?.length) return;
    const key = pendingPanelCallKey(panelWindowId);
    let active = true;
    void chrome.storage.session.get(key).then(
      (saved) => {
        if (!active) return;
        const pending = restoreSetup(saved[key], id, requestedTabIds);
        restoredSetup.current = Boolean(pending);
        setSetup(pending);
        setRestoringPanelSetup(false);
      },
      (cause: Error) => {
        if (active) setError(cause.message);
      },
    );
    return () => {
      active = false;
    };
  }, [id, panelWindowId, requestedTabIds, restoringPanelSetup]);
  useEffect(() => {
    if (!visible || restoringPanelSetup || initialized.current || !requestedTabIds?.length) return;
    initialized.current = true;
    if (restoredSetup.current) return;
    void runCommand(async (current) => {
      if (requestedTabIds.length === 1) {
        const tab = await chrome.tabs.get(requestedTabIds[0]!).catch(() => undefined);
        if (!current()) return;
        if (tab) setSource({ title: tab.title || 'Untitled page', url: tab.url || '' });
      }
      await launch(current, { id, tabIds: requestedTabIds });
    });
  }, [id, launch, runCommand, requestedTabIds, restoringPanelSetup, visible]);
  function confirmSetup() {
    if (!setup) return;
    return runCommand((current) =>
      launch(current, {
        ...setup.intent,
        review: { stamp: setup.outcome.stamp, ...(preset ? { presetId: preset } : {}) },
      }),
    );
  }
  function runAgain() {
    if (!batch) return;
    setSetup(undefined);
    setPreset('');
    const selected = sourceTabIds ?? batch.items.map((item) => item.tabId);
    return runCommand((current) =>
      launch(current, { id: crypto.randomUUID(), tabIds: selected, previousBatchId: batch.id }),
    );
  }
  const canObserve = !requestedTabIds?.length || Boolean(batch) || restoredSetup.current;
  useEffect(() => {
    if (!visible || !canObserve) return;
    const observer = createStatusObserver({
      read: () => readSummary(id),
      shouldPoll: (next) => next.kind === 'found' && next.batch.items.some(activeItem),
      onSnapshot: ({ value, error }) => {
        setReadError(error ?? '');
        if (error || !value) return;
        if (value.kind === 'missing') {
          if (!pending.current && !restoredSetup.current)
            setError('This saved Call no longer exists.');
          return;
        }
        setBatch(value.batch);
        const recoveringAcceptedSetup = restoredSetup.current;
        if (recoveringAcceptedSetup) {
          restoredSetup.current = false;
          if (panelWindowId === undefined) sessionStorage.removeItem(pendingSetupKey);
          setSetup(undefined);
          setPreset('');
          if (requestedTabIds) replaceSummaryRoute(value.batch.id, requestedTabIds);
        }
        if (!initialized.current || recoveringAcceptedSetup) {
          initialized.current = true;
          if (onResolved)
            void onResolved(value.batch.id).catch((cause: Error) => {
              if (status.current?.observer === observer) setError(cause.message);
            });
        }
      },
    });
    status.current = { id, observer };
    void observer.refresh();
    return () => {
      observer.dispose();
      if (status.current?.observer === observer) status.current = null;
    };
  }, [id, visible, canObserve, onResolved, panelWindowId, requestedTabIds]);
  const running = Boolean(batch?.items.some(activeItem));
  function control(action: 'stop' | 'retry' | 'delete') {
    return runCommand(async (current) => {
      try {
        if (action === 'delete') {
          await sendDigestMessage({ action, id });
          if (!current()) return;
          status.current?.observer.dispose();
          location.hash = 'summaries';
        } else {
          const next = await sendDigestMessage({ action, id });
          if (current()) adoptBatch(next);
        }
      } catch (cause) {
        if (current()) void status.current?.observer.invalidate();
        throw cause;
      }
    });
  }
  return {
    batch,
    reused,
    comparisons,
    source,
    setup: setup?.outcome,
    setupTabId: setup?.intent.tabIds.length === 1 ? setup.intent.tabIds[0] : undefined,
    preset,
    selectPreset: setPreset,
    confirmSetup,
    cancelSetup: () => {
      setSetup(undefined);
      setPreset('');
      setError('');
    },
    error,
    readError,
    busy,
    tabIds: sourceTabIds,
    runAgain,
    running,
    control,
    refresh: () => status.current?.observer.refresh(),
  };
}
