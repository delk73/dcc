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

  // Rule 1.1: Global state mutations sit at the absolute top ribbon.
  const modeRibbon: BoundingRect = {
    x: 0,
    y: 0,
    width: windowWidth,
    height: SPEC_CONSTRAINTS.RIBBON_HEIGHT,
  };

  const workspaceY = SPEC_CONSTRAINTS.RIBBON_HEIGHT;
  const workspaceHeight =
    windowHeight - SPEC_CONSTRAINTS.RIBBON_HEIGHT - SPEC_CONSTRAINTS.SLIDER_HEIGHT;

  // Rule 1.4 and Rule 2.3: Channel strip stays vertical on the left border.
  const channelStrip: BoundingRect = {
    x: 0,
    y: workspaceY,
    width: SPEC_CONSTRAINTS.CHANNEL_WIDTH,
    height: workspaceHeight,
  };

  const availableWidth = windowWidth - SPEC_CONSTRAINTS.CHANNEL_WIDTH;

  let curveEditor: BoundingRect;
  let outputViewport: BoundingRect;
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

    outputViewport = {
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
    // Rule 2.2: Portrait vertical stack. Read-only output top, interactive graph bottom.
    const halfHeight = Math.floor(workspaceHeight / 2);

    outputViewport = {
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
    modeRibbon,
    channelStrip,
    outputViewport,
    curveEditor,
    spaceSlider,
  };
}
