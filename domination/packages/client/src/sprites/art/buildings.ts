/**
 * Building sprites (work package WP5).
 *
 * The city is the hall of docs/art/style-d-reference.svg (groups "hallA" and
 * "hallB" plus the roof rectangles), in three-quarter view: you look at the
 * front wall and down onto the roof.
 *
 * Owner colours (see format.ts): the roof is the owner's primary colour, lit
 * along its top row (1), plain in the middle (2), and shaded on its right
 * end and along the eaves (3). The square above the roof is the flag; the
 * renderer hangs the name banner on top of it.
 */

import { TILE_WIDTH } from '../../render/geometry';
import type { SpriteSource } from '../format';
import { PALETTE } from '../palette';

export const city: SpriteSource = {
  width: TILE_WIDTH,
  height: 20,
  offsetY: 1,
  colors: { w: PALETTE.wall, s: PALETTE.wallShade, b: PALETTE.window, d: PALETTE.door },
  rows: [
    '............######........',
    '............#2222#........',
    '............#2222#........',
    '............#2222#........',
    '............######........',
    '............######........',
    '.....################.....',
    '.....#11111111111111#.....',
    '.....#22222222223333#.....',
    '.....#22222222223333#.....',
    '.....#33333333333333#.....',
    '.....#wwwwwwwwwwssss#.....',
    '.....#wbbwwbbwwwsbbs#.....',
    '.....#wbbwwbbwwwsbbs#.....',
    '.....#wwwwwwwwwwssss#.....',
    '.....#wwwwdddwwwssss#.....',
    '.....#wwwwdddwwwssss#.....',
    '.....#wwwwdddwwwssss#.....',
    '.....################::...',
    '........:::::::::::::::...',
  ],
};
