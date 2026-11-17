export interface CallSnapshot {
  raw: string;
  progress?: string;
  calls?: { instructions: string; input: string; output: string; complete: boolean }[];
}
