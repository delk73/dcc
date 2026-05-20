import React from 'react';
import {
  CurvePoint,
  CurvePointContinuity,
  CurvePointOutInterpolation,
  CurvePointRole,
  CurvePointSource
} from '../types';
import { cn } from '../lib/utils';
import {
  canConvertToAuthored,
  canEditOutgoingInterpolation,
  canEditPointMetadata,
  canEditPointRole,
  getEdgeOwner,
  setCurvePointFlag,
  setCurvePointOutgoingInterpolation,
  setCurvePointRole
} from '../lib/curvePointPolicy';

const ROLE_LABELS: Record<CurvePointRole, string> = {
  boundary: 'Boundary',
  interior: 'Point',
  anchor: 'Anchor',
  feature: 'Feature',
  sample: 'Sample'
};

const SOURCE_LABELS: Record<CurvePointSource, string> = {
  authored: 'Authored',
  derived: 'Derived',
  procedural: 'Procedural',
  imported: 'Imported'
};

const OUT_LABELS: Record<CurvePointOutInterpolation, string> = {
  smooth: 'Smooth',
  linear: 'Linear',
  constant: 'Hold'
};

const CONTINUITY_LABELS: Record<CurvePointContinuity, string> = {
  smooth: 'Smooth',
  corner: 'Corner'
};

type PointInspectorProps = {
  point: CurvePoint | null;
  channelLabel?: string;
  onPatchPoint: (patcher: (point: CurvePoint) => CurvePoint) => void;
  onPatchEditablePoint: (patcher: (point: CurvePoint) => CurvePoint) => void;
  onConvertToAuthored: () => void;
  onClearSelection: () => void;
};

const SelectRow = <T extends string>({
  label,
  value,
  options,
  disabled,
  reason,
  onChange
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  reason?: string;
  onChange: (value: T) => void;
}) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-4">
      <label className="text-zinc-400 text-sm">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(
          "bg-black border border-zinc-800 rounded px-3 py-1.5 text-zinc-300 outline-none w-3/5 text-sm",
          "focus:border-indigo-500/50 disabled:opacity-45 disabled:cursor-not-allowed"
        )}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
    {disabled && reason && <p className="text-[10px] text-zinc-600 text-right">{reason}</p>}
  </div>
);

const ToggleRow = ({
  label,
  checked,
  disabled,
  reason,
  onChange
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  reason?: string;
  onChange: (checked: boolean) => void;
}) => (
  <div className="space-y-1.5">
    <label className={cn("flex items-center justify-between gap-3", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
      <span className={cn("text-sm", disabled ? "text-zinc-600" : "text-zinc-300")}>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-indigo-500 disabled:opacity-40"
      />
    </label>
    {disabled && reason && <p className="text-[10px] text-zinc-600">{reason}</p>}
  </div>
);

export const PointInspector: React.FC<PointInspectorProps> = ({
  point,
  channelLabel,
  onPatchPoint,
  onPatchEditablePoint,
  onConvertToAuthored,
  onClearSelection
}) => {
  if (!point) {
    return (
      <div className="bg-[#09090b] flex flex-col min-h-[500px]">
        <div className="p-4 border-b border-zinc-800 pb-6">
          <h3 className="font-bold text-xs tracking-widest uppercase text-white">Point Inspector</h3>
        </div>
        <div className="flex-1 flex items-center justify-center px-8 text-center">
          <div className="space-y-3">
            <div className="w-10 h-10 rounded-full border border-zinc-800 mx-auto" />
            <p className="text-sm text-zinc-500 leading-relaxed">Select a point to edit its behavior.</p>
          </div>
        </div>
      </div>
    );
  }

  const edgeOwner = getEdgeOwner(point);
  const editable = canEditPointMetadata(point);
  const canEditRole = canEditPointRole(point);
  const canEditOut = canEditOutgoingInterpolation(point);
  const isLocked = point.edit === 'locked';
  const isProceduralBlocked = point.source === 'procedural' && point.edit !== 'convertible';
  const disabledReason = isLocked
    ? 'Locked point. Unlock before editing behavior.'
    : isProceduralBlocked
      ? 'Procedural point. Owned by generator logic.'
      : undefined;
  const outReason = edgeOwner === 'end'
    ? 'No outgoing segment.'
    : disabledReason;

  const patchFlag = (flag: 'protected' | 'uncompressible', enabled: boolean) => {
    onPatchEditablePoint(current => setCurvePointFlag(current, flag, enabled));
  };

  return (
    <div className="bg-[#09090b] flex flex-col min-h-[500px]">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between pb-6">
        <h3 className="font-bold text-xs tracking-widest uppercase text-white">Point Inspector</h3>
        <button
          onClick={onClearSelection}
          className="text-zinc-600 hover:text-white transition-colors"
          aria-label="Clear point selection"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
        </button>
      </div>

      <div className="px-4 py-5 border-b border-zinc-800 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
            <span className="text-xs font-bold tracking-widest uppercase text-zinc-300">1 Point Selected</span>
          </div>
          {channelLabel && <span className="text-xs text-blue-500 font-mono">{channelLabel}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="px-2 py-1 rounded border border-zinc-800 bg-black text-[10px] uppercase tracking-wider text-zinc-400">
            {SOURCE_LABELS[point.source]}
          </span>
          {edgeOwner && (
            <span className="px-2 py-1 rounded border border-indigo-500/30 bg-indigo-500/10 text-[10px] uppercase tracking-wider text-indigo-300">
              {edgeOwner === 'start' ? 'Start edge' : 'End edge'}
            </span>
          )}
          {point.flags.includes('spaceCoupled') && (
            <span className="px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-300">
              Coupled
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-6 space-y-6 flex-1 text-sm font-medium">
        <div className="space-y-4">
          {point.role === 'boundary' ? (
            <div className="flex items-center justify-between gap-4">
              <span className="text-zinc-400 text-sm">Role</span>
              <span className="w-3/5 bg-black border border-zinc-800 rounded px-3 py-1.5 text-zinc-500 text-sm">
                Boundary
              </span>
            </div>
          ) : (
            <SelectRow<Exclude<CurvePointRole, 'boundary'>>
              label="Role"
              value={point.role}
              disabled={!canEditRole}
              reason={disabledReason}
              options={[
                { value: 'interior', label: 'Point' },
                { value: 'anchor', label: 'Anchor' },
                { value: 'feature', label: 'Feature' },
                { value: 'sample', label: 'Sample' }
              ]}
              onChange={(role) => onPatchEditablePoint(current => setCurvePointRole(current, role))}
            />
          )}

          <SelectRow<CurvePointContinuity>
            label="Continuity"
            value={point.continuity}
            disabled={!editable}
            reason={disabledReason}
            options={[
              { value: 'smooth', label: CONTINUITY_LABELS.smooth },
              { value: 'corner', label: CONTINUITY_LABELS.corner }
            ]}
            onChange={(continuity) => onPatchEditablePoint(current => ({ ...current, continuity }))}
          />

          <SelectRow<CurvePointOutInterpolation>
            label="Out"
            value={point.outInterpolation}
            disabled={!canEditOut}
            reason={outReason}
            options={[
              { value: 'smooth', label: OUT_LABELS.smooth },
              { value: 'linear', label: OUT_LABELS.linear },
              { value: 'constant', label: OUT_LABELS.constant }
            ]}
            onChange={(outInterpolation) => onPatchEditablePoint(current => setCurvePointOutgoingInterpolation(current, outInterpolation))}
          />
        </div>

        <div className="space-y-4 pt-4 border-t border-zinc-800">
          <label className="text-zinc-400 mb-2 block">Behavior</label>
          <ToggleRow
            label="Lock"
            checked={isLocked}
            disabled={isProceduralBlocked}
            reason={isProceduralBlocked ? disabledReason : undefined}
            onChange={(checked) => onPatchPoint(current => ({ ...current, edit: checked ? 'locked' : 'free' }))}
          />
          <ToggleRow
            label="Protected"
            checked={point.flags.includes('protected')}
            disabled={!editable}
            reason={disabledReason}
            onChange={(checked) => patchFlag('protected', checked)}
          />
          <ToggleRow
            label="Preserve"
            checked={point.flags.includes('uncompressible')}
            disabled={!editable}
            reason={disabledReason}
            onChange={(checked) => patchFlag('uncompressible', checked)}
          />
        </div>

        {canConvertToAuthored(point) && (
          <div className="space-y-3 pt-4 border-t border-zinc-800">
            <p className="text-xs text-zinc-500 leading-relaxed">
              {point.source === 'procedural'
                ? 'Procedural point. Convert to authored before direct editing.'
                : 'Convert this point to authored to take direct control.'}
            </p>
            <button
              onClick={onConvertToAuthored}
              className="w-full rounded border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200 hover:bg-indigo-500/20 transition-colors"
            >
              Make authored
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
