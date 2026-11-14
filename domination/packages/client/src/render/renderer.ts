/**
 * The map renderer (work package WP5): draws a PlayerView on a canvas.
 *
 * WP5 owns packages/client/src/render/ and src/sprites/ and may add files
 * (camera, layers, animation...). The only things the rest of the client
 * uses are `createMapRenderer` and the types in api.ts.
 *
 * To look at your renderer in a browser before the app shell (WP4) exists,
 * run the dev server and open /dev-map.html (src/dev/mapHarness.ts): the
 * sample view with drag, wheel and click wired to the seam in api.ts.
 */

import type { MapRenderer } from './api';

/**
 * Creates the renderer for one canvas element. The canvas is sized by CSS
 * (WP4 makes it fill the game screen) and is ALREADY IN THE DOCUMENT when
 * this is called. Measure it right here, synchronously
 * (canvas.getBoundingClientRect()), and from then on watch its size with a
 * ResizeObserver; the renderer never needs to be told about a resize. (A
 * ResizeObserver alone would not do: it reports a little later, and WP4
 * calls setView and centerOn straight after creating the renderer.)
 * See the two "not ready yet" rules at the top of api.ts.
 *
 * PIXELS
 *  - Canvas 2D, `imageSmoothingEnabled = false` everywhere.
 *  - The backing store matches the device pixels of the canvas box.
 *  - Zoom is a whole number of DEVICE pixels per art pixel (so sprites are
 *    integer-scaled and crisp on any display); the first zoom shows roughly
 *    3 CSS pixels per art pixel; range about 1x to 6x CSS scale.
 *  - The camera position is snapped to whole device pixels when drawing.
 *
 * WHEN TO DRAW
 *  - Redraw only when something changed (view, overlay, camera, size) or an
 *    animation is running: keep a dirty flag and draw at most once per
 *    animation frame. Never run an idle loop.
 *  - Draw only the tiles that are on screen.
 *
 * THE FOG LOOK. A tile that is explored but not `visible` is "fogged":
 * everything drawn for it is blended 45% towards '#22223a'. Sprites may
 * stick out of their hexagon (tall mountains, city roofs), so the fog cannot
 * be one hexagon laid over the tile afterwards: the part sticking out would
 * stay bright. Give every sprite a fogged twin instead (rasterise it a
 * second time with the blend applied to its opaque pixels, or tint it per
 * sprite when drawing) and draw the twin for things on fogged tiles.
 *
 * WHAT TO DRAW, back to front (hex shapes always from geometry.ts):
 *  1. Background '#22223a'. Never-seen tiles (null) are simply not drawn.
 *  2. Ground of every explored tile: the terrain's ground sprite (fogged
 *     twin on fogged tiles), with the hex grid only faintly hinted (as in
 *     the reference picture).
 *  3. Territory borders: along each edge of an owned tile whose neighbor has
 *     a different owner, a strip INSIDE the tile: 2 px of the owner's
 *     primary colour at the edge and 1 px of the secondary colour inside it.
 *     No colour wash over the tile. "A different owner" includes: no owner,
 *     a never-seen neighbor (null), and NO neighbor at all (the edge of the
 *     map), so every territory is closed all the way round. On fogged tiles
 *     the strip gets the fog look too.
 *  4. Features (forest, hills, mountains), row by row from the top, so that
 *     tall things overlap the row behind them (fogged twin on fogged tiles).
 *  5. Highlights from the overlay: reachable tiles, path preview, worked
 *     tiles (a small marker in the middle of each tile of
 *     overlay.workedTiles, clearly different from the reachable highlight),
 *     selection ring, hover outline. Reachable tiles must be unmistakable.
 *  6. Cities, then units, row by row from the top, in their owner's colours.
 *     A remembered city (CityView.visible false) stands on a fogged tile and
 *     is drawn with its fogged twin. On a tile with two units the civilian
 *     stands offset behind the military unit, unless overlay.selectedUnitId
 *     says otherwise. Own units with no moves left are drawn dimmed.
 *  7. City banners in the pixel font: the name (upper case) and the
 *     population, written in the owner's SECONDARY colour
 *     (CIVS[civ].secondary) on a plate of the owner's PRIMARY colour with a
 *     '#22223a' frame (as data/civs.ts says; all six pairs read well this
 *     way round). The banner of a remembered city gets the fog look. Text is
 *     drawn at a whole-number scale: max(1, floor(zoom / 2)) device pixels
 *     per font pixel.
 *
 * ANIMATION is optional and purely cosmetic: at most a short slide when a
 * unit that existed in the previous view has a new tile in the next one.
 * Nothing may depend on it, and hit testing always uses the real positions.
 *
 * @param canvas  the canvas to draw on (WP4 creates it, gives it
 *                `touch-action: none` so touch gestures reach the app, and
 *                appends it to the page before calling this)
 */
export function createMapRenderer(canvas: HTMLCanvasElement): MapRenderer {
  throw new Error('not implemented: createMapRenderer');
}
