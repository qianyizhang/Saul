import type { TabEdit, TabEditResult, TabSnapshot } from '../../native/protocol.mjs';
import { tabLayoutRevision } from '../../native/tab-layout.mjs';

type List = () => Promise<TabSnapshot>;
const undos = new Map<string, { before: TabSnapshot; after: string; windows: number[] }>();
const ordered = (s: TabSnapshot, windowId: number) =>
  s.tabs.filter((t) => t.windowId === windowId).sort((a, b) => a.index - b.index);

// Called inside the shared tab mutation lock, after protocol validation.
export async function editTabs(edit: TabEdit, list: List): Promise<TabEditResult> {
  const before = await list();
  if (tabLayoutRevision(before) !== edit.expected)
    throw new Error('Tabs changed. Review the refreshed list and try your edit again.');
  const sourceGroup =
    edit.kind === 'moveGroup' ? before.groups.find((g) => g.id === edit.groupId) : undefined;
  const ids = sourceGroup
    ? ordered(before, sourceGroup.windowId)
        .filter((t) => t.groupId === sourceGroup.id)
        .map((t) => t.id)
    : edit.tabIds;
  if (
    !ids?.length ||
    new Set(ids).size !== ids.length ||
    (edit.kind === 'moveGroup' && !sourceGroup)
  )
    throw new Error('Select tabs or a complete group.');
  const tabs = ids.map((id) => before.tabs.find((t) => t.id === id));
  if (tabs.some((t) => !t || t.pinned))
    throw new Error('Pinned tabs can be summarized, but cannot be grouped or moved here.');
  const targetGroup =
    edit.kind !== 'moveGroup' && edit.groupId !== undefined
      ? before.groups.find((g) => g.id === edit.groupId)
      : undefined;
  if (edit.kind !== 'moveGroup' && edit.groupId !== undefined && !targetGroup)
    throw new Error('The destination group no longer exists.');
  const sources = [...new Set(tabs.map((t) => t!.windowId))];
  let destination =
    targetGroup?.windowId ?? edit.windowId ?? (sources.length === 1 ? sources[0] : undefined);
  if (destination === undefined) throw new Error('Choose a destination window.');
  if (targetGroup && edit.windowId !== undefined && edit.windowId !== destination)
    throw new Error('The group belongs to another window.');
  if (destination !== -1 && !before.windows.some((w) => w.id === destination))
    throw new Error('The destination window no longer exists.');
  if (edit.kind === 'group' && !targetGroup && !edit.title?.trim())
    throw new Error('Give the group a name.');
  const anchor =
    edit.beforeTabId === undefined ? undefined : before.tabs.find((t) => t.id === edit.beforeTabId);
  if (
    edit.beforeTabId !== undefined &&
    (!anchor || anchor.windowId !== destination || ids.includes(anchor.id) || anchor.pinned)
  )
    throw new Error('The drop position changed.');
  if (
    anchor &&
    !targetGroup &&
    anchor.groupId >= 0 &&
    ordered(before, destination).find((t) => t.groupId === anchor.groupId)?.id !== anchor.id
  )
    throw new Error('Drop before the group header or into the group.');
  const affected = [...new Set([...sources, ...(destination === -1 ? [] : [destination])])];
  try {
    if (sourceGroup) {
      if (destination === -1) {
        // Chrome can move a group only into an existing window. Keep the group
        // itself intact, and remove only the temporary tab this action creates.
        const created = await chrome.windows.create({
          url: 'about:blank',
          focused: false,
          type: 'normal',
        });
        if (created?.id === undefined) throw new Error('Window creation returned no ID.');
        destination = created.id;
        affected.push(destination);
        const placeholder = created.tabs?.[0]?.id;
        try {
          await chrome.tabGroups.move(sourceGroup.id, { windowId: destination, index: 0 });
        } finally {
          if (placeholder !== undefined) await chrome.tabs.remove(placeholder);
        }
        await chrome.tabGroups.update(sourceGroup.id, { collapsed: sourceGroup.collapsed });
      } else {
        const remaining = ordered(before, destination).filter((t) => !ids.includes(t.id));
        const index = anchor ? remaining.findIndex((t) => t.id === anchor.id) : remaining.length;
        await chrome.tabGroups.move(sourceGroup.id, { windowId: destination, index });
      }
    } else {
      const grouped = tabs.filter((t) => t!.groupId >= 0).map((t) => t!.id);
      const detach = grouped.filter(
        (id) => before.tabs.find((t) => t.id === id)?.groupId !== targetGroup?.id,
      );
      if (detach.length) await chrome.tabs.ungroup(detach as [number, ...number[]]);
      if (destination === -1) {
        const created = await chrome.windows.create({
          tabId: ids[0],
          focused: false,
          type: 'normal',
        });
        if (created?.id === undefined) throw new Error('Window creation returned no ID.');
        destination = created.id;
        affected.push(destination);
      }
      // Append first to avoid index drift when moving several tabs in one window.
      for (const id of ids) await chrome.tabs.move(id, { windowId: destination, index: -1 });
      const remaining = (await chrome.tabs.query({ windowId: destination }))
        .filter((t) => !ids.includes(t.id!))
        .sort((a, b) => a.index - b.index);
      const groupEnd = targetGroup
        ? remaining.filter((t) => t.groupId === targetGroup.id).at(-1)
        : undefined;
      const index = anchor
        ? remaining.findIndex((t) => t.id === anchor.id)
        : groupEnd
          ? remaining.indexOf(groupEnd) + 1
          : remaining.length;
      if (index < 0) throw new Error('The drop position changed during the move.');
      for (let offset = 0; offset < ids.length; offset++)
        await chrome.tabs.move(ids[offset]!, { windowId: destination, index: index + offset });
      if (edit.kind === 'group' || targetGroup) {
        const stillExists =
          targetGroup &&
          (await chrome.tabGroups.query({ windowId: destination })).some(
            (g) => g.id === targetGroup.id,
          );
        const groupId = await chrome.tabs.group({
          tabIds: ids as [number, ...number[]],
          ...(stillExists
            ? { groupId: targetGroup.id }
            : { createProperties: { windowId: destination } }),
        });
        if (!stillExists)
          await chrome.tabGroups.update(
            groupId,
            targetGroup
              ? {
                  title: targetGroup.title || '',
                  color: targetGroup.color,
                  collapsed: targetGroup.collapsed,
                }
              : { title: edit.title!.trim(), color: 'blue' },
          );
      } else {
        await chrome.tabs.ungroup(ids as [number, ...number[]]);
      }
    }
    const snapshot = await list();
    const actual = ordered(snapshot, destination).filter((t) => ids.includes(t.id));
    if (actual.length !== ids.length || actual.some((t, i) => t.id !== ids[i] || t.pinned))
      throw new Error('Chrome did not retain the requested tab order.');
    const grouping = edit.kind === 'group' || targetGroup || sourceGroup;
    if (
      grouping
        ? actual[0]!.groupId < 0 || actual.some((t) => t.groupId !== actual[0]!.groupId)
        : actual.some((t) => t.groupId >= 0)
    )
      throw new Error('Chrome did not retain the requested grouping.');
    let undoToken: string | undefined;
    // Chrome closes an emptied source window. Do not promise to recreate its
    // identity or browsing UI with Undo; normal reversible edits get a token.
    if (
      affected
        .filter((id) => before.windows.some((w) => w.id === id))
        .every((id) => snapshot.windows.some((w) => w.id === id))
    ) {
      undoToken = crypto.randomUUID();
      if (undos.size >= 20) undos.delete(undos.keys().next().value!);
      undos.set(undoToken, {
        before,
        after: tabLayoutRevision(snapshot, affected),
        windows: affected,
      });
    }
    return {
      snapshot,
      undoToken,
      message: `${ids.length} tab${ids.length === 1 ? '' : 's'} ${edit.kind === 'group' ? 'grouped' : 'moved'}.`,
    };
  } catch (error) {
    throw new Error(
      `${(error as Error).message} Some changes may have completed. Refresh before trying another edit.`,
      { cause: error },
    );
  }
}

export async function undoTabEdit(token: string, list: List): Promise<TabEditResult> {
  const saved = undos.get(token);
  undos.delete(token);
  const current = await list();
  if (!saved || tabLayoutRevision(current, saved.windows) !== saved.after)
    throw new Error('Undo is unavailable because the affected tabs changed.');
  const originalTabs = saved.before.tabs.filter((t) => saved.windows.includes(t.windowId));
  const desired = new Map(originalTabs.map((t) => [t.id, t]));
  const groupIds = new Map<number, number>();
  try {
    // Detach only memberships changed by the edit. Unrelated groups retain
    // their Chrome identity, including saved/shared group associations.
    const detach = current.tabs
      .filter(
        (t) => desired.has(t.id) && t.groupId >= 0 && t.groupId !== desired.get(t.id)!.groupId,
      )
      .map((t) => t.id);
    if (detach.length) await chrome.tabs.ungroup(detach as [number, ...number[]]);
    const originalGroups = saved.before.groups.filter((g) => saved.windows.includes(g.windowId));
    for (const group of originalGroups) {
      const live = (await chrome.tabGroups.query({})).find((g) => g.id === group.id);
      if (live && live.windowId !== group.windowId)
        await chrome.tabGroups.move(group.id, { windowId: group.windowId, index: -1 });
    }
    for (const tab of originalTabs.filter((t) => !t.pinned)) {
      if ((await chrome.tabs.get(tab.id)).windowId !== tab.windowId)
        await chrome.tabs.move(tab.id, { windowId: tab.windowId, index: -1 });
    }
    for (const group of originalGroups) {
      const ids = ordered(saved.before, group.windowId)
        .filter((t) => t.groupId === group.id)
        .map((t) => t.id);
      const live = (await chrome.tabGroups.query({ windowId: group.windowId })).find(
        (g) => g.id === group.id,
      );
      const members = live
        ? (await chrome.tabs.query({ groupId: live.id }))
            .sort((a, b) => a.index - b.index)
            .map((t) => t.id!)
        : [];
      const groupId =
        members.join() === ids.join()
          ? live!.id
          : await chrome.tabs.group({
              tabIds: ids as [number, ...number[]],
              ...(live ? { groupId: live.id } : { createProperties: { windowId: group.windowId } }),
            });
      groupIds.set(group.id, groupId);
      await chrome.tabGroups.update(groupId, {
        title: group.title || '',
        color: group.color,
        collapsed: group.collapsed,
      });
    }
    for (const windowId of saved.windows) {
      const restoredGroups = new Set<number>();
      for (const tab of ordered(saved.before, windowId)) {
        if (tab.pinned) continue;
        if (tab.groupId >= 0) {
          if (restoredGroups.has(tab.groupId)) continue;
          restoredGroups.add(tab.groupId);
          await chrome.tabGroups.move(groupIds.get(tab.groupId)!, { windowId, index: tab.index });
        } else if ((await chrome.tabs.get(tab.id)).index !== tab.index)
          await chrome.tabs.move(tab.id, { windowId, index: tab.index });
      }
    }
    const snapshot = await list();
    for (const windowId of saved.windows) {
      const original = ordered(saved.before, windowId);
      const actual = ordered(snapshot, windowId);
      if (
        original.map((t) => t.id).join() !== actual.map((t) => t.id).join() ||
        actual.some(
          (t, i) =>
            t.groupId !== (original[i]!.groupId < 0 ? -1 : groupIds.get(original[i]!.groupId)),
        )
      )
        throw new Error('Chrome did not restore the original tab order.');
    }
    return { snapshot, message: 'Previous arrangement restored.' };
  } catch (error) {
    throw new Error(
      `${(error as Error).message} Undo may be incomplete. Refresh to inspect the tabs.`,
      { cause: error },
    );
  }
}
