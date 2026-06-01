import React, { useReducer, useState, useEffect, useMemo, useRef } from 'react';
import { get, set } from 'idb-keyval';
import { ColorCurve, Channel, LibraryCurve } from './types';
import { CurveEditor } from './components/CurveEditor';
import { CurvePasteArea } from './components/CurvePasteArea';
import { AtlasViewer } from './components/AtlasViewer';
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
  migrateKeyframesToCurvePoints,
  normalizeLibraryCurves,
} from './lib/curvePointPolicy';
import {
  createInitialEditorState,
  editorReducer,
  normalizePersistedUxState,
  serializeUxState,
} from './state/editorState';

const EXPORT_ATLAS_SIZE = { width: 256, height: 32 };
const DOMAIN_TIME_DETENT_RADIUS = 0.015;

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

  const startAnchorDrag = (anchorId: string) => {
    dispatch({ type: 'start-anchor-drag', anchorId });
  };

  const endAnchorDrag = () => {
    if (interaction.type !== 'dragging-anchor') return;
    dispatch({ type: 'end-interaction' });
  };

  const spaceCurves = normalizedCategoryCurves;

  const activeSpaceCurve = spaceCurves.length > 0 
    ? blendSpaceCurves(spaceCurves, spaceLever, interpMode)
    : initialCurve;

  const activeCurveIndexInfo = useMemo(() => {
    if (normalizedCategoryCurves.length === 0) return null;

    const nearest = normalizedCategoryCurves.reduce((best, curve, index) => {
      const distance = Math.abs(curve.position - spaceLever);
      return distance < best.distance ? { curve, index, distance } : best;
    }, {
      curve: normalizedCategoryCurves[0],
      index: 0,
      distance: Math.abs(normalizedCategoryCurves[0].position - spaceLever)
    });

    return {
      label: `C:${nearest.index + 1}`,
      title: `${nearest.curve.name} / ${nearest.curve.category} / Y ${nearest.curve.position.toFixed(3)}`
    };
  }, [normalizedCategoryCurves, spaceLever]);

  const setAtlasDomainTimeWithDetent = (time: number, options: { commit?: boolean } = { commit: true }) => {
    const clampedTime = Math.max(0, Math.min(1, time));
    if (!options.commit) {
      setAtlasDomainTime(clampedTime);
      return;
    }

    const nearestPoint = (['r', 'g', 'b', 'a'] as Channel[]).reduce((nearest, channel) => {
      return activeSpaceCurve[channel].reduce((channelNearest, point) => {
        const distance = Math.abs(point.time - clampedTime);
        if (!channelNearest || distance < channelNearest.distance) {
          return { time: point.time, distance };
        }
        return channelNearest;
      }, nearest);
    }, null as { time: number; distance: number } | null);

    setAtlasDomainTime(
      nearestPoint && nearestPoint.distance <= DOMAIN_TIME_DETENT_RADIUS
        ? nearestPoint.time
        : clampedTime
    );
  };

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

  const pushSpace = (importedLibrary: LibraryCurve[]) => {
    dispatch({ type: 'reset-space', library: importedLibrary });
    dispatch({ type: 'set-main-view', mainView: TWO_DIMENSIONAL_WORKSPACE_VIEW });
    setAtlasTexture(null);
  };

  const toggleEditChannel = (channel: Channel) => {
    dispatch({ type: 'toggle-edit-channel', channel });
  };

  const resetToMinimalBasicSpace = () => {
    dispatch({ type: 'reset-space', library: createMinimalBasicSpace() });
    setAtlasTexture(null);
  };

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

  const renderCurveEditorPanel = (className = '', editorClassName = '') => {
    const pasteAreaHeight = layout.curveEditor.height >= 520 ? 156 : 132;
    const editorHeight = Math.max(240, layout.curveEditor.height - pasteAreaHeight - 88);

    return (
    <div className={cn("bg-[#09090b] border border-zinc-800 rounded-xl p-2 gap-2 min-h-0 flex flex-col", className)}>
       <div className="shrink-0 flex items-center">
          <h3 className="text-[10px] uppercase tracking-widest font-bold text-zinc-300 mr-1">Curve Editor</h3>
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
          onDomainTimeChange={setAtlasDomainTimeWithDetent}
          curveIndexLabel={activeCurveIndexInfo?.label}
          curveIndexTitle={activeCurveIndexInfo?.title}
          width={Math.max(0, layout.curveEditor.width - 16)}
          height={editorHeight}
          className={editorClassName}
       />
       <CurvePasteArea
          onImport={importCurve}
          onPushSpace={pushSpace}
          className={cn(layout.curveEditor.height < 520 && "hidden sm:block")}
       />
    </div>
    );
  };

  const renderAtlasPanel = (className = '') => (
    <AtlasViewer
      curves={normalizedCategoryCurves}
      interpMode={interpMode}
      spaceLever={spaceLever}
      domainTime={atlasDomainTime}
      activeAnchorId={interaction.type === 'dragging-anchor' ? interaction.anchorId : undefined}
      activeCurveLabel={activeCurveIndexInfo?.label}
      activeChannelsLabel={(['r', 'g', 'b', 'a'] as Channel[])
        .filter(channel => editChannels[channel])
        .map(channel => channel.toUpperCase())
        .join('') || 'NONE'}
      onSpaceLeverChange={setSpacePosition}
      onDomainTimeChange={setAtlasDomainTimeWithDetent}
      onAnchorDragStart={startAnchorDrag}
      onAnchorPositionChange={moveAnchor}
      onAnchorDragEnd={endAnchorDrag}
      onTextureUpdate={setAtlasTexture}
      onExportAtlas={handleExportLibraryLUT}
      canExportAtlas={normalizedCategoryCurves.length > 1}
      className={cn("h-full min-h-0 rounded-none border-zinc-800 p-2", className)}
      canvasClassName="min-h-0"
    />
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

    </div>
  );
}
