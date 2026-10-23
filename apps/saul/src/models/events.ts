export type ModelActivity = 'connecting' | 'waiting' | 'thinking' | 'generating';
export type ModelEvent =
  | { type: 'delta'; text: string }
  | { type: 'activity'; phase: 'waiting' | 'thinking' }
  | { type: 'complete' };
export { IncompleteGeneration } from '../../native/sse.mts';
