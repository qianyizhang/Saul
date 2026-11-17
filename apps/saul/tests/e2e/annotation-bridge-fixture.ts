// Test-only adapter: dispatch native operations in their production background context.
import { handleTabCall } from '../../src/native/tabs';
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'saul-fixture-annotation-bridge') return false;
  if (sender.id !== chrome.runtime.id) return false;
  void handleTabCall('saul_annotations', message.request).then(
    (result) => reply({ result }),
    (error) => reply({ error: String(error) }),
  );
  return true;
});
