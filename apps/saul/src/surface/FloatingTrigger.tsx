import { annotateRange } from '../annotations/capture';
import type { ReadingOperations } from '../contracts/reading';
import React, { useRef } from 'react';
import { useAnchoredPosition } from './useAnchoredPosition';
import { Sparkles } from 'lucide-react';

interface FloatingTriggerProps {
  range: Range;
  onTrigger: () => void;
  recipes: ReadingOperations['policy']['result']['recipes'];
  outputFormat: 'png' | 'gif';
  onOutputFormat: (value: 'png' | 'gif') => void;
  recipeId: string;
  onRecipe: (id: string) => void;
}

export const FloatingTrigger: React.FC<FloatingTriggerProps> = ({
  range,
  onTrigger,
  recipes,
  recipeId,
  onRecipe,
  outputFormat,
  onOutputFormat,
}) => {
  const triggerRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredPosition(range, triggerRef, 'bottom-end');
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
  const available = Math.max(210, (rects.at(-1)?.right ?? innerWidth) - 12);

  return (
    <div
      ref={triggerRef}
      style={{ ...style, maxWidth: `min(calc(100vw - 24px), ${available}px)` }}
      className="flex items-center bg-accent text-on-accent text-xs font-sans font-medium rounded-control saul-elevated border border-accent select-none max-w-[calc(100vw-24px)]"
    >
      <button type="button" onClick={() => annotateRange(range)} className="shrink-0 px-2.5 py-1.5">
        Annotate
      </button>
      <select
        aria-label="Action"
        style={{ fieldSizing: 'content' }}
        value={recipeId}
        onChange={(event) => onRecipe(event.target.value)}
        className="max-w-52 min-w-0 bg-transparent text-inherit rounded-l-control px-2 py-1.5"
      >
        {!recipes.some((recipe) => recipe.id === recipeId) && (
          <option value={recipeId}>Action unavailable</option>
        )}
        {recipes.map((recipe) => (
          <option key={recipe.id} value={recipe.id}>
            {recipe.name} · {recipe.presetName}
            {recipe.fast ? ' · Fast' : ''}
          </option>
        ))}
      </select>
      {recipes.find((r) => r.id === recipeId)?.capability === 'draw' && (
        <select
          aria-label="Output format"
          value={outputFormat}
          onChange={(e) => onOutputFormat(e.target.value as 'png' | 'gif')}
          className="bg-transparent text-inherit px-2 py-1.5 min-w-0"
        >
          <option value="png">PNG</option>
          <option value="gif">GIF · animated</option>
        </select>
      )}
      <button
        onClick={(event) => {
          event.stopPropagation();
          onTrigger();
        }}
        className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-r-control hover:bg-accent-hover"
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>
          {recipes.find((r) => r.id === recipeId)?.capability === 'draw'
            ? 'Illustrate & open'
            : 'Explain & open'}
        </span>
      </button>
    </div>
  );
};
