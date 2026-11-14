/**
 * Where tiles sit on screen, in ART PIXELS (the pixels the sprites are drawn
 * in, before zooming). This is the single source of truth for the hex shape:
 * hit testing, fog, highlights and border strips must all be derived from
 * the functions here, so they can never drift apart by a pixel.
 *
 * Layout (fixed by the art direction, see docs/art/style-d-reference.svg):
 *  - a tile sprite is 26 wide and 28 tall;
 *  - columns are 26 apart, rows are 22 apart;
 *  - odd rows are shifted right by 13.
 * The pixel hexagon has 572 pixels (26 x 22), and at this spacing the
 * hexagons tile the plane with no gaps and no overlaps: its pointed top (6
 * rows) fits exactly between the pointed bottoms of the two tiles above.
 *
 * Pure maths, no canvas: it runs (and is tested) without a browser.
 * (Implemented as part of the scaffold because it is the pixel-level twin of
 * the shared hex maths; WP5 owns it from here on.)
 */

import type { Coord, GridSize } from '@domination/shared';

/** Size of one tile sprite. */
export const TILE_WIDTH = 26;
export const TILE_HEIGHT = 28;
/** Distance between tile origins: horizontally within a row, vertically between rows. */
export const COLUMN_PITCH = 26;
export const ROW_PITCH = 22;
/** Odd rows start this far to the right. */
export const ODD_ROW_SHIFT = 13;
/** Rows at the top (and at the bottom) of the hexagon where it narrows to a point. */
export const HEX_POINT_ROWS = 6;
/** Number of pixels inside the hexagon. */
export const HEX_PIXEL_COUNT = 572;

/** A position in art pixels. For a whole map, (0, 0) is the top-left corner of tile (0, 0)'s sprite box. */
export interface ArtPoint {
  px: number;
  py: number;
}

/**
 * The first and last filled column in row `y` (0..27) of the pixel hexagon,
 * both inclusive. Same shape as the approved outline:
 * rows 0-5 widen from 4 to 24 pixels, rows 6-21 are the full 26, rows 22-27
 * narrow from 22 to 2.
 */
export function hexRowSpan(y: number): [first: number, last: number] {
  if (y < HEX_POINT_ROWS) return [11 - 2 * y, 14 + 2 * y];
  if (y < ROW_PITCH) return [0, TILE_WIDTH - 1];
  return [2 + 2 * (y - ROW_PITCH), 23 - 2 * (y - ROW_PITCH)];
}

/** Is the pixel (x, y) of a 26 x 28 tile box inside the hexagon? */
export function isInsideHex(x: number, y: number): boolean {
  if (y < 0 || y >= TILE_HEIGHT) return false;
  const [first, last] = hexRowSpan(y);
  return x >= first && x <= last;
}

/** Top-left corner of a tile's 26 x 28 sprite box. */
export function tileOrigin(c: Coord): ArtPoint {
  return { px: c.x * COLUMN_PITCH + (c.y & 1) * ODD_ROW_SHIFT, py: c.y * ROW_PITCH };
}

/** The middle of a tile (the point (13, 14) of its sprite box). */
export function tileCenter(c: Coord): ArtPoint {
  const origin = tileOrigin(c);
  return { px: origin.px + TILE_WIDTH / 2, py: origin.py + TILE_HEIGHT / 2 };
}

/** Size in art pixels of a whole map (its bounding box). The large map (56 x 36) is 1469 x 798. */
export function mapPixelSize(size: GridSize): { width: number; height: number } {
  return {
    width: size.width * COLUMN_PITCH + ODD_ROW_SHIFT,
    height: (size.height - 1) * ROW_PITCH + TILE_HEIGHT,
  };
}

/**
 * EXACT hit test: the tile whose hexagon contains the art pixel (px, py).
 * Fractional positions are fine (they are floored). Every pixel belongs to
 * exactly one tile. The result may be off the map (negative or too large);
 * check it with `inBounds` from the shared package.
 */
export function pixelToTile(px: number, py: number): Coord {
  px = Math.floor(px);
  py = Math.floor(py);

  // First guess: the tile whose 26 x 22 "cell" contains the pixel.
  let y = Math.floor(py / ROW_PITCH);
  const shift = (y & 1) * ODD_ROW_SHIFT;
  let x = Math.floor((px - shift) / COLUMN_PITCH);
  const localX = px - shift - x * COLUMN_PITCH;
  const localY = py - y * ROW_PITCH;

  // In the top 6 rows of the cell the corners belong to the pointed bottoms
  // of the two tiles in the row above.
  if (localY < HEX_POINT_ROWS) {
    const [first, last] = hexRowSpan(localY);
    if (localX < first) {
      // upper-left neighbor (NW)
      x -= y & 1 ? 0 : 1;
      y -= 1;
    } else if (localX > last) {
      // upper-right neighbor (NE)
      x += y & 1 ? 1 : 0;
      y -= 1;
    }
  }
  return { x, y };
}
