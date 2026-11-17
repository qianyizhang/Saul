export type SqlValue = string | number | bigint | null | Uint8Array;
export interface SqlDatabase {
  exec(sql: string): unknown;
  exec(options: { sql: string; bind?: SqlValue[] }): unknown;
  selectObjects(sql: string, bind?: SqlValue[]): Record<string, SqlValue>[];
  selectObject(sql: string, bind?: SqlValue[]): Record<string, SqlValue> | undefined;
  selectValue(sql: string, bind?: SqlValue[]): SqlValue | undefined;
  transaction<T>(operation: () => T): T;
  changes(): number;
}
