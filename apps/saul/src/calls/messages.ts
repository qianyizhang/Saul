import type {
  CallLaunch,
  CallLaunchResult,
  DigestCapture,
  DigestItem,
} from '../../shared/model/call-batch.ts';
import { isRecord } from '../../shared/model/value.mts';

export const CALL_LAUNCH = 'saul-call-launch';
export type CallLaunchMessage = { target: typeof CALL_LAUNCH; message: CallLaunch };
export type CallLaunchReply = CallLaunchResult;

export const DIGEST_CAPTURE = 'saul-digest-capture';
export type CaptureTabSource = Pick<DigestItem, 'tabId' | 'url' | 'title'>;
type CaptureMessage = { target: typeof DIGEST_CAPTURE; item: CaptureTabSource };
type CaptureRequest = CaptureMessage & { verifyOnly?: false };
type VerifyRequest = CaptureMessage & { verifyOnly: true };
export type DigestCaptureMessage = CaptureRequest | VerifyRequest;
export type DigestCaptureReply<T extends DigestCaptureMessage> = T extends VerifyRequest
  ? void
  : DigestCapture;
export type DigestCaptureHandlers = {
  capture: (item: CaptureTabSource) => Promise<DigestCaptureReply<CaptureRequest>>;
  verify: (item: CaptureTabSource) => Promise<DigestCaptureReply<VerifyRequest>>;
};

export function validateDigestCapture(value: unknown): asserts value is DigestCaptureMessage {
  if (
    !isRecord(value) ||
    value.target !== DIGEST_CAPTURE ||
    (value.verifyOnly !== undefined && typeof value.verifyOnly !== 'boolean') ||
    !isRecord(value.item) ||
    typeof value.item.tabId !== 'number' ||
    !Number.isSafeInteger(value.item.tabId) ||
    value.item.tabId < 0 ||
    typeof value.item.url !== 'string' ||
    typeof value.item.title !== 'string'
  )
    throw new Error('Invalid Summary capture request.');
}
