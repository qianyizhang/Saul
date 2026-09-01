import React, { useEffect, useRef, useState } from 'react';
import { computePosition, offset, flip, shift } from '@floating-ui/dom';
import { Sparkles } from 'lucide-react';

interface FloatingTriggerProps {
  range: Range;
  onTrigger: () => void;
  onDismiss: () => void;
}

export const FloatingTrigger: React.FC<FloatingTriggerProps> = ({
  range,
  onTrigger,
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!triggerRef.current) return;

    const virtualElement = {
      getBoundingClientRect: () => range.getBoundingClientRect(),
    };

    computePosition(virtualElement as any, triggerRef.current, {
      placement: 'bottom-end',
      middleware: [
        offset(6),
        flip({ fallbackPlacements: ['top-end', 'bottom-start', 'top-start'] }),
        shift({ padding: 12 }),
      ],
    }).then(({ x, y }) => {
      setPos({ x, y });
      setVisible(true);
    });
  }, [range]);

  return (
    <button
      ref={triggerRef}
      onClick={(e) => {
        e.stopPropagation();
        onTrigger();
      }}
      style={{
        position: 'fixed',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        opacity: visible ? 1 : 0,
        zIndex: 2147483646,
      }}
      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-medium rounded-full shadow-lg border border-indigo-500/30 transition-all duration-150 cursor-pointer select-none"
    >
      <Sparkles className="w-3.5 h-3.5" />
      <span>Explain</span>
    </button>
  );
};
