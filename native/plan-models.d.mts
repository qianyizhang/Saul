import type { PlanModel } from './plan-protocol.mjs';

export interface PlanModelSettings {
  model: string;
  effort?: string;
  fast?: boolean;
}
export function planModels(catalog: unknown): PlanModel[];
export function planModelIssue(
  settings: PlanModelSettings,
  models: PlanModel[],
): string | undefined;
export function planModelDefaults(model: PlanModel): { effort: string; fast: boolean };
