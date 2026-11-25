/**
 * Unit sprites (work package WP5; the two boats: round 3) in their owner's
 * colours (characters 1-4, see format.ts).
 *
 * The four land units are chunky big-headed figures. All four share the
 * body of the reference picture (groups "man" and "manB" of
 * docs/art/style-d-reference.svg): a big head with two eyes, a tunic in the
 * owner's colour, two feet and a shadow. What they carry and wear tells
 * them apart at a glance:
 *
 *  - unit.warrior  helmet, a bright shield on the left and a sword on the
 *                  right (the red soldier of the reference, pixel for pixel);
 *  - unit.scout    no armour: a feathered cap, a bow in the hand (the bow of
 *                  the reference's blue soldier) and bare legs with boots;
 *  - unit.settler  a wide straw hat and a loaded hand cart (a sack on a
 *                  wooden box with one big wheel) beside the figure; nothing
 *                  that looks like a weapon;
 *  - unit.worker   a bare head with brown hair and a headband in the
 *                  owner's secondary colour, and a big mattock held upright
 *                  at the right (no helmet, no hat, no cart).
 *
 * The two boats are no figures: each is a hull seen from the side, as wide
 * as the tile and low, under one mast. Nothing on land is that shape, so a
 * boat is never taken for a land unit that stands in the water. The sail
 * tells the two apart, also at the smallest zoom:
 *
 *  - unit.fishingBoat  a small open boat with ONE THREE-CORNERED sail
 *                      right of the mast, a pennant on the mast top and a
 *                      pale heap of net at the stern; the upper plank of
 *                      the hull is in the owner's colour;
 *  - unit.scoutBoat    a long boat with a tall bow post, a WIDE SQUARE sail
 *                      with two upright stripes, a pale hull, and a row of
 *                      oars in the water under it.
 *
 * New sprites must keep the style: lit left, shaded right, outline, shadow.
 */

import { TILE_WIDTH } from '../../render/geometry';
import type { SpriteSource } from '../format';
import { PALETTE } from '../palette';

/** Colours the figures share. `k` skin, `K` skin in shade. */
const BODY_COLORS = { k: PALETTE.skin, K: PALETTE.skinShade };

export const warrior: SpriteSource = {
  width: TILE_WIDTH,
  height: 17,
  offsetY: 4,
  colors: { ...BODY_COLORS, w: PALETTE.steel, g: PALETTE.gold },
  rows: [
    '.................###......',
    '..........######.#w#......',
    '.........#112222##w#......',
    '.........#222233##w#......',
    '.........#222233##w#......',
    '.........#kkkkkk##w#......',
    '.........#k#kk#k##w#......',
    '.........#kkkkkK##w#......',
    '......##########.ggg......',
    '......#111#1222#.###......',
    '......#113#1223#.###......',
    '......#113#2223#..........',
    '......#113#2223#..........',
    '......#####2223#..........',
    '..........######..........',
    '..........##..##..........',
    '...........::::::::.......',
  ],
};

export const scout: SpriteSource = {
  width: TILE_WIDTH,
  height: 19,
  offsetY: 2,
  colors: { ...BODY_COLORS, w: PALETTE.steel, o: PALETTE.bow, h: PALETTE.hair, t: PALETTE.boot },
  rows: [
    '.............###..........',
    '.............#4#..........',
    '.............#4##.........',
    '..........####44#.........',
    '.........#112223#####.....',
    '.........#222233##o##.....',
    '.........#hhhhhh##wo#.....',
    '.........#kkkkkk##wo#.....',
    '.........#k#kk#k##wo#.....',
    '.........#kkkkkK##wo#.....',
    '..........######.#wo#.....',
    '..........#1222#.#wo#.....',
    '..........#1223#.#o##.....',
    '..........#tttt#.####.....',
    '..........#2223#..........',
    '..........#kkkK#..........',
    '..........######..........',
    '..........##..##..........',
    '...........::::::::.......',
  ],
};

export const settler: SpriteSource = {
  width: TILE_WIDTH,
  height: 17,
  offsetY: 4,
  colors: {
    ...BODY_COLORS,
    y: PALETTE.straw, Y: PALETTE.strawShade, l: PALETTE.strawLight,
    c: PALETTE.sack, C: PALETTE.sackShade,
    p: PALETTE.plank, P: PALETTE.plankShade,
  },
  rows: [
    '.....######...............',
    '....#lyyyyY#..............',
    '..###222223###............',
    '.#llyyyyyyyYY#............',
    '..############..######....',
    '....#kkkkkk#...#ccccC#....',
    '....#k#kk#k#..#cccc4CC#...',
    '....#kkkkkK#..#cccc4CC#...',
    '.....######..##########...',
    '.....#1222####ppppppppP#..',
    '.....#1223#..#ppp####pP#..',
    '.....#2223#..####pPPP###..',
    '.....#2223#.....#P##P#....',
    '.....#2223#.....#P##P#....',
    '.....######.....#PPPP#....',
    '.....##..##......####.....',
    '......::::::::::::::::::..',
  ],
};

export const worker: SpriteSource = {
  width: TILE_WIDTH,
  height: 17,
  offsetY: 4,
  // `h` hair, `w` steel, `S` steel in shade, `o` the wood of the handle
  colors: { ...BODY_COLORS, h: PALETTE.hair, w: PALETTE.steel, S: PALETTE.steelShade, o: PALETTE.bow },
  rows: [
    '.................#######..',
    '..........#######wwwwwSS#.',
    '.........#hhhhhh########..',
    '.........#hhhhhh#..#o#....',
    '.........#444444#..#o#....',
    '.........#kkkkkk#..#o#....',
    '.........#k#kk#k#..#o#....',
    '.........#kkkkkK#..#o#....',
    '..........######...#o#....',
    '..........#1222#####o#....',
    '..........#1223#kkK#o#....',
    '..........#2223#####o#....',
    '..........#2223#...#o#....',
    '..........#2223#...###....',
    '..........######..........',
    '..........##..##..........',
    '...........::::::::.......',
  ],
};

/** Colours the two boats share: `p` the wood of the planks and of the mast, `P` planks in shade. */
const BOAT_COLORS = { p: PALETTE.plank, P: PALETTE.plankShade };

/**
 * The Fishing Boat. In the owner's colours: the sail (lit along the mast,
 * shaded towards its tip), the upper plank of the hull from end to end and
 * the bow post; the pennant is in the second colour. At the smallest zoom
 * the plank is what carries the colour (20 pixels in a row); the sail is
 * seven pixels wide there.
 *
 * It sits one row lower than the figures (offsetY 5): its last row, the
 * shadow, is the last row of the tile's hexagon that has the full width.
 * The mast top is the dark line that the worked-tile token ends on
 * (marker.worked, rows 0 to 5), as the line around a figure's head is: the
 * token covers nothing of the boat. The pennant hangs UNDER the mast top
 * and flies to the LEFT, clear of the sail and of the token. (Tried first:
 * right of the mast top it sat on the tip of the sail and read as a dark
 * knob; as a bar across the very top it read as a part of the mast.)
 */
export const fishingBoat: SpriteSource = {
  width: TILE_WIDTH,
  height: 17,
  offsetY: 5,
  // `n` `N` the heap of net at the stern
  colors: { ...BOAT_COLORS, n: PALETTE.sack, N: PALETTE.sackShade },
  rows: [
    '..........###.............',
    '.......####p#.............',
    '.......#444p#.............',
    '........#44p#1#...........',
    '.........##p#12#..........',
    '..........#p#122#.........',
    '..........#p#1222#........',
    '..........#p#12223#.......',
    '..........#p#122233#......',
    '..........#p#1222333#.....',
    '...####...#p##########.##.',
    '.##nNnN#..#p#.........#3#.',
    '.#1######################.',
    '..#12222222222222222223#..',
    '...#ppppppppppppppppPP#...',
    '....##################....',
    '.....:::::::::::::::::::..',
  ],
};

/**
 * The Scout Boat. In the owner's colours: the whole sail (lit along its top
 * and its left side, shaded at the right and the lower right), the largest
 * patch of owner colour any unit has, so that a foreign boat's owner is
 * read at a glance; the two upright stripes are in the second colour. The
 * hull is pale wood, not the owner's: a rectangle of colour over a long
 * pale line is what tells it from the Fishing Boat (a triangle over a line
 * of colour) when both are a few pixels tall.
 *
 * The oars are six short dark strokes with their shadows on the water, in
 * the two rows where the Fishing Boat has its keel and its shadow. The
 * mast top lies under the worked-tile token as the Fishing Boat's does.
 */
export const scoutBoat: SpriteSource = {
  width: TILE_WIDTH,
  height: 17,
  offsetY: 5,
  // `l` the pale upper plank of the hull and the tops of its two posts
  colors: { ...BOAT_COLORS, l: PALETTE.strawLight },
  rows: [
    '............###...........',
    '............#p#...........',
    '.....#################....',
    '......#1141111411113#.....',
    '......#1242222422223#.....',
    '......#1242222422223#.....',
    '......#1242222422233#...##',
    '......#2242222422333#..#l#',
    '.......#############..#p#.',
    '.##.........#p#.......#p#.',
    '#l#.........#p#......#pP#.',
    '#l#####################P#.',
    '.#lllllllllllllllllllpP#..',
    '..#pppppppppppppppppPP#...',
    '...###################....',
    '....#:.#:.#:.#:.#:.#:::...',
    '...#::#::#::#::#::#:::....',
  ],
};
