/**
 * Marker sprites (work package WP5): what the renderer draws on top of the
 * map for the selection and the highlights of the overlay (render/api.ts).
 * None of them is in the reference picture; they follow its rules (hard
 * pixels, dark outline, a shadow under raised things).
 *
 * The tile-shaped ones are written with `hexRows`, so their rings follow the
 * pixel hexagon exactly: ring 0 is the outermost line of pixels of the tile,
 * ring 1 the line inside it, and so on.
 */

import { TILE_HEIGHT, TILE_WIDTH } from '../../render/geometry';
import type { SpriteSource } from '../format';
import { PALETTE } from '../palette';
import { hexRows } from './hexShape';

export type MarkerId = 'selection' | 'reachable' | 'hover' | 'worked' | 'pathStep' | 'pathEnd';

/** All marker ids (for loops and tests). */
export const MARKER_IDS: readonly MarkerId[] = ['selection', 'reachable', 'hover', 'worked', 'pathStep', 'pathEnd'];

/** The selected tile: a bold white ring with a dark line on both sides, so it shows on any ground. */
const selection: SpriteSource = {
  width: TILE_WIDTH,
  height: TILE_HEIGHT,
  colors: { w: PALETTE.markerWhite },
  rows: hexRows((_x, _y, ring) => {
    if (ring === 0 || ring === 3) return '#';
    if (ring === 1 || ring === 2) return 'w';
    return '.';
  }),
};

/**
 * "You can go here": a bright white ring just inside the tile's edge, with a
 * darker line on both sides of it so that it shows on pale sand as well as
 * on dark forest, and a light wash over the middle. Neighboring reachable
 * tiles form a honeycomb.
 */
const reachable: SpriteSource = {
  width: TILE_WIDTH,
  height: TILE_HEIGHT,
  colors: { o: PALETTE.reachEdge, r: PALETTE.markerWhite, i: PALETTE.reachInner, f: PALETTE.reachWash },
  rows: hexRows((_x, _y, ring) => {
    if (ring === 0) return 'o';
    if (ring === 1) return 'r';
    if (ring === 2) return 'i';
    return 'f';
  }),
};

/** The tile under the mouse pointer: only a faint line along its edge. */
const hover: SpriteSource = {
  width: TILE_WIDTH,
  height: TILE_HEIGHT,
  colors: { h: PALETTE.hoverLine },
  rows: hexRows((_x, _y, ring) => (ring === 0 ? 'h' : '.')),
};

/** A tile worked by a citizen: a small gold token. */
const worked: SpriteSource = {
  width: 9,
  height: 7,
  offsetX: 10,
  offsetY: 11,
  colors: { l: PALETTE.tokenLight, g: PALETTE.gold, d: PALETTE.tokenShade },
  rows: [
    '..###....',
    '.#lgg#...',
    '#lgggd#..',
    '#ggggd#..',
    '#gggdd#::',
    '.#ddd#:::',
    '..###::::',
  ],
};

/** One dot of the path preview's dotted line, centred on the middle of the tile box. */
const pathStep: SpriteSource = {
  width: 6,
  height: 6,
  offsetX: 10,
  offsetY: 11,
  colors: { w: PALETTE.markerWhite },
  rows: [
    '..##..',
    '.#ww#.',
    '#wwww#',
    '#wwww#',
    '.#ww#.',
    '..##..',
  ],
};

/** The last tile of the path preview: a white ring, "the unit will stop here". */
const pathEnd: SpriteSource = {
  width: 8,
  height: 8,
  offsetX: 9,
  offsetY: 10,
  colors: { w: PALETTE.markerWhite },
  rows: [
    '..####..',
    '.#wwww#.',
    '#ww##ww#',
    '#w#..#w#',
    '#w#..#w#',
    '#ww##ww#',
    '.#wwww#.',
    '..####..',
  ],
};

export const MARKER_SPRITES: Record<MarkerId, SpriteSource> = {
  selection,
  reachable,
  hover,
  worked,
  pathStep,
  pathEnd,
};
