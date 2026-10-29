import { designColors } from '../design/tokens';
import type { DigestBatch, Pair } from './types';
function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
export function sourceUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
export function digestHtml(batch: DigestBatch): string {
  const e = escapeHtml;
  const pair = (p: Pair) =>
    `<p lang="en">${e(p.en)}</p><p lang="zh-Hans" class="zh">${e(p.zh)}</p>`;
  const rows = batch.items
    .map((item) => {
      const s = item.summary,
        url = sourceUrl(item.url);
      return `<article id="tab-${item.index}"><header><span class="status">${e(item.status + ' · ' + (item.windowTitle || batch.windowTitle))}</span><h2>${url ? `<a href="${e(url)}" rel="noreferrer">${e(item.title)}</a>` : e(item.title)}</h2>${url ? `<a class="source" href="${e(url)}" rel="noreferrer">${e(url)}</a>` : ''}</header>${s ? `<div class="lead">${pair(s.lead)}</div><ul>${s.points.map((p) => `<li>${pair(p)}</li>`).join('')}</ul>${s.caution ? `<aside><h3>Limit / 限制</h3>${pair(s.caution)}</aside>` : ''}${s.flow.length ? `<h3>How it works / 工作原理</h3><ol>${s.flow.map((p) => `<li>${pair(p)}</li>`).join('')}</ol>` : ''}${s.terms.length ? `<details><summary>Terms / 术语</summary>${s.terms.map(pair).join('')}</details>` : ''}${s.question ? `<details><summary>Explore further / 进一步思考</summary>${pair(s.question)}</details>` : ''}` : `<p>${e(item.error || 'Not summarized yet.')}</p>`}<footer>${e(item.coverage || 'No source input recorded.')}${item.capturedAt ? ` · ${item.sourceKind === 'pdf-url' ? 'Prepared' : 'Captured'} ${e(new Date(item.capturedAt).toLocaleString())}` : ''}</footer></article>`;
    })
    .join('');
  const done = batch.items.filter((i) => i.status === 'completed').length;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>${e(batch.windowTitle)} · Saul summary</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.6;background:light-dark(${designColors['canvas']},${designColors['canvas-dark']});color:light-dark(${designColors['ink']},${designColors['ink-dark']})}body{max-width:880px;margin:40px auto;padding:0 24px}a{color:light-dark(${designColors['primary']},${designColors['primary-dark']});overflow-wrap:anywhere}h1,h2{line-height:1.25}h2{font-size:1.4rem}h3{font-size:1rem;margin-bottom:6px}article{background:light-dark(${designColors.surface},${designColors['surface-dark']});border:1px solid light-dark(${designColors['line']},${designColors['line-dark']});border-radius:16px;padding:28px;margin:24px 0}p{margin:8px 0}.zh{color:light-dark(${designColors['muted']},${designColors['muted-dark']});margin-top:2px}li{margin:18px 0}.lead{font-weight:600;margin:20px 0}aside{border-left:3px solid ${designColors['primary']};padding-left:16px}.source,footer,.status{font-size:.8rem}footer{margin-top:24px;opacity:.75}details{margin:16px 0}summary{cursor:pointer}.status{text-transform:uppercase;letter-spacing:.06em}@media(max-width:520px){body{padding:0 12px;margin:20px auto}article{padding:18px}}@media print{article{break-inside:avoid}details{display:block}}
</style><header><h1>${e(batch.windowTitle)}</h1><p>${done} of ${batch.items.length} summarized · GPT-6 Luna · medium · ${e(new Date(batch.createdAt).toLocaleString())}</p><p>English first, then 简体中文. Generated summaries; follow source links for full context.</p>${batch.error ? `<p>${e(batch.error)}</p>` : ''}<details><summary>Contents / 目录</summary><ol>${batch.items.map((i) => `<li><a href="#tab-${i.index}">${e(i.title)}</a> · ${e(i.status)}</li>`).join('')}</ol></details></header>${rows}</html>`;
}
