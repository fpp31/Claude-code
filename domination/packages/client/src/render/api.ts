/**
 * THE SEAM between the app shell (WP4) and the map renderer (WP5).
 *
 * WP4 (store, panels, input, controller) knows nothing about canvases,
 * sprites or camera maths. WP5 (renderer, sprites, camera) knows nothing
 * about sockets, the store or what a tap means. They meet only here:
 *
 *   WP4 calls                         WP5 does
 *   --------------------------------  ---------------------------------------
 *   createMapRenderer(canvas)         sets up drawing on that canvas
 *   renderer.setView(view)            remembers what to draw, redraws
 *   renderer.setOverlay(overlay)      remembers selection/highlights, redraws
 *   renderer.panBy / zoomBy / centerOn   moves its camera, redraws
 *   renderer.tileAt(point)            hit test: which tile is under the pointer
 *   renderer.tileToScreen(tile)       where a tile's centre is on screen
 *   renderer.destroy()                stops drawing and listening
 *
 * TWO RULES ABOUT "NOT READY YET" (both sides rely on them):
 *
 *  1. SIZE. The canvas must already be in the document, with its final CSS
 *     size, when createMapRenderer(canvas) is called (WP4 appends it first).
 *     The renderer measures it right then, synchronously
 *     (getBoundingClientRect), and again at the start of every camera and
 *     hit-test call below (panBy, zoomBy, centerOn, tileAt, tileToScreen).
 *     So every method works from the first moment, and none is ever behind
 *     a resize: setView followed at once by centerOn puts the tile in the
 *     middle of the real canvas, not of an unmeasured 300 x 150 one, and
 *     centerOn straight after the window changed its size puts it in the
 *     middle of the canvas as it is now. (The renderer's ResizeObserver
 *     hears of a new size only while the browser makes the next frame;
 *     nobody has to wait for it.)
 *
 *  2. NO VIEW. Before the first setView, and after setView(null), the
 *     renderer does not know the map's size. Then panBy, zoomBy and
 *     centerOn do nothing, tileAt returns null and tileToScreen throws.
 *
 * Both sides are written against this file, and the renderer's tests pin
 * it down (test/renderRenderer.test.ts). Change it only together with both.
 */

import type { PlayerView, TileIndex, UnitId } from '@domination/shared';

/**
 * A point on screen in CSS pixels, measured from the top-left corner of the
 * browser viewport: exactly `clientX` / `clientY` of a pointer event.
 */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Everything the renderer draws on top of the map that is not part of the view. */
export interface MapOverlay {
  /** Tile of the selected unit or city: gets the selection ring. */
  selectedTile: TileIndex | null;
  /** The selected unit, so the renderer can draw it in front when two units share the tile. */
  selectedUnitId: UnitId | null;
  /** Tiles the selected unit can reach this turn: get the "you can go here" highlight. */
  reachable: TileIndex[];
  /**
   * Path preview from the selected unit to the hovered tile (start excluded,
   * target last). Empty = none. The renderer draws it as a line that starts
   * at `selectedTile`, so a path is only ever set together with the tile of
   * the selected unit (game/selectors.ts `overlayFor` does that).
   */
  path: TileIndex[];
  /**
   * Tiles worked by the citizens of the selected city (OwnCityDetail.worked):
   * each gets a small marker, so the player sees where the city's food and
   * production come from. Empty unless an own city is selected.
   */
  workedTiles: TileIndex[];
  /** Tile under the mouse pointer: gets a faint outline. Always null on touch screens. */
  hoverTile: TileIndex | null;
}

/** An overlay with nothing selected and nothing highlighted. */
export const EMPTY_OVERLAY: MapOverlay = {
  selectedTile: null,
  selectedUnitId: null,
  reachable: [],
  path: [],
  workedTiles: [],
  hoverTile: null,
};

export interface MapRenderer {
  /**
   * The view to draw: the player's whole picture of the game, straight from
   * the store. The renderer draws ONLY from this (terrain, features, fog,
   * territory borders, cities, units, banners; colours from view.players and
   * the CIVS table). Pass null to show an empty map.
   *
   * Views are never edited in place: a changed game means a NEW view object,
   * so the renderer may compare with `===` to skip work. Calling this never
   * moves the camera (it is only brought back onto the map if the map size
   * changed).
   */
  setView(view: PlayerView | null): void;

  /** Selection and highlights. Cheap to call often (on every hover change). */
  setOverlay(overlay: MapOverlay): void;

  /**
   * Scrolls the map by a distance in CSS pixels: the content follows the
   * finger, so dragging the pointer 10 px to the right is panBy(10, 0).
   * The map cannot be lost: it stops when its edge reaches the middle of
   * the canvas (camera.ts `clampCamera`). Does nothing without a view.
   */
  panBy(dx: number, dy: number): void;

  /**
   * Zooms in (positive) or out (negative) by whole steps; zoom is always a
   * whole number of screen pixels per art pixel, so the art stays crisp.
   * One step is about one CSS pixel per art pixel, which gives about six
   * zoom levels on every display (camera.ts `zoomStep`): one step per click
   * of the + and - buttons or notch of the mouse wheel.
   * The map point under `anchor` stays under it (default: the middle of the
   * canvas). Steps beyond the smallest or largest zoom are ignored.
   * Does nothing without a view.
   */
  zoomBy(steps: number, anchor?: ScreenPoint): void;

  /**
   * Moves the camera so this tile is in the middle of the canvas. That
   * works for every tile, also one in a corner of the map. Does nothing
   * without a view or for a tile that is not on the map.
   */
  centerOn(tile: TileIndex): void;

  /**
   * HIT TEST. The tile whose hexagon contains this screen point, exact to
   * the pixel, or null if the point is outside the canvas, outside the map,
   * or there is no view. Never-seen tiles ARE returned (the controller
   * decides what a tap on one means).
   */
  tileAt(point: ScreenPoint): TileIndex | null;

  /**
   * Screen position of the centre of a tile (may be outside the canvas if
   * the tile is scrolled away). For every tile on screen,
   * tileAt(tileToScreen(tile)) === tile.
   * Throws an Error if there is no view or the tile is not on the map:
   * there is no honest answer then, and a made-up point would send a test's
   * click to the wrong place without a word.
   */
  tileToScreen(tile: TileIndex): ScreenPoint;

  /** Stops the frame loop and removes every listener and observer the renderer created. */
  destroy(): void;
}
