import type { BrowserContext, Page, Worker } from '@playwright/test';
import { CHATGPT_ORIGIN, DEEP_DIVE_MENU } from '../../src/deep-dives/model';
import { reviewScreenshots } from './artifacts';
import { expect, test } from './fixtures';

test.use({ browserToolsFixtures: true });

const conversationId = 'c68abfba-6efe-40d4-acd5-200faf6aeed6';
const conversation = `${CHATGPT_ORIGIN}/c/${conversationId}`;
const customInstruction = 'Explain the claim and how to challenge it.';

async function mockChatGPT(
  context: BrowserContext,
  options: { signedIn?: boolean; hold?: Promise<void>; existingPrompt?: string } = {},
) {
  const sends: string[] = [];
  await context.route(`${CHATGPT_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/fixture-send') {
      sends.push(route.request().postData() ?? '');
      await route.fulfill({ status: 204 });
      return;
    }
    if (path === '/') await options.hold;
    const profile =
      options.signedIn === false
        ? '<button type="button" data-testid="login-button">Log in</button>'
        : '<button type="button" data-testid="accounts-profile-button">Profile</button>';
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>ChatGPT fixture</title>
${profile}
<main><div id="turns"></div><form data-chatgpt-composer>
  <div id="prompt-textarea" role="textbox" aria-label="Chat with ChatGPT" contenteditable="true" style="min-height:1em"></div>
  <button type="submit" data-testid="send-button" disabled>Send message</button>
</form></main>
<script>
  const input = document.querySelector('#prompt-textarea');
  const send = document.querySelector('[data-testid="send-button"]');
  let lastPrompt;
  const renderTurn = (prompt) => {
    const turn = document.createElement('p');
    turn.dataset.messageAuthorRole = 'user';
    turn.textContent = prompt;
    document.querySelector('#turns').replaceChildren(turn);
  };
  const keptPrompt = ${JSON.stringify(sends.at(-1) ?? options.existingPrompt ?? '').replace(/</g, '\\u003c')};
  if (location.pathname.startsWith('/c/') && keptPrompt) renderTurn(keptPrompt);
  const login = document.querySelector('[data-testid="login-button"]');
  login?.addEventListener('click', () => {
    login.dataset.testid = 'accounts-profile-button';
    login.textContent = 'Profile';
  });
  input.addEventListener('input', () => { send.disabled = !input.innerText.trim(); });
  send.form.addEventListener('submit', (event) => {
    event.preventDefault();
    lastPrompt = input.innerText;
    fetch('/fixture-send', { method: 'POST', body: lastPrompt });
    input.replaceChildren();
    send.disabled = true;
    history.pushState({}, '', '/c/WEB:${conversationId}');
  });
  window.publishDeepDiveFixture = (text) => {
    history.replaceState({}, '', '/c/${conversationId}');
    renderTurn(text ?? lastPrompt);
  };
</script>`,
    });
  });
  return sends;
}

async function invokeMenu(worker: Worker, article: Page) {
  await worker.evaluate(
    async ({ url, menu }) => {
      await chrome.contextMenus.update(menu, { enabled: true });
      const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
      if (tab?.id === undefined) throw new Error('Could not find article tab');
      await (
        globalThis as unknown as { saulFixtureContextMenu(id: string, tab: number): Promise<void> }
      ).saulFixtureContextMenu(menu, tab.id);
    },
    { url: article.url(), menu: DEEP_DIVE_MENU },
  );
}

async function publish(tab: Page, text?: string) {
  await tab.evaluate((value) => {
    (window as unknown as { publishDeepDiveFixture(prompt?: string): void }).publishDeepDiveFixture(
      value,
    );
  }, text);
}

test('deep dive verifies the first message, reuses the article, and saves both links across restart', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { context, worker, popup } = await sandbox.launch();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByRole('button', { name: 'Preferences', exact: true }).click();
  await popup.getByText('Deep dives', { exact: true }).click();
  const instruction = popup.getByRole('textbox', { name: 'Deep dive instruction' });
  await instruction.fill(customInstruction);
  await popup.getByRole('button', { name: 'Save instruction' }).click();
  await expect(popup.getByRole('button', { name: 'Save instruction' })).toBeDisabled();
  if (reviewScreenshots)
    await popup.screenshot({ path: info.outputPath('deep-dive-settings.png'), fullPage: true });
  await popup.getByRole('button', { name: 'History', exact: true }).click();
  await popup.getByRole('button', { name: 'Deep dives', exact: true }).click();
  await expect(popup.getByText('No deep dives yet.')).toBeVisible();

  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sends = await mockChatGPT(context, { hold });
  const article = await context.newPage();
  const articleUrl = `${fixtureServer.origin}/article`;
  await article.goto(articleUrl);
  await article.bringToFront();
  const opened = context.waitForEvent('page');
  await invokeMenu(worker, article);
  const chat = await opened;
  await invokeMenu(worker, article);
  await expect(popup.getByRole('link', { name: 'Open article' })).toHaveAttribute(
    'href',
    articleUrl,
  );
  expect(
    await worker.evaluate(async () => (await chrome.tabs.query({ active: true }))[0]?.url),
  ).toBe(articleUrl);
  await article.close();
  release();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0]).toEqual(expect.stringContaining(customInstruction));
  expect(sends[0]).toEqual(expect.stringContaining(`Article: ${articleUrl}`));
  expect(sends[0]).not.toContain('Gradient descent');
  await expect(chat).toHaveURL(new RegExp('/c/WEB:'));
  const openChat = popup.getByRole('link', { name: 'Open ChatGPT chat' });
  await expect(openChat).toHaveCount(0);
  await publish(chat, 'An unrelated user message');
  await expect(openChat).toHaveCount(0);
  await publish(chat);
  await expect(openChat).toHaveAttribute('href', conversation);

  const duplicate = await context.newPage();
  await duplicate.goto(articleUrl);
  await invokeMenu(worker, duplicate);
  const chatTabs = () =>
    worker.evaluate(
      async (origin) => (await chrome.tabs.query({})).filter((tab) => tab.url?.startsWith(origin)),
      CHATGPT_ORIGIN,
    );
  await expect.poll(async () => (await chatTabs()).filter((tab) => tab.active).length).toBe(1);
  expect(await chatTabs()).toHaveLength(1);
  expect(sends).toHaveLength(1);
  if (reviewScreenshots) {
    await popup.setViewportSize({ width: 360, height: 700 });
    await popup.emulateMedia({ colorScheme: 'dark' });
    expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await popup.screenshot({ path: info.outputPath('deep-dives-dark-narrow.png'), fullPage: true });
  }
  const restarted = await sandbox.launch();
  const resumedSends = await mockChatGPT(restarted.context, { existingPrompt: sends[0] });
  await restarted.popup.getByRole('button', { name: 'Deep dives', exact: true }).click();
  await expect(restarted.popup.getByRole('link', { name: 'Open article' })).toHaveAttribute(
    'href',
    articleUrl,
  );
  const restored = restarted.context.waitForEvent('page');
  await restarted.popup.getByRole('link', { name: 'Open ChatGPT chat' }).click();
  const reopened = await restored;
  await expect(reopened).toHaveURL(conversation);
  await expect(reopened.locator('[data-message-author-role="user"]')).toContainText(
    customInstruction,
  );
  expect(resumedSends).toHaveLength(0);
});

test('unconfirmed sign-in leaves a reopenable manual draft and links it after the user sends', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { context, worker, popup } = await sandbox.launch();
  const sends = await mockChatGPT(context, { signedIn: false });
  const article = await context.newPage();
  await article.goto(`${fixtureServer.origin}/article`);
  const opened = context.waitForEvent('page');
  await invokeMenu(worker, article);
  const chat = await opened;
  await popup.getByRole('button', { name: 'Deep dives', exact: true }).click();
  await expect(popup.getByRole('status')).toContainText('Send manually in ChatGPT');
  expect(sends).toHaveLength(0);
  await expect(chat.getByRole('textbox')).toContainText(article.url());
  if (reviewScreenshots)
    await popup.screenshot({ path: info.outputPath('deep-dive-manual-draft.png'), fullPage: true });
  await chat.close();
  const reopening = context.waitForEvent('page');
  await popup.getByRole('button', { name: 'Open ChatGPT' }).click();
  const draft = await reopening;
  await expect(draft.getByRole('textbox')).toContainText(article.url());
  await draft.getByRole('button', { name: 'Log in' }).click();
  expect(sends).toHaveLength(0);
  await draft.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => sends.length).toBe(1);
  await publish(draft);
  await expect(popup.getByRole('link', { name: 'Open ChatGPT chat' })).toHaveAttribute(
    'href',
    conversation,
  );
});

test('closing ChatGPT after the send keeps the article and prevents an automatic retry', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, worker, popup } = await sandbox.launch();
  const sends = await mockChatGPT(context);
  const article = await context.newPage();
  await article.goto(`${fixtureServer.origin}/article`);
  const opened = context.waitForEvent('page');
  await invokeMenu(worker, article);
  const chat = await opened;
  await expect.poll(() => sends.length).toBe(1);
  await chat.close();
  await popup.getByRole('button', { name: 'Deep dives', exact: true }).click();
  await expect(popup.getByRole('status')).toContainText('Send unconfirmed');
  await expect(popup.getByRole('link', { name: 'Open article' })).toHaveAttribute(
    'href',
    article.url(),
  );
  await invokeMenu(worker, article);
  await expect(popup.getByRole('link', { name: 'Open ChatGPT chat' })).toHaveCount(0);
  expect(sends).toHaveLength(1);
});
