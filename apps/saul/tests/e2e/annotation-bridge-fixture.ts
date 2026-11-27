// Test-only adapter: dispatch native operations in their production background context.
import { handleLocalToolCall } from '../../src/native/local-tool-call';
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const tool =
    message?.target === 'saul-fixture-annotation-bridge'
      ? 'saul_annotations'
      : message?.target === 'saul-fixture-history-bridge' &&
          ['saul_history_search', 'saul_history_read'].includes(message.tool)
        ? message.tool
        : undefined;
  if (!tool) return false;
  if (sender.id !== chrome.runtime.id) return false;
  void handleLocalToolCall(tool, message.request).then(
    (result) => reply({ result }),
    (error) => reply({ error: String(error) }),
  );
  return true;
});
