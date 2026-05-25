import React, { useReducer, useState, useEffect, useMemo, useRef } from 'react';
import { get, set } from 'idb-keyval';
import { ColorCurve, Channel, CurvePoint, LibraryCurve } from './types';
import { CurveEditor } from './components/CurveEditor';
import { CurveImportPanel } from './components/CurveImportPanel';
import { CurvePreview } from './components/CurvePreview';
import { PointInspector } from './components/PointInspector';
import { Layers, RotateCcw, Settings2 } from 'lucide-react';
import { cn } from './lib/utils';
import { InterpMode, computeTangents, evaluateCurve, blendSpaceCurves } from './lib/curveUtils';
import {
  POSITION_EPSILON,
  clampSpacePosition,
  cloneCurve,
  normalizeAnchors,
  snapToAnchorIfClose,
  sortAnchors
} from './lib/spaceUtils';
import { insertTextChunk } from './lib/pngUtils';
import {
  convertPointToAuthored,
  findCurvePoint,
  migrateKeyframesToCurvePoints,
  normalizeLibraryCurves,
  patchCurvePoint,
  patchEditableCurvePoint
} from './lib/curvePointPolicy';
import {
  createInitialEditorState,
  editorReducer,
  normalizePersistedUxState,
  serializeUxState,
} from './state/editorState';

const EXPORT_ATLAS_SIZE = { width: 256, height: 32 };

const initialCurve: ColorCurve = {
  r: migrateKeyframesToCurvePoints([{ time: 0, value: 0 }, { time: 1, value: 1 }]),
  g: migrateKeyframesToCurvePoints([{ time: 0, value: 0 }, { time: 1, value: 1 }]),
  b: migrateKeyframesToCurvePoints([{ time: 0, value: 0 }, { time: 1, value: 1 }]),
  a: migrateKeyframesToCurvePoints([{ time: 0, value: 1 }, { time: 1, value: 1 }])
};

const createMinimalBasicSpace = (): LibraryCurve[] => [{
  id: crypto.randomUUID(),
  name: 'Default Sweep',
  category: 'Basic',
  position: 0,
  curve: cloneCurve(initialCurve),
  authored: true,
  source: 'manual'
}];

import { AtlasViewer } from './components/AtlasViewer';

export default function App() {
  const [editorState, dispatch] = useReducer(editorReducer, undefined, createInitialEditorState);
  const continuumTrackRef = useRef<HTMLDivElement>(null);
  const anchorsRef = useRef<LibraryCurve[]>([]);
  
  const [atlasTexture, setAtlasTexture] = useState<ImageData | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);

  const { document: documentState, ui } = editorState;
  const library = documentState.library;
  const {
    mainView,
    levers,
    activeChannel,
    editChannels,
    interpMode,
    selectedPoint,
    interaction
  } = ui;
  const spaceLever = levers[mainView];

  const setRawSpacePosition = (val: number) => {
      dispatch({ type: 'set-space-position', mainView, position: val });
  };

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
          dispatch({ type: 'load-library', library: normalizeLibraryCurves(savedLibrary) });
          
          // Load UX state
          dispatch({ type: 'hydrate-ui', uxState: normalizePersistedUxState(await get('curve-ux-state')) });
        } else {
          dispatch({ type: 'load-library', library: createMinimalBasicSpace() });
        }
      } catch (e) {
        console.error("Failed to load state", e);
      } finally {
        setHasHydrated(true);
      }
    };
    loadState();
  }, []);

  // Save to indexedDB whenever library changes
  useEffect(() => {
    if (hasHydrated && library.length > 0) {
      set('curve-library', library).catch(console.error);
    }
  }, [hasHydrated, library]);

  // Save UX state
  useEffect(() => {
    if (!hasHydrated) return;
    set('curve-ux-state', serializeUxState(ui)).catch(console.error);
  }, [hasHydrated, ui]);

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
    dispatch({ type: 'move-anchor', anchorId, position: nextPosition, mainView });
  };

  const handleAnchorPointerDown = (e: React.PointerEvent<HTMLDivElement>, anchorId: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'start-anchor-drag', anchorId });
    moveAnchor(anchorId, getTrackPosition(e.clientX));
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleAnchorPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (interaction.type !== 'dragging-anchor') return;
    e.preventDefault();
    moveAnchor(interaction.anchorId, getTrackPosition(e.clientX));
  };

  const handleAnchorPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (interaction.type !== 'dragging-anchor') return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dispatch({ type: 'end-interaction' });
  };

  const spaceCurves = normalizedCategoryCurves;

  const activeSpaceCurve = spaceCurves.length > 0 
    ? blendSpaceCurves(spaceCurves, spaceLever, interpMode)
    : initialCurve;

  const updateActiveCurve = (newCurve: ColorCurve) => {
    dispatch({ type: 'edit-active-curve', curve: newCurve, newAnchorId: crypto.randomUUID() });
  };

  const importCurve = (importedCurve: ColorCurve) => {
    const channels: Channel[] = ['r', 'g', 'b', 'a'];
    const mergedCurve = channels.reduce((nextCurve, channel) => ({
      ...nextCurve,
      [channel]: importedCurve[channel].length > 0
        ? importedCurve[channel]
        : activeSpaceCurve[channel]
    }), activeSpaceCurve);

    dispatch({ type: 'clear-point-selection' });
    updateActiveCurve(mergedCurve);
  };

  const selectedCurvePoint = useMemo(
    () => findCurvePoint(activeSpaceCurve, selectedPoint),
    [activeSpaceCurve, selectedPoint]
  );

  const selectedCurvePointNumber = useMemo(() => {
    if (!selectedPoint) return undefined;
    const pointIndex = activeSpaceCurve[selectedPoint.channel].findIndex(point => point.id === selectedPoint.pointId);
    return pointIndex === -1 ? undefined : pointIndex + 1;
  }, [activeSpaceCurve, selectedPoint]);

  const updateSelectedPoint = (patcher: (point: CurvePoint) => CurvePoint) => {
    if (!selectedPoint) return;
    updateActiveCurve(patchCurvePoint(activeSpaceCurve, selectedPoint, patcher));
  };

  const updateEditableSelectedPoint = (patcher: (point: CurvePoint) => CurvePoint) => {
    if (!selectedPoint) return;
    updateActiveCurve(patchEditableCurvePoint(activeSpaceCurve, selectedPoint, patcher));
  };

  const convertSelectedPointToAuthored = () => {
    if (!selectedPoint) return;
    updateActiveCurve(patchCurvePoint(activeSpaceCurve, selectedPoint, convertPointToAuthored));
  };

  const resetToMinimalBasicSpace = () => {
    dispatch({ type: 'reset-space', library: createMinimalBasicSpace() });
    setAtlasTexture(null);
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
  ] satisfies { id: Channel; label: string; color: string }[];

  const enabledEditChannels = channelInfo.filter(ci => editChannels[ci.id]);
  const editFilterLabel = enabledEditChannels.length === channelInfo.length
    ? 'All channels enabled. Edits infer the nearest channel when needed.'
    : enabledEditChannels.length > 0
      ? `Editing ${enabledEditChannels.map(ci => ci.label.charAt(0)).join(', ')}. Disabled channels remain protected.`
      : 'No channels enabled. Turn on a channel to edit.';

  const toggleEditChannel = (channel: Channel) => {
    dispatch({ type: 'toggle-edit-channel', channel });
  };

  const renderCurveEditorPanel = () => (
    <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 pb-2 space-y-4">
       <div className="space-y-3">
           <h3 className="text-[11px] uppercase tracking-widest font-bold text-zinc-300">Curve Editor</h3>
           <PointInspector
              point={selectedCurvePoint}
              pointNumber={selectedCurvePointNumber}
              channelLabel={selectedPoint?.channel.toUpperCase()}
              onPatchPoint={updateSelectedPoint}
              onPatchEditablePoint={updateEditableSelectedPoint}
              onConvertToAuthored={convertSelectedPointToAuthored}
           />
       </div>

       <CurveEditor
          curve={activeSpaceCurve}
          onChange={updateActiveCurve}
          activeChannel={activeChannel}
          editChannels={editChannels}
          selectedPoint={selectedPoint}
          onActiveChannelChange={(channel) => dispatch({ type: 'set-active-channel', channel })}
          onSelectedPointChange={(selection) => selection
            ? dispatch({ type: 'select-point', selection })
            : dispatch({ type: 'clear-point-selection' })}
          interpMode={interpMode}
       />
    </div>
  );

  const renderEditFilter = () => (
    <div className="grid grid-cols-1 gap-4">
        <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
            <h3 className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 border-b border-zinc-800 pb-2">Edit Filter <span className="font-normal normal-case text-zinc-600">(Affects which channels you edit)</span></h3>
            <div className="flex gap-2">
                 {channelInfo.map((ci) => (
                    <button
                        key={ci.id}
                        onClick={() => toggleEditChannel(ci.id)}
                        aria-pressed={editChannels[ci.id]}
                        className={cn(
                        "flex-1 py-1.5 rounded-lg text-xs font-medium transition-all border flex items-center justify-center gap-2",
                        editChannels[ci.id]
                            ? `bg-zinc-800 border-zinc-700 text-white shadow-sm` 
                            : "bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-white/5",
                        activeChannel === ci.id && editChannels[ci.id] && "ring-1 ring-white/30"
                        )}
                    >
                        <span className={cn("w-2 h-2 rounded-full", ci.color)} />
                        {ci.label.charAt(0)}
                    </button>
                 ))}
            </div>
            <p className="text-[10px] text-zinc-500 pt-1">{editFilterLabel}</p>
        </div>
    </div>
  );

  const renderSpaceContinuum = () => (
    <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 flex flex-col gap-6">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <h3 className="text-xs uppercase tracking-wider font-bold text-zinc-300">Space Continuum <span className="text-zinc-600 font-normal normal-case">(1D)</span></h3>
            </div>
        </div>
        
        <div ref={continuumTrackRef} className="relative pt-6 pb-8 mx-4">
             <div className="absolute top-1/2 -mt-1 left-0 right-0 h-2 rounded-full overflow-hidden opacity-50" style={{ background: categoryGradient }} />
             
             <div className="absolute top-full text-[10px] text-zinc-500 font-mono w-full flex justify-between mt-2 px-1">
                 <div className="flex flex-col"><span className="text-zinc-300">0.00</span>Start</div>
                 <div>0.25</div>
                 <div>0.50</div>
                 <div>0.75</div>
                 <div className="flex flex-col items-end"><span className="text-zinc-300">1.00</span>End</div>
             </div>
             
             <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 pointer-events-none z-40">
                 {normalizedCategoryCurves.map((c) => (
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
                          interaction.type === 'dragging-anchor' && interaction.anchorId === c.id && "scale-125"
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
                
             <div className="absolute top-0 bottom-0 pointer-events-none w-8 bg-indigo-500/20 border border-indigo-500/50 rounded -ml-4 z-20 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.2)]" style={{ left: `${spaceLever * 100}%` }}>
                 <div className="w-3 h-8 bg-indigo-400 rounded-full" />
             </div>
        </div>
        
        <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mt-2">
            <div className="flex gap-4">
                <span>X: {spaceLever.toFixed(2)}</span>
            </div>
        </div>
    </div>
  );

  return (
    <div className="min-h-screen select-none bg-black text-zinc-100 font-sans selection:bg-indigo-500/30">
      <div className="max-w-[1400px] mx-auto p-4 sm:p-8 space-y-8">
        
        {/* Top Navbar */}
        <header className="flex items-center gap-6 pb-6 border-b border-white/5">
          <h1 className="text-xl font-bold tracking-tight text-white mr-4">Curve Composer</h1>
          
          <div className="flex bg-black border border-zinc-800 rounded-lg p-1 overflow-hidden">
             <button 
                onClick={() => dispatch({ type: 'set-main-view', mainView: 'curve' })}
                className={cn("px-5 py-2 text-sm font-medium transition-colors", mainView === 'curve' ? 'bg-[#1a1c2e] text-indigo-400' : 'text-zinc-400 hover:text-zinc-200')}
             >
                1D Curve
             </button>
             <button 
                onClick={() => dispatch({ type: 'set-main-view', mainView: '2d' })}
                className={cn("px-5 py-2 text-sm font-medium transition-colors border-l border-zinc-800", mainView === '2d' ? 'bg-[#1a1c2e] text-indigo-400' : 'text-zinc-400 hover:text-zinc-200')}
             >
                2D Atlas
             </button>
             <button 
                onClick={() => dispatch({ type: 'set-main-view', mainView: '3d' })}
                className={cn("px-5 py-2 text-sm font-medium transition-colors border-l border-zinc-800", mainView === '3d' ? 'bg-[#1a1c2e] text-indigo-400' : 'text-zinc-400 hover:text-zinc-200')}
             >
                3D Volume
             </button>
          </div>

          <div className="flex items-center gap-4 ml-auto">
             <button
                onClick={resetToMinimalBasicSpace}
                className="text-zinc-500 hover:text-zinc-300"
                title="Reset space to minimal basic representation"
                aria-label="Reset space to minimal basic representation"
             >
                 <RotateCcw className="w-5 h-5" />
             </button>
             <button className="text-zinc-500 hover:text-zinc-300">
                 <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"></path></svg>
             </button>
             <button className="text-zinc-500 hover:text-zinc-300 border border-zinc-800 bg-[#09090b] rounded p-2">
                 <Settings2 className="w-5 h-5" />
             </button>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-8 items-start">
            
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

                {renderCurveEditorPanel()}
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] gap-4">
                  {renderEditFilter()}
                  <CurveImportPanel onImport={importCurve} />
                </div>
                {renderSpaceContinuum()}

            </div>
            )}
            
            {mainView === '2d' && (
                <div className="flex flex-col gap-8">
                    <AtlasViewer 
                        curves={spaceCurves} 
                        interpMode={interpMode} 
                        spaceLever={spaceLever} 
                        onTextureUpdate={setAtlasTexture}
                        onExportAtlas={handleExportLibraryLUT}
                        canExportAtlas={normalizedCategoryCurves.length > 1}
                    />
                    {renderCurveEditorPanel()}
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] gap-4">
                      {renderEditFilter()}
                      <CurveImportPanel onImport={importCurve} />
                    </div>
                    {renderSpaceContinuum()}
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
        </div>

      </div>
    </div>
  );
}
