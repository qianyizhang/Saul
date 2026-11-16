import type { RunStatus } from '../types/storage';

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
