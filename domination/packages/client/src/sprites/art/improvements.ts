/**
 * Improvement sprites: what a Worker builds on a tile (a farm, a mine).
 * Neither is in the reference picture; they follow its rules (hard pixels,
 * a dark outline, light from the top left, a shadow to the lower right).
 *
 * An improvement is drawn on top of the bare ground of its tile, over the
 * territory's border strip and over the tile's feature (a mine stands on
 * hills). Like a feature it carries no ground of its own, and it comes in
 * one picture per ground it can stand on.
 *
 * Both pictures stay inside their own tile box and at least 3 pixels inside
 * the hexagon, so they never cover a border strip (render/terrainLayer.ts
 * relies on the first, test/render.test.ts checks both).
 *
 * Both were drawn to be told apart at a glance at the smallest zoom and
 * under fog: a farm is a striped block with a pale hut, a mine a pale rock
 * with a dark hole, and plain hills have neither.
 */

import type { ImprovementId, TerrainId } from '@domination/shared';
import type { SpriteSource } from '../format';
import { PALETTE } from '../palette';

/**
 * A farm in the given three colours: soil, the soil's darker edge, the crop.
 * A small hut with a straw roof, and one field that lies beside the hut and
 * below it. The crop stands in rows with bare soil between them: the
 * furrows are what says "field" when the picture is small. (Dots of crop,
 * the first drawing, looked like a brick wall.)
 */
function farm(soil: string, edge: string, crop: string): SpriteSource {
  return {
    width: 20,
    height: 13,
    offsetX: 3,
    offsetY: 7,
    colors: {
      s: soil, S: edge, c: crop,
      l: PALETTE.strawLight, y: PALETTE.straw, Y: PALETTE.strawShade,   // the roof
      w: PALETTE.wall, W: PALETTE.wallShade, d: PALETTE.door,           // the hut
    },
    rows: [
      '.######.............',
      '#lyyyyY#...SSSSSSSSS',
      '#yyyyYY#...ScccccccS',
      '########...SsssssssS',
      '#wwwwWW#...ScccccccS',
      '#wdwwWW#...SsssssssS',
      '########::.ScccccccS',
      '.SSSSSSSSSSSSSSSSSSS',
      '.ScccccccccccccccccS',
      '.SsssssssssssssssssS',
      '.ScccccccccccccccccS',
      '.SsssssssssssssssssS',
      '.SSSSSSSSSSSSSSSSSSS',
    ],
  };
}

/**
 * A mine: the mouth of a tunnel in a pale rock, held open by a timber frame
 * (a lit beam across the top, a lit post at the left, a post in shade at the
 * right). It stands in front of the far mound of the hills, whose green top
 * still shows behind it, and it is the same picture on all three grounds.
 *
 * It keeps to the LEFT of the tile (x 3 to 11). The frame is what tells a
 * mined hill from a plain one, and the frame and the hole are at x 5 to 9:
 * a unit standing on the tile covers the middle and leaves the left of the
 * mouth in view. (The gold token that marks a worked tile lay in the middle
 * too when the mine was drawn; it is in the top point of the tile now,
 * marker.worked, and reaches nothing built on a tile.)
 *
 * Why a rock and not only a frame: a narrow frame at the foot of the round
 * mound (the first drawing) looked like a tree, its opening the trunk and
 * the mound the crown. The rock is as wide as the mouth is tall, and pale,
 * so the dark hole is the first thing the eye finds, also at the smallest
 * zoom and under fog.
 */
const mine: SpriteSource = {
  width: 9,
  height: 11,
  offsetX: 3,
  offsetY: 9,
  // `y` `p` `P` the timber: lit beam, lit post, post in shade; `L` `r` `R` the rock of the mountains; the hole is the outline colour
  colors: {
    y: PALETTE.strawLight, p: PALETTE.bow, P: PALETTE.plankShade,
    L: PALETTE.rockLight, r: PALETTE.rock, R: PALETTE.rockShade,
  },
  rows: [
    '..####...',
    '.#LLrr##.',
    '#LyyyyyR#',
    '#rp###PR#',
    '#Lp###PR#',
    '#rp###PR#',
    '#rp###PR#',
    '#rp###PR#',
    '#########',
    '.::::::::',
    '..:::::::',
  ],
};

const grassFarm = farm(PALETTE.soil, PALETTE.soilShade, PALETTE.crop);
const plainsFarm = farm(PALETTE.soil, PALETTE.soilShade, PALETTE.gold);
const desertFarm = farm(PALETTE.desertSoil, PALETTE.sandstoneShade, PALETTE.cactus);

/**
 * Every improvement's sprite for every ground. (No improvement can stand on
 * water; those entries only make sure there is a picture for anything a view
 * could contain, as in FEATURE_SPRITES.)
 */
export const IMPROVEMENT_SPRITES: Record<ImprovementId, Record<TerrainId, SpriteSource>> = {
  farm: { ocean: grassFarm, coast: grassFarm, grassland: grassFarm, plains: plainsFarm, desert: desertFarm },
  mine: { ocean: mine, coast: mine, grassland: mine, plains: mine, desert: mine },
};
