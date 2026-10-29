import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { DigestTextSource } from './types';
import { captureWait } from './capture-wait';

export const PDF_LIMITS = { bytes: 20 * 1024 * 1024, pages: 200, characters: 120_000 } as const;

export async function downloadPdf(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const target = new URL(url);
  if (!/^https?:$/.test(target.protocol))
    throw new Error('Only online HTTP(S) PDFs are supported.');
  target.hash = '';
  let response: Response;
  try {
    response = await fetch(target.href, { signal, credentials: 'include', cache: 'no-store' });
  } catch (error) {
    signal.throwIfAborted();
    throw new Error('PDF download failed. Check site access, then retry.', { cause: error });
  }
  const reader = response.body?.getReader();
  try {
    if (response.status === 401 || response.status === 403)
      throw new Error('PDF access was denied. Sign in to the source site, then retry.');
    if (!response.ok) throw new Error(`PDF download failed (HTTP ${response.status}).`);
    if (Number(response.headers.get('content-length')) > PDF_LIMITS.bytes)
      throw new Error('PDF exceeds the 20 MiB download limit.');
    if (!reader) throw new Error('PDF download returned no document.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PDF_LIMITS.bytes) throw new Error('PDF exceeds the 20 MiB download limit.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-'))
      throw new Error(
        'The source returned no PDF document. It may require sign-in or a direct PDF link.',
      );
    return bytes;
  } finally {
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}

export async function extractPdf(url: string, signal: AbortSignal): Promise<DigestTextSource> {
  const data = await downloadPdf(url, signal);
  signal.throwIfAborted();
  // Lazy import keeps PDF.js out of HTML capture and avoids service-worker DOM requirements.
  const { getDocument, PDFWorker } = await captureWait(import('pdfjs-dist'), signal);
  signal.throwIfAborted();
  // PDF.js treats extension URLs as cross-origin and would create a blob wrapper.
  // Own a real packaged module worker instead; CSP stays self-only and Stop can
  // terminate parsing even when the worker is busy with a damaged document.
  const port = new Worker(workerUrl, { type: 'module', name: 'saul-pdf-capture' });
  const worker = PDFWorker.create({ port });
  const task = getDocument({
    data,
    worker,
    useWorkerFetch: false,
    useWasm: false,
    disableFontFace: true,
    stopAtErrors: true,
    cMapUrl: new URL('../pdf/cmaps/', location.href).href,
    standardFontDataUrl: new URL('../pdf/standard_fonts/', location.href).href,
  });
  const abort = () => {
    void task.destroy().catch(() => undefined);
    worker.destroy();
    port.terminate();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const pdf = await captureWait(task.promise, signal);
    let text = '';
    let readPages = 0;
    let truncated = false;
    const emptyPages: number[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, PDF_LIMITS.pages); pageNumber++) {
      signal.throwIfAborted();
      const page = await captureWait(pdf.getPage(pageNumber), signal);
      try {
        const content = await captureWait(page.getTextContent(), signal);
        signal.throwIfAborted();
        // Keep the PDF's text order and line breaks; do not guess column/table semantics.
        const pageText = content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
          .join('')
          .trim();
        readPages = pageNumber;
        if (!pageText) emptyPages.push(pageNumber);
        const block = `\n\n[Page ${pageNumber}]\n${pageText}`;
        const remaining = PDF_LIMITS.characters - text.length;
        text += block.slice(0, remaining);
        if (
          block.length > remaining ||
          (text.length === PDF_LIMITS.characters && pageNumber < pdf.numPages)
        ) {
          truncated = true;
          break;
        }
      } finally {
        page.cleanup();
      }
    }
    if (emptyPages.length === readPages)
      throw new Error(
        'PDF has no extractable text in the pages read. It may be scanned and need OCR.',
      );
    truncated ||= readPages < pdf.numPages;
    signal.throwIfAborted();
    return {
      text: text.trimStart(),
      capturedAt: Date.now(),
      truncated,
      coverage: `PDF text from pages 1–${readPages} of ${pdf.numPages}; fetched from the source URL for this capture, which may differ from the open viewer. Images, charts and scanned text are not read; text order and tables may be imperfect.${emptyPages.length ? ` Pages with no extractable text: ${emptyPages.join(', ')}.` : ''}${truncated ? ' Partial document: limited to the first 200 pages or 120,000 characters; the last included page may be partial.' : ''}`,
    };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('PDF is password-protected. Open an unlocked copy to summarize it.', {
        cause: error,
      });
    if (
      error instanceof Error &&
      /^(InvalidPDFException|UnknownErrorException|FormatError)$/.test(error.name)
    )
      throw new Error('PDF is damaged or unsupported and could not be read.', { cause: error });
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    try {
      await captureWait(task.destroy(), signal);
    } catch {
      // Cancellation terminates the worker without waiting for a parser reply.
    } finally {
      worker.destroy();
      port.terminate();
    }
  }
}
