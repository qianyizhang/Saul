import React, { useRef } from 'react';
import { useAnchoredPosition } from './useAnchoredPosition';
import { Sparkles } from 'lucide-react';

interface FloatingTriggerProps {
  range: Range;
  onTrigger: () => void;
  recipes: { id: string; name: string; presetName: string; fast: boolean }[];
  recipeId: string;
  onRecipe: (id: string) => void;
}

export const FloatingTrigger: React.FC<FloatingTriggerProps> = ({
  range,
  onTrigger,
  recipes,
  recipeId,
  onRecipe,
}) => {
  const triggerRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredPosition(range, triggerRef, 'bottom-end');

  return (
    <div
      ref={triggerRef}
      style={style}
      className="flex items-center bg-accent text-on-accent text-xs font-sans font-medium rounded-control saul-elevated border border-accent select-none max-w-[calc(100vw-24px)]"
    >
      <select
        aria-label="Recipe"
        value={recipeId}
        onChange={(event) => onRecipe(event.target.value)}
        className="max-w-52 min-w-0 bg-transparent text-inherit rounded-l-control px-2 py-1.5"
      >
        {!recipes.some((recipe) => recipe.id === recipeId) && (
          <option value={recipeId}>Recipe unavailable</option>
        )}
        {recipes.map((recipe) => (
          <option key={recipe.id} value={recipe.id}>
            {recipe.name} · {recipe.presetName}
            {recipe.fast ? ' · Fast' : ''}
          </option>
        ))}
      </select>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onTrigger();
        }}
        className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-r-control hover:bg-accent-hover"
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>Explain</span>
      </button>
    </div>
  );
};
