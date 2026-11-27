import type { CallToolResult } from '@modelcontextprotocol/client';
import type { AppArgs } from '../shared/protocol/app-protocol.mts';
import type { TabSnapshot, TabView } from '../shared/protocol/protocol.mts';
import {
  workspaceState,
  type WorkspaceState,
  type WorkspaceProposal,
  type ProjectedWindow,
} from '../shared/protocol/workspace-contract.mts';
import { isRecord } from '../shared/model/value.mts';
type BoardWindow = ProjectedWindow;
export type DraftWindow = Omit<BoardWindow, 'id'> & { id?: string | number };
export type DisplayProposal = Pick<
  WorkspaceProposal,
  'status' | 'summary' | 'changedTabIds' | 'projected' | 'before' | 'expiresAt'
> &
  Partial<WorkspaceProposal>;
interface DraftLayout {
  source: TabSnapshot;
  windows: BoardWindow[];
  revision?: string;
  changedTabIds: number[];
}

export const fixed = (tab: TabView) => tab.pinned || tab.groupId >= 0;
export const boardError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type BoardState = {
  data?: WorkspaceState;
  draftLayout?: DraftLayout;
  approvalToken?: string;
  ready: boolean;
  refreshing: boolean;
  busy: boolean;
  staging: boolean;
};
type Context = { generation: number; session?: string; observing?: boolean };
export type BoardManualCommand =
  | [
      name: 'saul_workspace_edit',
      args: Omit<AppArgs['saul_workspace_edit'], 'session' | 'interactionToken'>,
    ]
  | [name: 'saul_workspace_undo' | 'saul_workspace_discard']
  | [
      name: 'saul_workspace_summarize',
      args: Omit<AppArgs['saul_workspace_summarize'], 'session' | 'interactionToken'>,
    ];

export function createBoardSession(deps: {
  call: <K extends keyof AppArgs>(name: K, args: AppArgs[NoInfer<K>]) => Promise<CallToolResult>;
  changed: () => void;
  status: (message: string, error?: boolean) => void;
  onSessionChange: () => void;
  onPreview: () => void;
  dragActive: () => boolean;
  tabDragActive: () => boolean;
}) {
  let state: BoardState = { ready: false, refreshing: false, busy: false, staging: false };
  let generation = 0;
  let disconnected = false;
  let interactionToken: string | undefined;
  let editSequence = 0;
  let queuedEdit: { args: AppArgs['saul_workspace_propose']; sequence: number } | undefined;
  let deferred: { result: CallToolResult; context: Context; sequence?: number } | undefined;

  const context = (): Context => ({ generation, session: state.data?.session });
  const current = (owner: Context) => generation === owner.generation;
  function publish(patch: Partial<BoardState>, draw = true) {
    state = { ...state, ...patch };
    if (draw) deps.changed();
  }
  function receive(result: CallToolResult, owner: Context, sequence?: number) {
    if (!current(owner)) return false;
    if (result.isError)
      throw new Error(
        result.content?.find((item) => item.type === 'text')?.text ||
          'Saul could not complete the request',
      );
    if (!isRecord(result.structuredContent) || !('sessions' in result.structuredContent))
      return false;
    const next = workspaceState(result.structuredContent);
    const session = owner.session ?? state.data?.session;
    // A late host result can select a discovered session, but cannot revive
    // a session that discovery has already dropped.
    if (
      !owner.observing &&
      session === undefined &&
      next.session !== undefined &&
      state.data &&
      !state.data.sessions.some((item) => item.session === next.session)
    )
      return false;
    const lostSession =
      owner.observing &&
      session !== undefined &&
      next.session === undefined &&
      !next.snapshot &&
      !next.sessions.some((item) => item.session === session);
    if (session !== undefined && next.session !== session && !lostSession) return false;
    if (deps.dragActive()) {
      deferred = { result, context: owner, sequence };
      return false;
    }
    if (lostSession) {
      deferred = queuedEdit = interactionToken = undefined;
      deps.onSessionChange();
      publish({ data: next, draftLayout: undefined, approvalToken: undefined });
      return true;
    }
    const approvalToken =
      typeof result._meta?.approvalToken === 'string' ? result._meta.approvalToken : undefined;
    interactionToken =
      typeof result._meta?.interactionToken === 'string'
        ? result._meta.interactionToken
        : undefined;
    const draftLayout = sequence === editSequence ? undefined : state.draftLayout;
    const changed =
      JSON.stringify(next) !== JSON.stringify(state.data) ||
      state.approvalToken !== approvalToken ||
      state.draftLayout !== draftLayout;
    publish({ data: next, draftLayout, approvalToken }, changed);
    return true;
  }

  async function refresh() {
    if (state.busy || state.staging || state.refreshing || !state.ready || deps.dragActive())
      return;
    const owner = { ...context(), observing: true };
    publish({ refreshing: true });
    try {
      const result = await deps.call(
        'saul_workspace_state',
        owner.session ? { session: owner.session } : {},
      );
      if (receive(result, owner)) {
        const { data } = state;
        const error =
          data?.error ||
          (data?.snapshot?.nativeNames?.status === 'unavailable'
            ? data.snapshot.nativeNames.message
            : '');
        deps.status(error || '', Boolean(error));
      }
    } catch (cause) {
      if (!current(owner)) return;
      publish({ approvalToken: undefined }, false);
      deps.status(boardError(cause), true);
    } finally {
      if (current(owner)) publish({ refreshing: false }, !deps.dragActive());
    }
  }

  async function selectSession(session: string | undefined) {
    const { data } = state;
    if (
      !state.ready ||
      state.busy ||
      state.staging ||
      session === data?.session ||
      (session !== undefined && !data?.sessions.some((item) => item.session === session))
    )
      return;
    generation++;
    deferred = undefined;
    interactionToken = undefined;
    deps.onSessionChange();
    publish(
      {
        data: { sessions: data?.sessions ?? [], session, snapshot: null, proposal: null },
        draftLayout: undefined,
        approvalToken: undefined,
        refreshing: false,
      },
      false,
    );
    deps.status('');
    await refresh();
  }

  async function manual(...[name, args]: BoardManualCommand) {
    const owner = context();
    if (
      !state.ready ||
      state.busy ||
      state.staging ||
      state.refreshing ||
      !interactionToken ||
      !owner.session
    )
      return false;
    if (name === 'saul_workspace_discard') publish({ draftLayout: undefined }, false);
    publish({ busy: true });
    deps.status('');
    try {
      const scope = { session: owner.session, interactionToken };
      const result =
        name === 'saul_workspace_edit'
          ? await deps.call(name, { ...args, ...scope })
          : name === 'saul_workspace_summarize'
            ? await deps.call(name, { ...args, ...scope })
            : await deps.call(name, scope);
      return receive(result, owner);
    } catch (cause) {
      if (!current(owner)) return false;
      deps.status(boardError(cause), true);
      try {
        receive(await deps.call('saul_workspace_state', { session: owner.session }), {
          ...owner,
          observing: true,
        });
      } catch {
        /* Keep original error. */
      }
      return false;
    } finally {
      if (current(owner)) publish({ busy: false });
    }
  }

  async function apply() {
    const { busy, staging, draftLayout, refreshing, approvalToken, data, ready } = state;
    if (
      !ready ||
      busy ||
      staging ||
      draftLayout ||
      refreshing ||
      !approvalToken ||
      !data?.session ||
      data.proposal?.status !== 'pending'
    )
      return;
    const owner = context();
    const args = { session: data.session, proposalId: data.proposal.id, approvalToken };
    publish({ busy: true, approvalToken: undefined });
    deps.status('');
    try {
      if (receive(await deps.call('saul_workspace_apply', args), owner)) deps.status('');
    } catch (cause) {
      if (!current(owner)) return;
      publish({ approvalToken: undefined }, false);
      deps.status(boardError(cause), true);
    } finally {
      if (current(owner)) publish({ busy: false });
    }
  }

  async function stageDraft(
    source: TabSnapshot | null | undefined,
    draft: DraftWindow[],
    deduplicate = state.data?.proposal?.deduplicate ?? false,
    movedTabId?: number,
  ) {
    const { data, draftLayout } = state;
    if (
      !state.ready ||
      state.busy ||
      state.refreshing ||
      !source ||
      !data?.session ||
      !data.revision
    )
      return;
    const started = context();
    const submitted = draft.map((w) => ({ ...w, tabIds: [...w.tabIds] }));
    // A deduplicated projection hides removed copies. Retain those inputs while
    // editing or opting out so the server still validates complete tab coverage.
    for (const duplicate of ['pending', 'expired'].includes(data?.proposal?.status ?? '')
      ? (data.proposal!.duplicates ?? [])
      : []) {
      if (submitted.some((w) => w.tabIds.includes(duplicate.tabId))) continue;
      const destination = submitted.find((w) => w.tabIds.includes(duplicate.keepTabId));
      if (destination) destination.tabIds.push(duplicate.tabId);
    }
    const args = {
      session: data.session,
      revision: data.revision,
      summary: data?.proposal?.summary || 'Window name change',
      deduplicate,
      windows: submitted
        .map((window) => ({
          ...(typeof window.id === 'number' &&
          source.tabs.some(
            (tab) => tab.windowId === window.id && (fixed(tab) || window.tabIds.includes(tab.id)),
          )
            ? { windowId: window.id }
            : {}),
          title: window.title,
          tabIds: window.tabIds.filter((id) => !fixed(source.tabs.find((t) => t.id === id)!)),
        }))
        .filter(
          (window) =>
            window.tabIds.length ||
            source.tabs.some((tab) => fixed(tab) && tab.windowId === window.windowId),
        ),
    };
    const sequence = ++editSequence;
    const nextDraft = {
      changedTabIds: [
        ...new Set([
          ...(draftLayout?.changedTabIds ??
            (['pending', 'expired'].includes(data?.proposal?.status ?? '')
              ? data.proposal!.changedTabIds
              : [])),
          ...(movedTabId === undefined ? [] : [movedTabId]),
        ]),
      ],
      source,
      revision: data.revision,
      windows: draft
        .map((window, i) => ({
          ...window,
          id: window.id ?? `new-${i + 1}`,
          tabIds: [...window.tabIds],
        }))
        .filter((window) => window.tabIds.length),
    };
    queuedEdit = { args, sequence };
    const alreadyStaging = state.staging;
    deps.onPreview();
    publish({ approvalToken: undefined, draftLayout: nextDraft, staging: true });
    deps.status('');
    if (alreadyStaging) return;
    try {
      while (queuedEdit && current(started)) {
        const edit = queuedEdit;
        queuedEdit = undefined;
        receive(await deps.call('saul_workspace_propose', edit.args), started, edit.sequence);
      }
      if (current(started)) deps.status('');
    } catch (error) {
      if (!current(started)) return;
      // Retain the visible draft without approval for an unvalidated layout.
      queuedEdit = undefined;
      publish({ approvalToken: undefined }, false);
      deps.status(`${boardError(error)}. Draft retained. Choose Retry.`, true);
    } finally {
      if (current(started)) publish({ staging: false }, !deps.tabDragActive());
    }
  }
  function displayProposal(): DisplayProposal | null | undefined {
    const { data, draftLayout } = state;
    if (!draftLayout) return data?.proposal;
    const { source, windows } = draftLayout;
    return {
      ...data?.proposal,
      status: draftLayout.revision === data?.revision ? 'pending' : 'stale',
      receipt: undefined,
      summary: data?.proposal?.summary || 'Window name change',
      changedTabIds: draftLayout.changedTabIds,
      projected: windows,
      before: source,
      expiresAt: 0,
    };
  }

  return {
    get state(): Readonly<BoardState> {
      return state;
    },
    manual,
    stageDraft,
    displayProposal,
    apply,
    refresh,
    selectSession,
    setReady(ready: boolean) {
      disconnected = !ready;
      if (!ready) {
        generation++;
        queuedEdit = deferred = interactionToken = undefined;
        publish({
          ready,
          approvalToken: undefined,
          busy: false,
          staging: false,
          refreshing: false,
        });
      } else publish({ ready });
    },
    // The composer owns its draft and acknowledgement, but serializes its send
    // with board commands so the attached session stays fixed while sending.
    setSending(busy: boolean) {
      publish({ busy });
    },
    hostResult(result: CallToolResult) {
      // The host can supply its initial result before connect() finishes.
      if (!disconnected) receive(result, context());
    },
    endDrag() {
      if (!deferred) return;
      const { result, context, sequence } = deferred;
      deferred = undefined;
      receive(result, context, sequence);
    },
  };
}
