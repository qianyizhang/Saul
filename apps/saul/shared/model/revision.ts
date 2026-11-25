export async function revisionOf(stored: unknown): Promise<string> {
  // Hash the raw record, including unknown fields, without exposing credentials
  // in a revision or rewriting legacy records merely because they were read.
  // Chrome may reorder object keys on storage round trips; array order matters.
  const serialized = JSON.stringify(stored, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  );
  const bytes = new TextEncoder().encode(serialized ?? 'absent');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
