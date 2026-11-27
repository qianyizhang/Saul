import type { CallLaunchResult, DigestCapture } from '../shared/model/call-batch.ts';
import { captureTab, verifyCaptureTab } from '../src/calls/capture/capture';
import { requestDigestCapture } from '../src/calls/capture/source';
import { launchCall } from '../src/calls/client';
import {
  DIGEST_CAPTURE,
  type CallLaunchMessage,
  type CallLaunchReply,
  type DigestCaptureHandlers,
} from '../src/calls/messages';

export function checkCallMessageTypes(message: CallLaunchMessage) {
  const item = { tabId: 1, url: 'https://example.test/article', title: 'Article' };
  const launch: Promise<CallLaunchResult> = launchCall(message.message);
  const capture: Promise<DigestCapture> = requestDigestCapture({ target: DIGEST_CAPTURE, item });
  const verify: Promise<void> = requestDigestCapture({
    target: DIGEST_CAPTURE,
    item,
    verifyOnly: true,
  });
  // @ts-expect-error Wrong route.
  requestDigestCapture({ target: message.target, item });
  // @ts-expect-error Wrong payload.
  launchCall({ id: 'example', tabIds: ['1'] });
  // @ts-expect-error Wrong launch reply.
  const launchReply: CallLaunchReply = { kind: 'done' };
  // @ts-expect-error Verification must not return a capture to the caller.
  const handlers: DigestCaptureHandlers = { capture: captureTab, verify: captureTab };
  // @ts-expect-error Capture cannot return the verification acknowledgement.
  const captureHandler: DigestCaptureHandlers['capture'] = verifyCaptureTab;
  return { launch, capture, verify, launchReply, handlers, captureHandler };
}
