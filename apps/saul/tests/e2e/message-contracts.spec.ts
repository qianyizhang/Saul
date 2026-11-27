import { expect, test } from './fixtures.ts';

test('workspace routes reject malformed requests and keep offscreen storage private', async ({
  sandbox,
}) => {
  const { popup } = await sandbox.launch();
  const replies = await popup.evaluate(async () =>
    Promise.all([
      chrome.runtime.sendMessage({ target: 'saul-connection', message: { action: 'release' } }),
      chrome.runtime.sendMessage({
        target: 'saul-deep-dives',
        message: { action: 'save-instruction', value: 'new' },
      }),
      chrome.runtime.sendMessage({
        target: 'saul-call-editor',
        message: { action: 'read-draft' },
      }),
    ]),
  );
  expect(replies).toMatchObject([
    { success: false, error: 'Invalid connection setup request.' },
    { success: false, error: expect.stringContaining('expected') },
    { success: false, error: 'Runner only' },
  ]);
});

test('the actual offscreen runner accepts a supported read and rejects malformed dispatch', async ({
  sandbox,
}) => {
  const { worker } = await sandbox.launch();
  const replies = await worker.evaluate(async () => {
    const url = chrome.runtime.getURL('offscreen.html');
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [url],
    });
    if (!contexts.length)
      await chrome.offscreen.createDocument({
        url,
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: 'Verify the extension’s offscreen message listener.',
      });
    return Promise.all([
      chrome.runtime.sendMessage({
        target: 'saul-offscreen',
        operation: 'db',
        message: { type: 'DB_UNREAD' },
      }),
      chrome.runtime.sendMessage({
        target: 'saul-offscreen',
        operation: 'db',
        message: { type: 'DB_RECOVER' },
      }),
      chrome.runtime.sendMessage({
        target: 'saul-offscreen',
        operation: 'delete',
        expectedRevision: 1,
      }),
    ]);
  });
  expect(replies).toEqual([
    { success: true, result: 0 },
    { success: false, error: 'Unknown workspace storage operation' },
    { success: false, error: 'Invalid or unavailable workspace operation' },
  ]);
});
