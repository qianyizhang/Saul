export const PLAN_HOST: string;
export const PLAN_PORT: string;
export interface PlanAccount {
  id: string;
  label: string;
  signedIn: boolean;
  planEnabled: boolean;
}
export interface PlanModel {
  slug: string;
  display_name: string;
  supportedReasoningEfforts: { effort: string; description: string }[];
  defaultReasoningEffort: string;
  fastTier?: string;
  isDefault: boolean;
}
export type PlanRequest =
  | { action: 'accounts' }
  | { action: 'login'; accountId?: string; consent?: boolean }
  | { action: 'logout'; accountId: string }
  | { action: 'models'; accountId: string }
  | { action: 'speech'; accountId: string; input: string; voice: string }
  | {
      action: 'generate';
      accountId: string;
      model: string;
      effort?: string;
      fast?: boolean;
      systemPrompt: string;
      userPrompt: string;
    };
export type PlanControlRequest = Exclude<PlanRequest, { action: 'generate' }>;
export interface PlanResults {
  accounts: { accounts: PlanAccount[] };
  login: { account: PlanAccount };
  logout: { account: PlanAccount; warning?: string };
  models: { models: PlanModel[] };
  speech: { audioBase64: string; mimeType: 'audio/mpeg' };
}
export type PlanResult<T extends PlanControlRequest = PlanControlRequest> = {
  type: 'result';
} & PlanResults[T['action']];
export type PlanEvent =
  | { type: 'activity'; phase: 'waiting' | 'thinking' }
  | { type: 'delta'; text: string }
  | { type: 'complete' }
  | PlanResult
  | { type: 'authorize'; url: string }
  | { type: 'error'; message: string; reason?: string };
export function validatePlanRequest(v: unknown): asserts v is PlanRequest;
export function validatePlanResult<T extends PlanControlRequest>(
  request: T,
  value: unknown,
): asserts value is PlanResult<T>;
