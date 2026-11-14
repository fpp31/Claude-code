/**
 * Text rows in the shape of the pixel hexagon (work package WP5).
 *
 * Grounds, the faint grid hint and the tile markers all have to fit the
 * hexagon to the pixel. Typing 28 rows by hand for each of them would let
 * the shape drift, so their rows are written by this helper straight from
 * render/geometry.ts, the single source of truth for the hexagon.
 */

import { TILE_HEIGHT, TILE_WIDTH, hexDepth } from '../../render/geometry';

/**
 * The 28 rows of a 26 x 28 tile sprite. `pixel` is asked for every pixel
 * inside the hexagon and answers with the character to put there; everything
 * outside the hexagon is transparent.
 *
 * `depth` says how far inside the pixel is: 0 for the outermost ring of
 * pixels, 1 for the ring inside it, and so on (geometry.ts `hexDepth`).
 */
export function hexRows(pixel: (x: number, y: number, depth: number) => string): string[] {
  const rows: string[] = [];
  for (let y = 0; y < TILE_HEIGHT; y++) {
    let row = '';
    for (let x = 0; x < TILE_WIDTH; x++) {
      const depth = hexDepth(x, y);
      row += depth < 0 ? '.' : pixel(x, y, depth);
    }
    rows.push(row);
  }
  return rows;
}
