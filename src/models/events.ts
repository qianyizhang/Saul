export type ModelEvent = { type: 'delta'; text: string } | { type: 'complete' };
export { IncompleteGeneration } from '../../native/sse.mjs';
