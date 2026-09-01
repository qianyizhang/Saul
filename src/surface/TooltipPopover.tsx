import React, { useEffect, useRef, useState } from 'react';
import { computePosition, flip, shift, offset, arrow } from '@floating-ui/dom';
import { Sparkles } from 'lucide-react';

interface TooltipPopoverProps {
  anchorEl: HTMLElement | null;
  term: string;
  note: string;
  onClose?: () => void;
}

export const TooltipPopover: React.FC<TooltipPopoverProps> = ({
  anchorEl,
  term,
  note,
}) => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [arrowPos, setArrowPos] = useState<{ x?: number; y?: number }>({});
  const [placement, setPlacement] = useState<string>('top');

  useEffect(() => {
    if (!anchorEl || !tooltipRef.current) return;

    const updatePosition = () => {
      if (!anchorEl || !tooltipRef.current) return;

      computePosition(anchorEl, tooltipRef.current, {
        placement: 'top',
        middleware: [
          offset(8),
          flip({ fallbackPlacements: ['bottom', 'top-start', 'bottom-start'] }),
          shift({ padding: 12 }),
          arrowRef.current ? arrow({ element: arrowRef.current }) : undefined,
        ].filter(Boolean) as any,
      }).then(({ x, y, placement: finalPlacement, middlewareData }) => {
        setPosition({ x, y });
        setPlacement(finalPlacement);

        if (middlewareData.arrow && arrowRef.current) {
          const { x: ax, y: ay } = middlewareData.arrow;
          setArrowPos({ x: ax, y: ay });
        }
      });
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [anchorEl, note, term]);

  if (!anchorEl || !note) return null;

  return (
    <div
      ref={tooltipRef}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 2147483647,
      }}
      className="max-w-xs rounded-lg border border-indigo-100 bg-white/95 p-3 shadow-xl backdrop-blur-md transition-opacity duration-150 animate-in fade-in zoom-in-95 text-slate-800 text-xs leading-relaxed"
    >
      <div className="flex items-center gap-1.5 font-semibold text-indigo-600 mb-1">
        <Sparkles className="w-3.5 h-3.5" />
        <span>{term}</span>
      </div>
      <p className="text-slate-600 font-normal">{note}</p>

      {/* Arrow element */}
      <div
        ref={arrowRef}
        style={{
          position: 'absolute',
          left: arrowPos.x != null ? `${arrowPos.x}px` : '',
          top: arrowPos.y != null ? `${arrowPos.y}px` : '',
          [placement.startsWith('top') ? 'bottom' : 'top']: '-4px',
        }}
        className="h-2 w-2 rotate-45 border-r border-b border-indigo-100 bg-white"
      />
    </div>
  );
};
