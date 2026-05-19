export type Keyframe = {
  time: number;
  value: number;
};

export type ColorCurve = {
  r: Keyframe[];
  g: Keyframe[];
  b: Keyframe[];
  a: Keyframe[];
};

export type Channel = 'r' | 'g' | 'b' | 'a';

export type LibraryCurve = {
  id: string;
  name: string;
  category: string;
  position: number; // 0.0 to 1.0 mapping across the curve space
  curve: ColorCurve;
};
