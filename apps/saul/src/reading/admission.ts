import { configurationFor, type Configuration } from '../configuration/definition';
import type { ReadingRequest } from './contract';
import type { DbCall, Passage, Submission } from '../../shared/protocol/history-types.ts';
import { compareRunInput } from './input-change';
import { prepareFollowUpRun, prepareFrozenRun, prepareRecipeRun } from './configuration';

export type ReadingAdmission =
  | { kind: 'reused'; passageId: string }
  | { kind: 'ready'; submission: Submission; credential: string };

const defaultRecipe = (settings: Configuration) => configurationFor(settings).selectedRecipeId;

/** Admit one user intent against a single configuration and saved-input snapshot. */
export function createReadingAdmission(readSettings: () => Promise<Configuration>, db: DbCall) {
  const readInput = (selectionId: string, runId?: string) =>
    db({ type: 'DB_INPUT', payload: { selectionId, runId } });

  return {
    async submit(request: ReadingRequest<'submit'>, url: string): Promise<ReadingAdmission> {
      if (request.snapshot.page.url !== url)
        throw new Error('The page changed. Select the passage again.');
      const snapshot = { ...request.snapshot, page: { ...request.snapshot.page, url } };
      const context = {
        ...request.context,
        selection: snapshot.text,
        pageUrl: request.context.pageUrl ? url : '',
      };
      const { submissionId, outputFormat } = request;
      const regenerate = request.regenerate === true;
      let settings: Configuration | undefined;
      let recipeId = request.recipeId;
      if (!regenerate) {
        if (!recipeId) {
          settings = await readSettings();
          recipeId = defaultRecipe(settings);
        }
        // Reopening a known saved attempt does not need a usable current provider.
        const passageId = await db({
          type: 'DB_READING_RESOLVE',
          payload: { snapshot, submissionId, recipeId },
        });
        if (passageId) return { kind: 'reused', passageId };
      }
      settings ??= await readSettings();
      const prepared =
        regenerate && !recipeId
          ? await retry(snapshot.id, undefined, settings)
          : prepareRecipeRun(settings, context, recipeId || defaultRecipe(settings));
      if (outputFormat !== undefined) {
        if (prepared.input.preset?.capability !== 'draw')
          throw new Error('Output format requires a Draw action.');
        prepared.input.preset.imageOptions = {
          size: '1024x1024',
          quality: 'low',
          ...prepared.input.preset.imageOptions,
          outputFormat,
        };
      }
      return {
        kind: 'ready',
        submission: { snapshot, input: prepared.input, submissionId, regenerate },
        credential: prepared.credential,
      };
    },
    async regenerate(
      request: ReadingRequest<'regenerate'>,
      passage: Passage,
    ): Promise<ReadingAdmission> {
      const { instruction, recipeId, selectionId, submissionId } = request;
      const { snapshot } = passage;
      const prepare = async () => {
        if (instruction !== undefined) {
          if (['queued', 'running', 'saving'].includes(passage.latest.status))
            throw new Error('Wait for this explanation to finish before asking a follow-up.');
          const answer = passage.completed;
          if (!answer || (request.runId && request.runId !== answer.id))
            throw new Error('The answer changed. Review it before asking a follow-up.');
          const original = await readInput(selectionId, answer.id);
          if (!original)
            throw new Error('This older answer has no saved context. Start a new explanation.');
          return prepareFollowUpRun(
            await readSettings(),
            original,
            answer.responseRaw,
            instruction,
          );
        }
        if (!recipeId) return retry(selectionId, passage.latest.id);
        const context = await db({ type: 'DB_CONTEXT', payload: { selectionId } });
        return prepareRecipeRun(await readSettings(), context, recipeId);
      };
      const { input, credential } = await prepare();
      return {
        kind: 'ready',
        submission: { snapshot, input, submissionId, regenerate: true },
        credential,
      };
    },
    async review(request: ReadingRequest<'review'>, passage: Passage) {
      const before = await readInput(
        request.selectionId,
        passage.completed?.id || passage.latest.id,
      );
      if (!before) return { fields: [], error: 'The original input was not recorded.' };
      try {
        const settings = await readSettings();
        const after = prepareRecipeRun(
          settings,
          request.context,
          request.recipeId || defaultRecipe(settings),
          true,
        ).input;
        return compareRunInput(before, after);
      } catch (error) {
        return { fields: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  async function retry(selectionId: string, runId?: string, settings?: Configuration) {
    const original = await readInput(selectionId, runId);
    if (!original)
      throw new Error(
        'This older explanation has no saved request. Select its text and choose a recipe to run again.',
      );
    return prepareFrozenRun(settings ?? (await readSettings()), original);
  }
}
