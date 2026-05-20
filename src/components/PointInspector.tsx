import React from 'react';
import {
  Bookmark,
  Circle,
  Lock,
  MoreHorizontal,
  MoveRight,
  Spline,
  Unlock
} from 'lucide-react';
import {
  CurvePoint,
  CurvePointContinuity,
  CurvePointOutInterpolation,
  CurvePointRole
} from '../types';
import { cn } from '../lib/utils';
import {
  canConvertToAuthored,
  canEditContinuity,
  canEditOutInterpolation,
  canEditRole,
  canToggleLock,
  canTogglePreserve,
  getEdgeBadge,
  getOutgoingInterpolation,
  getPointLabel,
  getSourceBadge,
  setCurvePointFlag,
  setCurvePointOutgoingInterpolation,
  setCurvePointRole
} from '../lib/curvePointPolicy';

const ROLE_OPTIONS: { value: Exclude<CurvePointRole, 'boundary'>; label: string }[] = [
  { value: 'interior', label: 'Point' },
  { value: 'anchor', label: 'Anchor' },
  { value: 'feature', label: 'Feature' },
  { value: 'sample', label: 'Sample' }
];

const CONTINUITY_OPTIONS: { value: CurvePointContinuity; label: string }[] = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'corner', label: 'Corner' }
];

const OUT_OPTIONS: { value: CurvePointOutInterpolation; label: string }[] = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'linear', label: 'Linear' },
  { value: 'constant', label: 'Hold' }
];

type PointInspectorProps = {
  point: CurvePoint | null;
  pointNumber?: number;
  channelLabel?: string;
  onPatchPoint: (patcher: (point: CurvePoint) => CurvePoint) => void;
  onPatchEditablePoint: (patcher: (point: CurvePoint) => CurvePoint) => void;
  onConvertToAuthored: () => void;
};

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="h-7 inline-flex items-center rounded border border-zinc-800 bg-black px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
    {children}
  </span>
);

const ControlShell = ({
  label,
  title,
  disabled,
  children
}: {
  label: string;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) => (
  <label
    className={cn(
      "group relative h-10 min-w-[74px] rounded-md border border-zinc-800 bg-black/60 px-2 py-1",
      "flex items-center gap-2 text-zinc-300 transition-colors",
      disabled ? "opacity-45 cursor-not-allowed" : "hover:border-zinc-600 hover:text-white"
    )}
    title={title}
  >
    {children}
    <span className="pointer-events-none absolute -top-2 left-2 -translate-y-full whitespace-nowrap rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] text-zinc-400 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
      {label}: {title}
    </span>
  </label>
);

const CompactSelect = <T extends string>({
  label,
  title,
  value,
  options,
  disabled,
  icon,
  onChange
}: {
  label: string;
  title: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  icon: React.ReactNode;
  onChange: (value: T) => void;
}) => (
  <ControlShell label={label} title={title} disabled={disabled}>
    {icon}
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
      aria-label={label}
      className="min-w-0 flex-1 appearance-none bg-transparent text-xs font-medium text-zinc-100 outline-none disabled:cursor-not-allowed"
    >
      {options.map(option => (
        <option key={option.value} value={option.value} className="bg-zinc-950 text-zinc-100">
          {option.label}
        </option>
      ))}
    </select>
  </ControlShell>
);

const GlyphToggle = ({
  label,
  title,
  active,
  disabled,
  children,
  onClick
}: {
  label: string;
  title: string;
  active: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={`${label}: ${title}`}
    aria-label={label}
    aria-pressed={active}
    className={cn(
      "group relative h-10 w-10 rounded-md border border-zinc-800 bg-black/60",
      "inline-flex items-center justify-center transition-colors",
      active ? "text-white ring-1 ring-white/30" : "text-zinc-400",
      disabled ? "opacity-45 cursor-not-allowed" : "hover:border-zinc-600 hover:text-white"
    )}
  >
    {children}
    <span className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] text-zinc-400 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
      {label}: {title}
    </span>
  </button>
);

export const PointInspector: React.FC<PointInspectorProps> = ({
  point,
  pointNumber,
  channelLabel,
  onPatchPoint,
  onPatchEditablePoint,
  onConvertToAuthored
}) => {
  if (!point) {
    return (
      <div className="flex min-h-10 items-center gap-3 text-xs text-zinc-500">
        <span>No point selected</span>
      </div>
    );
  }

  const edgeBadge = getEdgeBadge(point);
  const outDisabled = !canEditOutInterpolation(point);
  const preserveActive = point.flags.includes('uncompressible');
  const locked = point.edit === 'locked';
  const isBoundary = point.role === 'boundary';

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-2 text-xs">
      <Badge>{pointNumber ? `Point ${pointNumber} selected` : 'Point selected'}</Badge>
      {channelLabel && <Badge>{channelLabel}</Badge>}
      <Badge>{getSourceBadge(point)}</Badge>
      {edgeBadge && <Badge>{edgeBadge}</Badge>}

      <div className="mx-1 h-8 w-px bg-zinc-800" />

      {isBoundary ? (
        <ControlShell label="Role" title="What this point represents in the curve." disabled>
          <Circle className="h-4 w-4" />
          <span className="text-xs font-medium">{getPointLabel(point)}</span>
        </ControlShell>
      ) : (
        <CompactSelect
          label="Role"
          title="What this point represents in the curve."
          value={point.role as Exclude<CurvePointRole, 'boundary'>}
          options={ROLE_OPTIONS}
          disabled={!canEditRole(point)}
          icon={<Circle className="h-4 w-4" />}
          onChange={(role) => onPatchEditablePoint(current => setCurvePointRole(current, role))}
        />
      )}

      <CompactSelect
        label="Continuity"
        title="Tangent behavior at this point."
        value={point.continuity}
        options={CONTINUITY_OPTIONS}
        disabled={!canEditContinuity(point)}
        icon={<Spline className="h-4 w-4" />}
        onChange={(continuity) => onPatchEditablePoint(current => ({ ...current, continuity }))}
      />

      <CompactSelect
        label="Out"
        title={outDisabled ? 'No outgoing segment.' : 'Segment behavior from this point to the next.'}
        value={getOutgoingInterpolation(point)}
        options={OUT_OPTIONS}
        disabled={outDisabled}
        icon={<MoveRight className="h-4 w-4" />}
        onChange={(outInterpolation) => onPatchEditablePoint(current => setCurvePointOutgoingInterpolation(current, outInterpolation))}
      />

      <div className="mx-1 h-8 w-px bg-zinc-800" />

      <GlyphToggle
        label="Lock"
        title="Prevent dragging or editing."
        active={locked}
        disabled={!canToggleLock(point)}
        onClick={() => onPatchPoint(current => {
          const editablePoint = canConvertToAuthored(current) ? { ...current, source: 'authored' as const } : current;
          return { ...editablePoint, edit: locked ? 'free' : 'locked' };
        })}
      >
        {locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
      </GlyphToggle>

      <GlyphToggle
        label="Preserve"
        title="Prevent removal during compression/resampling."
        active={preserveActive}
        disabled={!canTogglePreserve(point)}
        onClick={() => onPatchEditablePoint(current => setCurvePointFlag(current, 'uncompressible', !current.flags.includes('uncompressible')))}
      >
        <Bookmark className={cn("h-4 w-4", preserveActive && "fill-current")} />
      </GlyphToggle>

      {canConvertToAuthored(point) && (
        <button
          type="button"
          onClick={onConvertToAuthored}
          className="h-10 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 text-xs font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20"
        >
          Make authored
        </button>
      )}

      <div className="ml-auto flex items-center gap-3 text-zinc-500">
        <span>Segment Out is set per point</span>
        <button
          type="button"
          className="h-8 w-9 rounded border border-zinc-800 bg-black text-zinc-400 hover:text-white"
          aria-label="Curve editor menu"
          title="Curve editor menu"
        >
          <MoreHorizontal className="mx-auto h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
