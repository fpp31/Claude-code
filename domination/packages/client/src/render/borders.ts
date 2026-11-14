/**
 * Territory borders (work package WP5). Pure: no canvas.
 *
 * A player's territory is shown by a coloured line along its outer edge, not
 * by a colour wash over its tiles (the wash looked muddy on the art). The
 * line is made of strips drawn INSIDE each owned tile, along every edge
 * where the territory ends: 2 pixels of the owner's primary colour at the
 * edge, then 1 pixel of the secondary colour inside it. Strips of
 * neighboring tiles join into one closed line.
 */

import { DIRECTION_COUNT, neighborInDirection } from '@domination/shared';
import type { PlayerView, TileIndex } from '@domination/shared';
import { parseColor } from '../sprites/color';
import type { OwnerColors, RasterImage } from '../sprites/format';
import { blendPixel, createImage } from '../sprites/image';
import { TILE_HEIGHT, TILE_WIDTH, hexEdgeDepth, isInsideHex } from './geometry';

/** Thickness of the two lines of a strip (see hexEdgeDepth for how thickness is counted). */
export const BORDER_OUTER = 2;
export const BORDER_INNER = 1;

/**
 * Which edges of a tile are territory borders, as a set of bits: bit d is
 * set if the edge facing direction d (0 = E, 1 = SE, 2 = SW, 3 = W, 4 = NW,
 * 5 = NE) is one. 0 for a tile nobody owns and for a never-seen tile.
 *
 * An edge is a border if what lies beyond it has a different owner. That
 * includes: no owner, a never-seen neighbor, and no neighbor at all (the
 * edge of the map), so every territory is closed all the way round.
 */
export function borderEdges(view: PlayerView, tile: TileIndex): number {
  const owner = view.tiles[tile]?.owner ?? null;
  if (owner === null) return 0;
  let edges = 0;
  for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
    const neighbor = neighborInDirection(tile, direction, view);
    const neighborOwner = neighbor === null ? null : view.tiles[neighbor]?.owner ?? null;
    if (neighborOwner !== owner) edges |= 1 << direction;
  }
  return edges;
}

/**
 * The border strip of one tile as a 26 x 28 picture: transparent except for
 * the strips along the edges in `edges` (see borderEdges). Where two strips
 * meet in a corner they join without a gap.
 */
export function borderStripImage(edges: number, colors: OwnerColors): RasterImage {
  const primary = parseColor(colors.primary);
  const secondary = parseColor(colors.secondary);
  const image = createImage(TILE_WIDTH, TILE_HEIGHT);
  if (edges === 0) return image;
  for (let y = 0; y < TILE_HEIGHT; y++) {
    for (let x = 0; x < TILE_WIDTH; x++) {
      if (!isInsideHex(x, y)) continue;
      // How far this pixel is from the nearest edge that is a border.
      let depth = Infinity;
      for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
        if ((edges & (1 << direction)) !== 0) depth = Math.min(depth, hexEdgeDepth(x, y, direction));
      }
      if (depth < BORDER_OUTER) blendPixel(image, x, y, primary);
      else if (depth < BORDER_OUTER + BORDER_INNER) blendPixel(image, x, y, secondary);
    }
  }
  return image;
}
