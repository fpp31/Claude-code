/**
 * The light line around a unit that stands among trees. Pure: no canvas.
 *
 * Units and trees are drawn from the same strong greens, reds and blues,
 * with the same dark outline, so a figure in a forest was hard to find
 * (worst of all a dimmed one that has already moved). A thin pale line
 * around the figure lifts it off the trees. The reference picture has no
 * unit in a forest, so this is an addition to it; on open ground units are
 * drawn exactly as in the reference, without the line.
 */

import type { Rgba } from './color';
import { parseColor } from './color';
import type { RasterImage } from './format';
import { createImage, getPixel, stampImage } from './image';
import { PALETTE } from './palette';

/** The colour of the line. */
export const RIM_COLOR: Rgba = parseColor(PALETTE.unitRim);

/**
 * How many empty rows `imageWithRim` adds on top of the picture. A sword or
 * a feather may touch the top edge of a unit's picture, and the line has to
 * go above it. (At the sides and at the bottom the pictures have room.)
 */
export const RIM_ROWS_ADDED = 1;

/**
 * A copy of the picture with a line of `color` around the figure: every
 * fully see-through pixel that touches a solid pixel (left, right, above or
 * below) is painted. The cast shadow is see-through but not fully, so it is
 * neither painted over nor given a line of its own.
 *
 * The copy is RIM_ROWS_ADDED rows taller than the picture (the rows are
 * added on top), so it has to be drawn that many art pixels higher. A line
 * that would fall outside the copy at the sides or below is left out.
 */
export function imageWithRim(image: RasterImage, color: Rgba = RIM_COLOR): RasterImage {
  const result = createImage(image.width, image.height + RIM_ROWS_ADDED);
  stampImage(result, image, 0, RIM_ROWS_ADDED);

  const isSolid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < image.width && y < image.height && getPixel(image, x, y)[3] === 255;

  for (let y = -RIM_ROWS_ADDED; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const empty = y < 0 || getPixel(image, x, y)[3] === 0;
      if (!empty) continue;
      if (isSolid(x - 1, y) || isSolid(x + 1, y) || isSolid(x, y - 1) || isSolid(x, y + 1)) {
        const at = ((y + RIM_ROWS_ADDED) * result.width + x) * 4;
        result.pixels.set(color, at);
      }
    }
  }
  return result;
}
