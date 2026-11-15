/**
 * Marker sprites (work package WP5): what the renderer draws on top of the
 * map for the selection and the highlights of the overlay (render/api.ts),
 * and the two small signs it draws from the view alone: "at work" beside a
 * unit and "builds nothing" over a city (render/frame.ts).
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

export type MarkerId = 'selection' | 'reachable' | 'hover' | 'worked' | 'pathStep' | 'pathEnd' | 'working' | 'idle';

/** All marker ids (for loops and tests). */
export const MARKER_IDS: readonly MarkerId[] = ['selection', 'reachable', 'hover', 'worked', 'pathStep', 'pathEnd', 'working', 'idle'];

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

/**
 * A tile worked by a citizen: a small gold token in the top point of the
 * tile's hexagon (x 9 to 17, y 0 to 5), drawn after the units.
 *
 * Why there. The token used to lie in the middle of the tile, under
 * whatever stood on it, and the worked tiles are where the Workers stand:
 * with a city selected most tokens could not be seen. The top point is the
 * one place of a tile that is free of everything else: a unit's head begins
 * at y 5 (the token's last row lies on the dark line around the head, dark
 * on dark), a farm at y 7, a mine at y 9, the "at work" sign at y 6 at the
 * highest, and the name banner of a city further down lies on the LOWER
 * part of the tiles above it. It is six rows tall, not seven as it was, so
 * that it ends on that line. One thing it does cover: the feather on a
 * Scout's cap, which is the only part of a unit that reaches higher.
 */
const worked: SpriteSource = {
  width: 10,
  height: 6,
  offsetX: 9,
  offsetY: 0,
  colors: { l: PALETTE.tokenLight, g: PALETTE.gold, d: PALETTE.tokenShade },
  rows: [
    '..####....',
    '.#lggg#...',
    '#lggggd#..',
    '#ggggdd#::',
    '.#dddd#:::',
    '..####::..',
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

/**
 * A unit that is at work: a small white SQUARE sign with a dark hammer, left
 * of the figure. Square on purpose: the dots of the path preview are round
 * and white, and at the smallest zoom the two must not be mistaken for each
 * other.
 */
const working: SpriteSource = {
  width: 7,
  height: 7,
  offsetX: 1,
  offsetY: 7,
  colors: { w: PALETTE.markerWhite },
  rows: [
    '#######',
    '#wwwww#',
    '#w###w#',
    '#ww#ww#',
    '#ww#ww#',
    '#wwwww#',
    '#######',
  ],
};

/**
 * An own city that builds nothing: a small gold sign with a dark
 * exclamation mark at the upper left of the hall, left of the flag and
 * right under the name banner. Gold is the colour of every warning on the
 * page.
 *
 * Why the left: a unit alone in a city stands at the right of the hall
 * (render/scene.ts), and a city's queue usually runs empty in the very turn
 * that puts a new unit there. At the right the sign sat on that unit's head
 * and looked like the unit's own. Why two rows taller than the "at work"
 * sign: with gold above and below it the mark reads as "!"; in a 7 x 7
 * sign it touched the frame and the gold beside it read as the letter H.
 */
const idle: SpriteSource = {
  width: 7,
  height: 9,
  offsetX: 0,
  offsetY: 2,
  colors: { g: PALETTE.gold },
  rows: [
    '#######',
    '#ggggg#',
    '#gg#gg#',
    '#gg#gg#',
    '#gg#gg#',
    '#ggggg#',
    '#gg#gg#',
    '#ggggg#',
    '#######',
  ],
};

export const MARKER_SPRITES: Record<MarkerId, SpriteSource> = {
  selection,
  reachable,
  hover,
  worked,
  pathStep,
  pathEnd,
  working,
  idle,
};
