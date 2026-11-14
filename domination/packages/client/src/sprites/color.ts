/**
 * Colour arithmetic for the sprites (work package WP5). Pure: no canvas.
 *
 * Colours are written as '#rrggbb' or '#rrggbbaa' in the art files. Here
 * they become four numbers from 0 to 255, so they can be mixed and written
 * into pixel bytes.
 */

/** Red, green, blue and alpha (255 = opaque), each a whole number from 0 to 255. */
export type Rgba = [red: number, green: number, blue: number, alpha: number];

/** '#rrggbb' or '#rrggbbaa' -> numbers. Throws on anything else: a mistyped colour should be loud. */
export function parseColor(text: string): Rgba {
  if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)) {
    throw new Error(`'${text}' is not a colour: write '#rrggbb' or '#rrggbbaa'`);
  }
  const channel = (start: number): number => parseInt(text.slice(start, start + 2), 16);
  return [channel(1), channel(3), channel(5), text.length === 9 ? channel(7) : 255];
}

/** Numbers -> '#rrggbb'. The alpha is dropped. */
export function formatColor(color: Rgba): string {
  const hex = (value: number): string => Math.round(value).toString(16).padStart(2, '0');
  return `#${hex(color[0])}${hex(color[1])}${hex(color[2])}`;
}

/**
 * Moves the red, green and blue of `color` towards those of `target`:
 * amount 0 leaves it alone, 1 gives the target, 0.45 goes 45% of the way.
 * The alpha of `color` is kept.
 */
export function mixRgb(color: Rgba, target: Rgba, amount: number): Rgba {
  const mix = (from: number, to: number): number => Math.round(from + (to - from) * amount);
  return [mix(color[0], target[0]), mix(color[1], target[1]), mix(color[2], target[2]), color[3]];
}
