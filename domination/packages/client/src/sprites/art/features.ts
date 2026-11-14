/**
 * Feature sprites (work package WP5): forest, hills, mountains.
 *
 * `tree` below is the worked example of the text format, ported pixel for
 * pixel from the "tree" group of docs/art/style-d-reference.svg. The mound
 * and the mountain are ported the same way from the groups "mound" and "m".
 *
 * A feature is drawn on top of the ground sprite of its tile, so it carries
 * no ground of its own. In the reference all three stand on grass. To look
 * right on plains and desert too:
 *  - hills take their three colours from the ground they stand on (green
 *    mounds on grass, straw-coloured ones on plains, sand ones on desert);
 *  - mountains are the same rock on grass and plains, and warmer sandstone
 *    with a smaller snow cap on desert;
 *  - forest is the same dark pine wood everywhere.
 */

import type { FeatureId, TerrainId } from '@domination/shared';
import { TILE_WIDTH } from '../../render/geometry';
import type { SpriteSource } from '../format';
import { PALETTE } from '../palette';

export const tree: SpriteSource = {
  width: 8,
  height: 9,
  colors: { g: PALETTE.pine, d: PALETTE.pineShade, l: PALETTE.pineLight, t: PALETTE.trunk },
  rows: [
    '..###...',
    '..#g#...',
    '.#lgd#..',
    '.#ggd#..',
    '#lggdd#.',
    '#gggdd#.',
    '#######.',
    '..#t#:::',
    '..###:::',
  ],
};

/** Five trees, back row first so the front ones overlap them (as in the reference). */
const forest: SpriteSource = {
  width: TILE_WIDTH,
  height: 19,
  offsetY: 3,
  parts: [
    { sprite: tree, x: 11, y: 0 },
    { sprite: tree, x: 4, y: 3 },
    { sprite: tree, x: 17, y: 4 },
    { sprite: tree, x: 8, y: 9 },
    { sprite: tree, x: 15, y: 10 },
  ],
};

/** One rounded mound in the given three colours: lit top left, shaded lower right. */
function mound(light: string, base: string, shade: string): SpriteSource {
  return {
    width: 13,
    height: 7,
    colors: { l: light, g: base, d: shade },
    rows: [
      '...######....',
      '.##lllggg##..',
      '#llggggggdd#.',
      '#ggggggdddd#.',
      '#ggggdddddd#.',
      '.##########..',
      '..:::::::::::',
    ],
  };
}

/** Two mounds, the far one first (reference group "h"). */
function hills(light: string, base: string, shade: string): SpriteSource {
  const one = mound(light, base, shade);
  return {
    width: TILE_WIDTH,
    height: 13,
    offsetY: 7,
    parts: [
      { sprite: one, x: 2, y: 0 },
      { sprite: one, x: 12, y: 6 },
    ],
  };
}

/** The snow-capped peak (reference group "m"); `s` and `S` are snow, `r`, `R` and `L` the rock. */
const MOUNTAIN_ROWS = [
  '...........####...........',
  '..........#ssSS#..........',
  '.........#sssSSS#.........',
  '........#sssssSSS#........',
  '.......#LssrrssRRR#.......',
  '......#LrrrrrRRRRRR#......',
  '.....#LrrrLrrRRRRRRR#.....',
  '....#LrrrrLrrRRRRRRRR#....',
  '...#LrrrLrrrrRRRRRRRRR#...',
  '..#LrrrrLrrrrRRRRRRRRRR#..',
  '.#rrrrrrrrrrrRRRRRRRRRRR#.',
  '.########################.',
  '....::::::::::::::::::::::',
  '......::::::::::::::::::..',
];

const mountains: SpriteSource = {
  width: TILE_WIDTH,
  height: 14,
  offsetY: 4,
  colors: {
    r: PALETTE.rock, R: PALETTE.rockShade, L: PALETTE.rockLight,
    s: PALETTE.snow, S: PALETTE.snowShade,
  },
  rows: MOUNTAIN_ROWS,
};

/**
 * The desert peak: the same shape in sandstone. Only the very tip keeps
 * its snow (the two lower snow rows are drawn as lit and shaded rock).
 */
const desertMountains: SpriteSource = {
  ...mountains,
  colors: {
    r: PALETTE.sandstone, R: PALETTE.sandstoneShade, L: PALETTE.sandstoneLight,
    s: PALETTE.snow, S: PALETTE.snowShade,
  },
  rows: MOUNTAIN_ROWS.map((row, y) => (y >= 3 && y <= 4 ? row.replace(/s/g, 'L').replace(/S/g, 'R') : row)),
};

const grassHills = hills(PALETTE.hillLight, PALETTE.hill, PALETTE.hillShade);
const plainsHills = hills(PALETTE.plainsHillLight, PALETTE.plainsHill, PALETTE.plainsHillShade);
const desertHills = hills(PALETTE.desertHillLight, PALETTE.desertHill, PALETTE.desertHillShade);

/**
 * Every feature's sprite for every ground it can be drawn on. (The map
 * generator never puts a feature on water; those entries only make sure
 * there is a picture for anything a view could contain.)
 */
export const FEATURE_SPRITES: Record<FeatureId, Record<TerrainId, SpriteSource>> = {
  forest: { ocean: forest, coast: forest, grassland: forest, plains: forest, desert: forest },
  hills: { ocean: grassHills, coast: grassHills, grassland: grassHills, plains: plainsHills, desert: desertHills },
  mountains: { ocean: mountains, coast: mountains, grassland: mountains, plains: mountains, desert: desertMountains },
};
