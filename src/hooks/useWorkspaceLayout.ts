import { BoundingRect, ComputedLayout, SPEC_CONSTRAINTS } from '../types/layoutSpec';

/**
 * Deterministic layout calculation hook enforcing SPEC-UI-001.
 * Computes component geometry variations based strictly on viewport aspect ratio.
 *
 * @param windowWidth Current logical display width in pixels
 * @param windowHeight Current logical display height in pixels
 */
export function useWorkspaceLayout(windowWidth: number, windowHeight: number): ComputedLayout {
  const aspectRatio = windowWidth / windowHeight;
  const isWidescreen = aspectRatio >= SPEC_CONSTRAINTS.ASPECT_BREAKPOINT;

  // Rule 1.1: Global controls sit at the absolute top header ribbon.
  const headerRibbon: BoundingRect = {
    x: 0,
    y: 0,
    width: windowWidth,
    height: SPEC_CONSTRAINTS.HEADER_HEIGHT,
  };

  const workspaceY = SPEC_CONSTRAINTS.HEADER_HEIGHT;
  const workspaceHeight =
    windowHeight - SPEC_CONSTRAINTS.HEADER_HEIGHT - SPEC_CONSTRAINTS.SLIDER_HEIGHT;

  // Rule 1.4: Channel controls are local to the curve editor in Rev 2.0.
  const channelStrip: BoundingRect = {
    x: 0,
    y: workspaceY,
    width: SPEC_CONSTRAINTS.CHANNEL_WIDTH,
    height: workspaceHeight,
  };

  const availableWidth = windowWidth - SPEC_CONSTRAINTS.CHANNEL_WIDTH;

  let curveEditor: BoundingRect;
  let atlasViewport: BoundingRect;
  let spaceSlider: BoundingRect;

  if (isWidescreen) {
    // Rule 2.1: Widescreen side-by-side column partition.
    const halfWidth = Math.floor(availableWidth / 2);

    curveEditor = {
      x: SPEC_CONSTRAINTS.CHANNEL_WIDTH,
      y: workspaceY,
      width: halfWidth,
      height: workspaceHeight,
    };

    atlasViewport = {
      x: SPEC_CONSTRAINTS.CHANNEL_WIDTH + halfWidth,
      y: workspaceY,
      width: halfWidth,
      height: workspaceHeight,
    };

    // Rule 1.3: Tracking slider resides below viewports to prevent occlusion.
    spaceSlider = {
      x: SPEC_CONSTRAINTS.CHANNEL_WIDTH,
      y: workspaceY + workspaceHeight,
      width: availableWidth,
      height: SPEC_CONSTRAINTS.SLIDER_HEIGHT,
    };
  } else {
    // Rule 2.2: Portrait vertical stack. Read-only atlas top, interactive graph bottom.
    const halfHeight = Math.floor(workspaceHeight / 2);

    atlasViewport = {
      x: SPEC_CONSTRAINTS.CHANNEL_WIDTH,
      y: workspaceY,
      width: availableWidth,
      height: halfHeight,
    };

    curveEditor = {
      x: SPEC_CONSTRAINTS.CHANNEL_WIDTH,
      y: workspaceY + halfHeight,
      width: availableWidth,
      height: halfHeight,
    };

    // Rule 2.3: Slider claims full display width for maximum horizontal resolution.
    spaceSlider = {
      x: 0,
      y: workspaceY + workspaceHeight,
      width: windowWidth,
      height: SPEC_CONSTRAINTS.SLIDER_HEIGHT,
    };
  }

  return {
    aspectRatio,
    isWidescreen,
    headerRibbon,
    channelStrip,
    atlasViewport,
    curveEditor,
    spaceSlider,
  };
}
