import type { AnnotationSummary } from '../../shared/protocol/annotations.ts';

export function annotationLabels(records: AnnotationSummary[]) {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const { number } of records) {
    if (seen.has(number)) duplicates.add(number);
    seen.add(number);
  }
  return new Map(
    records.map(({ id, number, url }) => [
      id,
      duplicates.has(number) ? number + ' · ' + (new URL(url).hash || 'Page top') : String(number),
    ]),
  );
}
