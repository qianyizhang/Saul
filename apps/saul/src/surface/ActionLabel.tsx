/** Short visible wording; the surrounding control retains its complete accessible name. */
export function ActionLabel({ short, full }: { short: string; full: string }) {
  return (
    <>
      <span className="minimum-only" aria-hidden="true">
        {short}
      </span>
      <span className="standard-only" aria-hidden="true">
        {full}
      </span>
    </>
  );
}
