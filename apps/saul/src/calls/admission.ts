import { revisionOf } from '../../shared/model/revision.ts';
import {
  executionModel,
  originalSummaryPlan,
  type FrozenModel,
} from '../../shared/model/execution-route.ts';
import { MISSING_CALL_BATCH } from '../../shared/model/call-batch.ts';
import type {
  CallControl,
  CallLaunch,
  CallLaunchResult,
  CallLookup,
  DigestBatch,
  DigestRequest,
  DigestResolution,
} from '../../shared/model/call-batch.ts';
import { validatePlanResult } from '../../shared/protocol/credential-plan.mts';
import {
  catalogIssue,
  validConnectionCatalog,
} from '../../shared/protocol/connections-contract.mts';
import { configurationFor, type Configuration } from '../configuration/definition';
import { prepareFrozenPreset, prepareWritePreset, preparePreset } from '../configuration/resolve';
import { nativeCredentialCall } from '../native/credentials';
import type { SettingsState } from '../settings/contract';
import { readCallSources } from './capture/capture';
import type { CallEditorStorage } from './contract';
import { SUMMARY_PROMPT } from './execution/summary';

type Start = Extract<DigestRequest, { action: 'start' }>;
type Lookup = Extract<DigestRequest, { action: 'resolve' }>;
export type AdmittedCall =
  | { message: Start; snapshot: DigestBatch; credential: string }
  | { message: Lookup; snapshot: CallLookup; credential?: never }
  | { message: CallControl; snapshot?: never; credential?: string };

export async function retryCallCredential(
  batch: DigestBatch,
  settings: () => Promise<Configuration>,
) {
  const input = batch.action ? batch.action.input : batch.summaryInput;
  if (input) return prepareFrozenPreset(await settings(), input).credential;
  if (batch.action) throw new Error('The saved Call has no model preset.');
  // Original Summarize batches predate Write presets. Only their recorded route may run.
  const route = originalSummaryPlan(batch);
  const saved = await settings();
  if (saved.sharedCredentials !== 'saul')
    throw new Error('Connect this app in Settings → Preferences → Integrations.');
  if (route.binding.kind === 'connection') {
    const key = route.binding.key;
    const connection = saved.connections.find((c) => c.key === key);
    if (connection?.kind !== 'chatgpt-plan' || connection.accountId !== route.plan.accountId)
      throw new Error('The original summary connection changed. Choose a preset and run again.');
  }
}

async function checkCallModel(input: FrozenModel) {
  const route = executionModel(input);
  if (route.provider === 'chatgpt-plan') {
    const accounts = await nativeCredentialCall({ action: 'accounts' });
    validatePlanResult({ action: 'accounts' }, accounts);
    if (
      !accounts.accounts.some((a) => a.id === route.plan.accountId && a.signedIn && a.planEnabled)
    )
      throw new Error('The saved account is unavailable for plan use.');
    const request = { action: 'models' as const, accountId: route.plan.accountId };
    const reply = await nativeCredentialCall(request);
    validatePlanResult(request, reply);
    const model = reply.models.find((m) => m.slug === route.plan.model);
    if (
      !model ||
      (route.plan.effort &&
        !model.supportedReasoningEfforts.some((e) => e.effort === route.plan.effort)) ||
      (route.plan.fast && !model.fastTier)
    )
      throw new Error('The saved model or its options are unavailable on this account.');
  } else if (route.owner === 'saul' && route.binding.kind === 'connection') {
    const result = await nativeCredentialCall({
      action: 'connection-catalog',
      connectionKey: route.binding.key,
      intent: 'display',
    });
    if (!validConnectionCatalog(result.catalog))
      throw new Error('The model catalog could not be read.');
    const issue = catalogIssue(result.catalog, route.model);
    if (issue) throw new Error(issue);
    if (
      !result.catalog.models.some((m) => m.id === route.model && m.capabilities.includes('write'))
    )
      throw new Error('The saved model cannot run a Write Call.');
  }
}

export function createCallAdmission({
  readSettings,
  readChoices,
  saveChoices,
  readBatch,
  lookup,
  start,
  readSources = readCallSources,
  checkModel = checkCallModel,
}: Pick<CallEditorStorage, 'readChoices' | 'saveChoices'> & {
  readSettings: () => Promise<SettingsState>;
  readBatch: (id: string) => Promise<DigestBatch>;
  lookup: (id: string, snapshot: CallLookup) => Promise<DigestResolution>;
  start: (batch: DigestBatch, credential: string, runAgain: boolean) => Promise<DigestBatch>;
  readSources?: typeof readCallSources;
  checkModel?: typeof checkCallModel;
}) {
  async function inspect(request: CallLaunch) {
    const [sources, saved, settings] = await Promise.all([
      readSources(request.tabIds),
      readChoices(),
      readSettings().catch((cause: unknown) => ({
        state: 'conflict' as const,
        error: cause instanceof Error ? cause.message : 'Settings unavailable.',
      })),
    ]);
    if (saved.state !== 'ready') throw new Error(saved.error);
    const choices = saved.choices;
    const sourceIds = sources.items.map((item) => [item.tabId, item.url]);
    const selected = choices.selected;
    const presetId = selected?.presetId ?? choices.builtinPresetId;
    const source =
      sources.items.length === 1
        ? { title: sources.items[0]!.title, url: sources.items[0]!.url }
        : { title: sources.windowTitle, url: '' };
    const token = {
      sourceIds,
      attempt: request.id,
      previousBatch: request.previousBatchId,
      revision: settings.state === 'ready' ? settings.revision : undefined,
      custom: selected?.revision.revision,
      presetId,
    };
    return {
      sources,
      source,
      saved,
      settings,
      selected,
      presetId,
      token,
      stamp: await revisionOf(token),
    };
  }
  type Inspection = Awaited<ReturnType<typeof inspect>>;
  function prompt(
    view: Inspection,
    reason: 'choose' | 'repair' | 'changed',
    message: string,
  ): CallLaunchResult {
    const presets =
      view.settings.state === 'ready' ? configurationFor(view.settings.settings).presets : [];
    const preset = presets.find((p) => p.id === view.presetId);
    const connection =
      view.settings.state === 'ready'
        ? view.settings.settings.connections.find((c) => c.key === preset?.connectionKey)
        : undefined;
    return {
      kind: 'setup',
      reason,
      message,
      source: view.source,
      stamp: view.stamp,
      presetId: view.presetId,
      presetName: preset?.name,
      ...(reason === 'changed' && {
        reviewSources: view.sources.items.map(({ title, url }) => ({ title, url })),
        routeLabel: [
          view.selected?.revision.name ?? 'Summarize',
          preset?.name,
          connection?.name,
          preset?.model,
        ]
          .filter(Boolean)
          .join(' · '),
      }),
      presets: view.selected
        ? []
        : presets
            .filter((p) => {
              if (view.settings.state !== 'ready') return false;
              try {
                prepareWritePreset(view.settings.settings, p.id);
                return true;
              } catch {
                return false;
              }
            })
            .map(({ id, name }) => ({ id, name })),
    };
  }
  const changed = (view: Inspection) =>
    prompt(
      view,
      'changed',
      'The source or Call settings changed. Review the current selection before starting.',
    );

  return async function launch(request: CallLaunch): Promise<CallLaunchResult> {
    // The reader can reload after the runner accepted a batch but before the URL was updated.
    try {
      const existing = await readBatch(request.id);
      return { kind: 'reused', batch: existing, comparisons: [] };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== MISSING_CALL_BATCH) throw error;
    }
    const view = await inspect(request);
    if (request.previousBatchId) {
      const previous = await readBatch(request.previousBatchId);
      if (
        previous.items.length !== view.sources.items.length ||
        previous.items.some((item, i) => item.url !== view.sources.items[i]!.url)
      )
        throw new Error('A source tab changed or closed. Use Call Saul on the page you want.');
    }
    if (request.review && request.review.stamp !== view.stamp) return changed(view);
    if (!request.previousBatchId) {
      // Route comparison uses saved public choices only. A broken current preset never blocks reuse.
      let currentModel: FrozenModel | null = null;
      if (view.settings.state === 'ready' && view.presetId) {
        const preset = configurationFor(view.settings.settings).presets.find(
          (p) => p.id === view.presetId,
        );
        if (preset) {
          try {
            currentModel = preparePreset(view.settings.settings, preset, 'write', true).choices;
          } catch {
            /* An unresolved current route is reported in the comparison. */
          }
        }
      }
      const resolved = await lookup(request.id, {
        items: view.sources.items,
        action: view.selected,
        currentModel,
        pdfProcessing:
          view.settings.state === 'ready' ? view.settings.settings.summaryPdfProcessing : undefined,
      });
      if (resolved.batch)
        return { kind: 'reused', batch: resolved.batch, comparisons: resolved.comparisons };
    }
    if (view.settings.state !== 'ready') throw new Error(view.settings.error);
    const picked = request.review?.presetId;
    if (picked && view.selected) return changed(view);
    const id = picked ?? view.presetId;
    if (!id) return prompt(view, 'choose', 'Save a default preset for this and future summaries.');
    let prepared;
    try {
      prepared = prepareWritePreset(view.settings.settings, id);
      await checkModel(prepared.choices);
    } catch (error) {
      return prompt(
        { ...view, presetId: id },
        'repair',
        error instanceof Error ? error.message : 'The saved model preset is unavailable.',
      );
    }
    // A catalog check or live page comparison may yield to navigation or a settings edit.
    // Review the new inputs before saving a default or handing a frozen batch to the runner.
    let latest = await inspect(request);
    if (latest.stamp !== view.stamp) return changed(latest);
    if (picked && picked !== view.presetId) {
      await saveChoices(latest.saved.source, { ...latest.saved.choices, builtinPresetId: picked });
      latest = await inspect(request);
      if (latest.stamp !== (await revisionOf({ ...view.token, presetId: picked })))
        return changed(latest);
    }
    const input = prepared.choices;
    const batch: DigestBatch = {
      ...latest.sources,
      id: request.id,
      createdAt: Date.now(),
      pdfProcessing: view.settings.settings.summaryPdfProcessing ?? 'attachment',
      ...(view.selected
        ? { action: { ...view.selected, input } }
        : { prompt: SUMMARY_PROMPT, summaryInput: input }),
    };
    const accepted = await start(batch, prepared.credential, !!request.previousBatchId);
    return {
      kind: accepted.id === batch.id ? 'started' : 'reused',
      batch: accepted,
      comparisons: [],
    };
  };
}
