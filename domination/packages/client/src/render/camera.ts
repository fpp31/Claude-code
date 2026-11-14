/**
 * Camera maths (work package WP5): pure functions, no canvas, testable
 * without a browser. The renderer keeps the current Camera and calls these.
 */

import type { GridSize } from '@domination/shared';
import { COLUMN_PITCH, ODD_ROW_SHIFT, ROW_PITCH, TILE_HEIGHT, TILE_WIDTH, mapPixelSize } from './geometry';
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
 * How far beyond the edge of the map the MIDDLE of the canvas may go, in art
 * pixels (see clampCamera): a little, so that the outermost tiles can be
 * looked at with some room around them.
 */
export const CAMERA_MARGIN = 12;

/** CSS pixels per art pixel the game starts with, and the largest it allows (see zoomRange). */
const START_SCALE = 3;
const LARGEST_SCALE = 6;

/**
 * The allowed zoom levels for a display: whole numbers of device pixels per
 * art pixel from about 1 CSS pixel to about 6 CSS pixels per art pixel
 * (min = max(1, round(devicePixelRatio)), max = round(6 * devicePixelRatio)).
 */
export function zoomRange(devicePixelRatio: number): { min: number; max: number } {
  const min = Math.max(1, Math.round(devicePixelRatio));
  return { min, max: Math.max(min, Math.round(LARGEST_SCALE * devicePixelRatio)) };
}

/**
 * How much one zoom step (one click of the wheel, one press of + or -)
 * changes the zoom, in device pixels per art pixel: about one CSS pixel, so
 * a step feels the same on every display and there are about six of them
 * from the smallest to the largest zoom. On a high-density display that is
 * 2 or 3 device pixels at once.
 */
export function zoomStep(devicePixelRatio: number): number {
  return Math.max(1, Math.round(devicePixelRatio));
}

/** The zoom a new renderer starts with: about 3 CSS pixels per art pixel, within the display's range. */
export function startZoom(devicePixelRatio: number): number {
  const range = zoomRange(devicePixelRatio);
  return Math.min(range.max, Math.max(range.min, Math.round(START_SCALE * devicePixelRatio)));
}

/**
 * Keeps the map on screen: the art pixel shown in the MIDDLE of the canvas
 * is always on the map (or within CAMERA_MARGIN of its edge). Returns a new
 * Camera; one that already keeps the rule comes back with the same numbers.
 *
 * So the map can be dragged until its edge reaches the middle of the canvas,
 * and no further. Stopping at the edge of the canvas instead would look
 * tidier, but then a tile near the edge of the map could never be brought
 * out from under a panel that floats over a corner of the map, and
 * `centerOn` could not really centre it. The space beyond the map looks the
 * same as land nobody has explored yet.
 */
export function clampCamera(camera: Camera, viewport: Viewport, map: GridSize): Camera {
  const size = mapPixelSize(map);
  return {
    x: clampAxis(camera.x, size.width, viewport.width / camera.zoom),
    y: clampAxis(camera.y, size.height, viewport.height / camera.zoom),
    zoom: camera.zoom,
  };
}

/** One axis of clampCamera: `shown` is how many art pixels fit on the canvas along it. */
function clampAxis(position: number, mapLength: number, shown: number): number {
  // `position` is the art pixel at the left (or top) edge of the canvas; the
  // one in the middle is half a canvas further on.
  const lowest = -CAMERA_MARGIN - shown / 2;
  const highest = mapLength + CAMERA_MARGIN - shown / 2;
  return Math.min(Math.max(position, lowest), highest);
}

/**
 * Changes the zoom by whole steps, keeping the art pixel under the anchor
 * (a point in device pixels on the canvas) where it is. The zoom stays
 * within `range`. Returns a new, clamped Camera.
 *
 * Here one step is one device pixel per art pixel; the renderer multiplies
 * the steps it is asked for by `zoomStep`, so that a step is about one CSS
 * pixel on every display.
 */
export function zoomCamera(
  camera: Camera,
  steps: number,
  anchor: { x: number; y: number },
  range: { min: number; max: number },
  viewport: Viewport,
  map: GridSize,
): Camera {
  const zoom = Math.min(range.max, Math.max(range.min, camera.zoom + Math.round(steps)));
  const under = deviceToArt(camera, anchor);
  return clampCamera({ x: under.px - anchor.x / zoom, y: under.py - anchor.y / zoom, zoom }, viewport, map);
}

/**
 * The camera moved onto whole device pixels: what is really drawn. The
 * renderer draws with this camera and hit-tests with it, so a tap always
 * lands on the tile the player sees under the finger.
 */
export function snapCamera(camera: Camera): Camera {
  return {
    x: Math.round(camera.x * camera.zoom) / camera.zoom,
    y: Math.round(camera.y * camera.zoom) / camera.zoom,
    zoom: camera.zoom,
  };
}

/** Device pixel on the canvas -> art pixel on the map. */
export function deviceToArt(camera: Camera, point: { x: number; y: number }): ArtPoint {
  return { px: camera.x + point.x / camera.zoom, py: camera.y + point.y / camera.zoom };
}

/** Art pixel on the map -> device pixel on the canvas. */
export function artToDevice(camera: Camera, point: ArtPoint): { x: number; y: number } {
  return { x: (point.px - camera.x) * camera.zoom, y: (point.py - camera.y) * camera.zoom };
}

/**
 * The rectangle of tile coordinates that can touch the viewport (inclusive,
 * already limited to the map), so drawing can skip everything else. One
 * extra row above is included because tall sprites reach into the row above.
 *
 * In detail: every tile whose 26 x 28 sprite box touches the viewport is in
 * the rectangle, and then it is widened by one tile on all four sides. The
 * row below matters as much as the row above (a city just below the screen
 * still shows its flag and banner), and the columns beside it cover units
 * drawn a few pixels off their tile. If nothing of the map is in view the
 * rectangle is empty (x1 < x0 or y1 < y0).
 */
export function visibleTileRange(
  camera: Camera,
  viewport: Viewport,
  map: GridSize,
): { x0: number; y0: number; x1: number; y1: number } {
  const left = camera.x;
  const top = camera.y;
  const right = camera.x + viewport.width / camera.zoom;
  const bottom = camera.y + viewport.height / camera.zoom;

  // A row's boxes span art rows [y * 22, y * 22 + 28). A column's boxes span
  // art columns [x * 26, x * 26 + 26), or 13 further right in odd rows; to
  // cover both kinds of row the left limit allows for the shift.
  const firstRow = Math.floor((top - TILE_HEIGHT) / ROW_PITCH) + 1;
  const lastRow = Math.ceil(bottom / ROW_PITCH) - 1;
  const firstColumn = Math.floor((left - ODD_ROW_SHIFT - TILE_WIDTH) / COLUMN_PITCH) + 1;
  const lastColumn = Math.ceil(right / COLUMN_PITCH) - 1;

  return {
    x0: Math.max(0, firstColumn - 1),
    y0: Math.max(0, firstRow - 1),
    x1: Math.min(map.width - 1, lastColumn + 1),
    y1: Math.min(map.height - 1, lastRow + 1),
  };
}
