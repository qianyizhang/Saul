import { ControlIcon } from './ControlIcon';
import type { ControlSymbol } from '../design/control-symbols';

/** Short visible wording; the surrounding control retains its complete accessible name. */
export function ActionLabel({
  short,
  full,
  symbol,
}: {
  short: string;
  full: string;
  symbol?: ControlSymbol;
}) {
  return (
    <>
      <span className="minimum-only" aria-hidden="true">
        {symbol ? <ControlIcon symbol={symbol} /> : short}
      </span>
      <span className="standard-only" aria-hidden="true">
        {full}
      </span>
    </>
  );
}
