import { useCallback, useEffect, useRef, useState } from 'react';
import { planCall } from '../providers/chatgpt-plan';
import { requestSettings } from '../configuration/client';
import type { Configuration } from '../configuration/definition';
import { summaryConnections, type SummaryConnection } from './execution/summary-connection';
import { editCall, sendDigestMessage } from './client';
import {
  activeItem,
  type DigestBatch,
  type DigestComparison,
} from '../../shared/model/call-batch.ts';
import { createStatusObserver, type StatusObserver } from '../observation/status-observer';

async function summaryAccounts(settings: Configuration) {
  if (settings.sharedCredentials !== 'saul')
    throw new Error('Connect this app in Settings → Preferences → Integrations.');
  const result = await planCall({ action: 'accounts' });
  return summaryConnections(settings, result.accounts);
}

type SummaryLookup = { kind: 'found'; batch: DigestBatch } | { kind: 'missing' };
const missingSummary = 'This digest no longer exists.';
async function readSummary(id: string): Promise<SummaryLookup> {
  try {
    return { kind: 'found', batch: await sendDigestMessage({ action: 'get', id }) };
  } catch (cause) {
    if (cause instanceof Error && cause.message === missingSummary) return { kind: 'missing' };
    throw cause;
  }
}

export function useSummarySession({
  route,
  visible,
  onResolved,
}: {
  route: string;
  visible: boolean;
  onResolved?: (id: string) => Promise<void>;
}) {
  const [id, setId] = useState(() =>
    decodeURIComponent(route.split('?')[0]!.slice('#summary/'.length)),
  );
  const [tabIds] = useState(() =>
    new URLSearchParams(route.split('?')[1]).get('tabs')?.split(',').map(Number),
  );
  const [batch, setBatch] = useState<DigestBatch>();
  const [reused, setReused] = useState(false);
  const [comparisons, setComparisons] = useState<DigestComparison[]>([]);
  const [source, setSource] = useState<{ title: string; url: string }>();
  const [accounts, setAccounts] = useState<SummaryConnection[]>([]);
  const [account, setAccount] = useState('');
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [initialMissing, setInitialMissing] = useState(false);
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
    async (current: () => boolean, choiceKey?: string, regenerate = false) => {
      const [call, saved] = await Promise.all([
        editCall({ action: 'status' }),
        requestSettings({ action: 'read' }),
      ]);
      if (!current()) return;
      if (saved.state !== 'ready') throw new Error(saved.error);
      let runAccountId: string | undefined;
      let connectionKey: string | undefined;
      if (!call.selected && !saved.settings.summaryPresetId) {
        const resolved = await summaryAccounts(saved.settings);
        if (!current()) return;
        const key = choiceKey ?? resolved.chosen;
        setAccounts(resolved.choices);
        setAccount(key);
        const choice = resolved.choices.find((c) => c.key === key && c.available);
        if (!choice?.accountId) {
          if (!choiceKey && !regenerate && !resolved.error) return;
          throw new Error(resolved.error || 'Choose a model preset in Settings → Calls.');
        }
        runAccountId = choice.accountId;
        connectionKey = choice.key;
        const { settings, revision } = saved;
        if (settings.summaryConnectionKey !== choice.key) {
          const committed = await requestSettings({
            action: 'commit',
            baseline: revision,
            settings: { ...settings, summaryConnectionKey: choice.key },
          });
          if (committed.state !== 'ready') throw new Error(committed.error);
        }
        if (!current()) return;
        const catalog = await planCall({ action: 'models', accountId: runAccountId });
        if (
          !catalog.models.some(
            (m) =>
              m.slug === 'gpt-6-luna' &&
              m.supportedReasoningEfforts.some((e) => e.effort === 'medium'),
          )
        )
          throw new Error(
            'GPT-6 Luna with medium effort is unavailable. Check models in Connections.',
          );
      }
      const selected = tabIds || batch?.items.map((item) => item.tabId);
      if (!selected?.length) throw new Error('The selection is missing.');
      if (regenerate && batch) {
        for (const [index, tabId] of selected.entries()) {
          const tab = await chrome.tabs.get(tabId);
          if (tab.url !== batch.items[index]?.url)
            throw new Error('A source tab changed or closed. Use Call Saul on the page you want.');
        }
      }
      if (!current()) return;
      const targetId = regenerate ? crypto.randomUUID() : id;
      const result = await sendDigestMessage({
        action: 'start',
        id: targetId,
        tabIds: selected,
        ...(runAccountId ? { accountId: runAccountId } : {}),
        ...(connectionKey ? { connectionKey } : {}),
        ...(regenerate ? { regenerate: true } : {}),
      });
      if (!current()) return;
      adoptBatch(result);
      setReused(result.id !== targetId);
      setComparisons([]);
      history.replaceState(null, '', '#summary/' + encodeURIComponent(result.id));
      await onResolved?.(result.id);
    },
    [adoptBatch, id, tabIds, batch, onResolved],
  );
  function start(choiceKey?: string, regenerate = false) {
    return runCommand((current) => launch(current, choiceKey, regenerate));
  }
  useEffect(() => {
    if (!visible) return;
    const observer = createStatusObserver({
      read: () => readSummary(id),
      shouldPoll: (next) => next.kind === 'found' && next.batch.items.some(activeItem),
      onSnapshot: ({ value, error }) => {
        setReadError(error ?? '');
        if (error || !value) return;
        if (value.kind === 'missing') {
          if (!initialized.current && tabIds?.length) setInitialMissing(true);
          else if (!pending.current) setError(missingSummary);
          return;
        }
        setBatch(value.batch);
        if (!initialized.current) {
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
  }, [id, visible, tabIds, onResolved]);
  useEffect(() => {
    if (!visible || !initialMissing || initialized.current || !tabIds?.length) return;
    initialized.current = true;
    void runCommand(async (current) => {
      const resolved = await sendDigestMessage({ action: 'resolve', id, tabIds });
      if (!current()) return;
      if (resolved.batch) {
        adoptBatch(resolved.batch);
        setReused(true);
        setComparisons(resolved.comparisons);
        history.replaceState(null, '', '#summary/' + encodeURIComponent(resolved.batch.id));
        await onResolved?.(resolved.batch.id);
        return;
      }
      if (tabIds.length === 1) {
        const tab = await chrome.tabs.get(tabIds[0]!);
        if (!current()) return;
        setSource({ title: tab.title || 'Untitled page', url: tab.url || '' });
      }
      await launch(current);
    });
  }, [adoptBatch, id, initialMissing, onResolved, launch, runCommand, tabIds, visible]);
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
    accounts,
    account,
    selectAccount: setAccount,
    error,
    readError,
    busy,
    tabIds,
    start,
    running,
    control,
    refresh: () => status.current?.observer.refresh(),
  };
}
