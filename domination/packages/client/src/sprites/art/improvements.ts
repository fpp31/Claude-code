/**
 * Improvement sprites: what a Worker builds on a tile (a farm, a mine) and
 * what a Fishing Boat builds (a fishing net, round 3). None is in the
 * reference picture; they follow its rules (hard pixels, a dark outline,
 * light from the top left, a shadow to the lower right).
 *
 * An improvement is drawn on top of the bare ground of its tile, over the
 * territory's border strip and over the tile's feature (a mine stands on
 * hills). Like a feature it carries no ground of its own, and it comes in
 * one picture per ground it can stand on.
 *
 * Every picture stays inside its own tile box and at least 3 pixels inside
 * the hexagon, so it never covers a border strip (render/terrainLayer.ts
 * relies on the first, test/render.test.ts checks both). None reaches the
 * top point of the tile, where the worked-tile token lies (marker.worked).
 *
 * They were drawn to be told apart at a glance at the smallest zoom and
 * under fog: a farm is a striped block with a pale hut, a mine a pale rock
 * with a dark hole, a net a ring of six orange dots on water; plain hills
 * and plain coast have none of these.
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

/** One cork float of a fishing net: an orange disc with a light pixel at the upper left. */
const float: SpriteSource = {
  width: 4,
  height: 4,
  colors: { f: PALETTE.bow, F: PALETTE.strawLight },
  rows: [
    '.##.',
    '#Ff#',
    '#ff#',
    '.##.',
  ],
};

/**
 * Where the six floats of a net lie inside its picture, by their top-left
 * corners: one at the top, one at the bottom, two at each side.
 */
const NET_FLOATS: [x: number, y: number][] = [[8, 0], [1, 3], [15, 3], [1, 11], [15, 11], [8, 14]];

/**
 * A fishing net: a ring of six cork floats on the water. Between the floats
 * the head rope shows as a few dark dots; inside the ring the net is a
 * faint lattice in the shadow colour, so the water shows through. It
 * belongs to the tile, not to a player: no owner's colour.
 *
 * Why it reads. Orange dots on blue are like nothing else on the map (wave
 * dashes are white and flat, the dots of a path white and in the middle of
 * the tile). The ground under an improvement is drawn bare, so a fished
 * tile is also the one coast tile without wave dashes: calm water with a
 * ring on it. It is still the coast's own blue and lies between wavy tiles
 * without a line, so it reads as water; the picture carries no wave marks
 * of its own. Fogged, the ring is still six dots.
 *
 * The top float and the worked-tile token. The token lies in the top point
 * of the tile (x 9 to 18, y 0 to 5 of the tile box), the top float right
 * under it (x 11 to 14, y 6 to 9), and both are a warm disc with the same
 * light pixel. They were looked at on the map at the smallest zoom, a net
 * nobody gathers from beside a net with the token: the token is twice as
 * wide (eight pixels against four, ten with its shadow) and yellow, the
 * float one of six equal orange dots of a ring, and the lone float was not
 * taken for a token. So the ring keeps a float in the top point.
 *
 * The other ring, with floats at the left, at the right and at the four
 * slanted sides (corners (4,1) (12,1) (0,7) (16,7) (4,13) (12,13), the
 * rope drawn anew), was tried on the same map. It leaves the token free of
 * every float, and it is the cure should the top float ever be taken for a
 * token. What it costs is seen under boats, below.
 *
 * With a Fishing Boat on the tile the hull covers the two lower side
 * floats and the mast most of the top one; in view stay the two upper side
 * floats left and right of the sail, the bottom float under the hull and
 * the lattice at both sides. A Scout Boat's sail is wider: under it only
 * the bottom float between the oars and half of the upper left one show,
 * with the lattice at both ends of the hull. Under both boats the top and
 * the bottom float show. (The other ring shows four floats under a Scout
 * Boat, but only pieces under a Fishing Boat and none under both.)
 * test/render.test.ts holds these numbers; whoever draws a boat or the net
 * anew looks at them together in the sprite gallery.
 */
const fishingNet: SpriteSource = {
  width: 20,
  height: 18,
  offsetX: 3,
  offsetY: 6,
  parts: [
    {
      // The rope and the lattice; the floats are stamped over them. The lattice is a diamond mesh, which has
      // no mirror image on a picture 20 wide: it is centred half a pixel right of the ring and half a pixel above.
      sprite: {
        width: 20,
        height: 18,
        rows: [
          '....................',
          '....................',
          '......#......#......',
          '.......:.:.:.:......',
          '........:...:.......',
          '.....:.:.:.:.:.:....',
          '......:...:...:.....',
          '...:.:.:.:.:.:.:.:..',
          '.#..:...:...:...:.#.',
          '.#.:.:.:.:.:.:.:.:#.',
          '......:...:...:.....',
          '.....:.:.:.:.:.:....',
          '........:...:.......',
          '.......:.:.:.:......',
          '....................',
          '......#......#......',
          '....................',
          '....................',
        ],
      },
      x: 0,
      y: 0,
    },
    ...NET_FLOATS.map(([x, y]) => ({ sprite: float, x, y })),
  ],
};

const grassFarm = farm(PALETTE.soil, PALETTE.soilShade, PALETTE.crop);
const plainsFarm = farm(PALETTE.soil, PALETTE.soilShade, PALETTE.gold);
const desertFarm = farm(PALETTE.desertSoil, PALETTE.sandstoneShade, PALETTE.cactus);

/**
 * Every improvement's sprite for every ground. (A farm and a mine never
 * stand on water and a net stands on coast alone; the other entries only
 * make sure there is a picture for anything a view could contain, as in
 * FEATURE_SPRITES.)
 */
export const IMPROVEMENT_SPRITES: Record<ImprovementId, Record<TerrainId, SpriteSource>> = {
  farm: { ocean: grassFarm, coast: grassFarm, grassland: grassFarm, plains: plainsFarm, desert: desertFarm },
  mine: { ocean: mine, coast: mine, grassland: mine, plains: mine, desert: mine },
  fishingNet: { ocean: fishingNet, coast: fishingNet, grassland: fishingNet, plains: fishingNet, desert: fishingNet },
};
