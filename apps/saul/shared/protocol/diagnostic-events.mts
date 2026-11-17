import { validate, type ToolSchema } from './protocol.mts';

export const PAYLOAD_LIMIT = 64 * 1024;
export interface Payload {
  text: string;
  originalBytes: number;
  redacted: boolean;
  truncated: boolean;
  omitted: boolean;
}
export interface Event {
  id: string;
  session: string;
  interaction: string;
  time: string;
  source: 'app' | 'server';
  method: string;
  direction: string;
  phase: 'request' | 'result' | 'error';
  status: string;
  payload: Payload;
}
export const uuidSchema: ToolSchema = {
  type: 'string',
  pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',
};
export const objectSchema = (
  properties: Record<string, ToolSchema>,
  required = Object.keys(properties),
): ToolSchema => ({ type: 'object', properties, required, additionalProperties: false });
export const payloadSchema = objectSchema({
  text: { type: 'string', maxLength: PAYLOAD_LIMIT },
  originalBytes: { type: 'integer', minimum: 0 },
  redacted: { type: 'boolean' },
  truncated: { type: 'boolean' },
  omitted: { type: 'boolean' },
});
export const eventMetadataDefinition = objectSchema({
  id: uuidSchema,
  session: uuidSchema,
  interaction: uuidSchema,
  time: { type: 'string', maxLength: 30, pattern: '^\\d{4}-\\d\\d-\\d\\dT' },
  source: { type: 'string', enum: ['app', 'server'] },
  method: { type: 'string', maxLength: 120 },
  direction: { type: 'string', maxLength: 120 },
  phase: { type: 'string', enum: ['request', 'result', 'error'] },
  status: { type: 'string', maxLength: 80 },
});
export const eventDefinition = objectSchema({
  ...eventMetadataDefinition.properties,
  payload: payloadSchema,
});
export const eventSchema = {
  parse(value: unknown): Event {
    validate(eventDefinition, value, 'event');
    return structuredClone(value) as Event;
  },
};
export const eventMetadataSchema = {
  parse(value: unknown): Omit<Event, 'payload'> {
    validate(eventMetadataDefinition, value, 'event metadata');
    return structuredClone(value) as Omit<Event, 'payload'>;
  },
};
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
