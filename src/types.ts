export type Keyframe = {
  time: number;
  value: number;
};

export type CurvePointRole =
  | 'boundary'
  | 'interior'
  | 'anchor'
  | 'feature'
  | 'sample';

export type CurvePointSource =
  | 'authored'
  | 'derived'
  | 'procedural'
  | 'imported';

export type CurvePointEditability =
  | 'free'
  | 'locked'
  | 'softLocked'
  | 'convertible';

export type CurvePointContinuity =
  | 'smooth'
  | 'corner';

export type CurvePointOutInterpolation =
  | 'smooth'
  | 'linear'
  | 'constant';

export type CurvePointFlag =
  | 'uncompressible'
  | 'protected'
  | 'spaceCoupled'
  | 'diagnostic';

export type CurvePointConstraints = {
  edgeOwner?: 'start' | 'end';
  pinnedTime?: boolean;
  pinnedValue?: boolean;
  minTime?: number;
  maxTime?: number;
  minValue?: number;
  maxValue?: number;
};

export type CurvePoint = {
  id: string;
  time: number;
  value: number;

  role: CurvePointRole;
  source: CurvePointSource;
  edit: CurvePointEditability;

  continuity: CurvePointContinuity;
  outInterpolation: CurvePointOutInterpolation;

  flags: CurvePointFlag[];
  constraints?: CurvePointConstraints;
};

export type ColorCurve = {
  r: CurvePoint[];
  g: CurvePoint[];
  b: CurvePoint[];
  a: CurvePoint[];
};

export type Channel = 'r' | 'g' | 'b' | 'a';

export type ChannelMask = Record<Channel, boolean>;

export type LibraryCurve = {
  id: string;
  name: string;
  category: string;
  position: number; // 0.0 to 1.0 mapping across the curve space
  curve: ColorCurve;
  authored?: boolean;
  source?: 'implicit-edit' | 'manual' | 'loaded';
};

export type SpaceAnchor = LibraryCurve;
