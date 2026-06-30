import type { ColorCurve, LibraryCurve } from '../types';
import { createId } from '../lib/idUtils';
import { migrateKeyframesToCurvePoints } from '../lib/curvePointPolicy';
import { cloneCurve } from '../lib/spaceUtils';

export const EXPORT_ATLAS_SIZE = { width: 256, height: 32 };

export const initialCurve: ColorCurve = {
  r: migrateKeyframesToCurvePoints([{ time: 0, value: 0 }, { time: 1, value: 1 }]),
  g: migrateKeyframesToCurvePoints([{ time: 0, value: 0 }, { time: 1, value: 1 }]),
  b: migrateKeyframesToCurvePoints([{ time: 0, value: 0 }, { time: 1, value: 1 }]),
  a: migrateKeyframesToCurvePoints([{ time: 0, value: 1 }, { time: 1, value: 1 }])
};

export const createMinimalBasicSpace = (): LibraryCurve[] => [{
  id: createId('anchor'),
  name: 'Default Sweep',
  category: 'Basic',
  position: 0,
  curve: cloneCurve(initialCurve),
  authored: true,
  source: 'manual'
}];
