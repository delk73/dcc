/**
 * # Specification: Unified Multi-Dimensional Workspace UI
 * **Document ID:** SPEC-UI-001
 * **Revision:** 1.6
 * **Status:** Codified / Active
 *
 * ## 1. Anti-Occlusion Layout Constraints
 * - [Rule 1.1] Global state mutations (`ModeToggles`) must sit at the absolute top ribbon.
 * - [Rule 1.2] Main visual feedback areas sit in the center.
 * - [Rule 1.3] High-frequency interactive controls (`SpaceSlider`) must remain anchored
 * below index lines to preserve open lines of sight.
 * - [Rule 1.4] Color channel filters (`ChannelStrip`) form a fixed vertical boundary
 * column along the left edge.
 *
 * ## 2. Aspect Ratio Reflow (Best-Fit Model)
 * - [Rule 2.1] Widescreen (Aspect >= 1.0): Viewports partition side-by-side as distinct halves.
 * - [Rule 2.2] Portrait (Aspect < 1.0): Viewports stack vertically. Non-interactive `AtlasViewer`
 * or `CurvePreview` is pushed to the top; interactive `CurveEditor` drops to the bottom
 * to clear the user's hand/stylus tracking path.
 * - [Rule 2.3] Component geometry orientation remains invariant during reflow; `ChannelStrip`
 * remains a vertical asset. `SpaceSlider` expands horizontally to 100% display width.
 */

export type WorkspaceMode = '1D' | '2D' | '3D';

export interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputedLayout {
  aspectRatio: number;
  isWidescreen: boolean;
  modeRibbon: BoundingRect;
  channelStrip: BoundingRect;
  outputViewport: BoundingRect;
  curveEditor: BoundingRect;
  spaceSlider: BoundingRect;
}

// Immutable layout sizing primitives matching SPEC-UI-001.
export const SPEC_CONSTRAINTS = {
  RIBBON_HEIGHT: 40,
  CHANNEL_WIDTH: 48,
  SLIDER_HEIGHT: 32,
  ASPECT_BREAKPOINT: 1.0,
} as const;
