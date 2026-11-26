import type { FrozenModel } from './execution-route.ts';
import type { ActionRevision } from '../protocol/action-protocol.mts';
export interface ActionChoice {
  revision: ActionRevision;
  presetId: string;
}

export function actionChoiceKey(choice: ActionChoice) {
  return `${choice.revision.revision}:${choice.presetId}`;
}
export interface FrozenCustomAction extends ActionChoice {
  input?: FrozenModel;
}
