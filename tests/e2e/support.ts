import { chromium, type BrowserContext } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export { configureFixtureProvider } from './driver.ts';

export const answer = 'A gradient points in the direction of steepest increase.';
export const taggedAnswer =
  'A <term note="The direction of steepest increase.">gradient</term> describes how a function changes.';
const extensionBuild = fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url));

export async function createFixtureServer(
  response = answer,
  options: { gated?: boolean; ending?: 'done' | 'eof' | 'length' } = {},
) {
  const requests: { body: string }[] = [];
  let ending = options.ending || 'done';
  let gated = options.gated ?? false;
  const pending = new Set<() => void>();
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
      const request = { body: '' };
      requests.push(request);
      req.on('data', (chunk) => {
        request.body += chunk.toString();
      });
      const finishMode = ending;
      // Separate events exercise the real streaming parser without timed sleeps.
      res.setHeader('Content-Type', 'text/event-stream');
      const middle = Math.floor(response.length / 2);
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: response.slice(0, middle) } }] })}\n\n`,
      );
      const finish = () => {
        pending.delete(finish);
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: response.slice(middle) } }] })}\n\n`,
        );
        if (finishMode === 'length')
          res.write('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n');
        res.end(finishMode === 'eof' ? '' : 'data: [DONE]\n\n');
      };
      if (gated) {
        pending.add(finish);
        res.once('close', () => pending.delete(finish));
      } else finish();
    } else if (req.url === '/anchors') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        `<!doctype html><title>Anchor fixture</title><style>body{font:20px system-ui;padding:40px;line-height:1.7}.hidden{display:none}#late{height:0}#scroller{height:80px;overflow:auto}p{max-width:680px}</style><article id="article"><h1>Repeated terms</h1><p id="one">First context ${'alpha '.repeat(20)}<span id="term-one">gradient</span> ${'first '.repeat(20)}</p><div id="late"></div><p id="two">Second context ${'beta '.repeat(20)}<span id="term-two">gradient</span> ${'second '.repeat(20)}</p><p><a id="native" href="#native-link">native link</a></p><div id="scroller"><p id="clipped">${'above '.repeat(90)}<span id="term-clipped">clipped concept</span>${' below'.repeat(90)}</p></div></article>`,
      );
    } else if (req.url === '/long') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><title>Long reading fixture</title><style>body{font:20px system-ui;padding:60px;line-height:1.7}#concept{margin-top:2000px}footer{height:2000px}</style><h1>Long notes</h1><p id="concept">Gradient descent</p><footer>Continue reading.</footer>',
      );
    } else if (req.url === '/multiline') {
      res.setHeader('Content-Type', 'text/html');
      // Adjacent blocks deliberately have no source whitespace: capture must
      // preserve rendered paragraph/list breaks, not rely on HTML formatting.
      res.end(
        [
          '<!doctype html><title>Multiline reading fixture</title>',
          '<style>body{font:16px Arial;padding:60px;line-height:1.6;min-height:2000px}article{width:560px}li{margin:8px 0}</style>',
          '<article><h1>Saul</h1>',
          '<p id="intro">A local-first Chrome reading assistant built with WXT, React and TypeScript.</p>',
          '<ul>',
          '<li><strong>Reading:</strong> explain a selection, ask for a simpler answer or example, and revisit automatically saved history with bookmarks and full-library export.</li>',
          '<li><strong>Tabs:</strong><span id="ending"> preview sorting, grouping, and moving; undo an unchanged last sort.</span></li>',
          '<li><strong>Settings:</strong> provider profiles and response language.</li>',
          '</ul>',
          '<p id="breaks">First line<br>Second line<br>Final line</p></article>',
        ].join(''),
      );
    } else if (req.url === '/' || req.url === '/article') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><title>Calculus reading fixture</title><style>body{font:20px system-ui;padding:60px;line-height:1.7}</style><h1>Calculus notes</h1><p id="concept">Gradient descent</p><p id="second">Follow the gradient to understand how a function changes.</p><p id="third">Learning rate</p>',
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
    requests,
    setEnding: (value: 'done' | 'eof' | 'length') => {
      ending = value;
    },
    setGated: (value: boolean) => {
      gated = value;
    },
    releaseAll: () => {
      for (const finish of [...pending]) finish();
    },
    pendingCount: () => pending.size,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

export type FixtureServer = Awaited<ReturnType<typeof createFixtureServer>>;

export interface SandboxOptions {
  headless?: boolean;
  artifactsDir?: string;
  databaseFixtures?: boolean;
  handleProcessSignals?: boolean;
}

export async function createSandbox(options: SandboxOptions = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'saul-browser-'));
  const extension = path.join(root, 'extension');
  const profile = path.join(root, 'profile');
  // A fixed bundle path inside this sandbox preserves extension identity across
  // relaunches and prevents later builds in a shared checkout changing the test.
  try {
    await cp(extensionBuild, extension, { recursive: true });
    if (options.databaseFixtures) {
      const require = createRequire(import.meta.resolve('wxt'));
      const { build } = await import(require.resolve('vite'));
      await writeFile(
        path.join(extension, 'database-fixture.html'),
        '<!doctype html><title>Saul database fixture</title>',
      );
      await build({
        configFile: false,
        publicDir: false,
        logLevel: 'error',
        build: {
          lib: {
            entry: {
              'database-fixture': fileURLToPath(new URL('./database-fixture.ts', import.meta.url)),
              'marker-fixture': fileURLToPath(new URL('./marker-fixture.ts', import.meta.url)),
            },
            formats: ['es'],
            fileName: (_format: string, name: string) => name + '.js',
          },
          outDir: extension,
          emptyOutDir: false,
          minify: false,
        },
      });
    }
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
        ...(options.handleProcessSignals === false
          ? { handleSIGINT: false, handleSIGTERM: false }
          : {}),
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

// Seed via the real database worker's current job transitions from the trusted
// background. Test helpers are never exposed as production workspace routes.
export async function seedHistory(
  browser: Awaited<ReturnType<ExtensionSandbox['launch']>>,
  origin: string,
  count: number,
  options: { prefix?: string; response?: string; title?: string } = {},
) {
  await browser.popup.evaluate(async () => {
    const reply = await chrome.runtime.sendMessage({
      target: 'saul-workspace',
      message: { type: 'DB_UNREAD' },
    });
    if (!reply.success) throw new Error(reply.error);
  });
  await browser.worker.evaluate(
    async ({ origin, count, options }) => {
      const db = async (type: string, payload?: unknown) => {
        const reply = await chrome.runtime.sendMessage({
          target: 'saul-offscreen',
          operation: 'db',
          message: { type, payload },
        });
        if (!reply.success) throw new Error(reply.error);
        return reply.result;
      };
      for (let i = 0; i < count; i++) {
        const id = `${options.prefix || 'item'}-${i}`,
          text = `Selection ${id}`;
        const { run } = await db('DB_SUBMIT', {
          submissionId: id,
          regenerate: false,
          snapshot: {
            id,
            text,
            page: { url: origin + '/article', title: options.title || 'Calculus notes' },
            anchor: { exact: text, prefix: '', suffix: '', textStart: i, textEnd: i + text.length },
            viewport: { x: 0, y: 0, width: 0, height: 0, scrollX: 0, scrollY: 0 },
            capturedAt: i + 1,
          },
          input: {
            provider: 'openai-compatible',
            remote: { baseUrl: origin + '/v1', model: 'test-model', temperature: 0.3 },
            local: { temperature: 0.3, topK: 3 },
            systemPrompt: 'test',
            userPrompt: 'test',
            context: { selection: text, pageTitle: '', pageUrl: '' },
          },
        });
        await db('DB_CLAIM', { runId: run.id });
        await db('DB_SAVING', { runId: run.id });
        await db('DB_FINISH', {
          runId: run.id,
          status: 'completed',
          raw:
            options.response ||
            'A <term note="Steepest increase">gradient</term> explains velocity.',
          latencyMs: 1,
        });
        await db('DB_VIEW', { selectionId: id, runId: run.id });
      }
    },
    { origin, count, options },
  );
}
