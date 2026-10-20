import type { TabSnapshot } from './protocol.mjs';
export interface NativeWindowName {
  windowId: number;
  title: string;
  expectedTitle?: string;
}
export type NativeNames =
  | { status: 'available'; windows: NativeWindowName[] }
  | { status: 'unavailable' | 'unsupported'; message?: string };
export interface WindowNames {
  read(snapshot: TabSnapshot): Promise<NativeNames>;
  apply(snapshot: TabSnapshot, windows: NativeWindowName[], dryRun?: boolean): Promise<void>;
}
export function createWindowNames(options?: {
  browserPid?: number;
  platform?: string;
  execFile?: (file: string, args: string[], options: object) => Promise<{ stdout: string }>;
}): WindowNames;
export function withWindowNames(
  call: (name: string, args?: Record<string, unknown>) => Promise<unknown>,
  names: WindowNames,
): (name: string, args?: Record<string, unknown>) => Promise<unknown>;
