import type { TabSnapshot } from './protocol.mts';

export interface ProposalWindow {
  windowId?: number;
  title: string;
  tabIds: number[];
}
export interface WorkspaceState {
  sessions: { session: string; extensionId: string }[];
  session?: string;
  snapshot: TabSnapshot | null;
  revision?: string;
  error?: string;
  notice?: string;
  canUndo?: boolean;
  summary?: { id: string; completed: number; total: number } | null;
  proposal: null | {
    id: string;
    status: 'pending' | 'applying' | 'applied' | 'stale' | 'failed' | 'expired';
    summary: string;
    windows: ProposalWindow[];
    deduplicate: boolean;
    duplicates: { tabId: number; keepTabId: number; url: string }[];
    before: TabSnapshot;
    projected: { id: number | string; title: string; tabIds: number[] }[];
    changedTabIds: number[];
    revision: string;
    expiresAt: number;
    receipt?: { completedMoves: number; completedClosures: number; message: string };
  };
}
export interface WorkspaceResult {
  content: { type: 'text'; text: string }[];
  structuredContent: WorkspaceState;
  _meta: { interactionToken?: string; approvalToken?: string; ui?: { resourceUri: string } };
}

export type WorkspaceProposal = NonNullable<WorkspaceState['proposal']>;
export type ProjectedWindow = WorkspaceProposal['projected'][number];

import { isRecord } from './value.mts';
import { isSnapshot } from './results.mts';
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ids = (v: unknown): v is number[] => Array.isArray(v) && v.every(Number.isSafeInteger);
const optionalText = (v: unknown) => v === undefined || typeof v === 'string';
/** The MCP SDK validates the envelope; Saul validates its own payload before replacing state. */
export function workspaceState(value: unknown): WorkspaceState {
  if (
    !isRecord(value) ||
    !Array.isArray(value.sessions) ||
    !value.sessions.every(
      (s) => isRecord(s) && typeof s.session === 'string' && typeof s.extensionId === 'string',
    ) ||
    !optionalText(value.session) ||
    !optionalText(value.revision) ||
    !optionalText(value.notice) ||
    !optionalText(value.error) ||
    (value.snapshot !== null && !isSnapshot(value.snapshot)) ||
    (value.canUndo !== undefined && typeof value.canUndo !== 'boolean') ||
    (value.summary != null &&
      (!isRecord(value.summary) ||
        typeof value.summary.id !== 'string' ||
        !number(value.summary.completed) ||
        !number(value.summary.total)))
  )
    throw new Error('Invalid Saul workspace state');
  const p = value.proposal;
  if (p !== null) {
    if (
      !isRecord(p) ||
      typeof p.id !== 'string' ||
      typeof p.summary !== 'string' ||
      typeof p.revision !== 'string' ||
      typeof p.deduplicate !== 'boolean' ||
      !number(p.expiresAt) ||
      !ids(p.changedTabIds) ||
      !['pending', 'applying', 'applied', 'stale', 'failed', 'expired'].includes(
        String(p.status),
      ) ||
      !isSnapshot(p.before) ||
      !Array.isArray(p.windows) ||
      !p.windows.every(
        (w) =>
          isRecord(w) &&
          (w.windowId === undefined || Number.isSafeInteger(w.windowId)) &&
          typeof w.title === 'string' &&
          ids(w.tabIds),
      ) ||
      !Array.isArray(p.projected) ||
      !p.projected.every(
        (w) =>
          isRecord(w) &&
          (typeof w.id === 'string' || Number.isSafeInteger(w.id)) &&
          typeof w.title === 'string' &&
          ids(w.tabIds),
      ) ||
      !Array.isArray(p.duplicates) ||
      !p.duplicates.every(
        (d) =>
          isRecord(d) &&
          Number.isSafeInteger(d.tabId) &&
          Number.isSafeInteger(d.keepTabId) &&
          typeof d.url === 'string',
      ) ||
      (p.receipt !== undefined &&
        (!isRecord(p.receipt) ||
          !number(p.receipt.completedMoves) ||
          !number(p.receipt.completedClosures) ||
          typeof p.receipt.message !== 'string'))
    )
      throw new Error('Invalid Saul workspace proposal');
    const known = new Set(p.before.tabs.map((t) => t.id));
    if (p.projected.some((w) => w.tabIds.some((id: number) => !known.has(id))))
      throw new Error('Proposal references an unknown tab');
  }
  return value as unknown as WorkspaceState;
}
