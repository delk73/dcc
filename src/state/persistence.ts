import { get, set } from 'idb-keyval';
import type { LibraryCurve } from '../types';
import {
  normalizePersistedUxState,
  serializeUxState,
  type EditorUiState,
} from './editorState';
import { normalizeLibraryCurves } from '../lib/curvePointPolicy';

const CURVE_LIBRARY_KEY = 'curve-library';
const CURVE_UX_STATE_KEY = 'curve-ux-state';

const isNonEmptyArray = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.length > 0;

const readLegacyLocalStorageLibrary = (): unknown => {
  const data = localStorage.getItem(CURVE_LIBRARY_KEY);
  if (!data) return undefined;

  try {
    return JSON.parse(data);
  } catch (error) {
    console.error('Migration parse error', error);
    return undefined;
  }
};

export const loadPersistedLibrary = async (): Promise<LibraryCurve[]> => {
  let savedLibrary = await get(CURVE_LIBRARY_KEY);

  if (!isNonEmptyArray(savedLibrary)) {
    const legacyLibrary = readLegacyLocalStorageLibrary();
    if (isNonEmptyArray(legacyLibrary)) {
      savedLibrary = legacyLibrary;
      await set(CURVE_LIBRARY_KEY, savedLibrary);
    }
  }

  return isNonEmptyArray(savedLibrary)
    ? normalizeLibraryCurves(savedLibrary as LibraryCurve[])
    : [];
};

export const loadPersistedUxState = async () =>
  normalizePersistedUxState(await get(CURVE_UX_STATE_KEY));

export const saveCurveLibrary = async (library: LibraryCurve[]) => {
  await set(CURVE_LIBRARY_KEY, library);
};

export const saveUxState = async (ui: EditorUiState) => {
  await set(CURVE_UX_STATE_KEY, serializeUxState(ui));
};
