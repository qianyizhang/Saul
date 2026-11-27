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
