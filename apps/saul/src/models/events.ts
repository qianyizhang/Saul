export type ModelActivity = 'connecting' | 'waiting' | 'thinking' | 'generating';
export type ModelEvent =
  | { type: 'delta'; text: string }
  | { type: 'image'; image: import('./images').GeneratedImage }
  | { type: 'activity'; phase: 'waiting' | 'thinking' }
  | { type: 'complete' };
export { IncompleteGeneration } from '../../native/sse.mts';
