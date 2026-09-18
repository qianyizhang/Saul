import { useEffect, useState, type RefObject } from 'react';
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom';
export function useAnchoredPosition(
  anchor: Range | HTMLElement | null,
  ref: RefObject<HTMLElement | null>,
  placement: Placement = 'bottom-start',
) {
  const [position, setPosition] = useState({ x: 0, y: 0, ready: false });
  useEffect(() => {
    if (!anchor || !ref.current) return;
    let active = true;
    const element =
      anchor instanceof Range
        ? {
            getBoundingClientRect: () => anchor.getBoundingClientRect(),
            getClientRects: () => anchor.getClientRects(),
            contextElement:
              anchor.commonAncestorContainer instanceof Element
                ? anchor.commonAncestorContainer
                : anchor.commonAncestorContainer.parentElement || undefined,
          }
        : anchor;
    const update = () => {
      if (ref.current)
        void computePosition(element, ref.current, {
          strategy: 'fixed',
          placement,
          middleware: [offset(8), flip(), shift({ padding: 12, crossAxis: true })],
        }).then(({ x, y }) => {
          if (active) setPosition({ x, y, ready: true });
        });
    };
    const cleanup = autoUpdate(element, ref.current, update);
    return () => {
      active = false;
      cleanup();
    };
  }, [anchor, ref, placement]);
  return {
    position: 'fixed' as const,
    left: position.x,
    top: position.y,
    visibility: position.ready ? ('visible' as const) : ('hidden' as const),
    zIndex: 2147483647,
  };
}
