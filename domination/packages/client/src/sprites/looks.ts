/**
 * The three looks of a sprite (work package WP5). Pure: no canvas.
 *
 *  - 'normal'  as drawn;
 *  - 'fogged'  the fog-of-war twin, for things on tiles that were explored
 *              but are not in sight: every colour blended 45% towards the
 *              colour of the unknown;
 *  - 'spent'   the dimmed twin of a unit that has no moves left this turn:
 *              half drained of colour and darker, but still recognisably
 *              in its owner's colour.
 *
 * Why twins and not a dark hexagon laid over the tile: sprites stick out of
 * their hexagon (a city's flag, a unit's sword), and the part sticking out
 * would stay bright.
 */

import { formatColor, mixRgb, parseColor } from './color';
import type { Rgba } from './color';
import type { RasterImage } from './format';
import { PALETTE } from './palette';

export type SpriteLook = 'normal' | 'fogged' | 'spent';

/** All looks (for loops and tests). */
export const SPRITE_LOOKS: readonly SpriteLook[] = ['normal', 'fogged', 'spent'];

/** The fog look: this far towards this colour. */
export const FOG_COLOR = PALETTE.outline;
export const FOG_AMOUNT = 0.45;

/** The spent look: this far towards grey, then this far towards the fog colour. */
const SPENT_TOWARDS_GREY = 0.5;
const SPENT_TOWARDS_DARK = 0.3;

const FOG_RGBA = parseColor(FOG_COLOR);

/**
 * One colour with a look applied. The alpha is kept: a see-through pixel
 * (a shadow) blended over a fogged ground then comes out exactly as if the
 * finished picture had been fogged.
 */
export function colorWithLook(color: Rgba, look: SpriteLook): Rgba {
  switch (look) {
    case 'normal':
      return color;
    case 'fogged':
      return mixRgb(color, FOG_RGBA, FOG_AMOUNT);
    case 'spent': {
      // How bright the colour looks to the eye (green counts most, blue least).
      const brightness = Math.round(0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2]);
      const grey: Rgba = [brightness, brightness, brightness, color[3]];
      return mixRgb(mixRgb(color, grey, SPENT_TOWARDS_GREY), FOG_RGBA, SPENT_TOWARDS_DARK);
    }
  }
}

/** A '#rrggbb' colour as it looks on a fogged tile (for banners and border strips). */
export function foggedColor(color: string): string {
  return formatColor(colorWithLook(parseColor(color), 'fogged'));
}

/** A copy of the picture with the look applied to every pixel. */
export function imageWithLook(image: RasterImage, look: SpriteLook): RasterImage {
  const pixels = new Uint8ClampedArray(image.pixels);
  if (look !== 'normal') {
    for (let at = 0; at < pixels.length; at += 4) {
      const changed = colorWithLook([pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]], look);
      pixels[at] = changed[0];
      pixels[at + 1] = changed[1];
      pixels[at + 2] = changed[2];
    }
  }
  return { width: image.width, height: image.height, pixels };
}
