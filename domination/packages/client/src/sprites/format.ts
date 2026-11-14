/**
 * How sprites are written down (work package WP5).
 *
 * Phase 1 has NO image files. A sprite is drawn in the source code as rows
 * of characters, one character per art pixel, so anybody can change a pixel
 * in a text editor and see the picture in the file. Example (the pine tree
 * of the reference picture):
 *
 *   rows: [
 *     '..###...',
 *     '..#g#...',
 *     '.#lgd#..',
 *     '.#ggd#..',
 *     '#lggdd#.',
 *     '#gggdd#.',
 *     '#######.',
 *     '..#t#:::',
 *     '..###:::',
 *   ]
 *
 * Characters with a fixed meaning in EVERY sprite:
 *   .   transparent
 *   #   outline, '#22223a'
 *   :   cast shadow (black at 25%)
 *   1   owner's primary colour, lit    (primary mixed 45% towards white)
 *   2   owner's primary colour, as it is
 *   3   owner's primary colour, shaded (primary mixed 22% towards black)
 *   4   owner's secondary colour
 * Every other character is looked up in the sprite's own `colors` table.
 *
 * Style D in one line: lit left side, shaded right side, dark outline, cast
 * shadow to the lower right.
 *
 * Later, real PNG sprite sheets can replace all of this: the renderer only
 * ever asks a SpriteSheet (spriteSheet.ts) for a Sprite.
 */

/** A sprite as text. */
export interface SpriteSource {
  /** Width and height in art pixels. Every row must be exactly `width` characters, and there must be `height` rows. */
  width: number;
  height: number;
  /**
   * Where the sprite's top-left corner goes inside the 26 x 28 tile box
   * (default 0, 0). Sprites may stick out of the top of the box (negative y)
   * to overlap the row behind.
   */
  offsetX?: number;
  offsetY?: number;
  /** The sprite's own characters -> '#rrggbb' or '#rrggbbaa'. */
  colors?: Record<string, string>;
  /**
   * Other sprites stamped first, each at (x, y) inside this sprite, in list
   * order (like the forest made of five trees in the reference picture).
   * A part must fit inside this sprite; its own offsetX / offsetY are not
   * used (they only matter for a sprite drawn on a tile by itself).
   */
  parts?: { sprite: SpriteSource; x: number; y: number }[];
  /** The pixels, drawn over the parts. May be omitted for a sprite made only of parts. */
  rows?: string[];
}

/** The colours that replace the characters 1-4 for one owner. */
export interface OwnerColors {
  /** '#rrggbb' */
  primary: string;
  /** '#rrggbb' */
  secondary: string;
}

/** A finished picture: RGBA bytes, row by row, 4 per pixel (the layout ImageData uses). */
export interface RasterImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}
