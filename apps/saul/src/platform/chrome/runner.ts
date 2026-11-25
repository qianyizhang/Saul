import type { AdmittedCall } from '../../calls/admission';
import type { CallEditRequest } from '../../calls/contract';
import type { PreparedModel } from '../../configuration/resolve';
import type { DbRequest, Submission } from '../../../shared/protocol/history-types.ts';
import { ensureOffscreenDocument } from './offscreen';
import { request } from './messages';

export type RunnerRequest =
  | {
      operation: 'annotation';
      message: import('../../annotations/runner').AnnotationRunRequest;
      prepared?: PreparedModel;
    }
  | {
      operation: 'action';
      message: CallEditRequest;
    }
  | ({ operation: 'digest' } & AdmittedCall)
  | { operation: 'db'; message: DbRequest }
  | { operation: 'submit'; submission: Submission; credential: string }
  | { operation: 'stop'; selectionId: string }
  | ({ operation: 'delete' } & Partial<DbRequest<'DB_DELETE_SELECTION'>['payload']>);
export async function runnerRequest<T>(message: RunnerRequest): Promise<T> {
  await ensureOffscreenDocument();
  return request<T>({ target: 'saul-offscreen', ...message });
}
