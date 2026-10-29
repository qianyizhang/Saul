import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadPdf, PDF_LIMITS } from '../src/digest/pdf';
import { captureSummarySource, CAPTURE_TIMEOUT_MS } from '../src/digest/source';
import { captureTab, verifyCaptureTab } from '../src/digest/capture';
import type { DigestItem } from '../src/digest/types';

const item: DigestItem = {
  index: 0,
  tabId: 1,
  title: 'PDF',
  url: 'https://example.com/document.pdf?download=1#page=2',
  raw: '',
  status: 'queued',
};
const bytes = new TextEncoder().encode('%PDF-1.7\nfixture');
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function browser() {
  const get = vi.fn(async () => ({ id: 1, url: item.url, status: 'complete' }));
  const executeScript = vi.fn();
  const sendMessage = vi.fn();
  vi.stubGlobal('chrome', {
    tabs: { get },
    scripting: { executeScript },
    runtime: { sendMessage },
  });
  return { get, executeScript, sendMessage };
}

describe('PDF downloads', () => {
  it('keeps query parameters, drops viewer fragments and validates bytes despite an incorrect MIME type', async () => {
    const fetch = vi.fn(
      async () => new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await downloadPdf(item.url, new AbortController().signal)).toEqual(bytes);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/document.pdf?download=1',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
  });
  it.each([401, 403, 404, 500])('reports HTTP %i and closes the response body', async (status) => {
    const cancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new ReadableStream({ cancel }), { status })),
    );
    await expect(downloadPdf(item.url, new AbortController().signal)).rejects.toThrow(
      status === 401 || status === 403 ? /Sign in/ : new RegExp(`HTTP ${status}`),
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects an HTML login response even when it claims to be a PDF', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>Sign in to continue</html>', {
            headers: { 'Content-Type': 'application/pdf' },
          }),
      ),
    );
    await expect(downloadPdf(item.url, new AbortController().signal)).rejects.toThrow(
      /no PDF document/,
    );
  });
  it('rejects excessive Content-Length without consuming the body', async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            headers: { 'Content-Length': String(PDF_LIMITS.bytes + 1) },
          }),
      ),
    );
    await expect(downloadPdf(item.url, new AbortController().signal)).rejects.toThrow(/20 MiB/);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('enforces the actual streamed size without trusting Content-Length', async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(PDF_LIMITS.bytes));
                controller.enqueue(bytes);
              },
              cancel,
            }),
          ),
      ),
    );
    await expect(downloadPdf(item.url, new AbortController().signal)).rejects.toThrow(/20 MiB/);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('reports network failures and preserves cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network failed');
      }),
    );
    await expect(downloadPdf(item.url, new AbortController().signal)).rejects.toThrow(
      /download failed/,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(downloadPdf(item.url, controller.signal)).rejects.toThrow(/abort/i);
  });
  it('never fetches a local file or viewer URL', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(downloadPdf('file:///private.pdf', new AbortController().signal)).rejects.toThrow(
      /HTTP/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('summary capture routing', () => {
  it('defaults to a PDF URL attachment without downloading or parsing the document', async () => {
    const f = browser();
    f.sendMessage.mockResolvedValue({
      success: true,
      result: { pdf: { url: item.url, title: item.title } },
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const source = await captureSummarySource(item);
    expect(source).toMatchObject({
      kind: 'pdf-url',
      attachment: { type: 'pdf-url', url: 'https://example.com/document.pdf?download=1' },
      truncated: false,
    });
    expect(source).not.toHaveProperty('text');
    expect(fetch).not.toHaveBeenCalled();
    expect(f.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ verifyOnly: true }));
  });
  it('does not attach unreadable HTML as a PDF when the browser cannot identify its content', async () => {
    const f = browser();
    f.sendMessage.mockResolvedValue({
      success: true,
      result: { pdf: { url: item.url, unverified: true } },
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(captureSummarySource(item)).rejects.toThrow(/could not be identified as a PDF/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('recognizes PDF pathnames with queries without injecting into Chrome’s viewer', async () => {
    const f = browser();
    expect(await captureTab(item)).toEqual({ pdf: { url: item.url, title: item.title } });
    expect(f.executeScript).not.toHaveBeenCalled();
  });
  it('uses wrapper metadata for extensionless URLs and verifies the source again', async () => {
    const f = browser();
    const source = { ...item, url: 'https://example.com/download?id=1' };
    f.get.mockResolvedValue({ id: 1, url: source.url, status: 'complete' });
    f.executeScript.mockResolvedValue([{ result: { pdf: { url: source.url } } }]);
    expect(await captureTab(source)).toEqual({ pdf: { url: source.url } });
    expect(f.get).toHaveBeenCalledTimes(2);
  });
  it('tries validated PDF bytes if Chrome denies wrapper injection', async () => {
    const f = browser();
    f.executeScript.mockRejectedValue(new Error('Cannot access page'));
    const source = { ...item, url: 'https://example.com/download' };
    f.get.mockResolvedValue({ id: 1, url: source.url, status: 'complete' });
    expect(await captureTab(source)).toHaveProperty('pdf.url', source.url);
  });
  it('rejects closed, navigated and unloaded source tabs', async () => {
    const f = browser();
    f.get.mockRejectedValueOnce(new Error('No tab'));
    await expect(verifyCaptureTab(item)).rejects.toThrow(/No tab/);
    f.get.mockResolvedValueOnce({ id: 1, url: 'https://example.com/other', status: 'complete' });
    await expect(verifyCaptureTab(item)).rejects.toThrow(/changed/);
    f.get.mockResolvedValueOnce({ id: 1, url: item.url, status: 'loading' });
    await expect(verifyCaptureTab(item)).rejects.toThrow(/loading/);
  });
  it('keeps HTML capture on the existing path without a download', async () => {
    const f = browser();
    const source = { text: 'Article text', capturedAt: 1, truncated: false, coverage: 'Visible' };
    f.sendMessage.mockResolvedValue({ success: true, result: source });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await captureSummarySource(item)).toEqual(source);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('Stop settles even if a browser capture message has not returned', async () => {
    const f = browser();
    f.sendMessage.mockReturnValue(new Promise(() => undefined));
    const stop = new AbortController();
    const pending = expect(captureSummarySource(item, stop.signal)).rejects.toThrow('Stopped.');
    stop.abort();
    await pending;
  });
  it('times out a stalled download and aborts its fetch signal', async () => {
    // Native AbortSignal.timeout uses the real clock; replace only its clock source.
    vi.useFakeTimers();
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockImplementationOnce((ms) => {
      setTimeout(() => timeout.abort(new DOMException('Timeout', 'TimeoutError')), ms);
      return timeout.signal;
    });
    const f = browser();
    f.sendMessage.mockResolvedValue({ success: true, result: { pdf: { url: item.url } } });
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            signal = options.signal!;
            signal.addEventListener('abort', () => reject(signal!.reason), { once: true });
          }),
      ),
    );
    const pending = expect(captureSummarySource(item, undefined, 'local')).rejects.toThrow(
      /timed out/,
    );
    await vi.advanceTimersByTimeAsync(CAPTURE_TIMEOUT_MS);
    await pending;
    expect(signal?.aborted).toBe(true);
  });
});
