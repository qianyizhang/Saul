import type { TabSnapshot } from './protocol.mjs';

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
  _meta: { approvalToken?: string; ui?: { resourceUri: string } };
}
export function revision(snapshot: TabSnapshot): string;
export function createWorkspace(options?: {
  call?: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  now?: () => number;
  labels?: {
    get(session: string): Record<string, string>;
    save(session: string, labels: Record<string, string>, sessions: string[]): void;
  };
}): (name: string, input?: unknown) => Promise<WorkspaceResult>;
