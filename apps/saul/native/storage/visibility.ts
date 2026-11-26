export type HistoryVisibility = 'visible' | 'masked' | 'all';

export function maskFilter(column: string, visibility: HistoryVisibility): string {
  switch (visibility) {
    case 'all':
      return '1';
    case 'masked':
      return `${column} IS NOT NULL`;
    case 'visible':
      return `${column} IS NULL`;
  }
}

export function recordMask(collection: string, id: string, owner = "''"): string {
  return `(SELECT masked_at FROM history_record WHERE collection='${collection}' AND id=${id} AND owner=${owner})`;
}

export function entryMask(collection: string, recordId: string, id: string, owner = "''"): string {
  return `(SELECT masked_at FROM history_entry WHERE collection='${collection}' AND record_id=${recordId} AND id=${id} AND owner=${owner})`;
}

export const browserMask = (id: string) => recordMask('library-browser', id);
export const runMask = entryMask('library-browser', 'llm_run.selection_id', 'llm_run.id');
