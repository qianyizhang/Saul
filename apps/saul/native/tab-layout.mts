import type { TabSnapshot } from './protocol.mts';
// Navigation and focus do not invalidate an edit or Undo. Changed membership,
// order, pins and groups do. This identity is shared by both surfaces.
export function tabLayoutRevision(
  snapshot: TabSnapshot,
  windowIds = snapshot.windows.map((w) => w.id),
) {
  const ids = new Set(windowIds);
  return JSON.stringify({
    windows: snapshot.windows
      .filter((w) => ids.has(w.id))
      .map((w) => w.id)
      .sort((a, b) => a - b),
    tabs: snapshot.tabs
      .filter((t) => ids.has(t.windowId))
      .map(({ id, windowId, index, pinned, groupId }) => ({ id, windowId, index, pinned, groupId }))
      .sort((a, b) => a.id - b.id),
    groups: snapshot.groups
      .filter((g) => ids.has(g.windowId))
      .map(({ id, windowId, title, color, collapsed }) => ({
        id,
        windowId,
        title,
        color,
        collapsed,
      }))
      .sort((a, b) => a.id - b.id),
  });
}
