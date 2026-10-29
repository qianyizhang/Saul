import type { Reply } from '../types/storage';
import type { DigestCapture, DigestItem, DigestSource, PdfProcessing } from './types';
import { validPdfUrlAttachment } from '../../native/plan-protocol.mts';
import { extractPdf } from './pdf';
import { captureWait } from './capture-wait';

export const CAPTURE_TIMEOUT_MS = 30_000;

async function backgroundCapture(item: DigestItem, verifyOnly = false) {
  const reply: Reply<DigestCapture | undefined> = await chrome.runtime.sendMessage({
    target: 'saul-digest-capture',
    item,
    verifyOnly,
  });
  if (!reply?.success) throw new Error(reply?.error || 'Capture failed.');
  return reply.result;
}

// Runs in the existing offscreen document, never in the PDF viewer or service worker.
export async function captureSummarySource(
  item: DigestItem,
  stop?: AbortSignal,
  pdfProcessing: PdfProcessing = 'attachment',
): Promise<DigestSource> {
  const timeout = AbortSignal.timeout(CAPTURE_TIMEOUT_MS);
  const signal = stop ? AbortSignal.any([stop, timeout]) : timeout;
  try {
    signal.throwIfAborted();
    const captured = await captureWait(backgroundCapture(item), signal);
    signal.throwIfAborted();
    if (!captured) throw new Error('Page text could not be read.');
    if (!('pdf' in captured)) return captured;
    if (pdfProcessing === 'attachment') {
      if (captured.pdf.unverified)
        throw new Error(
          'This tab could not be identified as a PDF. Open a direct PDF URL, or choose Local PDF processing in Settings.',
        );
      const url = new URL(captured.pdf.url);
      url.hash = '';
      const attachment = { type: 'pdf-url' as const, url: url.href };
      if (!validPdfUrlAttachment(attachment))
        throw new Error(
          'This PDF URL cannot be attached. Choose Local PDF processing in Settings.',
        );
      await captureWait(backgroundCapture(item, true), signal);
      signal.throwIfAborted();
      return {
        kind: 'pdf-url',
        attachment,
        title: captured.pdf.title,
        capturedAt: Date.now(),
        truncated: false,
        coverage:
          'PDF URL attachment: OpenAI is asked to read the whole document, including text and page images, subject to model and provider limits. Saul does not download, parse or store the PDF contents. No local text or page cutoff is applied. Extracted text and exact page coverage are not returned. Retry fetches the saved URL again and may read a newer version. The URL must be accessible to OpenAI without your browser sign-in.',
      };
    }
    const source = await extractPdf(captured.pdf.url, signal);
    signal.throwIfAborted();
    await captureWait(backgroundCapture(item, true), signal);
    signal.throwIfAborted();
    return source;
  } catch (error) {
    if (stop?.aborted) throw new Error('Stopped.', { cause: error });
    if (timeout.aborted)
      throw new Error('PDF capture timed out after 30 seconds. Retry explicitly.', {
        cause: error,
      });
    throw error;
  }
}
