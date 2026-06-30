import type { LibraryCurve } from '../types';
import { computeTangents, evaluateCurve, blendSpaceCurves, type InterpMode } from '../lib/curveUtils';
import { insertTextChunk } from '../lib/pngUtils';
import { EXPORT_ATLAS_SIZE } from '../domain/defaults';

type ExportAtlasOptions = {
  curves: LibraryCurve[];
  interpMode: InterpMode;
  atlasTexture: ImageData | null;
};

const clampByte = (value: number) =>
  Math.min(255, Math.max(0, value * 255));

export const createAtlasPngUrl = ({
  curves,
  interpMode,
  atlasTexture,
}: ExportAtlasOptions): string | null => {
  if (curves.length === 0) return null;

  const width = EXPORT_ATLAS_SIZE.width;
  const height = EXPORT_ATLAS_SIZE.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  if (atlasTexture) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = atlasTexture.width;
    tempCanvas.height = atlasTexture.height;
    tempCanvas.getContext('2d')?.putImageData(atlasTexture, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0, width, height);
  } else {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
      const tSpace = 1.0 - (y / (height - 1));
      const curveObj = blendSpaceCurves(curves, tSpace, interpMode);
      const sortedCurve = {
        r: [...curveObj.r].sort((a, b) => a.time - b.time),
        g: [...curveObj.g].sort((a, b) => a.time - b.time),
        b: [...curveObj.b].sort((a, b) => a.time - b.time),
        a: [...curveObj.a].sort((a, b) => a.time - b.time),
      };
      const tangents = {
        r: computeTangents(sortedCurve.r),
        g: computeTangents(sortedCurve.g),
        b: computeTangents(sortedCurve.b),
        a: computeTangents(sortedCurve.a)
      };

      for (let x = 0; x < width; x++) {
        const t = x / (width - 1);
        const r = evaluateCurve(sortedCurve.r, tangents.r, t, interpMode);
        const g = evaluateCurve(sortedCurve.g, tangents.g, t, interpMode);
        const b = evaluateCurve(sortedCurve.b, tangents.b, t, interpMode);
        const a = evaluateCurve(sortedCurve.a, tangents.a, t, interpMode);
        const idx = (y * width + x) * 4;

        data[idx] = clampByte(r);
        data[idx + 1] = clampByte(g);
        data[idx + 2] = clampByte(b);
        data[idx + 3] = clampByte(a);
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  const metadataJSON = JSON.stringify(curves.map(curve => ({
    name: curve.name,
    category: curve.category,
    position: curve.position,
    curve: curve.curve
  })));

  return insertTextChunk(canvas.toDataURL('image/png'), 'Provenance', metadataJSON);
};
