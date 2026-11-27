import { z } from 'zod';

export const accessLevel = z.enum(['off', 'read', 'write']);
export type AccessLevel = z.infer<typeof accessLevel>;
export const localToolAccess = z.object({
  tabs: z.enum(['read', 'write']),
  history: z.enum(['off', 'read']).optional(),
  pages: accessLevel,
  annotations: accessLevel,
});
export type LocalToolAccess = z.infer<typeof localToolAccess>;

export const localAccessSettingsPath =
  'Saul → Settings → Preferences → Integrations → Local tool access';
export const organizePermission = `Enable Organize tabs and windows in ${localAccessSettingsPath}.`;
export const summaryPermission = `Set Pages to Write in ${localAccessSettingsPath} to start a Summary from the Tab board.`;
