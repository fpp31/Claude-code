import { describe, expect, it } from 'vitest';
import type { TerrainId } from '@domination/shared';
import referenceSvg from '../../../docs/art/style-d-reference.svg?raw';
import { TILE_HEIGHT, TILE_WIDTH } from '../src/render/geometry';
import { city } from '../src/sprites/art/buildings';
import { FEATURE_SPRITES } from '../src/sprites/art/features';
import { BARE_GROUND_SPRITES, GROUND_SPRITES } from '../src/sprites/art/ground';
import { warrior } from '../src/sprites/art/units';
import { parseColor } from '../src/sprites/color';
import type { Rgba } from '../src/sprites/color';
import type { OwnerColors, RasterImage, SpriteSource } from '../src/sprites/format';
import { blendPixel, createImage, getPixel, stampImage } from '../src/sprites/image';
import { rasterizeSprite } from '../src/sprites/rasterize';

/**
 * The approved art direction is a picture: docs/art/style-d-reference.svg.
 * These tests read that file and compare the sprites that were ported from
 * it, pixel by pixel, with what the picture shows. If somebody changes a
 * pixel of a ported sprite (or the reference is replaced), the test says
 * which sprite and prints where.
 *
 * Only what the reference contains can be checked this way: the five
 * grounds (their first variant), forest, hills and mountains on grass, the
 * city and the soldier with shield and sword. The Scout, the Settler, the
 * markers and the desert and plains versions of the features are new art in
 * the same style and are checked by eye (/sprites.html).
 */

// ---- A reader for exactly this SVG file -----------------------------------
// The reference draws everything with <path> elements that only use M, h, v
// and z (rectangles and staircases on the art-pixel grid) and <use> elements
// that place a named group. That is all this reader understands.

/** The named shapes of the file: id -> the elements inside it. */
const GROUPS = new Map<string, string>();
for (const match of referenceSvg.matchAll(/<path id="(\w+)" d="([^"]+)"><\/path>/g)) {
  GROUPS.set(match[1], `<path d="${match[2]}"></path>`);
}
for (const match of referenceSvg.matchAll(/<g id="(\w+)"(?: transform="scale\(4\)")?>(.*?)<\/g>\n/g)) {
  GROUPS.set(match[1], match[2]);
}

/** Fills one path (even-odd rule along each row, like the outline test in geometry.test.ts). */
function fillPath(target: RasterImage, d: string, dx: number, dy: number, color: Rgba): void {
  const inside = new Set<number>();
  for (const subPath of d.split('M').filter((part) => part.trim() !== '')) {
    const start = /^(-?\d+) (-?\d+)/.exec(subPath);
    if (start === null) throw new Error(`cannot read the path '${d}'`);
    let x = Number(start[1]);
    let y = Number(start[2]);
    const startY = y;
    const verticalEdges: { x: number; y0: number; y1: number }[] = [];
    for (const command of subPath.slice(start[0].length).matchAll(/([hv])(-?\d+)/g)) {
      if (command[1] === 'h') {
        x += Number(command[2]);
      } else {
        const nextY = y + Number(command[2]);
        verticalEdges.push({ x, y0: Math.min(y, nextY), y1: Math.max(y, nextY) });
        y = nextY;
      }
    }
    // The closing 'z' goes straight back up or down to the start.
    if (y !== startY) verticalEdges.push({ x, y0: Math.min(y, startY), y1: Math.max(y, startY) });
    for (let py = 0; py < target.height; py++) {
      for (let px = 0; px < target.width; px++) {
        const crossings = verticalEdges.filter((edge) => edge.x <= px - dx && py - dy >= edge.y0 && py - dy < edge.y1).length;
        if (crossings % 2 === 1) inside.add(py * target.width + px);
      }
    }
  }
  for (const at of inside) blendPixel(target, at % target.width, Math.floor(at / target.width), color);
}

/** Draws a run of <path> and <use> elements, in order, as the browser would. */
function drawElements(target: RasterImage, elements: string, dx: number, dy: number, inheritedFill: string | null): void {
  for (const element of elements.matchAll(/<(path|use)([^>]*)>/g)) {
    const attributes = new Map([...element[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((pair) => [pair[1], pair[2]]));
    if (element[1] === 'path') {
      const [red, green, blue] = parseColor(attributes.get('fill') ?? inheritedFill ?? '#000000');
      const opacity = Number(attributes.get('fill-opacity') ?? '1');
      fillPath(target, attributes.get('d') ?? '', dx, dy, [red, green, blue, Math.round(opacity * 255)]);
    } else {
      const id = (attributes.get('href') ?? '').slice(1);
      const group = GROUPS.get(id);
      if (group === undefined) throw new Error(`the reference has no shape called '${id}'`);
      const x = Number(attributes.get('x') ?? '0');
      const y = Number(attributes.get('y') ?? '0');
      drawElements(target, group, dx + x, dy + y, attributes.get('fill') ?? inheritedFill);
    }
  }
}

/** One 26 x 28 tile of the reference, built from the given elements. */
function referenceTile(elements: string): RasterImage {
  const image = createImage(TILE_WIDTH, TILE_HEIGHT);
  drawElements(image, elements, 0, 0, null);
  return image;
}

/** The game's sprites laid into a 26 x 28 tile box, back to front. */
function gameTile(sprites: SpriteSource[], owner?: OwnerColors): RasterImage {
  const image = createImage(TILE_WIDTH, TILE_HEIGHT);
  for (const sprite of sprites) {
    stampImage(image, rasterizeSprite(sprite, owner), sprite.offsetX ?? 0, sprite.offsetY ?? 0);
  }
  return image;
}

/**
 * Compares two tiles. Returns '' if every pixel matches (each colour channel
 * within `tolerance`), otherwise a little map of the tile with an X on every
 * pixel that differs, to print in the failure message.
 */
function differences(reference: RasterImage, game: RasterImage, tolerance: number): string {
  let different = 0;
  const rows: string[] = [];
  for (let y = 0; y < TILE_HEIGHT; y++) {
    let row = '';
    for (let x = 0; x < TILE_WIDTH; x++) {
      const wanted = getPixel(reference, x, y);
      const got = getPixel(game, x, y);
      const same = wanted.every((value, channel) => Math.abs(value - got[channel]) <= tolerance);
      if (!same) different += 1;
      row += same ? (wanted[3] === 0 ? '.' : 'o') : 'X';
    }
    rows.push(row);
  }
  return different === 0 ? '' : `${different} pixels differ:\n${rows.join('\n')}`;
}

describe('the sprites ported from the reference picture (WP5)', () => {
  it('finds the shapes it needs in docs/art/style-d-reference.svg', () => {
    for (const id of ['hx', 'edge', 'tuft', 'o', 'c', 'g', 'p', 'd', 'tree', 'f', 'mound', 'h', 'm', 'hallA', 'hallB', 'man', 'manB']) {
      expect(GROUPS.has(id), id).toBe(true);
    }
  });

  it.each<[TerrainId, string]>([
    ['ocean', 'o'],
    ['coast', 'c'],
    ['grassland', 'g'],
    ['plains', 'p'],
    ['desert', 'd'],
  ])('ground.%s (first variant) is the reference tile "%s", pixel for pixel', (terrain, id) => {
    expect(differences(referenceTile(GROUPS.get(id)!), gameTile([GROUND_SPRITES[terrain][0]]), 0)).toBe('');
  });

  it.each([
    ['forest', 'f'],
    ['hills', 'h'],
    ['mountains', 'm'],
  ] as const)('feature.%s on bare grass is the reference tile "%s"', (feature, id) => {
    // The reference lays its faint grid hint over the feature, the game under it. Two see-through blacks give the
    // same colour in either order, up to rounding: so one step of tolerance.
    const game = gameTile([BARE_GROUND_SPRITES.grassland, FEATURE_SPRITES[feature].grassland]);
    expect(differences(referenceTile(GROUPS.get(id)!), game, 1)).toBe('');
  });

  // The reference paints roofs and tunics in '#e83030' and puts a 40% white and a 20% black sheet over them for
  // light and shade. The sprite format (format.ts) fixes these as 45% towards white and 22% towards black, and the
  // reference's shield uses two hand-picked reds. The shapes must match exactly; the shades within 14 of 255.
  const RED: OwnerColors = { primary: '#e83030', secondary: '#ffffff' };
  const SHADE_TOLERANCE = 14;

  it('the city is the reference hall with the owner-coloured roof and flag', () => {
    const reference = referenceTile(
      '<use href="#hallA"></use><path d="M6 8h14v4h-14zM13 2h4v3h-4z" fill="#e83030"></path><use href="#hallB"></use>',
    );
    expect(differences(reference, gameTile([city], RED), SHADE_TOLERANCE)).toBe('');
  });

  it('the warrior is the reference soldier with shield and sword', () => {
    const reference = referenceTile(
      '<use href="#man"></use><path d="M10 6h6v3h-6zM11 13h4v5h-4z" fill="#e83030"></path>' +
        '<path d="M6 12h5v6h-5zM17 4h3v11h-3z" fill="#22223a"></path><path d="M7 13h3v4h-3z" fill="#ff9898"></path>' +
        '<path d="M9 14h1v3h-1z" fill="#c02828"></path><path d="M18 5h1v7h-1z" fill="#ffffff"></path>' +
        '<path d="M17 12h3v1h-3z" fill="#f8c020"></path><use href="#manB"></use>',
    );
    expect(differences(reference, gameTile([warrior], RED), SHADE_TOLERANCE)).toBe('');
  });

  it('the comparison is not blind: a sprite with one pixel changed is caught', () => {
    const changed: SpriteSource = { ...FEATURE_SPRITES.mountains.grassland };
    changed.rows = [...changed.rows!];
    changed.rows[5] = changed.rows[5].replace('L', 'R');
    const game = gameTile([BARE_GROUND_SPRITES.grassland, changed]);
    expect(differences(referenceTile(GROUPS.get('m')!), game, 1)).toMatch(/^1 pixels differ/);
  });
});
