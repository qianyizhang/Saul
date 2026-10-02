// Shared by browser Chat Completions and native Responses transports.
export class IncompleteGeneration extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// SSE records end at blank lines, not at network chunk boundaries.
export async function* eventData(body, maxEventSize = 2_000_000) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    data = [],
    eventSize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.search(/[\r\n]/)) !== -1) {
        if (!done && buffer[end] === '\r' && end === buffer.length - 1) break;
        const line = buffer.slice(0, end);
        eventSize += line.length;
        if (eventSize > maxEventSize)
          throw new IncompleteGeneration('event-too-large', 'Model event exceeded the size limit.');
        buffer = buffer.slice(end + (buffer.slice(end, end + 2) === '\r\n' ? 2 : 1));
        if (!line) {
          if (data.length) yield data.join('\n');
          data = [];
          eventSize = 0;
        } else if (line === 'data' || line.startsWith('data:'))
          data.push(line.slice(5).replace(/^ /, ''));
      }
      if (eventSize + buffer.length > maxEventSize)
        throw new IncompleteGeneration('event-too-large', 'Model event exceeded the size limit.');
      if (done) {
        if (data.length || /^data(?::|$)/.test(buffer))
          throw new IncompleteGeneration(
            'truncated-event',
            'The model stream ended in an incomplete event.',
          );
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
