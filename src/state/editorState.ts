import { Channel, ChannelMask, ColorCurve, LibraryCurve } from '../types';
import { InterpMode } from '../lib/curveUtils';
import {
  POSITION_EPSILON,
  clampSpacePosition,
  cloneCurve,
  normalizeAnchors,
  sortAnchors
} from '../lib/spaceUtils';
import { normalizeLibraryCurves } from '../lib/curvePointPolicy';

export type MainView = 'curve' | '2d' | '3d';

export type InteractionState =
  | { type: 'idle' }
  | { type: 'dragging-anchor'; anchorId: string };

export type EditorDocumentState = {
  library: LibraryCurve[];
};

export type EditorUiState = {
  mainView: MainView;
  levers: Record<MainView, number>;
  activeChannel: Channel;
  editChannels: ChannelMask;
  interpMode: InterpMode;
  interaction: InteractionState;
};

export type EditorState = {
  document: EditorDocumentState;
  ui: EditorUiState;
};

export const UX_STATE_VERSION = 1;

export type PersistedUxStateV1 = {
  version: typeof UX_STATE_VERSION;
  interpMode: InterpMode;
  mainView: MainView;
  activeChannel: Channel;
  editChannels: ChannelMask;
};

export const ALL_CHANNELS: Channel[] = ['r', 'g', 'b', 'a'];

export const ALL_CHANNELS_ENABLED: ChannelMask = {
  r: true,
  g: true,
  b: true,
  a: true
};

export const createInitialEditorState = (): EditorState => ({
  document: {
    library: []
  },
  ui: {
    mainView: 'curve',
    levers: {
      curve: 0,
      '2d': 0,
      '3d': 0
    },
    activeChannel: 'r',
    editChannels: ALL_CHANNELS_ENABLED,
    interpMode: 'cubic',
    interaction: { type: 'idle' }
  }
});

export type EditorAction =
  | { type: 'load-library'; library: LibraryCurve[] }
  | { type: 'hydrate-ui'; uxState: Partial<Pick<EditorUiState, 'interpMode' | 'mainView' | 'activeChannel' | 'editChannels'>> }
  | { type: 'set-main-view'; mainView: MainView }
  | { type: 'set-space-position'; mainView: MainView; position: number }
  | { type: 'set-interp-mode'; interpMode: InterpMode }
  | { type: 'set-active-channel'; channel: Channel }
  | { type: 'set-edit-channels'; editChannels: ChannelMask }
  | { type: 'toggle-edit-channel'; channel: Channel }
  | { type: 'edit-active-curve'; curve: ColorCurve; newAnchorId: string }
  | { type: 'start-anchor-drag'; anchorId: string }
  | { type: 'move-anchor'; anchorId: string; position: number; mainView: MainView }
  | { type: 'end-interaction' }
  | { type: 'reset-space'; library: LibraryCurve[] };

export const editorReducer = (state: EditorState, action: EditorAction): EditorState => {
  switch (action.type) {
    case 'load-library':
      return {
        ...state,
        document: {
          ...state.document,
          library: sortAnchors(normalizeLibraryCurves(action.library))
        }
      };

    case 'hydrate-ui':
      return {
        ...state,
        ui: {
          ...state.ui,
          ...action.uxState,
          editChannels: action.uxState.editChannels
            ? { ...ALL_CHANNELS_ENABLED, ...action.uxState.editChannels }
            : state.ui.editChannels
        }
      };

    case 'set-main-view':
      return {
        ...state,
        ui: {
          ...state.ui,
          mainView: action.mainView
        }
      };

    case 'set-space-position':
      return {
        ...state,
        ui: {
          ...state.ui,
          levers: {
            ...state.ui.levers,
            [action.mainView]: clampSpacePosition(action.position)
          }
        }
      };

    case 'set-interp-mode':
      return {
        ...state,
        ui: {
          ...state.ui,
          interpMode: action.interpMode
        }
      };

    case 'set-active-channel':
      return {
        ...state,
        ui: {
          ...state.ui,
          activeChannel: action.channel
        }
      };

    case 'set-edit-channels':
      return {
        ...state,
        ui: {
          ...state.ui,
          editChannels: { ...ALL_CHANNELS_ENABLED, ...action.editChannels }
        }
      };

    case 'toggle-edit-channel': {
      const editChannels = {
        ...state.ui.editChannels,
        [action.channel]: !state.ui.editChannels[action.channel]
      };
      const activeChannel = editChannels[state.ui.activeChannel]
        ? action.channel
        : ALL_CHANNELS.find(channel => editChannels[channel]) ?? state.ui.activeChannel;

      return {
        ...state,
        ui: {
          ...state.ui,
          activeChannel,
          editChannels
        }
      };
    }

    case 'edit-active-curve': {
      const editPosition = clampSpacePosition(state.ui.levers[state.ui.mainView]);
      const anchors = normalizeAnchors(state.document.library);
      const existingAnchor = anchors.find(anchor => Math.abs(anchor.position - editPosition) <= POSITION_EPSILON);
      const library = existingAnchor
        ? state.document.library.map(anchor =>
            anchor.id === existingAnchor.id
              ? { ...anchor, position: existingAnchor.position, curve: cloneCurve(action.curve), authored: true }
              : anchor
          )
        : [
            ...state.document.library,
            {
              id: action.newAnchorId,
              name: `Anchor ${anchors.length + 1}`,
              category: anchors[0]?.category ?? 'default',
              position: editPosition,
              curve: cloneCurve(action.curve),
              authored: true,
              source: 'implicit-edit' as const
            }
          ];

      return {
        ...state,
        document: {
          ...state.document,
          library: sortAnchors(library)
        }
      };
    }

    case 'start-anchor-drag':
      return {
        ...state,
        ui: {
          ...state.ui,
          interaction: { type: 'dragging-anchor', anchorId: action.anchorId }
        }
      };

    case 'move-anchor':
      return {
        ...state,
        document: {
          ...state.document,
          library: sortAnchors(state.document.library.map(anchor =>
            anchor.id === action.anchorId ? { ...anchor, position: action.position } : anchor
          ))
        },
        ui: {
          ...state.ui,
          levers: {
            ...state.ui.levers,
            [action.mainView]: clampSpacePosition(action.position)
          }
        }
      };

    case 'end-interaction':
      return {
        ...state,
        ui: {
          ...state.ui,
          interaction: { type: 'idle' }
        }
      };

    case 'reset-space':
      return {
        document: {
          library: sortAnchors(normalizeLibraryCurves(action.library))
        },
        ui: {
          ...state.ui,
          levers: {
            curve: 0,
            '2d': 0,
            '3d': 0
          },
          activeChannel: 'r',
          editChannels: ALL_CHANNELS_ENABLED,
          interaction: { type: 'idle' }
        }
      };

    default:
      return state;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isMainView = (value: unknown): value is MainView =>
  value === 'curve' || value === '2d' || value === '3d';

const isInterpMode = (value: unknown): value is InterpMode =>
  value === 'linear' || value === 'cubic' || value === 'constant';

const isChannel = (value: unknown): value is Channel =>
  value === 'r' || value === 'g' || value === 'b' || value === 'a';

const normalizeEditChannels = (value: unknown): ChannelMask | undefined => {
  if (!isRecord(value)) return undefined;
  return {
    ...ALL_CHANNELS_ENABLED,
    r: typeof value.r === 'boolean' ? value.r : ALL_CHANNELS_ENABLED.r,
    g: typeof value.g === 'boolean' ? value.g : ALL_CHANNELS_ENABLED.g,
    b: typeof value.b === 'boolean' ? value.b : ALL_CHANNELS_ENABLED.b,
    a: typeof value.a === 'boolean' ? value.a : ALL_CHANNELS_ENABLED.a
  };
};

export const normalizePersistedUxState = (
  value: unknown
): Partial<Pick<EditorUiState, 'interpMode' | 'mainView' | 'activeChannel' | 'editChannels'>> => {
  if (!isRecord(value)) return {};
  const editChannels = normalizeEditChannels(value.editChannels);

  return {
    ...(isInterpMode(value.interpMode) ? { interpMode: value.interpMode } : {}),
    ...(isMainView(value.mainView) ? { mainView: value.mainView } : {}),
    ...(isChannel(value.activeChannel) ? { activeChannel: value.activeChannel } : {}),
    ...(editChannels ? { editChannels } : {})
  };
};

export const serializeUxState = (ui: EditorUiState): PersistedUxStateV1 => ({
  version: UX_STATE_VERSION,
  interpMode: ui.interpMode,
  mainView: ui.mainView,
  activeChannel: ui.activeChannel,
  editChannels: ui.editChannels
});
