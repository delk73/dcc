import React, { useState, useEffect, useMemo, useRef } from 'react';
import { get, set } from 'idb-keyval';
import { ColorCurve, Channel, LibraryCurve } from './types';
import { CurveEditor } from './components/CurveEditor';
import { CurvePreview } from './components/CurvePreview';
import { Plus, Layers, Settings2 } from 'lucide-react';
import { cn } from './lib/utils';
import { motion } from 'motion/react';
import { InterpMode, computeTangents, evaluateCurve, blendSpaceCurves } from './lib/curveUtils';
import {
  POSITION_EPSILON,
  clampSpacePosition,
  cloneCurve,
  evaluateSpaceAt,
  normalizeAnchors,
  snapToAnchorIfClose,
  sortAnchors
} from './lib/spaceUtils';
import { insertTextChunk } from './lib/pngUtils';

const EXPORT_ATLAS_SIZE = { width: 256, height: 32 };

const initialCurve: ColorCurve = {
  r: [{ time: 0, value: 0 }, { time: 1, value: 1 }],
  g: [{ time: 0, value: 0 }, { time: 1, value: 1 }],
  b: [{ time: 0, value: 0 }, { time: 1, value: 1 }],
  a: [{ time: 0, value: 1 }, { time: 1, value: 1 }]
};

import { AtlasViewer } from './components/AtlasViewer';

export default function App() {
  const [library, setLibrary] = useState<LibraryCurve[]>([]);
  const [mainView, setMainView] = useState<'curve' | '2d' | '3d'>('curve');
  const continuumTrackRef = useRef<HTMLDivElement>(null);
  const anchorsRef = useRef<LibraryCurve[]>([]);
  const [draggingAnchorId, setDraggingAnchorId] = useState<string | null>(null);
  
  const [curveState, setCurveState] = useState({ lever: 0 });
  const [state2d, setState2d] = useState({ lever: 0 });
  const [state3d, setState3d] = useState({ lever: 0 });
  
  const [atlasTexture, setAtlasTexture] = useState<ImageData | null>(null);

  const activeControlState = mainView === 'curve' ? curveState : (mainView === '2d' ? state2d : state3d);
  const spaceLever = activeControlState.lever;

  const setRawSpacePosition = (val: number) => {
      const nextPosition = clampSpacePosition(val);
      if (mainView === 'curve') setCurveState(prev => ({...prev, lever: nextPosition}));
      else if (mainView === '2d') setState2d(prev => ({...prev, lever: nextPosition}));
      else setState3d(prev => ({...prev, lever: nextPosition}));
  };

  const [activeChannel, setActiveChannel] = useState<Channel>('r');
  const [interpMode, setInterpMode] = useState<InterpMode>('cubic');

  // Load from local storage / indexedDB
  useEffect(() => {
    const loadState = async () => {
      try {
        let savedLibrary = await get('curve-library');
        
        // Migrate from localStorage if idb is empty
        if (!savedLibrary || savedLibrary.length === 0) {
            const lsData = localStorage.getItem('curve-library');
            if (lsData) {
                try {
                    savedLibrary = JSON.parse(lsData);
                    await set('curve-library', savedLibrary); // Save it to indexedDB for next time
                } catch (e) {
                    console.error("Migration parse error", e);
                }
            }
        }

        if (savedLibrary && savedLibrary.length > 0) {
          setLibrary(savedLibrary);
          
          // Load UX state
          const uxState = await get('curve-ux-state');
          if (uxState) {
            
            if (uxState.interpMode) setInterpMode(uxState.interpMode);
            if (uxState.mainView) setMainView(uxState.mainView);
            if (uxState.activeChannel) setActiveChannel(uxState.activeChannel);
          }
        } else {
          // Default initial curve
          const defaultCurve: LibraryCurve = { id: crypto.randomUUID(), name: 'Default Sweep', category: 'Basic', position: 0, curve: initialCurve };
          setLibrary([defaultCurve]);
        }
      } catch (e) {
        console.error("Failed to load state", e);
      }
    };
    loadState();
  }, []);

  // Save to indexedDB whenever library changes
  useEffect(() => {
    if (library.length > 0) {
      set('curve-library', library).catch(console.error);
    }
  }, [library]);

  // Save UX state
  useEffect(() => {
    const uxState = {
       interpMode,
       mainView,
       activeChannel
    };
    set('curve-ux-state', uxState).catch(console.error);
  }, [interpMode, mainView, activeChannel]);

  const activeCategoryCurves = useMemo(() => {
    return [...library].sort((a,b) => (a.position||0) - (b.position||0));
  }, [library]);
  
  // Ensure default position parameters exist (for backwards compat)
  const normalizedCategoryCurves = useMemo(() => {
     return normalizeAnchors(activeCategoryCurves);
  }, [activeCategoryCurves]);

  anchorsRef.current = normalizedCategoryCurves;

  const setSpacePosition = (position: number) => {
    setRawSpacePosition(snapToAnchorIfClose(position, normalizedCategoryCurves));
  };

  const getTrackPosition = (clientX: number) => {
    const rect = continuumTrackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return spaceLever;
    return clampSpacePosition((clientX - rect.left) / rect.width);
  };

  const clampAnchorPosition = (anchorId: string, position: number, anchors: LibraryCurve[]) => {
    const sorted = sortAnchors(anchors);
    const anchorIndex = sorted.findIndex(anchor => anchor.id === anchorId);
    if (anchorIndex === -1) return clampSpacePosition(position);

    const min = anchorIndex > 0 ? sorted[anchorIndex - 1].position + POSITION_EPSILON : 0;
    const max = anchorIndex < sorted.length - 1 ? sorted[anchorIndex + 1].position - POSITION_EPSILON : 1;
    return Math.max(min, Math.min(max, clampSpacePosition(position)));
  };

  const moveAnchor = (anchorId: string, position: number) => {
    const nextPosition = clampAnchorPosition(anchorId, position, anchorsRef.current);
    setRawSpacePosition(nextPosition);
    setLibrary(prev => sortAnchors(prev.map(anchor =>
      anchor.id === anchorId ? { ...anchor, position: nextPosition } : anchor
    )));
  };

  const handleAnchorPointerDown = (e: React.PointerEvent<HTMLDivElement>, anchorId: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDraggingAnchorId(anchorId);
    moveAnchor(anchorId, getTrackPosition(e.clientX));
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleAnchorPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingAnchorId) return;
    e.preventDefault();
    moveAnchor(draggingAnchorId, getTrackPosition(e.clientX));
  };

  const handleAnchorPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingAnchorId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDraggingAnchorId(null);
  };

  const spaceCurves = normalizedCategoryCurves;

  const activeSpaceCurve = spaceCurves.length > 0 
    ? blendSpaceCurves(spaceCurves, spaceLever, interpMode)
    : initialCurve;

  const deferredActiveSpaceCurve = React.useDeferredValue(activeSpaceCurve);

  const updateActiveCurve = (newCurve: ColorCurve) => {
    const editPosition = clampSpacePosition(spaceLever);

    setLibrary(prev => {
      const anchors = normalizeAnchors(prev);
      const existingAnchor = anchors.find(anchor => Math.abs(anchor.position - editPosition) <= POSITION_EPSILON);

      if (existingAnchor) {
        return sortAnchors(prev.map(anchor =>
          anchor.id === existingAnchor.id
            ? { ...anchor, position: existingAnchor.position, curve: cloneCurve(newCurve), authored: true }
            : anchor
        ));
      }

      const derivedCurve = evaluateSpaceAt(editPosition, anchors, interpMode, initialCurve);
      const newEntry: LibraryCurve = {
        id: crypto.randomUUID(),
        name: `Anchor ${anchors.length + 1}`,
        category: anchors[0]?.category ?? 'default',
        position: editPosition,
        curve: cloneCurve(newCurve ?? derivedCurve),
        authored: true,
        source: 'implicit-edit'
      };

      return sortAnchors([...prev, newEntry]);
    });
  };

  const categoryGradient = useMemo(() => {
    if (normalizedCategoryCurves.length === 0) return 'none';
    
    const spaceCurves = normalizedCategoryCurves.map(c => ({ position: c.position || 0, curve: c.curve }));

    const getColorAtTime = (cv: ColorCurve, t: number) => {
        const tr = computeTangents(cv.r);
        const tg = computeTangents(cv.g);
        const tb = computeTangents(cv.b);
        const r = Math.round(evaluateCurve(cv.r, tr, t, interpMode) * 255);
        const g = Math.round(evaluateCurve(cv.g, tg, t, interpMode) * 255);
        const b = Math.round(evaluateCurve(cv.b, tb, t, interpMode) * 255);
        return `rgb(${Math.max(0,Math.min(255,r))},${Math.max(0,Math.min(255,g))},${Math.max(0,Math.min(255,b))})`;
    };

    const numStops = 12;
    const stops = [];
    for (let i = 0; i <= numStops; i++) {
        const p = i / numStops;
        const color = getColorAtTime(blendSpaceCurves(spaceCurves, p, interpMode), 0.5);
        stops.push(`${color} ${p * 100}%`);
    }

    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [normalizedCategoryCurves, interpMode]);

  const handleExportLibraryLUT = () => {
    if (normalizedCategoryCurves.length === 0) return;
    
    const width = EXPORT_ATLAS_SIZE.width;
    const height = EXPORT_ATLAS_SIZE.height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
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
            const curveObj = blendSpaceCurves(spaceCurves, tSpace, interpMode);
            
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
                data[idx] = Math.min(255, Math.max(0, r * 255));
                data[idx + 1] = Math.min(255, Math.max(0, g * 255));
                data[idx + 2] = Math.min(255, Math.max(0, b * 255));
                data[idx + 3] = Math.min(255, Math.max(0, a * 255));
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
    }
    const url = canvas.toDataURL('image/png');
    
    // Embed provenance directly into the PNG tEXt chunk
    const metadataJSON = JSON.stringify(normalizedCategoryCurves.map(c => ({
      name: c.name,
      category: c.category,
      position: c.position,
      curve: c.curve
    })));

    const finalUrl = insertTextChunk(url, 'Provenance', metadataJSON);

    const a = document.createElement('a');
    a.href = finalUrl;
    a.download = `SpaceAtlas_export.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(finalUrl), 0);
  };

  const channelInfo = [
    { id: 'r', label: 'Red', color: 'bg-red-500' },
    { id: 'g', label: 'Green', color: 'bg-green-500' },
    { id: 'b', label: 'Blue', color: 'bg-blue-500' },
    { id: 'a', label: 'Alpha', color: 'bg-stone-400' },
  ];

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-indigo-500/30">
      <div className="max-w-[1400px] mx-auto p-4 sm:p-8 space-y-8">
        
        {/* Top Navbar */}
        <header className="flex items-center gap-6 pb-6 border-b border-white/5">
          <h1 className="text-xl font-bold tracking-tight text-white mr-4">Curve Composer</h1>
          
          <div className="flex bg-black border border-zinc-800 rounded-lg p-1 overflow-hidden">
             <button 
                onClick={() => setMainView('curve')}
                className={cn("px-5 py-2 text-sm font-medium transition-colors", mainView === 'curve' ? 'bg-[#1a1c2e] text-indigo-400' : 'text-zinc-400 hover:text-zinc-200')}
             >
                1D Curve
             </button>
             <button 
                onClick={() => setMainView('2d')}
                className={cn("px-5 py-2 text-sm font-medium transition-colors border-l border-zinc-800", mainView === '2d' ? 'bg-[#1a1c2e] text-indigo-400' : 'text-zinc-400 hover:text-zinc-200')}
             >
                2D Atlas
             </button>
             <button 
                onClick={() => setMainView('3d')}
                className={cn("px-5 py-2 text-sm font-medium transition-colors border-l border-zinc-800", mainView === '3d' ? 'bg-[#1a1c2e] text-indigo-400' : 'text-zinc-400 hover:text-zinc-200')}
             >
                3D Volume
             </button>
          </div>

          <div className="flex items-center gap-2 mx-auto">
             <button className="w-10 h-10 flex items-center justify-center rounded-md border border-indigo-500/50 bg-indigo-500/10 text-indigo-400">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path></svg>
             </button>
             <button className="w-10 h-10 flex items-center justify-center rounded-md border border-zinc-800 bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"></path><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"></path><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"></path><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path></svg>
             </button>
             <button className="w-10 h-10 flex items-center justify-center rounded-md border border-zinc-800 bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300">
                <Plus className="w-5 h-5" />
             </button>
             <button className="w-10 h-10 flex items-center justify-center rounded-md border border-zinc-800 bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M9 19l3 3 3-3M19 9l3 3-3 3M2 12h20M12 2v20"></path></svg>
             </button>
             <button className="w-10 h-10 flex items-center justify-center rounded-md border border-zinc-800 bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3h18v18H3zM8 3v18M16 3v18M3 8h18M3 16h18"></path></svg>
             </button>
             
             <div className="ml-4 flex items-center justify-center border border-zinc-800 rounded-md px-4 py-1.5 bg-black gap-3">
                 <div className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
                 <div className="flex flex-col">
                    <span className="text-xs font-semibold text-zinc-200 leading-tight">Point Editor</span>
                    <span className="text-[10px] text-zinc-500 leading-tight">Under Construction</span>
                 </div>
             </div>
          </div>

          <div className="flex items-center gap-4">
             <button className="text-zinc-500 hover:text-zinc-300">
                 <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"></path></svg>
             </button>
             <button className="text-zinc-500 hover:text-zinc-300">
                 <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"></path></svg>
             </button>
             <button className="text-zinc-500 hover:text-zinc-300 border border-zinc-800 bg-[#09090b] rounded p-2">
                 <Settings2 className="w-5 h-5" />
             </button>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-8 items-start xl:grid-cols-[1fr_320px]">
            
          {/* Main Area (Editor + Generate) */}
          <div className={cn("space-y-8", "min-w-0")}>
            



            {mainView === 'curve' && (
              <div className="flex flex-col gap-8">
              <div className="grid grid-cols-1 gap-8">
                  <CurvePreview 
                      curve={activeSpaceCurve} 
                      interpMode={interpMode} 
                      textureData={atlasTexture}
                      sampleY={spaceLever}
                  />
              </div>

              <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 pb-2 space-y-4">
                 <div className="flex items-center justify-between">
                     <h3 className="text-[11px] uppercase tracking-widest font-bold text-zinc-300">Curve Editor</h3>
                     <div className="flex items-center gap-3 text-xs">
                          <span className="text-zinc-500">Interpolation</span>
                          <select
                              value={interpMode}
                              onChange={(e) => setInterpMode(e.target.value as InterpMode)}
                              className="bg-black border border-zinc-800 text-zinc-300 rounded px-3 py-1.5 outline-none focus:border-indigo-500/50 appearance-none"
                          >
                              <option value="linear">Linear</option>
                              <option value="cubic">Cubic (Hermite)</option>
                              <option value="constant">Constant (Stepped)</option>
                          </select>
                          <svg className="w-3 h-3 text-zinc-500 -ml-8 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"></path></svg>
                          <button className="h-7 px-2 ml-4 flex items-center justify-center rounded border border-zinc-800 bg-black text-zinc-400 hover:text-white">
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
                          </button>
                     </div>
                 </div>

                 <CurveEditor curve={activeSpaceCurve} onChange={updateActiveCurve} activeChannel={activeChannel} interpMode={interpMode} />
              </div>
                
                {/* 3 Panels: Edit Filter, View Context, Diagnostics */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
                        <h3 className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 border-b border-zinc-800 pb-2">Edit Filter <span className="font-normal normal-case text-zinc-600">(Affects which channels you edit)</span></h3>
                        <div className="flex gap-2">
                             {channelInfo.map((ci) => (
                                <button
                                    key={ci.id}
                                    onClick={() => setActiveChannel(ci.id as Channel)}
                                    className={cn(
                                    "flex-1 py-1.5 rounded-lg text-xs font-medium transition-all border flex items-center justify-center gap-2",
                                    activeChannel === ci.id 
                                        ? `bg-zinc-800 border-zinc-700 text-white shadow-sm` 
                                        : "bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                                    )}
                                >
                                    <span className={cn("w-2 h-2 rounded-full", ci.color)} />
                                    {ci.label.charAt(0)}
                                </button>
                             ))}
                        </div>
                        <p className="text-[10px] text-zinc-500 pt-1">All channels enabled. Filter limits available targets.</p>
                    </div>

                    <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
                        <h3 className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 border-b border-zinc-800 pb-2">View Context <span className="font-normal normal-case text-zinc-600">(Affects which curves you see)</span></h3>
                        <div className="flex bg-black border border-zinc-800 rounded-lg p-0.5">
                            <button className="flex-1 py-1.5 text-[11px] font-medium bg-zinc-800 text-white rounded-md shadow-sm">Show All</button>
                            <button className="flex-1 py-1.5 text-[11px] font-medium text-zinc-500 hover:text-white transition-colors">Focus Filtered</button>
                            <button className="flex-1 py-1.5 text-[11px] font-medium text-zinc-500 hover:text-white transition-colors">Ghost Inactive</button>
                            <button className="flex-1 py-1.5 text-[11px] font-medium text-zinc-500 hover:text-white transition-colors">Hide Inactive</button>
                        </div>
                        <p className="text-[10px] text-zinc-500 pt-1">All channels visible. Inactive channels are ghosted.</p>
                    </div>

                    <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
                        <h3 className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 border-b border-zinc-800 pb-2">Diagnostics <span className="font-normal normal-case text-zinc-600">(Preview overlay modes)</span></h3>
                        <div className="flex bg-black border border-zinc-800 rounded-lg p-0.5">
                            <button className="flex-1 py-1.5 text-[11px] font-medium text-zinc-500 hover:text-white transition-colors">Heat</button>
                            <button className="flex-1 py-1.5 text-[11px] font-medium text-zinc-500 hover:text-white transition-colors">Vector</button>
                            <button className="flex-1 py-1.5 text-[11px] font-medium text-zinc-500 hover:text-white transition-colors">Luma</button>
                        </div>
                        <p className="text-[10px] text-zinc-500 pt-1">Diagnostics replace the preview output.</p>
                    </div>
                </div>

                {/* Space Continuum */}
                <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <h3 className="text-xs uppercase tracking-wider font-bold text-zinc-300">Space Continuum <span className="text-zinc-600 font-normal normal-case">(1D)</span></h3>
                        </div>
                        <div className="flex items-center gap-6 text-[11px] text-zinc-400">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-white shadow-sm" /> Authored Anchor
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full border border-zinc-500 bg-transparent" /> Interpolated Position
                            </div>
                        </div>
                    </div>
                    
                    <div ref={continuumTrackRef} className="relative pt-6 pb-8 mx-4">
                         <div className="absolute top-1/2 -mt-1 left-0 right-0 h-2 rounded-full overflow-hidden opacity-50" style={{ background: categoryGradient }} />
                         
                         {/* Axis labels */}
                         <div className="absolute top-full text-[10px] text-zinc-500 font-mono w-full flex justify-between mt-2 px-1">
                             <div className="flex flex-col"><span className="text-zinc-300">0.00</span>Start</div>
                             <div>0.25</div>
                             <div>0.50</div>
                             <div>0.75</div>
                             <div className="flex flex-col items-end"><span className="text-zinc-300">1.00</span>End</div>
                         </div>
                         
                         {/* Anchor Ticks */}
                         <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 pointer-events-none z-40">
                             {normalizedCategoryCurves.map((c, i) => (
                                 <div 
                                    key={c.id}
                                    role="slider"
                                    aria-label={`Authored anchor at ${(c.position || 0).toFixed(2)}`}
                                    aria-valuemin={0}
                                    aria-valuemax={1}
                                    aria-valuenow={c.position || 0}
                                    tabIndex={0}
                                    className={cn(
                                      "pointer-events-auto absolute w-5 h-5 -mt-2.5 -ml-2.5 rounded-full cursor-grab active:cursor-grabbing",
                                      "flex items-center justify-center touch-none"
                                    )}
                                    style={{ left: `${(c.position || 0) * 100}%` }}
                                    onPointerDown={(e) => handleAnchorPointerDown(e, c.id)}
                                    onPointerMove={handleAnchorPointerMove}
                                    onPointerUp={handleAnchorPointerUp}
                                    onPointerCancel={handleAnchorPointerUp}
                                 >
                                    <div className={cn(
                                      "w-3 h-3 rounded-full bg-white shadow-md border-2 border-zinc-900 transition-transform",
                                      draggingAnchorId === c.id && "scale-125"
                                    )} />
                                 </div>
                             ))}
                         </div>
                         
                         <input 
                              type="range" 
                              list="variant-ticks"
                              min="0" max="1" step="0.001"
                              value={spaceLever}
                              onChange={(e) => setSpacePosition(parseFloat(e.target.value))}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30"
                            />
                            
                         {/* Custom thumb to represent the scrubber */}
                         <div className="absolute top-2 bottom-2 pointer-events-none w-4 bg-indigo-500/20 border border-indigo-500/50 rounded -ml-2 z-20 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.2)]" style={{ left: `${spaceLever * 100}%` }}>
                             <div className="w-1.5 h-6 bg-indigo-400 rounded-full" />
                         </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mt-2">
                        <div className="flex gap-4">
                            <span>X: {spaceLever.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                           <span>Zoom</span>
                           <div className="flex items-center border border-zinc-800 rounded-md bg-black">
                               <button className="px-2 py-1 hover:text-white transition-colors">-</button>
                               <span className="px-2 text-zinc-300">100%</span>
                               <button className="px-2 py-1 hover:text-white transition-colors">+</button>
                           </div>
                        </div>
                    </div>
                </div>

            </div>
            )}
            
            {mainView === '2d' && (
                <div className="flex flex-col gap-8 h-full min-h-[500px]">
                    <motion.div layout className="flex-1 flex flex-col gap-8">
                        <AtlasViewer 
                            curves={spaceCurves} 
                            interpMode={interpMode} 
                            spaceLever={spaceLever} 
                            setSpaceLever={setSpacePosition}
                            onTextureUpdate={setAtlasTexture}
                            onExportAtlas={handleExportLibraryLUT}
                            canExportAtlas={normalizedCategoryCurves.length > 1}
                        />
                        <motion.div
                            layout
                            className="flex flex-col gap-8"
                        >
                            <CurvePreview
                                curve={activeSpaceCurve}
                                interpMode={interpMode}
                                textureData={atlasTexture}
                                sampleY={spaceLever}
                            />

                        </motion.div>
                    </motion.div>
                </div>
            )}

            {mainView === '3d' && (
                <div className="flex flex-col items-center justify-center p-12 text-zinc-500 border border-zinc-800 border-dashed rounded-xl h-96 bg-zinc-900/50">
                   <Layers className="w-12 h-12 mb-4 opacity-30" />
                   <h3 className="text-xl font-medium text-zinc-300">3D Volume Generation</h3>
                   <p className="text-sm mt-3 max-w-md text-center leading-relaxed">
                     Generate entire sets of variant spaces to build a fully procedural Volume texture (3D LUT). 
                     This feature evaluates batch matrices seamlessly mapping along an additional Z-axis dimension.
                   </p>
                   <button className="px-4 py-2 mt-6 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md text-sm border border-zinc-700 transition-colors pointer-events-none opacity-50">
                     Under Construction
                   </button>
                </div>
            )}

          </div>
          
          {/* Right Rail Sidebar */}
          <div className="flex flex-col gap-6 sticky top-8 transition-opacity duration-300">
             <div className="bg-[#09090b] flex flex-col min-h-[500px]">
                 <div className="p-4 border-b border-zinc-800 flex items-center justify-between pb-6">
                     <h3 className="font-bold text-xs tracking-widest uppercase text-white">Point Editor</h3>
                     <button className="text-zinc-600 hover:text-white transition-colors">
                         <span className="sr-only">Close</span>
                         <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
                     </button>
                 </div>
                 
                 <div className="px-4 py-6 border-b border-zinc-800 flex items-center justify-between">
                     <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                        <span className="text-xs font-bold tracking-widest uppercase text-zinc-300">1 POINT SELECTED</span>
                     </div>
                     <span className="text-xs text-blue-500 font-mono tracking-tight">Position {spaceLever.toFixed(2)}</span>
                 </div>

                 <div className="px-4 py-6 space-y-6 flex-1 text-sm font-medium">
                     <div className="flex items-center justify-between gap-4">
                         <label className="text-zinc-400">Type</label>
                         <select className="bg-black border border-zinc-800 rounded px-3 py-1.5 text-zinc-300 outline-none w-3/5">
                             <option>Smooth</option>
                             <option>Linear</option>
                             <option>Constant</option>
                         </select>
                     </div>
                     <div className="flex items-center justify-between gap-4">
                         <label className="text-zinc-400">Interpolation</label>
                         <select className="bg-black border border-zinc-800 rounded px-3 py-1.5 text-zinc-300 outline-none w-3/5 text-xs">
                             <option>Cubic (Hermite)</option>
                             <option>Catmull-Rom</option>
                             <option>Linear</option>
                         </select>
                     </div>

                     <div className="space-y-4 pt-4 border-t border-zinc-800">
                         <div className="flex items-center justify-between gap-4">
                             <label className="text-zinc-400">Tension</label>
                             <div className="flex items-center gap-2 flex-1">
                                 <input type="range" className="flex-1 h-1 bg-zinc-800 accent-blue-500 rounded appearance-none cursor-pointer" defaultValue={0} min={-1} max={1} step={0.01} />
                                 <div className="bg-black border border-zinc-800 px-2 py-1 rounded w-12 text-center text-xs text-zinc-300 font-mono">0.00</div>
                             </div>
                         </div>
                         <div className="flex items-center justify-between gap-4">
                             <label className="text-zinc-400">Continuity</label>
                             <div className="flex items-center gap-2 flex-1">
                                 <input type="range" className="flex-1 h-1 bg-zinc-800 accent-blue-500 rounded appearance-none cursor-pointer" defaultValue={0} min={-1} max={1} step={0.01} />
                                 <div className="bg-black border border-zinc-800 px-2 py-1 rounded w-12 text-center text-xs text-zinc-300 font-mono">0.00</div>
                             </div>
                         </div>
                         <div className="flex items-center justify-between gap-4">
                             <label className="text-zinc-400">Bias</label>
                             <div className="flex items-center gap-2 flex-1">
                                 <input type="range" className="flex-1 h-1 bg-zinc-800 accent-blue-500 rounded appearance-none cursor-pointer" defaultValue={0} min={-1} max={1} step={0.01} />
                                 <div className="bg-black border border-zinc-800 px-2 py-1 rounded w-12 text-center text-xs text-zinc-300 font-mono">0.00</div>
                             </div>
                         </div>
                     </div>

                     <div className="space-y-4 pt-4 border-t border-zinc-800">
                         <label className="text-zinc-400 mb-2 block">Behavior</label>
                         
                         <div className="flex items-center justify-between">
                             <label className="flex items-center gap-3 cursor-pointer">
                                 <div className="w-4 h-4 rounded border border-zinc-700 bg-black flex items-center justify-center">
                                 </div>
                                 <span className="text-zinc-300 text-sm">Compression Protected</span>
                             </label>
                             <svg className="w-4 h-4 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0110 0v4"></path></svg>
                         </div>
                         <div className="flex items-center justify-between">
                             <label className="flex items-center gap-3 cursor-pointer">
                                 <div className="w-4 h-4 rounded border border-zinc-700 bg-black flex items-center justify-center">
                                 </div>
                                 <span className="text-zinc-300 text-sm">Derived (Auto)</span>
                             </label>
                             <svg className="w-4 h-4 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                         </div>
                         <div className="flex items-center justify-between">
                             <label className="flex items-center gap-3 cursor-pointer">
                                 <div className="w-4 h-4 rounded border border-zinc-700 bg-black flex items-center justify-center">
                                 </div>
                                 <span className="text-zinc-300 text-sm">Procedural</span>
                             </label>
                             <svg className="w-4 h-4 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                         </div>
                     </div>

                     <div className="space-y-4 pt-4 border-t border-zinc-800">
                         <label className="text-zinc-400 block text-xs">Neighborhood Influence</label>
                         <div className="flex items-center gap-4">
                             <input type="range" className="flex-1 h-1 bg-zinc-800 accent-blue-500 rounded appearance-none cursor-pointer" defaultValue={1} min={0} max={2} step={0.01} />
                             <div className="bg-black border border-zinc-800 px-2 py-1 rounded w-12 text-center text-xs text-zinc-300 font-mono">1.00</div>
                         </div>
                     </div>
                     
                     <div className="space-y-2 pt-4 border-t border-zinc-800">
                         <label className="text-zinc-400 block text-xs">Notes</label>
                         <textarea 
                             className="w-full bg-black border border-zinc-800 rounded-md p-3 text-sm text-zinc-300 outline-none resize-none h-16 placeholder:text-zinc-700" 
                             placeholder="Add note..."
                         />
                     </div>
                 </div>
             </div>
          </div>
        </div>

      </div>
    </div>
  );
}
