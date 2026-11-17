export type ModelActivity = 'connecting' | 'waiting' | 'thinking' | 'generating';
export type ModelEvent =
  | { type: 'delta'; text: string }
  | { type: 'image'; image: import('./image.ts').GeneratedImage }
  | { type: 'activity'; phase: 'waiting' | 'thinking' }
  | { type: 'complete' };
export { IncompleteGeneration } from '../protocol/sse.mts';
