import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { BOARD_HTML, BOARD_URI } from './board-resource.mts';
import { createBoardService } from './board-service.mts';
import { isRecord } from './value.mts';

/** The same board and operation owner, with loopback + same-origin + bearer gates. */
export async function startBoardWeb(
  options: { service?: ReturnType<typeof createBoardService>; port?: number } = {},
) {
  const service = options.service ?? createBoardService({ resourceUri: BOARD_URI });
  const token = randomBytes(32).toString('hex');
  let origin = '';
  let queue: Promise<unknown> = Promise.resolve();
  const html = BOARD_HTML.replace(
    '</head>',
    '<script type="application/json" id="saul-web">{"mode":"standalone"}</script></head>',
  );
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'",
    );
    const finish = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (request.headers.host !== new URL(origin).host) {
      finish(403, { error: 'Unexpected host' });
      return;
    }
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    if (request.method !== 'POST' || request.url !== '/api') {
      finish(404, { error: 'Not found' });
      return;
    }
    if (request.headers.origin !== origin || request.headers.authorization !== `Bearer ${token}`) {
      finish(403, {
        error: 'Open the local board URL printed by the server; this request is not authorized.',
      });
      return;
    }
    void (async () => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 1024 * 1024) {
          finish(413, { error: 'Request too large' });
          return;
        }
        chunks.push(buffer);
      }
      const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (
        !isRecord(input) ||
        typeof input.name !== 'string' ||
        Object.keys(input).some((key) => !['name', 'arguments'].includes(key))
      )
        throw new Error('Invalid operation request');
      const name = input.name;
      const run = () => service.call(name, input.arguments ?? {});
      const result = name.startsWith('diagnostics_')
        ? await run()
        : await (queue = queue.then(run, run));
      finish(200, result);
    })().catch((error) =>
      finish(400, {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local board did not bind');
  origin = `http://127.0.0.1:${address.port}`;
  return { server, service, origin, url: `${origin}/#${token}` };
}
