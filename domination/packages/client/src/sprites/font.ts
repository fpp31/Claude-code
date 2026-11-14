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
/** Width of every glyph in font pixels (the font is fixed-width). */
export const GLYPH_WIDTH = 5;
/** Empty font pixels between two letters. */
export const LETTER_GAP = 1;

/** The letters, 5 wide and 7 tall each: '#' is ink, '.' is empty. */
export const GLYPHS: Record<string, readonly string[]> = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
};

/** Width in font pixels of `text` drawn with this font (glyph widths plus 1 pixel between letters). */
export function measureText(text: string): number {
  const count = letters(text).length;
  if (count === 0) return 0;
  return count * GLYPH_WIDTH + (count - 1) * LETTER_GAP;
}

/** The characters of a text as they are drawn: in upper case, one entry per character. */
function letters(text: string): string[] {
  return [...text.toUpperCase()];
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
  context.fillStyle = color;
  let left = x;
  for (const character of letters(text)) {
    const glyph = GLYPHS[character];
    if (glyph !== undefined) {
      glyph.forEach((row, rowIndex) => {
        for (let column = 0; column < row.length; column++) {
          if (row[column] === '#') context.fillRect(left + column * scale, y + rowIndex * scale, scale, scale);
        }
      });
    }
    left += (GLYPH_WIDTH + LETTER_GAP) * scale;
  }
}
