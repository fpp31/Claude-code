/**
 * Ground sprites (work package WP5): 26 x 28 sprites that fill exactly the
 * pixel hexagon (geometry.ts `isInsideHex`), ported from the groups "o",
 * "c", "g", "p" and "d" of docs/art/style-d-reference.svg.
 *
 * A ground is put together from parts:
 *   1. the hexagon filled with the terrain's base colour;
 *   2. a few small decorations (tufts, stalks, dunes, wave dashes), each
 *      drawn once as text below and placed by its top-left corner;
 *   3. on land, the faint hint of the hex grid along the lower and right
 *      edges (water has none, so the sea is one continuous surface).
 *
 * Every terrain has a few VARIANTS: the same decorations in other places.
 * The first variant is the tile of the reference picture. The sprite sheet
 * picks a variant per tile, which keeps a large meadow from looking like
 * one stamp repeated. To change the look of a terrain, move or add entries
 * in its lists; a decoration must stay inside the hexagon.
 *
 * Every terrain also has a BARE ground without decorations. It goes under
 * forest, hills and mountains (in the reference those tiles have no tufts
 * either), so a cactus never pokes out from behind a hill.
 */

import type { TerrainId } from '@domination/shared';
import { ROW_PITCH, TILE_HEIGHT, TILE_WIDTH, hexEdgeDepth } from '../../render/geometry';
import type { SpriteSource } from '../format';
import { PALETTE } from '../palette';
import { hexRows } from './hexShape';

type Part = { sprite: SpriteSource; x: number; y: number };

/** Places one decoration at each of the given top-left corners. */
function scatter(sprite: SpriteSource, corners: [x: number, y: number][]): Part[] {
  return corners.map(([x, y]) => ({ sprite, x, y }));
}

/**
 * The faint grid hint (reference group "edge"): the last line of pixels
 * along the two lower edges and along the right edge, black at 10%.
 * One hint per shared edge is enough, so the upper and left edges have none.
 */
const gridHint: SpriteSource = {
  width: TILE_WIDTH,
  height: TILE_HEIGHT,
  colors: { e: PALETTE.gridHint },
  rows: hexRows((x, y) => {
    const onLowerEdge = y >= ROW_PITCH && (hexEdgeDepth(x, y, 1) === 0 || hexEdgeDepth(x, y, 2) === 0);
    const onRightEdge = y < ROW_PITCH && hexEdgeDepth(x, y, 0) === 0;
    return onLowerEdge || onRightEdge ? 'e' : '.';
  }),
};

/** One ground sprite: the filled hexagon, its decorations, and on land the grid hint. */
function ground(base: string, decorations: Part[], land: boolean): SpriteSource {
  const fill: SpriteSource = {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    colors: { b: base },
    rows: hexRows(() => 'b'),
  };
  const parts: Part[] = [{ sprite: fill, x: 0, y: 0 }, ...decorations];
  if (land) parts.push({ sprite: gridHint, x: 0, y: 0 });
  return { width: TILE_WIDTH, height: TILE_HEIGHT, parts };
}

// ---- Water: wave dashes --------------------------------------------------

function wave(color: string): SpriteSource {
  return { width: 2, height: 1, colors: { w: color }, rows: ['ww'] };
}

/** The reference picture's wave pattern. */
const WAVES_A: [number, number][] = [
  [11, 3],
  [3, 8], [9, 7], [15, 8], [21, 7],
  [6, 12], [12, 11], [18, 12],
  [3, 16], [9, 15], [15, 16], [21, 15],
  [6, 20], [12, 19], [18, 20],
  [12, 24],
];
/** The same swell, shifted half a step, so neighboring tiles do not line up. */
const WAVES_B: [number, number][] = [
  [8, 4], [15, 3],
  [5, 9], [12, 8], [18, 9],
  [2, 13], [9, 13], [15, 12], [22, 13],
  [5, 17], [12, 17], [18, 16],
  [9, 21], [15, 21], [21, 20],
  [11, 25],
];

function water(base: string, dash: string): SpriteSource[] {
  return [ground(base, scatter(wave(dash), WAVES_A), false), ground(base, scatter(wave(dash), WAVES_B), false)];
}

// ---- Grassland: tufts and bright blades ----------------------------------

const tuft: SpriteSource = {
  width: 3,
  height: 2,
  colors: { t: PALETTE.grassTuftDark },
  rows: [
    '.t.',
    't.t',
  ],
};
const blade: SpriteSource = { width: 2, height: 1, colors: { l: PALETTE.grassTuftLight }, rows: ['ll'] };

const grassland: SpriteSource[] = [
  ground(PALETTE.grassBase, [
    ...scatter(tuft, [[6, 9], [16, 14], [10, 19]]),
    ...scatter(blade, [[14, 7], [20, 11], [4, 16]]),
  ], true),
  ground(PALETTE.grassBase, [
    ...scatter(tuft, [[12, 6], [3, 13], [19, 17]]),
    ...scatter(blade, [[19, 8], [9, 16], [12, 22]]),
  ], true),
  ground(PALETTE.grassBase, [
    ...scatter(tuft, [[20, 9], [8, 12], [14, 20]]),
    ...scatter(blade, [[5, 8], [15, 15], [6, 19]]),
  ], true),
];

// ---- Plains: rows of stalks with bright tips -----------------------------

const stalk: SpriteSource = {
  width: 1,
  height: 4,
  colors: { l: PALETTE.plainsStalkLight, s: PALETTE.plainsStalkDark },
  rows: ['l', 's', 's', 's'],
};

const plains: SpriteSource[] = [
  ground(PALETTE.plainsBase, scatter(stalk, [
    [5, 8], [8, 7], [11, 8], [14, 7], [17, 8], [20, 7],
    [6, 15], [9, 14], [12, 15], [15, 14], [18, 15], [21, 14],
  ]), true),
  ground(PALETTE.plainsBase, scatter(stalk, [
    [9, 5], [12, 4], [15, 5],
    [3, 11], [6, 10], [9, 11], [17, 11], [20, 10], [23, 11],
    [8, 18], [11, 17], [14, 18], [17, 17],
  ]), true),
  ground(PALETTE.plainsBase, scatter(stalk, [
    [4, 8], [7, 7], [10, 8], [18, 6], [21, 7],
    [11, 13], [14, 12], [17, 13], [20, 12],
    [5, 17], [8, 16], [14, 20], [17, 19],
  ]), true),
];

// ---- Desert: dunes, and now and then a cactus ----------------------------

const DUNE_COLORS = { l: PALETTE.desertDuneLight, d: PALETTE.desertDune };
const smallDune: SpriteSource = {
  width: 8,
  height: 3,
  colors: DUNE_COLORS,
  rows: [
    '..llll..',
    '..dddd..',
    'dddddddd',
  ],
};
const wideDune: SpriteSource = {
  width: 9,
  height: 3,
  colors: DUNE_COLORS,
  rows: [
    '..lllll..',
    '..ddddd..',
    'ddddddddd',
  ],
};
const pebble: SpriteSource = { width: 2, height: 1, colors: DUNE_COLORS, rows: ['dd'] };
const cactus: SpriteSource = {
  width: 6,
  height: 8,
  colors: { c: PALETTE.cactus },
  rows: [
    '.###..',
    '.#c##.',
    '##cc#.',
    '#cc##.',
    '##c#..',
    '.#c#..',
    '.#c#..',
    '.###::',
  ],
};

const desert: SpriteSource[] = [
  ground(PALETTE.desertBase, [
    { sprite: smallDune, x: 4, y: 9 },
    { sprite: wideDune, x: 12, y: 16 },
    { sprite: cactus, x: 16, y: 6 },
  ], true),
  ground(PALETTE.desertBase, [
    { sprite: wideDune, x: 12, y: 7 },
    { sprite: smallDune, x: 3, y: 15 },
    ...scatter(pebble, [[6, 9], [19, 15], [14, 21]]),
  ], true),
  ground(PALETTE.desertBase, [
    { sprite: smallDune, x: 6, y: 6 },
    { sprite: wideDune, x: 9, y: 18 },
    ...scatter(pebble, [[19, 11], [4, 13], [15, 14]]),
  ], true),
];

/** Every terrain's ground without decorations, for tiles that carry a feature. */
export const BARE_GROUND_SPRITES: Record<TerrainId, SpriteSource> = {
  ocean: ground(PALETTE.oceanBase, [], false),
  coast: ground(PALETTE.coastBase, [], false),
  grassland: ground(PALETTE.grassBase, [], true),
  plains: ground(PALETTE.plainsBase, [], true),
  desert: ground(PALETTE.desertBase, [], true),
};

/** Every terrain's ground sprites; the first of each list is the reference tile. */
export const GROUND_SPRITES: Record<TerrainId, SpriteSource[]> = {
  ocean: water(PALETTE.oceanBase, PALETTE.oceanWave),
  coast: water(PALETTE.coastBase, PALETTE.coastWave),
  grassland,
  plains,
  desert,
};
