import React, { useState } from 'react';
import { ColorCurve } from '../types';
import { Check, Copy, Download } from 'lucide-react';
import { cn } from '../lib/utils';

import { InterpMode, evaluateCurve, computeTangents } from '../lib/curveUtils';

interface CurveExporterProps {
    curve: ColorCurve;
    interpMode: InterpMode;
}

type ExportFormat = 'unreal' | 'unity' | 'generic';

export const CurveExporter: React.FC<CurveExporterProps> = ({ curve, interpMode }) => {
    const [copied, setCopied] = useState(false);
    const [format, setFormat] = useState<ExportFormat>('unreal');
    
    const exportUECurve = (c: ColorCurve) => {
        const getUEInterp = (mode: InterpMode) => {
            if (mode === 'constant') return "RCIM_Constant";
            if (mode === 'linear') return "RCIM_Linear";
            return "RCIM_Cubic";
        };
        const ueInterp = getUEInterp(interpMode);
        const mapKeys = (keys: {time: number, value: number}[]) => {
            return keys.sort((a, b) => a.time - b.time).map(k => ({
                "interpMode": ueInterp,
                "tangentMode": "RCTM_Auto",
                "tangentWeightMode": "RCTWM_WeightedNone",
                "time": k.time,
                "value": k.value,
                "arriveTangent": 0,
                "arriveTangentWeight": 0,
                "leaveTangent": 0,
                "leaveTangentWeight": 0
            }));
        };
        
        return JSON.stringify({
            "floatCurves": [
                {
                    "keys": mapKeys(c.r),
                    "defaultValue": 3.4028234663852886e+38,
                    "preInfinityExtrap": "RCCE_Constant",
                    "postInfinityExtrap": "RCCE_Constant"
                },
                {
                    "keys": mapKeys(c.g),
                    "defaultValue": 3.4028234663852886e+38,
                    "preInfinityExtrap": "RCCE_Constant",
                    "postInfinityExtrap": "RCCE_Constant"
                },
                {
                    "keys": mapKeys(c.b),
                    "defaultValue": 3.4028234663852886e+38,
                    "preInfinityExtrap": "RCCE_Constant",
                    "postInfinityExtrap": "RCCE_Constant"
                },
                {
                    "keys": mapKeys(c.a),
                    "defaultValue": 3.4028234663852886e+38,
                    "preInfinityExtrap": "RCCE_Constant",
                    "postInfinityExtrap": "RCCE_Constant"
                }
            ],
            "adjustHue": 0,
            "adjustSaturation": 1,
            "adjustBrightness": 1,
            "adjustBrightnessCurve": 1,
            "adjustVibrance": 0,
            "adjustMinAlpha": 0,
            "adjustMaxAlpha": 1,
            "assetImportData": {
                "_ClassName": "/Script/Engine.AssetImportData",
                "sourceData": {}
            }
        }, null, '\t');
    };

    const exportGenericCurve = (c: ColorCurve) => {
        return JSON.stringify(c, null, 2);
    };

    const exportUnityCurve = (c: ColorCurve) => {
        const mapKeys = (keys: {time: number, value: number}[]) => {
            return keys.sort((a, b) => a.time - b.time).map(k => ({
                "time": k.time,
                "value": k.value,
                "inTangent": 0,
                "outTangent": 0,
                "tangentMode": 0
            }));
        };
        return JSON.stringify({
            "curveR": mapKeys(c.r),
            "curveG": mapKeys(c.g),
            "curveB": mapKeys(c.b),
            "curveA": mapKeys(c.a)
        }, null, 2);
    };

    const getExportText = () => {
        if (format === 'unreal') return exportUECurve(curve);
        if (format === 'generic') return exportGenericCurve(curve);
        if (format === 'unity') return exportUnityCurve(curve);
        return '';
    };

    const handleCopy = async () => {
        const text = getExportText();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
        const text = getExportText();
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ColorCurve_${format}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleDownloadLUT = () => {
        const width = 256;
        const height = 1;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;
        
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

        for(let x=0; x<width; x++) {
            const t = x / (width - 1);
            const r = evaluateCurve(sortedCurve.r, tangents.r, t, interpMode);
            const g = evaluateCurve(sortedCurve.g, tangents.g, t, interpMode);
            const b = evaluateCurve(sortedCurve.b, tangents.b, t, interpMode);
            const a = evaluateCurve(sortedCurve.a, tangents.a, t, interpMode);
            
            const idx = x * 4;
            data[idx] = Math.min(255, Math.max(0, r * 255));
            data[idx + 1] = Math.min(255, Math.max(0, g * 255));
            data[idx + 2] = Math.min(255, Math.max(0, b * 255));
            data[idx + 3] = Math.min(255, Math.max(0, a * 255));
        }
        
        ctx.putImageData(imageData, 0, 0);
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ColorCurve_LUT.png';
        a.click();
    };

    return (
        <div className="flex flex-col gap-4 flex-1">
            <div className="flex flex-col gap-2">
                <p className="text-xs text-zinc-400 font-medium pb-1">1D LUT Texture (.png)</p>
                <div className="flex items-center gap-4 bg-[#09090b] border border-zinc-800 rounded-lg p-3">
                    <div 
                        className="flex-1 h-3 rounded shadow-inner overflow-hidden" 
                        style={(() => {
                            const sorted = {
                                r: [...curve.r].sort((a, b) => a.time - b.time),
                                g: [...curve.g].sort((a, b) => a.time - b.time),
                                b: [...curve.b].sort((a, b) => a.time - b.time),
                                a: [...curve.a].sort((a, b) => a.time - b.time)
                            };
                            const tang = {
                                r: computeTangents(sorted.r),
                                g: computeTangents(sorted.g),
                                b: computeTangents(sorted.b),
                                a: computeTangents(sorted.a)
                            };
                            const stops = Array.from({length: 10}).map((_, i) => {
                                const t = i / 9;
                                const r = Math.round(evaluateCurve(sorted.r, tang.r, t, interpMode) * 255);
                                const g = Math.round(evaluateCurve(sorted.g, tang.g, t, interpMode) * 255);
                                const b = Math.round(evaluateCurve(sorted.b, tang.b, t, interpMode) * 255);
                                const a = Math.round(evaluateCurve(sorted.a, tang.a, t, interpMode) * 255);
                                return `rgba(${Math.max(0, Math.min(255, r))}, ${Math.max(0, Math.min(255, g))}, ${Math.max(0, Math.min(255, b))}, ${Math.max(0, Math.min(255, a)) / 255}) ${t * 100}%`;
                            });
                            return { background: `linear-gradient(to right, ${stops.join(', ')})` };
                        })()}
                    />
                    <button 
                        onClick={handleDownloadLUT}
                        className="flex shrink-0 items-center justify-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-white text-black hover:bg-zinc-200 rounded-md transition-colors"
                    >
                        <Download className="w-3.5 h-3.5" />
                        Save PNG
                    </button>
                </div>
            </div>

            <div className="h-px bg-zinc-800 w-full my-1" />

            <div className="flex flex-col gap-2 flex-1">
                <p className="text-xs text-zinc-400 font-medium pb-1">Curve JSON (.json)</p>
                <div className="flex bg-[#09090b] rounded-lg p-1 border border-zinc-800">
                    <button 
                      onClick={() => setFormat('unreal')}
                      className={cn("flex-1 py-1.5 text-xs font-medium rounded-md transition-all", format === 'unreal' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300')}
                    >
                      Unreal Engine
                    </button>
                    <button 
                      onClick={() => setFormat('unity')}
                      className={cn("flex-1 py-1.5 text-xs font-medium rounded-md transition-all", format === 'unity' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300')}
                    >
                      Unity
                    </button>
                    <button 
                      onClick={() => setFormat('generic')}
                      className={cn("flex-1 py-1.5 text-xs font-medium rounded-md transition-all", format === 'generic' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300')}
                    >
                      Generic JSON
                    </button>
                </div>

                <pre className="bg-[#09090b] text-zinc-400 text-xs p-4 rounded-lg overflow-auto max-h-64 scrollbar-thin scrollbar-thumb-zinc-700 flex-1 min-h-[10rem]">
                    {getExportText()}
                </pre>

                <div className="flex gap-2">
                    <button 
                        onClick={handleCopy}
                        className="flex-1 flex justify-center items-center gap-2 px-3 py-2 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-colors"
                    >
                        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button 
                        onClick={handleDownload}
                        className="flex-1 flex justify-center items-center gap-2 px-3 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        Download
                    </button>
                </div>
            </div>
        </div>
    );
};
