import type { FrozenModel } from './execution-route.ts';
import type { ActionRevision } from '../protocol/action-protocol.mts';
export interface CallChoice {
  revision: ActionRevision;
  presetId: string;
}

export interface FrozenCustomCall extends CallChoice {
  input?: FrozenModel;
}
