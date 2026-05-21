import React, { useEffect, useRef, useState } from 'react';
import { ColorCurve } from '../types';
import { cn } from '../lib/utils';
import { evaluateCurve, computeTangents, InterpMode } from '../lib/curveUtils';
import { Download } from 'lucide-react';

interface CurvePreviewProps {
  curve: ColorCurve;
  interpMode: InterpMode;
  textureData?: ImageData | null;
  sampleY?: number;
}

export const CurvePreview: React.FC<CurvePreviewProps> = ({ curve, interpMode, textureData, sampleY = 0 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [channels, setChannels] = useState({ r: true, g: true, b: true, a: true });

  const handleDownloadPreview = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = textureData ? 'SpacePreview_Row.png' : 'ColorCurve_Preview.png';
    a.click();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    if (textureData) {
        const texW = textureData.width;
        const texH = textureData.height;
        const ty = Math.min(texH - 1, Math.max(0, Math.round((1.0 - sampleY) * (texH - 1))));
        const startIdx = ty * texW * 4;
        const endIdx = startIdx + texW * 4;
        
        const rowData = textureData.data.subarray ? textureData.data.subarray(startIdx, endIdx) : textureData.data.slice(startIdx, endIdx);
        
        for (let x = 0; x < width; x++) {
            const t = x / (width - 1);
            const tx = Math.min(texW - 1, Math.max(0, Math.round(t * (texW - 1))));
            const idx = tx * 4;
            
            const r8 = rowData[idx];
            const g8 = rowData[idx + 1];
            const b8 = rowData[idx + 2];
            const a8 = rowData[idx + 3];

            data[x * 4] = channels.r ? r8 : 0;
            data[x * 4 + 1] = channels.g ? g8 : 0;
            data[x * 4 + 2] = channels.b ? b8 : 0;
            data[x * 4 + 3] = channels.a ? a8 : 255;
        }
    } else {
        const sortedCurve = {
          r: [...curve.r].sort((a, b) => a.time - b.time),
          g: [...curve.g].sort((a, b) => a.time - b.time),
          b: [...curve.b].sort((a, b) => a.time - b.time),
          a: [...curve.a].sort((a, b) => a.time - b.time),
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

            const r8 = Math.min(255, Math.max(0, r * 255));
            const g8 = Math.min(255, Math.max(0, g * 255));
            const b8 = Math.min(255, Math.max(0, b * 255));
            const a8 = Math.min(255, Math.max(0, a * 255));

            data[x * 4] = channels.r ? r8 : 0;
            data[x * 4 + 1] = channels.g ? g8 : 0;
            data[x * 4 + 2] = channels.b ? b8 : 0;
            data[x * 4 + 3] = channels.a ? a8 : 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [curve, interpMode, textureData, sampleY, channels]);

  return (
    <div className="flex flex-col gap-4 bg-[#09090b] border border-zinc-800 rounded-xl p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-zinc-100 font-bold text-[11px] tracking-widest uppercase">PREVIEW <span className="text-zinc-500 font-normal normal-case tracking-normal">(Output)</span></h3>
        <div className="flex gap-3 items-center">
             <button
                onClick={handleDownloadPreview}
                className="flex items-center gap-1.5 px-2 py-1 rounded border border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
             >
                <Download className="w-3.5 h-3.5" />
                PNG
             </button>
             <button className="text-zinc-500 hover:text-zinc-300">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path></svg>
             </button>
             <button className="text-zinc-500 hover:text-zinc-300">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
             </button>
        </div>
      </div>
      
      <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                  <label className="flex items-center gap-2 border border-zinc-800 rounded px-2 py-1 bg-black cursor-pointer">
                      <input type="checkbox" checked={channels.r} onChange={e => setChannels(p => ({...p, r: e.target.checked}))} className="accent-red-500 rounded-sm" />
                      <span className="text-xs text-red-500 font-bold">R</span>
                  </label>
                  <label className="flex items-center gap-2 border border-zinc-800 rounded px-2 py-1 bg-black cursor-pointer">
                      <input type="checkbox" checked={channels.g} onChange={e => setChannels(p => ({...p, g: e.target.checked}))} className="accent-green-500 rounded-sm" />
                      <span className="text-xs text-green-500 font-bold">G</span>
                  </label>
                  <label className="flex items-center gap-2 border border-zinc-800 rounded px-2 py-1 bg-black cursor-pointer">
                      <input type="checkbox" checked={channels.b} onChange={e => setChannels(p => ({...p, b: e.target.checked}))} className="accent-blue-500 rounded-sm" />
                      <span className="text-xs text-blue-500 font-bold">B</span>
                  </label>
                  <label className="flex items-center gap-2 border border-zinc-800 rounded px-2 py-1 bg-black cursor-pointer">
                      <input type="checkbox" checked={channels.a} onChange={e => setChannels(p => ({...p, a: e.target.checked}))} className="accent-zinc-400 rounded-sm" />
                      <span className="text-xs text-zinc-400 font-bold">A</span>
                  </label>
              </div>
              <p className="text-[10px] text-zinc-500 mt-2 tracking-wide font-mono">
                  Previewing: 
                  <span className={cn("ml-2", channels.r ? "text-red-500" : "opacity-30")}>R</span>
                  <span className={cn("ml-1", channels.g ? "text-green-500" : "opacity-30")}>G</span>
                  <span className={cn("ml-1", channels.b ? "text-blue-500" : "opacity-30")}>B</span>
                  <span className={cn("ml-1", channels.a ? "text-zinc-500" : "opacity-30")}>A</span>
              </p>
          </div>

          <div className="flex-1 relative h-20 rounded-lg overflow-hidden border border-zinc-700" 
             style={{
                  backgroundColor: '#09090b',
                  backgroundImage: `
                    linear-gradient(45deg, #1f1f22 25%, transparent 25%), 
                    linear-gradient(-45deg, #1f1f22 25%, transparent 25%), 
                    linear-gradient(45deg, transparent 75%, #1f1f22 75%), 
                    linear-gradient(-45deg, transparent 75%, #1f1f22 75%)`,
                  backgroundSize: '16px 16px',
                  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px'
             }}>
              <canvas 
                  ref={canvasRef} 
                  width={256} 
                  height={1} 
                  className="w-full h-full object-fill absolute inset-0"
              />
          </div>
      </div>

    </div>
  );
};
