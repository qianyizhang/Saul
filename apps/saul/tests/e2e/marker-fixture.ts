// Browser-only measurement harness; bundled solely in disposable test snapshots.
import { PassageMarkers } from '../../src/reading/markers';
import { buildTextMap, captureAnchor, resolveAnchor } from '../../src/reading/anchors';
import type { Passage } from '../../src/types/storage';
export async function measureMarkers(count: number) {
  document.body.style.cssText = 'font:20px system-ui;line-height:1.7;padding:32px;';
  document.body.replaceChildren();
  for (let i = 0; i < count; i++) {
    const p = document.createElement('p');
    p.textContent = `Context ${i}: concept ${String(i).padStart(4, '0')} has a specific meaning here.`;
    document.body.append(p);
  }
  await document.fonts.ready;
  const map = buildTextMap(),
    passages: Passage[] = [...document.querySelectorAll('p')].map((p, i) => {
      const range = document.createRange(),
        text = `concept ${String(i).padStart(4, '0')}`,
        start = p.textContent!.indexOf(text);
      range.setStart(p.firstChild!, start);
      range.setEnd(p.firstChild!, start + text.length);
      const run = {
        id: `r${i}`,
        status: 'completed' as const,
        responseRaw: 'Answer',
        model: 'fixture',
        provider: 'fixture',
        createdAt: 1,
        viewedAt: 1,
      };
      return {
        snapshot: {
          id: `s${i}`,
          text,
          page: { url: location.href, title: 'Scale' },
          anchor: captureAnchor(range, map),
          viewport: { x: 0, y: 0, width: 0, height: 0, scrollX: 0, scrollY: 0 },
          capturedAt: 1,
        },
        latest: run,
        completed: run,
        bookmarked: false,
        unread: false,
      };
    });
  const renderer = new PassageMarkers(
    () => {},
    () => {},
  );
  // Let the constructor's font readiness pass settle before timed calls.
  await Promise.resolve();
  const full: number[] = [],
    statusOnly: number[] = [];
  try {
    for (let i = 0; i < 5; i++) {
      const variant = passages.map((p) => ({
        ...p,
        snapshot: { ...p.snapshot, id: p.snapshot.id + '-' + i },
      }));
      let at = performance.now();
      renderer.set(variant);
      full.push(performance.now() - at);
      at = performance.now();
      renderer.set(variant);
      statusOnly.push(performance.now() - at);
    }
    return {
      passages: count,
      textCharacters: map.text.length,
      attached: [...renderer.attachments.values()].filter((a) => a.state === 'attached').length,
      fullRestoreMs: full,
      statusRefreshMs: statusOnly,
    };
  } finally {
    renderer.destroy();
  }
}

export function checkAnchorBounds() {
  document.body.replaceChildren();
  const original = document.createTextNode('unique concept in context');
  document.body.append(original);
  const range = document.createRange();
  range.setStart(original, 0);
  range.setEnd(original, 14);
  const anchor = captureAnchor(range);
  const oversized = document.createTextNode('x'.repeat(1_000_001));
  document.body.append(oversized);
  const map = buildTextMap();
  let captureRejected = false;
  range.setEnd(oversized, oversized.length);
  try {
    captureAnchor(range, map);
  } catch {
    captureRejected = true;
  }
  const withinSingleNode = document.createRange();
  document.body.replaceChildren(oversized);
  withinSingleNode.setStart(oversized, 999_990);
  withinSingleNode.setEnd(oversized, 1_000_001);
  let singleNodeRejected = false;
  const singleMap = buildTextMap();
  try {
    captureAnchor(withinSingleNode, singleMap);
  } catch {
    singleNodeRejected = true;
  }
  document.body.replaceChildren();
  for (let i = 0; i < 30_001; i++) document.body.append(document.createTextNode('x'));
  const nodeMap = buildTextMap();
  return {
    characters: map.text.length,
    truncated: map.truncated,
    captureRejected,
    resolution: resolveAnchor(anchor, map).state,
    singleCharacters: singleMap.text.length,
    singleNodeRejected,
    nodes: nodeMap.spans.length,
    nodesTruncated: nodeMap.truncated,
  };
}
