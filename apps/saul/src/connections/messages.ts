import type {
  ConnectionReservation,
  SetupFence,
} from '../../shared/protocol/connection-coordination.mts';
import type { PlanResults } from '../../shared/protocol/credential-plan.mts';
import type { Reply } from '../../shared/protocol/history-types.ts';
import type { SettingsState } from '../settings/contract';
import type { ConnectionSetup } from './setup';

export const CONNECTION_TARGET = 'saul-connection';
export const CONNECTION_REVIEW_PORT = 'saul-connection-review';
export type ConnectionReviewRequest = { key: string; id: string; phase: ConnectionSetup['phase'] };
export type ConnectionReviewEvent = { token: string } | { error: string };
type ConnectionOperations = {
  save: {
    input: { setup: ConnectionSetup; key: string; resume: boolean };
    result: Extract<SettingsState, { state: 'ready' }>;
  };
  discard: { input: { id: string; phase: ConnectionSetup['phase'] }; result: void };
  recovery: { input: object; result: ConnectionSetup[] };
  accounts: { input: object; result: PlanResults['accounts'] };
  setups: { input: object; result: ConnectionReservation[] };
  release: { input: { fence: SetupFence }; result: void };
};
type ConnectionAction = keyof ConnectionOperations;
export type ConnectionRequest = {
  [K in ConnectionAction]: { action: K } & ConnectionOperations[K]['input'];
}[ConnectionAction];
export type ConnectionResult<K extends ConnectionAction> = ConnectionOperations[K]['result'];
export type ConnectionReply<K extends ConnectionAction> = Reply<ConnectionResult<K>> & {
  setupNotAdmitted?: true;
};
