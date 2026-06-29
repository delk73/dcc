import React, { useReducer, useState, useEffect, useMemo, useRef } from 'react';
import { get, set } from 'idb-keyval';
import { ColorCurve, Channel, LibraryCurve } from './types';
import { CurveEditor } from './components/CurveEditor';
import { CurveMappingLedger } from './components/CurveMappingLedger';
import { CurvePasteArea } from './components/CurvePasteArea';
import { AtlasViewer } from './components/AtlasViewer';
import { OutputModeTabs } from './components/OutputModeTabs';
import { CurveFieldProjectionControls } from './components/CurveFieldProjectionControls';
import { CurveFieldProjectionViewer } from './components/CurveFieldProjectionViewer';
import { CurveProjectionIrPanel } from './components/CurveProjectionIrPanel';
import { Copy, Download, RotateCcw, Settings2 } from 'lucide-react';
import { cn } from './lib/utils';
import { InterpMode, computeTangents, evaluateCurve, blendSpaceCurves } from './lib/curveUtils';
import { colorCurveToCurveSpaceIr } from './lib/curveSpaceIr';
import { hashCurveFieldProjectionCanonical } from './lib/curveSpaceHash';
import { stableHashHex } from './lib/stableHash';
import { getCurveFieldChannelRoleSummary } from './lib/curveFieldChannelRoles';
import { getAtlasMappingRows, getCurveFieldMappingRows } from './lib/curveMappingRows';
import { CURVE_FIELD_BASIS_RECIPES } from './lib/curveFieldBasisIr';
import { type CurveFieldPreviewSpec } from './lib/curveProjectionIr';
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
import {
  createInitialCurveProjectionState,
  curveProjectionReducer,
} from './state/curveProjectionState';

const EXPORT_ATLAS_SIZE = { width: 256, height: 32 };
const DOMAIN_TIME_DETENT_RADIUS = 0.015;
const MIN_LAYOUT_WIDTH = 1080;
const MIN_LAYOUT_HEIGHT = 900;
const MIN_STACKED_ATLAS_HEIGHT = 640;
const MIN_CURVE_EDITOR_HEIGHT = {
  atlas: 1120,
  'curve-field': 960,
} as const;

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
type RecipeEditMode = 'inspect' | 'edit-expression' | 'bind-channels';

const RECIPE_EDIT_MODES: Array<{ id: RecipeEditMode; label: string }> = [
  { id: 'inspect', label: 'Inspect' },
  { id: 'edit-expression', label: 'Edit Expression' },
  { id: 'bind-channels', label: 'Bind Channels' },
];

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
  const layoutWidth = Math.max(width, MIN_LAYOUT_WIDTH);
  const layoutHeight = Math.max(height, MIN_LAYOUT_HEIGHT);
  const layout = useWorkspaceLayout(layoutWidth, layoutHeight);
  const [editorState, dispatch] = useReducer(editorReducer, undefined, createInitialEditorState);
  const [projectionState, dispatchProjection] = useReducer(
    curveProjectionReducer,
    undefined,
    createInitialCurveProjectionState
  );
  const anchorsRef = useRef<LibraryCurve[]>([]);
  const [recipeEditMode, setRecipeEditMode] = useState<RecipeEditMode>('inspect');
  
  const [atlasTexture, setAtlasTexture] = useState<ImageData | null>(null);
  const [atlasDomainTime, setAtlasDomainTime] = useState(0.5);
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
  const spaceLever = levers[TWO_DIMENSIONAL_WORKSPACE_VIEW];
  const { outputMode, curveFieldCurve, curveFieldProjection, curveFieldPreviewSize } = projectionState;
  const workspaceMinHeight = Math.max(MIN_LAYOUT_HEIGHT - layout.headerRibbon.height, height - layout.headerRibbon.height);
  const outputPanelMinHeight = Math.max(MIN_STACKED_ATLAS_HEIGHT, layout.isWidescreen ? workspaceMinHeight : 0);
  const curvePanelMinHeight = MIN_CURVE_EDITOR_HEIGHT[outputMode];
  const curvePanelWidth = layout.isWidescreen ? Math.floor(layoutWidth / 2) : layoutWidth;

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
      name: nearest.curve.name,
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

  const updateEditorCurve = (newCurve: ColorCurve) => {
    if (outputMode === 'curve-field') {
      dispatchProjection({ type: 'set-curve-field-curve', curve: newCurve });
      return;
    }

    updateActiveCurve(newCurve);
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

  const curveFieldCurveSpace = useMemo(
    () => colorCurveToCurveSpaceIr(curveFieldCurve),
    [curveFieldCurve]
  );

  const curveFieldPreviewSpec = useMemo<CurveFieldPreviewSpec>(() => ({
    version: 1,
    kind: 'curve-field-preview-spec',
    curveSpace: curveFieldCurveSpace,
    projection: curveFieldProjection,
    output: {
      width: curveFieldPreviewSize,
      height: curveFieldPreviewSize,
    },
  }), [curveFieldCurveSpace, curveFieldProjection, curveFieldPreviewSize]);

  const atlasRecipeHash = useMemo(() => stableHashHex(normalizedCategoryCurves.map(anchor => ({
    name: anchor.name,
    category: anchor.category,
    position: anchor.position,
    curve: anchor.curve,
    authored: anchor.authored,
    source: anchor.source,
  }))), [normalizedCategoryCurves]);

  const curveFieldRecipeHash = useMemo(
    () => hashCurveFieldProjectionCanonical(curveFieldCurveSpace, curveFieldProjection),
    [curveFieldCurveSpace, curveFieldProjection]
  );

  const curveFieldRecipeName = useMemo(() => {
    const selectedRecipe = CURVE_FIELD_BASIS_RECIPES.find(recipe => recipe.basis === curveFieldProjection.basis)
      ?? CURVE_FIELD_BASIS_RECIPES.find(recipe => JSON.stringify(recipe.basis) === JSON.stringify(curveFieldProjection.basis));

    return selectedRecipe?.label ?? curveFieldProjection.basis.kind;
  }, [curveFieldProjection.basis]);

  const curveFieldChannelRoleSummary = useMemo(
    () => getCurveFieldChannelRoleSummary(curveFieldProjection.basis),
    [curveFieldProjection.basis]
  );

  const curveLaneLegendRows = useMemo(
    () => outputMode === 'curve-field'
      ? getCurveFieldMappingRows(curveFieldProjection.basis)
      : getAtlasMappingRows(),
    [curveFieldProjection.basis, outputMode]
  );

  const pushSpace = (importedLibrary: LibraryCurve[]) => {
    dispatch({ type: 'reset-space', library: importedLibrary });
    dispatch({ type: 'set-main-view', mainView: TWO_DIMENSIONAL_WORKSPACE_VIEW });
    setAtlasTexture(null);
  };

  const toggleEditChannel = (channel: Channel) => {
    dispatch({ type: 'toggle-edit-channel', channel });
  };

  const selectMappingChannel = (channel: Channel) => {
    dispatch({ type: 'set-active-channel', channel });
    dispatch({ type: 'clear-point-selection' });
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

  const copyRecipeHash = () => {
    const hash = outputMode === 'curve-field' ? curveFieldRecipeHash : atlasRecipeHash;
    navigator.clipboard?.writeText(hash).catch(console.error);
  };

  const formatShortHash = (hash: string) =>
    `${hash.slice(0, 8)}${hash.length > 8 ? '...' : ''}`;

  const formatBindingSource = (row?: { input?: string; parameter?: string }) =>
    row?.input ?? row?.parameter ?? '-';

  const formatBindingClamp = (row?: { clamp?: string; parameter?: string }) =>
    row?.clamp ?? (row?.parameter ? 'off' : '-');

  const formatEditorBasis = (mode: InterpMode) => {
    if (mode === 'constant') return 'stepped';
    if (mode === 'cubic') return 'spline';
    return mode;
  };

  const renderCurveEditorPanel = (className = '', editorClassName = '') => {
    const showPasteArea = outputMode === 'atlas';
    const editorCurve = outputMode === 'curve-field' ? curveFieldCurve : activeSpaceCurve;
    const editorWidth = Math.max(0, curvePanelWidth - 32);
    const curveIndexTitle = outputMode === 'curve-field'
      ? curveFieldChannelRoleSummary.replace(/  /g, ' / ')
      : activeCurveIndexInfo?.title;
    const recipeIdentity = outputMode === 'curve-field'
      ? { name: curveFieldRecipeName, hash: curveFieldRecipeHash }
      : { name: activeCurveIndexInfo?.name ?? 'Atlas Recipe', hash: atlasRecipeHash };
    const activeMappingRow = curveLaneLegendRows.find(row => row.curveId === activeChannel) ?? curveLaneLegendRows[0];
    const expressionTerms = curveLaneLegendRows.map(row => row.roleLabel);
    const expressionText = expressionTerms.length > 1
      ? `Output = compose(${expressionTerms.join(', ')})`
      : `Output = ${expressionTerms[0] ?? activeChannel.toUpperCase()}`;
    const showingLabel = activeMappingRow
      ? `${activeMappingRow.curveLabel} / ${activeMappingRow.roleLabel}`
      : activeChannel.toUpperCase();
    const showingSource = formatBindingSource(activeMappingRow);
    const showingBasis = formatEditorBasis(interpMode);
    const showingClamp = formatBindingClamp(activeMappingRow);

    return (
     <div className={cn("bg-[#09090b] border border-zinc-800 rounded-xl p-1.5 gap-1.5 min-h-0 flex flex-col", className)}>
       <div className="flex min-h-7 shrink-0 items-center gap-2 overflow-hidden border-b border-zinc-900/90 px-1.5 pb-1 font-mono text-[10px] leading-none text-zinc-500">
          <span className="shrink-0 font-bold uppercase tracking-widest text-zinc-400">Recipe:</span>
          <span className="min-w-0 truncate text-zinc-100" title={recipeIdentity.name}>{recipeIdentity.name}</span>
          <span className="shrink-0" title={recipeIdentity.hash}>recipe hash <span className="text-zinc-300">{formatShortHash(recipeIdentity.hash)}</span></span>
          <button
            type="button"
            onClick={copyRecipeHash}
            className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-100"
            title="Copy recipe hash"
            aria-label="Copy recipe hash"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {outputMode === 'atlas' && (
            <button
              type="button"
              onClick={handleExportLibraryLUT}
              disabled={normalizedCategoryCurves.length <= 1}
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
              title="Export 2D atlas"
              aria-label="Export 2D atlas"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          )}
       </div>

       <div className="flex min-h-7 shrink-0 items-center gap-1.5 overflow-hidden px-1.5 font-mono text-[10px] leading-none text-zinc-500">
          <span className="shrink-0 font-bold uppercase tracking-widest text-zinc-400">Mode:</span>
          {RECIPE_EDIT_MODES.map(mode => {
            const active = recipeEditMode === mode.id;

            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setRecipeEditMode(mode.id)}
                aria-pressed={active}
                className={cn(
                  'h-5 rounded border px-2 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200',
                  active && 'border-zinc-600 bg-zinc-900 text-zinc-100'
                )}
              >
                {mode.label}
              </button>
            );
          })}
       </div>

       <section className="shrink-0 rounded-sm border border-zinc-900/90 bg-black/25 px-2 py-1 font-mono text-[10px]">
          <div className="flex items-center gap-2 leading-none">
            <h3 className="shrink-0 font-bold uppercase tracking-widest text-zinc-400">Curve Expression</h3>
          </div>
          <div className="mt-1 truncate text-zinc-200" title={expressionText}>{expressionText}</div>
       </section>

       <div className="flex min-h-4 shrink-0 items-center gap-2 px-1.5 leading-none">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-300">Curve Editor</h3>
          <span className="min-w-0 truncate font-mono text-[10px] text-zinc-500" title={`${showingLabel} / source ${showingSource} / ${showingBasis} / clamp ${showingClamp}`}>
            Showing: <span className="text-zinc-300">{showingLabel}</span>
            <span className="ml-2">source <span className="text-zinc-300">{showingSource}</span></span>
            <span className="ml-2 text-zinc-300">{showingBasis}</span>
            <span className="ml-2">clamp <span className="text-zinc-300">{showingClamp}</span></span>
          </span>
       </div>

       <CurveEditor
          curve={editorCurve}
          onChange={updateEditorCurve}
          editChannels={editChannels}
          activeChannel={activeChannel}
          selectedPoint={selectedPoint}
          onActiveChannelChange={(channel) => dispatch({ type: 'set-active-channel', channel })}
          onSelectedPointChange={(selection) => selection
            ? dispatch({ type: 'select-point', selection })
            : dispatch({ type: 'clear-point-selection' })}
          interpMode={interpMode}
          spaceLever={spaceLever}
          domainTime={atlasDomainTime}
          onDomainTimeChange={setAtlasDomainTimeWithDetent}
           curveIndexLabel={outputMode === 'curve-field' ? 'CF' : activeCurveIndexInfo?.label}
           curveIndexTitle={curveIndexTitle}
          width={editorWidth}
          className={editorClassName}
       />
       <CurveMappingLedger
          rows={curveLaneLegendRows}
          editChannels={editChannels}
          activeChannel={activeChannel}
          interpMode={interpMode}
          onSelectChannel={selectMappingChannel}
          onToggleChannel={toggleEditChannel}
          className="shrink-0"
       />
         {showPasteArea && (
          <CurvePasteArea
            onImport={importCurve}
            onPushSpace={pushSpace}
          />
         )}
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

  const renderCurveFieldPanel = (className = '') => (
    <div className={cn('flex h-full min-h-0 flex-col gap-1.5 rounded-none border border-zinc-800 bg-[#09090b] p-1.5', className)}>
      <div className="flex min-h-4 shrink-0 items-center leading-none">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-300">Field Preview</h3>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-sm bg-zinc-950">
        <CurveFieldProjectionViewer spec={curveFieldPreviewSpec} />
      </div>
      <CurveFieldProjectionControls
        transform={curveFieldProjection.transform}
        basis={curveFieldProjection.basis}
        previewSize={curveFieldPreviewSize}
        onTransformChange={transform => dispatchProjection({ type: 'set-curve-field-transform', transform })}
        onBasisRecipeChange={id => dispatchProjection({ type: 'set-curve-field-basis-recipe', id })}
        onPreviewSizeChange={size => dispatchProjection({ type: 'set-curve-field-preview-size', size })}
      />
      <CurveProjectionIrPanel curveSpace={curveFieldCurveSpace} projection={curveFieldProjection} />
    </div>
  );

  return (
    <div className="fixed inset-0 overflow-auto select-none bg-black text-zinc-100 font-sans selection:bg-indigo-500/30">
      <div className="min-h-full bg-black" style={{ minWidth: MIN_LAYOUT_WIDTH }}>
      <header
        data-layout-region="headerRibbon"
        style={{
          height: layout.headerRibbon.height
        }}
        className="sticky top-0 z-50 flex items-center gap-3 border-b border-white/10 bg-[#09090b]/95 px-3"
      >
        <h1 className="mr-1 shrink-0 text-sm font-bold tracking-tight text-white">Curve Composer</h1>
        <OutputModeTabs mode={outputMode} onChange={mode => dispatchProjection({ type: 'set-output-mode', mode })} />
        <span className="hidden text-[10px] font-mono uppercase tracking-wider text-zinc-600 sm:inline">
          {outputMode === 'atlas' ? '2D Atlas + 1D Curve' : 'Curve Field'} / {layout.isWidescreen ? 'Wide' : 'Portrait'}
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

      <div
        data-layout-region="workspace"
        style={{
          minHeight: workspaceMinHeight,
          gridTemplateColumns: layout.isWidescreen
            ? 'minmax(540px, 1fr) minmax(540px, 1fr)'
            : 'minmax(0, 1fr)',
        }}
        className="grid bg-black"
      >
        <main
          data-layout-region="curveEditor"
          style={{ minHeight: curvePanelMinHeight }}
          className="min-w-0 overflow-visible bg-black p-2"
        >
          {renderCurveEditorPanel("min-h-full rounded-none border-zinc-800", "shrink-0 rounded-none")}
        </main>

        <section
          data-layout-region="atlasViewport"
          style={{ minHeight: outputPanelMinHeight }}
          className="min-w-0 overflow-visible bg-black p-2"
        >
          {outputMode === 'atlas' ? renderAtlasPanel("min-h-full") : renderCurveFieldPanel("min-h-full")}
        </section>
      </div>

      </div>
    </div>
  );
}
