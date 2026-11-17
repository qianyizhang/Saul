import type { RunStatus } from '../../../shared/protocol/history-types.ts';

export const runLabel = (status: RunStatus) =>
  ({
    queued: 'Waiting…',
    running: 'Explaining…',
    saving: 'Saving…',
    completed: 'Saved',
    failed: 'Incomplete',
    interrupted: 'Interrupted',
    cancelled: 'Stopped',
  })[status];
