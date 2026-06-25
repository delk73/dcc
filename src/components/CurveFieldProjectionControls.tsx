import React from 'react';
import { cn } from '../lib/utils';
import type { CurveFieldProjectionIr } from '../lib/curveProjectionIr';
import { CURVE_FIELD_BASIS_RECIPES, type CurveFieldBasisRecipeId } from '../lib/curveFieldBasisIr';

type CurveFieldProjectionControlsProps = {
  transform: CurveFieldProjectionIr['transform'];
  basis: CurveFieldProjectionIr['basis'];
  previewSize: 256 | 512;
  onTransformChange: (transform: Partial<CurveFieldProjectionIr['transform']>) => void;
  onBasisRecipeChange: (id: CurveFieldBasisRecipeId) => void;
  onPreviewSizeChange: (size: 256 | 512) => void;
  className?: string;
};

function NumericDisplay({ value, decimals = 2 }: { value: number; decimals?: number }) {
  return <span className="w-10 shrink-0 text-right font-mono text-[10px] text-zinc-400">{value.toFixed(decimals)}</span>;
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={event => onChange(Number(event.target.value))}
      className="h-1 flex-1 accent-zinc-400"
    />
  );
}

export function CurveFieldProjectionControls({
  transform,
  basis,
  previewSize,
  onTransformChange,
  onBasisRecipeChange,
  onPreviewSizeChange,
  className,
}: CurveFieldProjectionControlsProps) {
  const rotationDegrees = (transform.rotation * 180) / Math.PI;
  const selectedRecipe = CURVE_FIELD_BASIS_RECIPES.find(recipe => recipe.basis === basis)
    ?? CURVE_FIELD_BASIS_RECIPES.find(recipe => JSON.stringify(recipe.basis) === JSON.stringify(basis));

  return (
    <div className={cn('flex flex-col gap-2 p-2', className)}>
      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300">Projection</span>
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">Basis</span>
        <div className="flex flex-wrap gap-1">
          {CURVE_FIELD_BASIS_RECIPES.map(recipe => (
            <button
              key={recipe.id}
              type="button"
              onClick={() => onBasisRecipeChange(recipe.id)}
              className={cn(
                'rounded border px-1.5 py-0.5 text-[10px]',
                selectedRecipe?.id === recipe.id
                  ? 'border-zinc-600 bg-zinc-700 text-zinc-100'
                  : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
              )}
            >
              {recipe.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">Rotation</span>
        <Slider
          value={rotationDegrees}
          min={-180}
          max={180}
          step={1}
          onChange={value => onTransformChange({ rotation: (value * Math.PI) / 180 })}
        />
        <NumericDisplay value={rotationDegrees} decimals={0} />
      </label>
      <label className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">Scale X</span>
        <Slider value={transform.scaleX} min={0.25} max={2} step={0.025} onChange={value => onTransformChange({ scaleX: value })} />
        <NumericDisplay value={transform.scaleX} />
      </label>
      <label className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">Scale Y</span>
        <Slider value={transform.scaleY} min={0.25} max={2} step={0.025} onChange={value => onTransformChange({ scaleY: value })} />
        <NumericDisplay value={transform.scaleY} />
      </label>
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">Preview</span>
        <div className="flex gap-1">
          {([256, 512] as const).map(size => (
            <button
              key={size}
              type="button"
              onClick={() => onPreviewSizeChange(size)}
              className={cn(
                'rounded border px-1.5 py-0.5 font-mono text-[10px]',
                previewSize === size
                  ? 'border-zinc-600 bg-zinc-700 text-zinc-100'
                  : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
              )}
            >
              {size}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}