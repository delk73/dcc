/**
 * # Specification: Unified 2D-Centric Workspace UI
 * **Document ID:** SPEC-UI-001
 * **Revision:** 2.0
 * **Status:** Codified / Active
 *
 * ## 1. Anti-Occlusion Layout Constraints
 * - [Rule 1.1] Global header controls are limited to non-destructive actions (Export, Reset).
 * - [Rule 1.2] The workspace maintains a persistent dual-engine layout: 1D Curve Editor
 * and 2D Atlas Viewer are visible simultaneously across all display profiles.
 * - [Rule 1.3] Space keyframe controls live on the 2D Atlas Viewer Y axis; no
 * detached footer space slider reserves workspace height.
 * - [Rule 1.4] Color channel filters are local to the curve editor controls.
 *
 * ## 2. Aspect Ratio Reflow (Best-Fit Model)
 * - [Rule 2.1] Widescreen (Aspect >= 1.0): Viewports partition side-by-side as distinct halves.
 * - [Rule 2.2] Portrait (Aspect < 1.0): Viewports stack vertically. The highly interactive
 * 1D Curve Editor remains top-priority; the 2D Atlas Viewer follows below it.
 * - [Rule 2.3] Component geometry orientation remains invariant during reflow.
 */

export interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputedLayout {
  aspectRatio: number;
  isWidescreen: boolean;
  headerRibbon: BoundingRect;
  channelStrip: BoundingRect;
  atlasViewport: BoundingRect;
  curveEditor: BoundingRect;
  spaceSlider: BoundingRect;
}

// Immutable layout sizing primitives matching SPEC-UI-001 Rev 2.0.
export const SPEC_CONSTRAINTS = {
  HEADER_HEIGHT: 40,
  CHANNEL_WIDTH: 0,
  SLIDER_HEIGHT: 0,
  ASPECT_BREAKPOINT: 1.0,
} as const;
