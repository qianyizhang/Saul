import { chromium, type BrowserContext } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const answer = 'A gradient points in the direction of steepest increase.';
export const taggedAnswer =
  'A <term note="The direction of steepest increase.">gradient</term> describes how a function changes.';
const extensionBuild = fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url));

export async function createFixtureServer(
  response = answer,
  options: { chunkDelayMs?: number } = {},
) {
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    } else if (req.url === '/v1/chat/completions') {
      // Separate events exercise the real streaming parser without timed sleeps.
      res.setHeader('Content-Type', 'text/event-stream');
      const middle = Math.floor(response.length / 2);
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: response.slice(0, middle) } }] })}\n\n`,
      );
      const finish = () => {
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: response.slice(middle) } }] })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
      };
      if (options.chunkDelayMs) {
        const timer = setTimeout(finish, options.chunkDelayMs);
        res.once('close', () => clearTimeout(timer));
      } else finish();
    } else if (req.url === '/' || req.url === '/article') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><title>Calculus reading fixture</title><style>body{font:20px system-ui;padding:60px;line-height:1.7}</style><h1>Calculus notes</h1><p id="concept">Gradient descent</p><p>Follow the gradient to understand how a function changes.</p>',
      );
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

export type FixtureServer = Awaited<ReturnType<typeof createFixtureServer>>;

export async function createSandbox(options: { headless?: boolean; artifactsDir?: string } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'saul-browser-'));
  const extension = path.join(root, 'extension');
  const profile = path.join(root, 'profile');
  // A fixed bundle path inside this sandbox preserves extension identity across
  // relaunches and prevents later builds in a shared checkout changing the test.
  try {
    await cp(extensionBuild, extension, { recursive: true });
    if (options.artifactsDir) await mkdir(options.artifactsDir, { recursive: true });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  let context: BrowserContext | undefined;
  let launchNumber = 0;
  let tracing = false;
  const logs: string[] = [];

  async function closeBrowser() {
    if (!context) return;
    const closing = context;
    context = undefined;
    try {
      if (tracing && options.artifactsDir) {
        await closing.tracing.stop({
          path: path.join(options.artifactsDir, `trace-${launchNumber}.zip`),
        });
      }
    } finally {
      tracing = false;
      await closing.close();
    }
  }

  return {
    profile,
    async launch() {
      await closeBrowser();
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: options.headless ?? true,
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
        viewport: { width: 1000, height: 800 },
      });
      launchNumber++;
      context.on('console', (message) =>
        logs.push(`[${launchNumber}] ${message.type()}: ${message.text()}`),
      );
      context.on('weberror', (event) =>
        logs.push(`[${launchNumber}] uncaught: ${event.error().message}`),
      );
      if (options.artifactsDir) {
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        tracing = true;
      }
      const worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
      const extensionId = new URL(worker.url()).host;
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      return { context, worker, popup };
    },
    async close(failed = false) {
      try {
        if (failed && context && options.artifactsDir) {
          for (const [index, page] of context.pages().entries()) {
            await page
              .screenshot({
                path: path.join(options.artifactsDir, `page-${index}.png`),
                timeout: 3_000,
              })
              .catch((error) => logs.push(`Screenshot unavailable: ${error.message}`));
          }
        }
        await closeBrowser();
      } finally {
        await rm(root, { recursive: true, force: true });
        if (options.artifactsDir) {
          if (failed)
            await writeFile(path.join(options.artifactsDir, 'console.log'), logs.join('\n'));
          else await rm(options.artifactsDir, { recursive: true, force: true });
        }
      }
    },
  };
}

export type ExtensionSandbox = Awaited<ReturnType<typeof createSandbox>>;
