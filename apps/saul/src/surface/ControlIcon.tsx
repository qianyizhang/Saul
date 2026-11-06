import { controlSymbols, type ControlSymbol } from '../design/control-symbols';

/** Decorative glyph; its button owns the accessible name and tooltip. */
export function ControlIcon({ symbol }: { symbol: ControlSymbol }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: 'inline-flex', verticalAlign: 'middle' }}
      dangerouslySetInnerHTML={{ __html: controlSymbols[symbol].svg }}
    />
  );
}
