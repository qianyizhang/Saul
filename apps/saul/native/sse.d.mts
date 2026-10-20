export class IncompleteGeneration extends Error {
  reason: string;
  constructor(reason: string, message: string);
}
export function eventData(
  body: ReadableStream<Uint8Array>,
  maxEventSize?: number,
): AsyncGenerator<string>;
