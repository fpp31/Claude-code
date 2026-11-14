/**
 * Turning text sprites into pixels (work package WP5). Pure: no canvas, so
 * the art can be checked by tests without a browser.
 */

import type { OwnerColors, RasterImage, SpriteSource } from './format';

/**
 * Draws a text sprite into RGBA bytes.
 *
 *  - Parts are stamped first, in order, then the sprite's own rows on top.
 *  - Semi-transparent pixels (the shadow, or '#rrggbbaa' colours) are
 *    blended over what is already there ("source over").
 *  - The reserved characters are explained in format.ts. `owner` supplies
 *    the colours for 1-4; a sprite that uses them needs an owner.
 *
 * Throws an Error with the sprite's problem spelled out (a row of the wrong
 * length, the wrong number of rows, a character that is neither reserved nor
 * in `colors`, an owner character without an owner): art mistakes should be
 * loud and easy to find.
 */
export function rasterizeSprite(source: SpriteSource, owner?: OwnerColors): RasterImage {
  throw new Error('not implemented: rasterizeSprite');
}

/**
 * The three shades of an owner colour used by the characters 1, 2 and 3:
 * lit (mixed 45% towards white), base, shaded (mixed 22% towards black).
 * Returns '#rrggbb' strings.
 */
export function ownerRamp(primary: string): { lit: string; base: string; shaded: string } {
  throw new Error('not implemented: ownerRamp');
}
