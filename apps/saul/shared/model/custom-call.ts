import type { FrozenModel } from './execution-route.ts';
import type { ActionRevision } from '../protocol/action-protocol.mts';
export interface CallChoice {
  revision: ActionRevision;
  presetId: string;
}

export function callChoiceKey(choice: CallChoice) {
  return `${choice.revision.revision}:${choice.presetId}`;
}
export interface FrozenCustomCall extends CallChoice {
  input?: FrozenModel;
}
