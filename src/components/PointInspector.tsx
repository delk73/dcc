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
  dense?: boolean;
};

const Badge = ({ children, dense = false }: { children: React.ReactNode; dense?: boolean }) => (
  <span className={cn(
    "inline-flex items-center rounded border border-zinc-800 bg-black text-[10px] font-bold uppercase tracking-wider text-zinc-400",
    dense ? "h-6 px-1.5" : "h-7 px-2"
  )}>
    {children}
  </span>
);

const ControlShell = ({
  label,
  title,
  disabled,
  dense,
  children
}: {
  label: string;
  title: string;
  disabled?: boolean;
  dense?: boolean;
  children: React.ReactNode;
}) => (
  <label
    className={cn(
      "group relative rounded-md border border-zinc-800 bg-black/60 px-2 py-1",
      "flex items-center gap-2 text-zinc-300 transition-colors",
      dense ? "h-8 min-w-[66px]" : "h-10 min-w-[74px]",
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
  dense,
  onChange
}: {
  label: string;
  title: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  icon: React.ReactNode;
  dense?: boolean;
  onChange: (value: T) => void;
}) => (
  <ControlShell label={label} title={title} disabled={disabled} dense={dense}>
    <span className={cn(dense && "[&_svg]:h-3.5 [&_svg]:w-3.5")}>{icon}</span>
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
  dense,
  onClick
}: {
  label: string;
  title: string;
  active: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  dense?: boolean;
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
      "group relative rounded-md border border-zinc-800 bg-black/60",
      "inline-flex items-center justify-center transition-colors",
      dense ? "h-8 w-8 [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-10 w-10",
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
  onConvertToAuthored,
  dense = false
}) => {
  if (!point) {
    return (
      <div className={cn("flex items-center gap-3 text-xs text-zinc-500", dense ? "min-h-8" : "min-h-10")}>
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
    <div className={cn("flex flex-wrap items-center gap-1.5 text-xs", dense ? "min-h-8" : "min-h-10 gap-2")}>
      <Badge dense={dense}>{pointNumber ? `Point ${pointNumber}` : 'Point'}</Badge>
      {channelLabel && <Badge dense={dense}>{channelLabel}</Badge>}
      <Badge dense={dense}>{getSourceBadge(point)}</Badge>
      {edgeBadge && <Badge dense={dense}>{edgeBadge}</Badge>}

      <div className={cn("mx-1 w-px bg-zinc-800", dense ? "h-6" : "h-8")} />

      {isBoundary ? (
        <ControlShell label="Role" title="What this point represents in the curve." disabled dense={dense}>
          <Circle className={cn(dense ? "h-3.5 w-3.5" : "h-4 w-4")} />
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
          dense={dense}
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
        dense={dense}
        onChange={(continuity) => onPatchEditablePoint(current => ({ ...current, continuity }))}
      />

      <CompactSelect
        label="Out"
        title={outDisabled ? 'No outgoing segment.' : 'Segment behavior from this point to the next.'}
        value={getOutgoingInterpolation(point)}
        options={OUT_OPTIONS}
        disabled={outDisabled}
        icon={<MoveRight className="h-4 w-4" />}
        dense={dense}
        onChange={(outInterpolation) => onPatchEditablePoint(current => setCurvePointOutgoingInterpolation(current, outInterpolation))}
      />

      <div className={cn("mx-1 w-px bg-zinc-800", dense ? "h-6" : "h-8")} />

      <GlyphToggle
        label="Lock"
        title="Prevent dragging or editing."
        active={locked}
        disabled={!canToggleLock(point)}
        dense={dense}
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
        dense={dense}
        onClick={() => onPatchEditablePoint(current => setCurvePointFlag(current, 'uncompressible', !current.flags.includes('uncompressible')))}
      >
        <Bookmark className={cn("h-4 w-4", preserveActive && "fill-current")} />
      </GlyphToggle>

      {canConvertToAuthored(point) && (
        <button
          type="button"
          onClick={onConvertToAuthored}
          className={cn(
            "rounded-md border border-indigo-500/40 bg-indigo-500/10 text-xs font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20",
            dense ? "h-8 px-2" : "h-10 px-3"
          )}
        >
          {dense ? 'Author' : 'Make authored'}
        </button>
      )}

      <div className="ml-auto flex items-center gap-2 text-zinc-500">
        <span className={cn(dense && "hidden 2xl:inline")}>Segment Out is set per point</span>
        <button
          type="button"
          className={cn(
            "rounded border border-zinc-800 bg-black text-zinc-400 hover:text-white",
            dense ? "h-7 w-8" : "h-8 w-9"
          )}
          aria-label="Curve editor menu"
          title="Curve editor menu"
        >
          <MoreHorizontal className="mx-auto h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
