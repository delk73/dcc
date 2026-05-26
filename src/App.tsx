import React, { useReducer, useState, useEffect, useMemo, useRef } from 'react';
import { get, set } from 'idb-keyval';
import { ColorCurve, Channel, CurvePoint, LibraryCurve } from './types';
import { CurveEditor } from './components/CurveEditor';
import { AtlasViewer } from './components/AtlasViewer';
import { PointInspector } from './components/PointInspector';
import { Download, RotateCcw, Settings2 } from 'lucide-react';
import { cn } from './lib/utils';
import { InterpMode, computeTangents, evaluateCurve, blendSpaceCurves } from './lib/curveUtils';
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout';
import {
  POSITION_EPSILON,
  clampSpacePosition,
  cloneCurve,
  normalizeAnchors,
  snapToAnchorIfClose,
  sortAnchors
} from './lib/spaceUtils';
import { insertTextChunk } from './lib/pngUtils';
import { createId } from './lib/idUtils';
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
  id: createId('anchor'),
  name: 'Default Sweep',
  category: 'Basic',
  position: 0,
  curve: cloneCurve(initialCurve),
  authored: true,
  source: 'manual'
}];

import type { MainView } from './state/editorState';

const TWO_DIMENSIONAL_WORKSPACE_VIEW: MainView = '2d';

const useWindowDimensions = () => {
  const [dims, setDims] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));

  useEffect(() => {
    const handleResize = () => {
      setDims({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return dims;
};

export default function App() {
  const { width, height } = useWindowDimensions();
  const layout = useWorkspaceLayout(width, height);
  const [editorState, dispatch] = useReducer(editorReducer, undefined, createInitialEditorState);
  const continuumTrackRef = useRef<HTMLDivElement>(null);
  const anchorsRef = useRef<LibraryCurve[]>([]);
  
  const [atlasTexture, setAtlasTexture] = useState<ImageData | null>(null);
  const [atlasDomainTime, setAtlasDomainTime] = useState(0.5);
  const [hasHydrated, setHasHydrated] = useState(false);

  const { document: documentState, ui } = editorState;
  const library = documentState.library;
  const {
    mainView,
    levers,
    editChannels,
    interpMode,
    selectedPoint,
    interaction
  } = ui;
  const spaceLever = levers[TWO_DIMENSIONAL_WORKSPACE_VIEW];

  const setRawSpacePosition = (val: number) => {
      dispatch({ type: 'set-space-position', mainView: TWO_DIMENSIONAL_WORKSPACE_VIEW, position: val });
  };

  useEffect(() => {
    if (mainView !== TWO_DIMENSIONAL_WORKSPACE_VIEW) {
      dispatch({ type: 'set-main-view', mainView: TWO_DIMENSIONAL_WORKSPACE_VIEW });
    }
  }, [mainView]);

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
    dispatch({ type: 'edit-active-curve', curve: newCurve, newAnchorId: createId('anchor') });
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

  const toggleEditChannel = (channel: Channel) => {
    dispatch({ type: 'toggle-edit-channel', channel });
  };

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

  const renderCurveEditorPanel = (className = '', editorClassName = '') => (
    <div className={cn("bg-[#09090b] border border-zinc-800 rounded-xl p-2 gap-2 min-h-0 flex flex-col", className)}>
       <div className="shrink-0 flex flex-wrap items-center gap-2">
          <h3 className="text-[10px] uppercase tracking-widest font-bold text-zinc-300 mr-1">Curve Editor</h3>
          <PointInspector
            point={selectedCurvePoint}
            pointNumber={selectedCurvePointNumber}
            channelLabel={selectedPoint?.channel.toUpperCase()}
            onPatchPoint={updateSelectedPoint}
            onPatchEditablePoint={updateEditableSelectedPoint}
            onConvertToAuthored={convertSelectedPointToAuthored}
            dense
          />
       </div>

       <CurveEditor
          curve={activeSpaceCurve}
          onChange={updateActiveCurve}
          editChannels={editChannels}
          selectedPoint={selectedPoint}
          onActiveChannelChange={(channel) => dispatch({ type: 'set-active-channel', channel })}
          onEditChannelToggle={toggleEditChannel}
          onSelectedPointChange={(selection) => selection
            ? dispatch({ type: 'select-point', selection })
            : dispatch({ type: 'clear-point-selection' })}
          interpMode={interpMode}
          spaceLever={spaceLever}
          domainTime={atlasDomainTime}
          width={Math.max(0, layout.curveEditor.width - 16)}
          height={Math.max(240, layout.curveEditor.height - 72)}
          className={editorClassName}
       />
    </div>
  );

  const renderAtlasPanel = (className = '') => (
    <AtlasViewer
      curves={normalizedCategoryCurves}
      interpMode={interpMode}
      spaceLever={spaceLever}
      domainTime={atlasDomainTime}
      onSpaceLeverChange={setSpacePosition}
      onDomainTimeChange={setAtlasDomainTime}
      onTextureUpdate={setAtlasTexture}
      onExportAtlas={handleExportLibraryLUT}
      canExportAtlas={normalizedCategoryCurves.length > 1}
      className={cn("h-full min-h-0 rounded-none border-zinc-800 p-2", className)}
      canvasClassName="min-h-0"
    />
  );

  const renderSpaceContinuum = (className = '') => (
    <div className={cn("bg-[#09090b] border border-zinc-800 rounded-xl px-3 py-2 flex items-center gap-3 min-h-[58px]", className)}>
        <div className="w-24 shrink-0">
          <h3 className="text-[10px] uppercase tracking-wider font-bold text-zinc-300 leading-3">Space</h3>
          <div className="text-[10px] font-mono text-zinc-500">X {spaceLever.toFixed(3)}</div>
        </div>
        
        <div ref={continuumTrackRef} className="relative h-11 flex-1 min-w-0 mx-2">
             <div className="absolute top-1/2 -mt-1 left-0 right-0 h-2 rounded-full overflow-hidden opacity-50" style={{ background: categoryGradient }} />
             
             <div className="absolute top-[30px] text-[10px] text-zinc-500 font-mono w-full flex justify-between px-1 pointer-events-none">
                 <div><span className="text-zinc-300">0.00</span></div>
                 <div>0.25</div>
                 <div>0.50</div>
                 <div>0.75</div>
                 <div className="text-zinc-300">1.00</div>
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
                
             <div className="absolute top-1/2 -translate-y-1/2 pointer-events-none w-7 h-9 bg-indigo-500/20 border border-indigo-500/50 rounded -ml-3.5 z-20 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.2)]" style={{ left: `${spaceLever * 100}%` }}>
                 <div className="w-2.5 h-7 bg-indigo-400 rounded-full" />
             </div>
        </div>
    </div>
  );

  return (
    <div className="fixed inset-0 overflow-hidden select-none bg-black text-zinc-100 font-sans selection:bg-indigo-500/30">
      <header
        data-layout-region="headerRibbon"
        style={{
          position: 'fixed',
          left: layout.headerRibbon.x,
          top: layout.headerRibbon.y,
          width: layout.headerRibbon.width,
          height: layout.headerRibbon.height
        }}
        className="z-50 flex items-center gap-3 border-b border-white/10 bg-[#09090b]/95 px-3"
      >
        <h1 className="mr-1 shrink-0 text-sm font-bold tracking-tight text-white">Curve Composer</h1>
        <span className="hidden text-[10px] font-mono uppercase tracking-wider text-zinc-600 sm:inline">
          2D Atlas + 1D Curve / {layout.isWidescreen ? 'Wide' : 'Portrait'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportLibraryLUT}
            disabled={normalizedCategoryCurves.length <= 1}
            className="grid h-7 w-7 place-items-center rounded border border-zinc-800 text-zinc-500 hover:bg-white/10 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            title="Export 2D atlas"
            aria-label="Export 2D atlas"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={resetToMinimalBasicSpace}
            className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
            title="Reset space to minimal basic representation"
            aria-label="Reset space to minimal basic representation"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded border border-zinc-800 bg-black text-zinc-500 hover:text-zinc-200"
            aria-label="Settings"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main
        data-layout-region="curveEditor"
        style={{
          position: 'fixed',
          left: layout.curveEditor.x,
          top: layout.curveEditor.y,
          width: layout.curveEditor.width,
          height: layout.curveEditor.height
        }}
        className="overflow-hidden bg-black p-2"
      >
        {renderCurveEditorPanel("h-full min-h-0 rounded-none border-zinc-800", "h-full min-h-0 flex-1 rounded-none")}
      </main>

      <section
        data-layout-region="atlasViewport"
        style={{
          position: 'fixed',
          left: layout.atlasViewport.x,
          top: layout.atlasViewport.y,
          width: layout.atlasViewport.width,
          height: layout.atlasViewport.height
        }}
        className="overflow-hidden bg-black p-2"
      >
        {renderAtlasPanel()}
      </section>

      <footer
        data-layout-region="spaceSlider"
        style={{
          position: 'fixed',
          left: layout.spaceSlider.x,
          top: layout.spaceSlider.y,
          width: layout.spaceSlider.width,
          height: layout.spaceSlider.height
        }}
        className="z-50 flex items-center gap-3 border-t border-white/10 bg-[#09090b]/95 px-4"
      >
        <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          Space
        </span>
        <div ref={continuumTrackRef} className="relative h-full min-w-0 flex-1">
          <div
            className="pointer-events-none absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full opacity-60"
            style={{ background: categoryGradient }}
          />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 -translate-y-1/2">
            {normalizedCategoryCurves.map((c) => (
              <div
                key={c.id}
                role="slider"
                aria-label={`Authored anchor at ${(c.position || 0).toFixed(2)}`}
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={c.position || 0}
                tabIndex={0}
                className="pointer-events-auto absolute -ml-2.5 -mt-2.5 flex h-5 w-5 cursor-grab touch-none items-center justify-center rounded-full active:cursor-grabbing"
                style={{ left: `${(c.position || 0) * 100}%` }}
                onPointerDown={(e) => handleAnchorPointerDown(e, c.id)}
                onPointerMove={handleAnchorPointerMove}
                onPointerUp={handleAnchorPointerUp}
                onPointerCancel={handleAnchorPointerUp}
              >
                <div
                  className={cn(
                    "h-3 w-3 rounded-full border-2 border-zinc-950 bg-white shadow-md transition-transform",
                    interaction.type === 'dragging-anchor' && interaction.anchorId === c.id && "scale-125"
                  )}
                />
              </div>
            ))}
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={spaceLever}
            onChange={(e) => setSpacePosition(parseFloat(e.target.value))}
            className="absolute inset-0 z-30 h-full w-full cursor-pointer opacity-0"
            aria-label="Space position"
          />
          <div
            className="pointer-events-none absolute top-1/2 z-10 -ml-3.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded border border-indigo-500/50 bg-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.2)]"
            style={{ left: `${spaceLever * 100}%` }}
          >
            <div className="h-5 w-2 rounded-full bg-indigo-400" />
          </div>
        </div>
        <span className="w-12 shrink-0 text-right font-mono text-[10px] text-zinc-400">
          {spaceLever.toFixed(3)}
        </span>
      </footer>
    </div>
  );
}
