import React, { useRef } from 'react';
import { useAnchoredPosition } from './useAnchoredPosition';
import { Sparkles } from 'lucide-react';

interface FloatingTriggerProps {
  range: Range;
  onTrigger: () => void;
  onDismiss: () => void;
}

export const FloatingTrigger: React.FC<FloatingTriggerProps> = ({ range, onTrigger }) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const style = useAnchoredPosition(range, triggerRef, 'bottom-end');

  return (
    <button
      ref={triggerRef}
      onClick={(e) => {
        e.stopPropagation();
        onTrigger();
      }}
      style={style}
      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-medium rounded-full shadow-lg border border-indigo-500/30 transition-all duration-150 cursor-pointer select-none"
    >
      <Sparkles className="w-3.5 h-3.5" />
      <span>Explain</span>
    </button>
  );
};
