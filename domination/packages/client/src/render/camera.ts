/**
 * Camera maths (work package WP5): pure functions, no canvas, testable
 * without a browser. The renderer keeps the current Camera and calls these.
 */

import type { GridSize } from '@domination/shared';
import type { ArtPoint } from './geometry';

export interface Camera {
  /** Art-pixel position shown at the top-left corner of the canvas (may be fractional while dragging). */
  x: number;
  y: number;
  /** Whole number of device pixels per art pixel. */
  zoom: number;
}

/** Size of the canvas backing store in device pixels. */
export interface Viewport {
  width: number;
  height: number;
}

/**
 * The allowed zoom levels for a display: whole numbers of device pixels per
 * art pixel from about 1 CSS pixel to about 6 CSS pixels per art pixel
 * (min = max(1, round(devicePixelRatio)), max = round(6 * devicePixelRatio)).
 */
export function zoomRange(devicePixelRatio: number): { min: number; max: number } {
  throw new Error('not implemented: zoomRange');
}

/**
 * Keeps the camera on the map. If the map (plus a small margin) is larger
 * than the viewport the camera may not show anything beyond the margin; if
 * it is smaller the map is centred. Returns a new Camera.
 */
export function clampCamera(camera: Camera, viewport: Viewport, map: GridSize): Camera {
  throw new Error('not implemented: clampCamera');
}

/**
 * Changes the zoom by whole steps, keeping the art pixel under the anchor
 * (a point in device pixels on the canvas) where it is. The zoom stays
 * within `range`. Returns a new, clamped Camera.
 */
export function zoomCamera(
  camera: Camera,
  steps: number,
  anchor: { x: number; y: number },
  range: { min: number; max: number },
  viewport: Viewport,
  map: GridSize,
): Camera {
  throw new Error('not implemented: zoomCamera');
}

/** Device pixel on the canvas -> art pixel on the map. */
export function deviceToArt(camera: Camera, point: { x: number; y: number }): ArtPoint {
  throw new Error('not implemented: deviceToArt');
}

/** Art pixel on the map -> device pixel on the canvas. */
export function artToDevice(camera: Camera, point: ArtPoint): { x: number; y: number } {
  throw new Error('not implemented: artToDevice');
}

/**
 * The rectangle of tile coordinates that can touch the viewport (inclusive,
 * already limited to the map), so drawing can skip everything else. One
 * extra row above is included because tall sprites reach into the row above.
 */
export function visibleTileRange(
  camera: Camera,
  viewport: Viewport,
  map: GridSize,
): { x0: number; y0: number; x1: number; y1: number } {
  throw new Error('not implemented: visibleTileRange');
}
