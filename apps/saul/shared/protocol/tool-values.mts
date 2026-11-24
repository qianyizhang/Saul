import { localToolAccess } from './local-access.mts';
import { z } from 'zod';
import { integer } from './tool-schema.mts';

export const groupColor = z.enum([
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
]);
export const groupMetadata = z.object({
  title: z.string().max(200).optional(),
  color: groupColor.optional(),
  collapsed: z.boolean().optional(),
});
export const tabView = z.object({
  id: integer,
  windowId: integer,
  index: integer,
  title: z.string(),
  url: z.string(),
  active: z.boolean(),
  pinned: z.boolean(),
  groupId: integer,
  audible: z.boolean(),
  discarded: z.boolean(),
});
export const groupView = z.object({
  id: integer,
  windowId: integer,
  title: z.string().optional(),
  color: groupColor,
  collapsed: z.boolean(),
});
export const tabSnapshot = z.object({
  localAccess: localToolAccess.optional(),
  windows: z.array(z.object({ id: integer, focused: z.boolean(), title: z.string().optional() })),
  tabs: z.array(tabView),
  groups: z.array(groupView),
  nativeNames: z
    .object({
      status: z.enum(['available', 'unavailable', 'unsupported']),
      message: z.string().optional(),
    })
    .optional(),
});
export const pageSnapshot = z.object({
  url: z.string(),
  title: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  snapshotId: z.string(),
  documentId: z.string(),
  elements: z.array(
    z.object({
      elementId: integer,
      tag: z.string(),
      label: z.string(),
      type: z.string(),
      href: z.string().optional(),
    }),
  ),
  elementsTruncated: z.boolean(),
});
export const browserSession = z.object({
  session: z.string(),
  extensionId: z.string(),
  pid: integer,
  connectedAt: z.string(),
  browserPid: integer.optional(),
});
export const tabEditResult = z.object({
  snapshot: tabSnapshot,
  undoToken: z.string().optional(),
  message: z.string(),
});
export const summaryProgress = z.object({ id: z.string(), completed: integer, total: integer });
export const tabResult = z.object({ dryRun: z.boolean(), tabIds: z.array(integer) });
export const windowTabResult = tabResult.extend({ windowId: integer });

export type GroupColor = z.infer<typeof groupColor>;
export type GroupMetadata = z.infer<typeof groupMetadata>;
export type TabView = z.infer<typeof tabView>;
export type GroupView = z.infer<typeof groupView>;
export type TabSnapshot = z.infer<typeof tabSnapshot>;
export type PageSnapshot = z.infer<typeof pageSnapshot>;
export type TabEditResult = z.infer<typeof tabEditResult>;
export type SummaryProgress = z.infer<typeof summaryProgress>;

export function isSnapshot(value: unknown): value is z.infer<typeof tabSnapshot> {
  return tabSnapshot.safeParse(value).success;
}
export function isSession(value: unknown): value is z.infer<typeof browserSession> {
  return browserSession.safeParse(value).success;
}
