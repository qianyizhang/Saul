export type ModelEvent = { type: 'delta'; text: string } | { type: 'complete' };
export class IncompleteGeneration extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
  }
}
