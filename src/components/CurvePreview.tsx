import React, { useEffect, useRef, useState } from 'react';
import { ColorCurve } from '../types';
import { cn } from '../lib/utils';
import { evaluateCurve, computeTangents, InterpMode } from '../lib/curveUtils';

interface CurvePreviewProps {
  curve: ColorCurve;
  interpMode: InterpMode;
  textureData?: ImageData | null;
  sampleY?: number;
}

export const CurvePreview: React.FC<CurvePreviewProps> = ({ curve, interpMode, textureData, sampleY = 0 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [channels, setChannels] = useState({ r: true, g: true, b: true, a: true });
  const [diag, setDiag] = useState<'none' | 'heat' | 'vector' | 'luma'>('none');

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
        
        if (!channels.r || !channels.g || !channels.b || !channels.a || diag !== 'none') {
            for (let x = 0; x < width; x++) {
                const t = x / (width - 1);
                const tx = Math.min(texW - 1, Math.max(0, Math.round(t * (texW - 1))));
                const idx = tx * 4;
                
                let r8 = rowData[idx];
                let g8 = rowData[idx + 1];
                let b8 = rowData[idx + 2];
                let a8 = rowData[idx + 3];

                // Apply channel filters
                let fr = channels.r ? r8 : 0;
                let fg = channels.g ? g8 : 0;
                let fb = channels.b ? b8 : 0;
                let fa = channels.a ? a8 : 255; // If alpha is disabled, make it fully opaque to see RGB

                // Apply diagnostics if needed
                if (diag === 'luma') {
                    const luma = fr * 0.299 + fg * 0.587 + fb * 0.114;
                    fr = fg = fb = luma;
                } else if (diag === 'heat') {
                    const avg = (fr + fg + fb) / 3;
                    fr = avg > 128 ? 255 : avg * 2;
                    fg = avg;
                    fb = avg < 128 ? 255 : (255 - avg) * 2;
                }

                data[x * 4] = fr;
                data[x * 4 + 1] = fg;
                data[x * 4 + 2] = fb;
                data[x * 4 + 3] = fa;
            }
        } else {
            data.set(rowData);
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
            let t = x / (width - 1);
            
            const r = evaluateCurve(sortedCurve.r, tangents.r, t, interpMode);
            const g = evaluateCurve(sortedCurve.g, tangents.g, t, interpMode);
            const b = evaluateCurve(sortedCurve.b, tangents.b, t, interpMode);
            const a = evaluateCurve(sortedCurve.a, tangents.a, t, interpMode);

            let r8 = Math.min(255, Math.max(0, r * 255));
            let g8 = Math.min(255, Math.max(0, g * 255));
            let b8 = Math.min(255, Math.max(0, b * 255));
            let a8 = Math.min(255, Math.max(0, a * 255));

            // Apply channel filters
            let fr = channels.r ? r8 : 0;
            let fg = channels.g ? g8 : 0;
            let fb = channels.b ? b8 : 0;
            let fa = channels.a ? a8 : 255; // If alpha is disabled, make it fully opaque to see RGB

            // Apply diagnostics if needed
            if (diag === 'luma') {
                const luma = fr * 0.299 + fg * 0.587 + fb * 0.114;
                fr = fg = fb = luma;
            } else if (diag === 'heat') {
                const avg = (fr + fg + fb) / 3;
                fr = avg > 128 ? 255 : avg * 2;
                fg = avg;
                fb = avg < 128 ? 255 : (255 - avg) * 2;
            }

            data[x * 4] = fr;
            data[x * 4 + 1] = fg;
            data[x * 4 + 2] = fb;
            data[x * 4 + 3] = fa;
        }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [curve, interpMode, textureData, sampleY, channels, diag]);

  return (
    <div className="flex flex-col gap-4 bg-[#09090b] border border-zinc-800 rounded-xl p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-zinc-100 font-bold text-[11px] tracking-widest uppercase">PREVIEW <span className="text-zinc-500 font-normal normal-case tracking-normal">(Output)</span></h3>
        <div className="flex gap-3">
             <button className="text-zinc-500 hover:text-zinc-300">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path></svg>
             </button>
             <button className="text-zinc-500 hover:text-zinc-300">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
             </button>
        </div>
      </div>
      
      <div className="flex items-start justify-between gap-8">
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

          <div className="flex gap-6 mt-1 border-l border-zinc-800 pl-6 h-full items-center">
              <button 
                onClick={() => setDiag(prev => prev === 'heat' ? 'none' : 'heat')}
                className={cn("flex flex-col items-center gap-1.5 transition-colors", diag === 'heat' ? "text-indigo-400" : "text-zinc-500 hover:text-zinc-300")}
              >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                  <span className="text-[10px]">Heat</span>
              </button>
              <button 
                onClick={() => setDiag(prev => prev === 'vector' ? 'none' : 'vector')}
                className={cn("flex flex-col items-center gap-1.5 transition-colors", diag === 'vector' ? "text-indigo-400" : "text-zinc-500 hover:text-zinc-300")}
              >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                  <span className="text-[10px]">Vector</span>
              </button>
              <button 
                onClick={() => setDiag(prev => prev === 'luma' ? 'none' : 'luma')}
                className={cn("flex flex-col items-center gap-1.5 transition-colors", diag === 'luma' ? "text-indigo-400" : "text-zinc-500 hover:text-zinc-300")}
              >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                  <span className="text-[10px]">Luma</span>
              </button>
          </div>

          <div className="flex-1 ml-6 relative h-20 rounded-lg overflow-hidden border border-zinc-700" 
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
              <button className="absolute bottom-1 right-1 w-4 h-4 rounded-full border border-zinc-500 flex items-center justify-center text-zinc-400 text-[10px]">i</button>
          </div>
      </div>

    </div>
  );
};

