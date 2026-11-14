/**
 * Turning text sprites into pixels (work package WP5). Pure: no canvas, so
 * the art can be checked by tests without a browser.
 */

import { formatColor, mixRgb, parseColor } from './color';
import type { Rgba } from './color';
import type { OwnerColors, RasterImage, SpriteSource } from './format';
import { blendPixel, createImage, stampImage } from './image';
import { PALETTE } from './palette';

/** How far the lit and the shaded owner colour are from the primary colour (see format.ts). */
const LIT_TOWARDS_WHITE = 0.45;
const SHADED_TOWARDS_BLACK = 0.22;

const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];

/** The characters that mean the same in every sprite (see format.ts). */
const TRANSPARENT = '.';
const FIXED_COLORS: Record<string, Rgba> = {
  '#': parseColor(PALETTE.outline),
  ':': parseColor(PALETTE.shadow),
};
const OWNER_CHARACTERS = '1234';

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
 * loud and easy to find. Also loud: a size that is not a whole number above
 * zero, a sprite with neither rows nor parts, a part that sticks out of the
 * sprite, and an entry in `colors` that is not one free character.
 */
export function rasterizeSprite(source: SpriteSource, owner?: OwnerColors): RasterImage {
  if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 1 || source.height < 1) {
    throw new Error(`a sprite's width and height must be whole numbers above zero, not ${source.width} x ${source.height}`);
  }
  if (source.rows === undefined && (source.parts === undefined || source.parts.length === 0)) {
    throw new Error('a sprite needs rows or parts (it has neither)');
  }

  const image = createImage(source.width, source.height);

  for (const part of source.parts ?? []) {
    const stamp = rasterizeSprite(part.sprite, owner);
    const fits =
      Number.isInteger(part.x) && Number.isInteger(part.y) &&
      part.x >= 0 && part.y >= 0 &&
      part.x + stamp.width <= source.width && part.y + stamp.height <= source.height;
    if (!fits) {
      throw new Error(
        `a ${stamp.width} x ${stamp.height} part at (${part.x}, ${part.y}) sticks out of its ${source.width} x ${source.height} sprite`,
      );
    }
    stampImage(image, stamp, part.x, part.y);
  }

  if (source.rows !== undefined) {
    const colors = characterColors(source, owner);
    if (source.rows.length !== source.height) {
      throw new Error(`the sprite has ${source.rows.length} rows, but its height is ${source.height}`);
    }
    source.rows.forEach((row, y) => {
      if (row.length !== source.width) {
        throw new Error(`row ${y} ('${row}') is ${row.length} characters long, but the sprite's width is ${source.width}`);
      }
      for (let x = 0; x < row.length; x++) {
        const character = row[x];
        if (character === TRANSPARENT) continue;
        const color = colors.get(character);
        if (color === undefined) throw new Error(unknownCharacterMessage(character, x, y, owner));
        blendPixel(image, x, y, color);
      }
    });
  }

  return image;
}

/** Every character this sprite may use (except '.') with its colour. */
function characterColors(source: SpriteSource, owner: OwnerColors | undefined): Map<string, Rgba> {
  const colors = new Map<string, Rgba>(Object.entries(FIXED_COLORS));
  if (owner !== undefined) {
    const ramp = ownerRamp(owner.primary);
    colors.set('1', parseColor(ramp.lit));
    colors.set('2', parseColor(ramp.base));
    colors.set('3', parseColor(ramp.shaded));
    colors.set('4', parseColor(owner.secondary));
  }
  for (const [character, color] of Object.entries(source.colors ?? {})) {
    const reserved = character === TRANSPARENT || character in FIXED_COLORS || OWNER_CHARACTERS.includes(character);
    if (character.length !== 1 || reserved) {
      throw new Error(`'${character}' cannot be given a colour: it must be one character that is not one of . # : 1 2 3 4`);
    }
    colors.set(character, parseColor(color));
  }
  return colors;
}

function unknownCharacterMessage(character: string, x: number, y: number, owner: OwnerColors | undefined): string {
  if (OWNER_CHARACTERS.includes(character) && owner === undefined) {
    return `the owner character '${character}' at column ${x} of row ${y} needs an owner, and none was given`;
  }
  return `the character '${character}' at column ${x} of row ${y} is neither reserved nor in the sprite's colors`;
}

/**
 * The three shades of an owner colour used by the characters 1, 2 and 3:
 * lit (mixed 45% towards white), base, shaded (mixed 22% towards black).
 * Returns '#rrggbb' strings.
 */
export function ownerRamp(primary: string): { lit: string; base: string; shaded: string } {
  const base = parseColor(primary);
  return {
    lit: formatColor(mixRgb(base, WHITE, LIT_TOWARDS_WHITE)),
    base: formatColor(base),
    shaded: formatColor(mixRgb(base, BLACK, SHADED_TOWARDS_BLACK)),
  };
}
