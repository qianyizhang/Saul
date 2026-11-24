// Test-only adapter: dispatch native operations in their production background context.
import { handleLocalToolCall } from '../../src/native/local-tool-call';
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'saul-fixture-annotation-bridge') return false;
  if (sender.id !== chrome.runtime.id) return false;
  void handleLocalToolCall('saul_annotations', message.request).then(
    (result) => reply({ result }),
    (error) => reply({ error: String(error) }),
  );
  return true;
});
