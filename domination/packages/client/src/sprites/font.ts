/**
 * The pixel font for city banners (work package WP5).
 *
 * A font file would be a binary asset, so the letters are drawn in code like
 * every other sprite: a 5 x 7 bitmap per character, written as text rows.
 * Needed characters: A-Z, 0-9 and space (city names in the data tables use
 * only letters and spaces; banners show them in upper case).
 */

/** Height of every glyph in font pixels. */
export const FONT_HEIGHT = 7;

/** Width in font pixels of `text` drawn with this font (glyph widths plus 1 pixel between letters). */
export function measureText(text: string): number {
  throw new Error('not implemented: measureText');
}

/**
 * Draws `text` with its top-left corner at (x, y) in device pixels, each
 * font pixel as a `scale` x `scale` square (scale is a whole number) in the
 * given CSS colour. Lower-case letters are drawn as upper case; unknown
 * characters as a blank.
 */
export function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: string,
): void {
  throw new Error('not implemented: drawText');
}
