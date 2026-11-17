import { z } from 'zod';
import { integer, wireObject } from './tool-schema.mts';

export const PAYLOAD_LIMIT = 64 * 1024;
export const uuidSchema = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
export const payloadSchema = wireObject({
  text: z.string().max(PAYLOAD_LIMIT),
  originalBytes: integer.min(0),
  redacted: z.boolean(),
  truncated: z.boolean(),
  omitted: z.boolean(),
});
export const eventMetadataSchema = wireObject({
  id: uuidSchema,
  session: uuidSchema,
  interaction: uuidSchema,
  time: z
    .string()
    .max(30)
    .regex(/^\d{4}-\d\d-\d\dT/),
  source: z.enum(['app', 'server']),
  method: z.string().max(120),
  direction: z.string().max(120),
  phase: z.enum(['request', 'result', 'error']),
  status: z.string().max(80),
});
export const eventSchema = wireObject({ ...eventMetadataSchema.shape, payload: payloadSchema });
export type Event = z.infer<typeof eventSchema>;
export type Payload = z.infer<typeof payloadSchema>;
export function snapshot(value: unknown, omit = false): Payload {
  let redacted = false;
  const original = JSON.stringify(value) ?? 'null';
  const text =
    JSON.stringify(
      value,
      (key, item: unknown) => {
        if (
          /^(?:authorization|proxyauthorization|cookie|setcookie|password|secret|clientsecret|token|accesstoken|refreshtoken|idtoken|apikey|privatekey|interactiontoken|approvaltoken)$/.test(
            key.replace(/[-_]/g, '').toLowerCase(),
          )
        ) {
          redacted = true;
          return '[redacted]';
        }
        return item;
      },
      2,
    ) ?? 'null';
  const bytes = new TextEncoder().encode(text);
  return {
    text: omit
      ? '[payload omitted by recording policy]'
      : new TextDecoder().decode(bytes.slice(0, PAYLOAD_LIMIT)),
    originalBytes: new TextEncoder().encode(original).length,
    redacted,
    truncated: bytes.length > PAYLOAD_LIMIT,
    omitted: omit,
  };
}
export class Recorder {
  readonly session = crypto.randomUUID();
  readonly events: Event[] = [];
  dropped = 0;
  readonly source: Event['source'];
  readonly sink?: (event: Event) => void;
  constructor(source: Event['source'], sink?: (event: Event) => void) {
    this.source = source;
    this.sink = sink;
  }
  record(
    interaction: string,
    method: string,
    direction: string,
    phase: Event['phase'],
    status: string,
    value: unknown,
  ): Event {
    const event = eventSchema.parse({
      id: crypto.randomUUID(),
      session: this.session,
      interaction,
      time: new Date().toISOString(),
      source: this.source,
      method,
      direction,
      phase,
      status,
      payload: snapshot(value),
    });
    this.events.push(event);
    if (this.events.length > 250) {
      this.events.shift();
      this.dropped++;
    }
    // Recording is best effort and must not change the observed action's result.
    try {
      this.sink?.(event);
    } catch {
      /* Sink exposes its own health. */
    }
    return event;
  }
}
