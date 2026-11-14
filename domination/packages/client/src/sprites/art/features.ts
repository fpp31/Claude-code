/**
 * Feature sprites (work package WP5): forest, hills, mountains.
 *
 * `tree` below is the worked example of the text format, ported pixel for
 * pixel from the "tree" group of docs/art/style-d-reference.svg. Port the
 * other sprites of the reference the same way (the SVG lists every sprite as
 * rectangles on the 26 x 28 tile, shown at 4x).
 *
 * Still to draw here:
 *  - forest: five trees at (11,3) (4,6) (17,7) (8,12) (15,13), as in the reference;
 *  - hills: two mounds at (2,7) and (12,13) (reference group "mound");
 *  - mountains: the snow-capped peak (reference group "m").
 * In the reference all three stand on grass; they must also look right on
 * plains and desert ground (the ground sprite is drawn underneath).
 */

import { PALETTE } from '../palette';
import type { SpriteSource } from '../format';

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
