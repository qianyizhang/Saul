import type { Finding } from '@google/design.md/linter';

export interface DesignOutput {
  type: 'css' | 'swift' | 'typescript';
  path: string;
}
export interface CompiledDesign {
  css: string;
  typescript: string;
  swift: string | undefined;
  hash: string;
  findings: Finding[];
}
export function compileDesign(source: string, options?: { native?: boolean }): CompiledDesign;
export function generate(options: {
  source: string;
  outputs: DesignOutput[];
  check?: boolean;
}): Promise<CompiledDesign>;
