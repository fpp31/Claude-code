/**
 * Unit sprites (work package WP5): chunky big-headed figures in their
 * owner's colours (characters 1-4, see format.ts).
 *
 * All four share the body of the reference picture (groups "man" and
 * "manB" of docs/art/style-d-reference.svg): a big head with two eyes, a
 * tunic in the owner's colour, two feet and a shadow. What they carry and
 * wear tells them apart at a glance:
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
