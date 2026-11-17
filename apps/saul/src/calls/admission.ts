import { prepareCallModel } from './configuration';
import type { CallEditorStorage } from './contract';
import type { Configuration } from '../configuration/definition';
import type { SettingsState } from '../contracts/settings';
import { snapshotSelection } from '../digest/capture';
import { validateSummaryConnection } from '../digest/connection';
import type { DigestBatch, DigestRequest } from '../digest/types';
import { prepareFrozenPreset } from '../configuration/resolve';
import { originalSummaryPlan } from '../providers/request';

type StartCall = Extract<DigestRequest, { action: 'start' }>;
type ResolveCall = Extract<DigestRequest, { action: 'resolve' }>;
type RetryCall = Extract<DigestRequest, { action: 'retry' }>;
export type AdmittedCall =
  | { message: StartCall; snapshot: DigestBatch; credential?: string }
  | { message: ResolveCall; snapshot: DigestBatch; credential?: never }
  | { message: RetryCall; snapshot?: never; credential?: string }
  | {
      message: Exclude<DigestRequest, StartCall | ResolveCall | RetryCall>;
      snapshot?: never;
      credential?: never;
    };

/** Reads today's choice only for exact-selection lookup and new work. Retry uses the saved route. */
export function createCallAdmission({
  readSettings,
  readChoices,
  readBatch,
  capture = snapshotSelection,
}: {
  readSettings: () => Promise<SettingsState>;
  readChoices: CallEditorStorage['readChoices'];
  readBatch: (id: string) => Promise<DigestBatch>;
  capture?: typeof snapshotSelection;
}) {
  async function settings(): Promise<Configuration> {
    const saved = await readSettings();
    if (saved.state !== 'ready') throw new Error(saved.error);
    return saved.settings;
  }

  return async function admit(request: DigestRequest): Promise<AdmittedCall> {
    if (request.action === 'retry') {
      const saved = await readBatch(request.id);
      const input = saved.action ? saved.action.input : saved.summaryInput;
      if (saved.action && !input) throw new Error('The saved action preset is unavailable.');
      if (!input) {
        const route = originalSummaryPlan(saved);
        const current = await settings();
        if (route.binding.kind === 'connection')
          validateSummaryConnection(current, route.plan.accountId, route.binding.key);
        else if (current.sharedCredentials !== 'saul')
          throw new Error('Connect this app in Settings → Preferences → Integrations.');
      }
      return {
        message: request,
        credential: input ? prepareFrozenPreset(await settings(), input).credential : undefined,
      };
    }
    if (request.action !== 'start' && request.action !== 'resolve') return { message: request };

    const savedChoices = await readChoices();
    if (savedChoices.state !== 'ready') throw new Error(savedChoices.error);
    const choice = savedChoices.choices.selected;
    if (request.action === 'resolve') {
      // Unreadable settings do not block saved results. If a preference cannot
      // be read, compare current input in the saved result's processing mode.
      const preference = await readSettings().catch(() => undefined);
      const ready = preference?.state === 'ready' ? preference.settings : undefined;
      const selection = await capture(request.id, request.tabIds, '', ready?.summaryPdfProcessing);
      const snapshot = { ...selection, pdfProcessing: ready ? selection.pdfProcessing : undefined };
      return {
        message: request,
        snapshot: choice
          ? { ...snapshot, action: structuredClone(choice), prompt: choice.revision.source }
          : snapshot,
      };
    }

    const saved = await settings();
    const selection = await capture(
      request.id,
      request.tabIds,
      request.accountId ?? '',
      saved.summaryPdfProcessing,
    );
    const snapshot = {
      ...selection,
      credentialOwner: saved.sharedCredentials === 'saul' ? ('saul' as const) : ('local' as const),
    };
    if (choice) {
      const { choices: input, credential } = prepareCallModel(saved, choice.presetId);
      return {
        message: request,
        snapshot: {
          ...snapshot,
          action: { ...structuredClone(choice), input },
          prompt: choice.revision.source,
        },
        credential,
      };
    }
    if (saved.summaryPresetId) {
      const { choices: input, credential } = prepareCallModel(saved, saved.summaryPresetId);
      return {
        message: request,
        snapshot: {
          ...snapshot,
          summaryInput: input,
          accountId: input.plan?.accountId ?? '',
          connectionKey: input.preset?.connectionKey,
          model: input.plan?.model ?? input.remote.model,
          effort: input.plan?.effort,
        },
        credential,
      };
    }
    if (!request.accountId)
      throw new Error('Choose a model preset in Settings → Calls and reopen Call Saul.');
    validateSummaryConnection(saved, request.accountId, request.connectionKey);
    return {
      message: request,
      snapshot: { ...snapshot, connectionKey: request.connectionKey },
    };
  };
}
