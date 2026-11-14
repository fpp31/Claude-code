import { describe, expect, it } from 'vitest';
import { CIVS, CIV_IDS, FEATURE_IDS, MAP_SIZES, TERRAIN_IDS, UNIT_TYPE_IDS, tileCoord, tileCount } from '@domination/shared';
import type { GridSize } from '@domination/shared';
import {
  CAMERA_MARGIN,
  artToDevice,
  clampCamera,
  deviceToArt,
  snapCamera,
  startZoom,
  visibleTileRange,
  zoomCamera,
  zoomRange,
  zoomStep,
} from '../src/render/camera';
import type { Camera } from '../src/render/camera';
import { TILE_HEIGHT, TILE_WIDTH, isInsideHex, mapPixelSize, tileCenter, tileOrigin } from '../src/render/geometry';
import { tree } from '../src/sprites/art/features';
import { MARKER_IDS } from '../src/sprites/art/markers';
import { ALL_SPRITE_IDS, buildCatalog } from '../src/sprites/catalog';
import { FONT_HEIGHT, GLYPHS, GLYPH_WIDTH, drawText, measureText } from '../src/sprites/font';
import type { SpriteSource } from '../src/sprites/format';
import { getPixel } from '../src/sprites/image';
import { SPRITE_LOOKS } from '../src/sprites/looks';
import { PALETTE } from '../src/sprites/palette';
import { ownerRamp, rasterizeSprite } from '../src/sprites/rasterize';
import { RIM_ROWS_ADDED } from '../src/sprites/rim';
import { buildSpriteImages, spriteKey } from '../src/sprites/spriteSheet';
import type { SpriteId } from '../src/sprites/spriteSheet';
import { installFakeBrowser } from './renderFakeCanvas';

/**
 * Tests for the renderer's pure parts. They run in plain Node (no canvas):
 * sprite rasterising and camera maths are pure functions exactly so that
 * they can be tested here. (geometry.test.ts covers the hex shape, tiling
 * and hit testing; renderBorders, renderScene and renderRenderer cover the
 * rest of the renderer.)
 *
 * How the map LOOKS is checked by eye against
 * docs/art/style-d-reference.svg, on the test pages /dev-map.html,
 * /sprites.html and /src/dev/big-map.html.
 */

/** Colours as the four numbers a pixel holds. */
const OUTLINE = [0x22, 0x22, 0x3a, 255];
const SHADOW = [0, 0, 0, 64];
const NOTHING = [0, 0, 0, 0];
const RED = { primary: '#c81e1e', secondary: '#f6dc8c' };
const BLUE = { primary: '#1f7fa0', secondary: '#a9ecd4' };

function rgba(hex: string): number[] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).concat(255);
}

/** How many pixels of an image have exactly this colour. */
function countPixels(image: { width: number; height: number; pixels: Uint8ClampedArray }, color: number[]): number {
  let count = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (getPixel(image, x, y).join() === color.join()) count += 1;
    }
  }
  return count;
}

describe('rasterizeSprite (WP5)', () => {
  it('draws the example tree: outline, three greens, trunk and a 25% shadow in the right pixels', () => {
    const image = rasterizeSprite(tree);
    expect(image.width).toBe(8);
    expect(image.height).toBe(9);
    expect(image.pixels.length).toBe(8 * 9 * 4);

    // One pixel of each kind, read off the reference picture's "tree" group.
    expect(getPixel(image, 2, 0)).toEqual(OUTLINE);
    expect(getPixel(image, 3, 1)).toEqual(rgba(PALETTE.pine));
    expect(getPixel(image, 2, 2)).toEqual(rgba(PALETTE.pineLight));
    expect(getPixel(image, 4, 2)).toEqual(rgba(PALETTE.pineShade));
    expect(getPixel(image, 3, 7)).toEqual(rgba(PALETTE.trunk));
    expect(getPixel(image, 5, 7)).toEqual(SHADOW);
    expect(getPixel(image, 0, 0)).toEqual(NOTHING);

    // And how many there are of each: 9 + 6 + 2 greens, 25 outline, 1 trunk, 6 shadow, the rest empty.
    expect(countPixels(image, rgba(PALETTE.pine))).toBe(9);
    expect(countPixels(image, rgba(PALETTE.pineShade))).toBe(6);
    expect(countPixels(image, rgba(PALETTE.pineLight))).toBe(2);
    expect(countPixels(image, OUTLINE)).toBe(25);
    expect(countPixels(image, rgba(PALETTE.trunk))).toBe(1);
    expect(countPixels(image, SHADOW)).toBe(6);
    expect(countPixels(image, NOTHING)).toBe(72 - 9 - 6 - 2 - 25 - 1 - 6);
  });

  it('maps the reserved characters . # : 1 2 3 4 as documented in format.ts', () => {
    const image = rasterizeSprite({ width: 7, height: 1, rows: ['.#:1234'] }, RED);
    const ramp = ownerRamp(RED.primary);
    expect(getPixel(image, 0, 0)).toEqual(NOTHING);
    expect(getPixel(image, 1, 0)).toEqual(OUTLINE);
    expect(getPixel(image, 2, 0)).toEqual(SHADOW);
    expect(getPixel(image, 3, 0)).toEqual(rgba(ramp.lit));
    expect(getPixel(image, 4, 0)).toEqual(rgba(RED.primary));
    expect(getPixel(image, 5, 0)).toEqual(rgba(ramp.shaded));
    expect(getPixel(image, 6, 0)).toEqual(rgba(RED.secondary));
  });

  it('looks other characters up in the sprite\'s own colors, with or without an alpha', () => {
    const image = rasterizeSprite({ width: 2, height: 1, colors: { a: '#102030', b: '#10203080' }, rows: ['ab'] });
    expect(getPixel(image, 0, 0)).toEqual([0x10, 0x20, 0x30, 255]);
    expect(getPixel(image, 1, 0)).toEqual([0x10, 0x20, 0x30, 0x80]);
  });

  it('stamps parts first and the sprite\'s own rows on top', () => {
    const dot: SpriteSource = { width: 2, height: 1, colors: { a: '#ff0000' }, rows: ['aa'] };
    const other: SpriteSource = { width: 1, height: 1, colors: { c: '#0000ff' }, rows: ['c'] };
    const image = rasterizeSprite({
      width: 4,
      height: 2,
      colors: { b: '#00ff00' },
      parts: [
        { sprite: dot, x: 1, y: 0 },
        { sprite: other, x: 2, y: 0 }, // a later part covers an earlier one
        { sprite: dot, x: 2, y: 1 },
      ],
      rows: [
        'b...', // '.' leaves what is underneath alone
        '..b.', // a character covers the part underneath
      ],
    });
    expect(getPixel(image, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(image, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(image, 2, 0)).toEqual([0, 0, 255, 255]);
    expect(getPixel(image, 3, 0)).toEqual(NOTHING);
    expect(getPixel(image, 2, 1)).toEqual([0, 255, 0, 255]);
    expect(getPixel(image, 3, 1)).toEqual([255, 0, 0, 255]);
  });

  it('a sprite made only of parts needs no rows, and parts may have parts', () => {
    const dot: SpriteSource = { width: 1, height: 1, colors: { a: '#ff0000' }, rows: ['a'] };
    const pair: SpriteSource = { width: 3, height: 1, parts: [{ sprite: dot, x: 0, y: 0 }, { sprite: dot, x: 2, y: 0 }] };
    const image = rasterizeSprite({ width: 3, height: 2, parts: [{ sprite: pair, x: 0, y: 1 }] });
    expect(countPixels(image, [255, 0, 0, 255])).toBe(2);
    expect(getPixel(image, 0, 1)).toEqual([255, 0, 0, 255]);
    expect(getPixel(image, 2, 1)).toEqual([255, 0, 0, 255]);
  });

  it('blends semi-transparent pixels over what is underneath', () => {
    const blue: SpriteSource = { width: 3, height: 1, colors: { b: '#0000ff' }, rows: ['bb.'] };
    const image = rasterizeSprite({
      width: 3,
      height: 1,
      colors: { h: '#ff000080' },
      parts: [{ sprite: blue, x: 0, y: 0 }],
      rows: ['h::'],
    });
    // Half-transparent red over solid blue: half of each, still solid.
    expect(getPixel(image, 0, 0)).toEqual([128, 0, 127, 255]);
    // The 25% black shadow over solid blue: blue darkened by a quarter, still solid.
    expect(getPixel(image, 1, 0)).toEqual([0, 0, 191, 255]);
    // The shadow over nothing stays a 25% black pixel (it is blended over the ground later, when drawn).
    expect(getPixel(image, 2, 0)).toEqual(SHADOW);
  });

  it('throws a clear error for a row of the wrong length, a missing row, an unknown character, or an owner character without an owner', () => {
    expect(() => rasterizeSprite({ width: 3, height: 2, rows: ['###', '##'] })).toThrow();
    expect(() => rasterizeSprite({ width: 3, height: 2, rows: ['###', '####'] })).toThrow();
    expect(() => rasterizeSprite({ width: 3, height: 2, rows: ['###'] })).toThrow();
    expect(() => rasterizeSprite({ width: 3, height: 1, rows: ['###', '###'] })).toThrow();
    expect(() => rasterizeSprite({ width: 3, height: 1, rows: ['#x#'] })).toThrow();
    expect(() => rasterizeSprite({ width: 3, height: 1, rows: ['#2#'] })).toThrow();
    // The same sprites, put right, are fine.
    expect(() => rasterizeSprite({ width: 3, height: 2, rows: ['###', '###'] })).not.toThrow();
    expect(() => rasterizeSprite({ width: 3, height: 1, colors: { x: '#123456' }, rows: ['#x#'] })).not.toThrow();
    expect(() => rasterizeSprite({ width: 3, height: 1, rows: ['#2#'] }, RED)).not.toThrow();
  });

  it('also throws for other art mistakes: no rows and no parts, a bad size, a bad colour, a part that sticks out', () => {
    const dot: SpriteSource = { width: 2, height: 1, rows: ['##'] };
    expect(() => rasterizeSprite({ width: 3, height: 1 })).toThrow();
    expect(() => rasterizeSprite({ width: 0, height: 1, rows: [''] })).toThrow();
    expect(() => rasterizeSprite({ width: 1.5, height: 1, rows: ['#'] })).toThrow();
    expect(() => rasterizeSprite({ width: 1, height: 1, colors: { x: 'red' }, rows: ['x'] })).toThrow();
    expect(() => rasterizeSprite({ width: 1, height: 1, colors: { '#': '#ffffff' }, rows: ['#'] })).toThrow();
    expect(() => rasterizeSprite({ width: 3, height: 1, parts: [{ sprite: dot, x: 2, y: 0 }] })).toThrow();
    expect(() => rasterizeSprite({ width: 3, height: 1, parts: [{ sprite: dot, x: -1, y: 0 }] })).toThrow();
    expect(() => rasterizeSprite({ width: 3, height: 1, parts: [{ sprite: dot, x: 1, y: 0 }] })).not.toThrow();
  });

  it('ownerRamp returns a lighter, the same and a darker colour', () => {
    // 45% of the way to white, as it is, 22% of the way to black.
    expect(ownerRamp('#c81e1e')).toEqual({ lit: '#e18383', base: '#c81e1e', shaded: '#9c1717' });
    for (const civ of CIV_IDS) {
      const ramp = ownerRamp(CIVS[civ].primary);
      expect(ramp.base).toBe(CIVS[civ].primary);
      expect(ramp.lit).not.toBe(ramp.base);
      expect(ramp.shaded).not.toBe(ramp.base);
      const [lit, base, shaded] = [rgba(ramp.lit), rgba(ramp.base), rgba(ramp.shaded)];
      for (let channel = 0; channel < 3; channel++) {
        expect(lit[channel]).toBeGreaterThanOrEqual(base[channel]);
        expect(shaded[channel]).toBeLessThanOrEqual(base[channel]);
      }
    }
  });
});

describe('the art (WP5)', () => {
  const images = buildSpriteImages();
  const byKey = new Map(images.map((entry) => [entry.key, entry]));

  it('there is a sprite for every SpriteId (every terrain, feature and unit type in the tables, and the city)', () => {
    const wanted: SpriteId[] = [
      ...TERRAIN_IDS.map((terrain): SpriteId => `ground.${terrain}`),
      ...FEATURE_IDS.map((feature): SpriteId => `feature.${feature}`),
      ...UNIT_TYPE_IDS.map((unitType): SpriteId => `unit.${unitType}`),
      'city',
      ...MARKER_IDS.map((marker): SpriteId => `marker.${marker}`),
    ];
    expect([...ALL_SPRITE_IDS].sort()).toEqual([...wanted].sort());

    const catalog = buildCatalog();
    for (const id of wanted) {
      expect(catalog.some((entry) => entry.id === id), id).toBe(true);
    }
    // Grounds: at least one decorated variant and the bare one. Features: one picture per terrain.
    for (const terrain of TERRAIN_IDS) {
      const versions = catalog.filter((entry) => entry.id === `ground.${terrain}`).map((entry) => entry.version);
      expect(versions).toContain('0');
      expect(versions).toContain('bare');
    }
    for (const feature of FEATURE_IDS) {
      const versions = catalog.filter((entry) => entry.id === `feature.${feature}`).map((entry) => entry.version);
      expect(versions.sort()).toEqual([...TERRAIN_IDS].sort());
    }
    // Units: the picture itself and the one with the pale line around it (for standing among trees). Nothing else has that line.
    for (const unitType of UNIT_TYPE_IDS) {
      const entries = catalog.filter((entry) => entry.id === `unit.${unitType}`);
      expect(entries.map((entry) => [entry.version, entry.rim])).toEqual([['', false], ['rim', true]]);
    }
    expect(catalog.filter((entry) => entry.rim).every((entry) => entry.id.startsWith('unit.'))).toBe(true);
  });

  it('every sprite rasterises without error, for every civilization where it uses owner colours', () => {
    const catalog = buildCatalog();
    for (const entry of catalog) {
      const owners = entry.owned ? [...CIV_IDS, 'neutral' as const] : ['' as const];
      for (const owner of owners) {
        for (const look of SPRITE_LOOKS) {
          const image = byKey.get(spriteKey(entry.id, entry.version, owner, look));
          expect(image, `${entry.id} ${entry.version} ${owner} ${look}`).toBeDefined();
          expect(image!.image.width).toBe(entry.source.width);
          // The pale line of a unit's 'rim' version needs one more row on top (rim.ts).
          expect(image!.image.height).toBe(entry.source.height + (entry.rim ? RIM_ROWS_ADDED : 0));
        }
      }
    }
    // Nothing else is on the sheet, and no name is used twice.
    const owned = catalog.filter((entry) => entry.owned).length;
    expect(images.length).toBe((owned * (CIV_IDS.length + 1) + (catalog.length - owned)) * SPRITE_LOOKS.length);
    expect(byKey.size).toBe(images.length);
    // Exactly the units and the city are in owner colours (a unit is listed once per version).
    expect([...new Set(catalog.filter((entry) => entry.owned).map((entry) => entry.id))].sort()).toEqual(
      ['city', ...UNIT_TYPE_IDS.map((unitType) => `unit.${unitType}`)].sort(),
    );
  });

  it('every sprite fits the tile it is drawn on: no wider than a tile box and inside it sideways', () => {
    for (const entry of buildCatalog()) {
      const left = entry.source.offsetX ?? 0;
      expect(left, entry.id).toBeGreaterThanOrEqual(0);
      expect(left + entry.source.width, entry.id).toBeLessThanOrEqual(TILE_WIDTH);
    }
  });

  it('ground and feature sprites stay inside their own 26 x 28 tile box (repainting a few tiles relies on it)', () => {
    // render/terrainLayer.ts repaints a changed tile together with its neighbors only. That is enough exactly
    // because nothing on the terrain picture reaches beyond its own tile box. (Cities and units may stick out.)
    const terrainArt = buildCatalog().filter((entry) => entry.id.startsWith('ground.') || entry.id.startsWith('feature.'));
    expect(terrainArt.length).toBeGreaterThan(20);
    for (const entry of terrainArt) {
      const top = entry.source.offsetY ?? 0;
      expect(top, `${entry.id} ${entry.version}`).toBeGreaterThanOrEqual(0);
      expect(top + entry.source.height, `${entry.id} ${entry.version}`).toBeLessThanOrEqual(TILE_HEIGHT);
    }
  });

  it('every ground sprite covers exactly the pixel hexagon (isInsideHex) and nothing outside it', () => {
    const grounds = images.filter((entry) => entry.key.startsWith('ground.'));
    expect(grounds.length).toBeGreaterThanOrEqual(TERRAIN_IDS.length * 2 * SPRITE_LOOKS.length);
    for (const ground of grounds) {
      expect(ground.image.width).toBe(TILE_WIDTH);
      expect(ground.image.height).toBe(TILE_HEIGHT);
      expect([ground.offsetX, ground.offsetY]).toEqual([0, 0]);
      for (let y = 0; y < TILE_HEIGHT; y++) {
        for (let x = 0; x < TILE_WIDTH; x++) {
          // Solid inside (no see-through pixel that would show the dark background as a seam), empty outside.
          expect(getPixel(ground.image, x, y)[3], `${ground.key} at (${x}, ${y})`).toBe(isInsideHex(x, y) ? 255 : 0);
        }
      }
    }
  });

  it('the pictures of a terrain\'s ground (its variants and the bare one) all differ from each other', () => {
    for (const terrain of TERRAIN_IDS) {
      const variants = images.filter((entry) => entry.key.startsWith(`ground.${terrain}|`) && entry.key.endsWith('|normal'));
      const pictures = new Set(variants.map((entry) => entry.image.pixels.join()));
      expect(pictures.size, terrain).toBe(variants.length);
    }
  });

  it('unit and city sprites use owner colours, so two civilizations give different pixels', () => {
    const ids: SpriteId[] = ['city', ...UNIT_TYPE_IDS.map((unitType): SpriteId => `unit.${unitType}`)];
    for (const id of ids) {
      const pictures = new Set(
        [...CIV_IDS, 'neutral' as const].map((owner) => byKey.get(spriteKey(id, '', owner, 'normal'))!.image.pixels.join()),
      );
      expect(pictures.size, id).toBe(CIV_IDS.length + 1);
    }
    // And the colours really are the owner's: the city's roof holds the primary colour.
    const romeCity = rasterizeSprite(buildCatalog().find((entry) => entry.id === 'city')!.source, RED);
    const mayaCity = rasterizeSprite(buildCatalog().find((entry) => entry.id === 'city')!.source, BLUE);
    expect(countPixels(romeCity, rgba(RED.primary))).toBeGreaterThan(0);
    expect(countPixels(romeCity, rgba(BLUE.primary))).toBe(0);
    expect(countPixels(mayaCity, rgba(BLUE.primary))).toBe(countPixels(romeCity, rgba(RED.primary)));
  });

  it('the three unit types have clearly different pictures (told apart by more than a few pixels)', () => {
    const picture = (id: SpriteId) => {
      const sprite = byKey.get(spriteKey(id, '', 'rome', 'normal'))!;
      // Lay the sprite into a tile box, so sprites of different sizes can be compared pixel by pixel.
      const box: string[] = new Array(TILE_WIDTH * TILE_HEIGHT).fill('');
      for (let y = 0; y < sprite.image.height; y++) {
        for (let x = 0; x < sprite.image.width; x++) {
          box[(y + sprite.offsetY) * TILE_WIDTH + x + sprite.offsetX] = getPixel(sprite.image, x, y).join();
        }
      }
      return box;
    };
    const ids = UNIT_TYPE_IDS.map((unitType): SpriteId => `unit.${unitType}`);
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const first = picture(ids[a]);
        const second = picture(ids[b]);
        const different = first.filter((pixel, index) => pixel !== second[index]).length;
        expect(different, `${ids[a]} against ${ids[b]}`).toBeGreaterThan(40);
      }
    }
  });

  it('the pixel font has a 5 x 7 glyph for A-Z, 0-9 and space, and measureText adds up widths and gaps', () => {
    expect(FONT_HEIGHT).toBe(7);
    expect(GLYPH_WIDTH).toBe(5);
    const needed = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
    for (const character of needed) {
      const glyph = GLYPHS[character];
      expect(glyph, `glyph '${character}'`).toBeDefined();
      expect(glyph.length).toBe(7);
      for (const row of glyph) expect(row).toMatch(/^[#.]{5}$/);
    }
    // Every letter and digit has ink and no two look the same; the space is empty.
    const shapes = new Set([...needed].map((character) => GLYPHS[character].join('')));
    expect(shapes.size).toBe(needed.length);
    expect(GLYPHS[' '].join('')).toBe('.'.repeat(35));

    expect(measureText('')).toBe(0);
    expect(measureText('A')).toBe(5);
    expect(measureText('AB')).toBe(5 + 1 + 5);
    expect(measureText('ROME 12')).toBe(7 * 5 + 6);
    expect(measureText('rome')).toBe(measureText('ROME'));
  });

  it('drawText draws each font pixel as a scale x scale square, lower case as upper case, unknown characters as a blank', () => {
    const browser = installFakeBrowser({ devicePixelRatio: 1 });
    try {
      const canvas = browser.createCanvas({ left: 0, top: 0, width: 100, height: 100 });
      const context = canvas.element.getContext('2d')!;
      drawText(context, 'l?i', 10, 20, 3, '#abcdef');
      const squares = canvas.calls.filter((call) => call.method === 'fillRect').map((call) => call.args as number[]);
      const ink = (character: string) => GLYPHS[character].join('').split('#').length - 1;
      expect(squares.length).toBe(ink('L') + ink('I')); // the '?' draws nothing but takes its place
      expect(canvas.calls.every((call) => call.fillStyle === '#abcdef')).toBe(true);
      for (const [x, y, width, height] of squares) {
        expect([width, height]).toEqual([3, 3]);
        expect((x - 10) % 3).toBe(0);
        expect((y - 20) % 3).toBe(0);
      }
      // 'L' has ink in its first column from top to bottom; the 'I' starts two letter places further right.
      expect(squares).toContainEqual([10, 20, 3, 3]);
      expect(squares).toContainEqual([10, 20 + 6 * 3, 3, 3]);
      expect(Math.min(...squares.filter(([x]) => x >= 10 + 6 * 3).map(([x]) => x))).toBe(10 + 2 * 6 * 3);
    } finally {
      browser.uninstall();
    }
  });
});

describe('camera (WP5)', () => {
  const LARGE: GridSize = MAP_SIZES.large;

  it('zoomRange gives whole-number zooms for device pixel ratios 1, 1.25, 1.5, 2 and 3', () => {
    expect(zoomRange(1)).toEqual({ min: 1, max: 6 });
    expect(zoomRange(1.25)).toEqual({ min: 1, max: 8 });
    expect(zoomRange(1.5)).toEqual({ min: 2, max: 9 });
    expect(zoomRange(2)).toEqual({ min: 2, max: 12 });
    expect(zoomRange(3)).toEqual({ min: 3, max: 18 });
    for (const ratio of [0.5, 0.75, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.625, 3, 4]) {
      const range = zoomRange(ratio);
      expect(Number.isInteger(range.min)).toBe(true);
      expect(Number.isInteger(range.max)).toBe(true);
      expect(range.min).toBeGreaterThanOrEqual(1);
      expect(range.max).toBeGreaterThanOrEqual(range.min);
      // The game starts at about 3 CSS pixels per art pixel, on a whole zoom inside the range.
      const start = startZoom(ratio);
      expect(Number.isInteger(start)).toBe(true);
      expect(start).toBeGreaterThanOrEqual(range.min);
      expect(start).toBeLessThanOrEqual(range.max);
    }
    expect(startZoom(1)).toBe(3);
    expect(startZoom(2)).toBe(6);
  });

  it('zoomStep is about one CSS pixel per art pixel on every display, and always a whole number of device pixels', () => {
    expect([1, 1.25, 1.5, 2, 3].map(zoomStep)).toEqual([1, 1, 2, 2, 3]);
    expect(zoomStep(0.5)).toBe(1);
    // About six steps from the smallest to the largest zoom, whatever the display.
    for (const ratio of [1, 1.25, 1.5, 2, 2.625, 3]) {
      const range = zoomRange(ratio);
      const steps = Math.ceil((range.max - range.min) / zoomStep(ratio));
      expect(steps).toBeGreaterThanOrEqual(4);
      expect(steps).toBeLessThanOrEqual(7);
    }
  });

  it('deviceToArt and artToDevice are inverses at every zoom', () => {
    for (let zoom = 1; zoom <= 18; zoom++) {
      const camera: Camera = { x: 37.25, y: -5.5, zoom };
      for (const point of [{ x: 0, y: 0 }, { x: 123, y: 456 }, { x: 799.5, y: 0.25 }]) {
        const back = artToDevice(camera, deviceToArt(camera, point));
        expect(back.x).toBeCloseTo(point.x, 9);
        expect(back.y).toBeCloseTo(point.y, 9);
      }
      // The camera position itself is the art pixel in the canvas's top-left corner.
      expect(deviceToArt(camera, { x: 0, y: 0 })).toEqual({ px: 37.25, py: -5.5 });
      expect(artToDevice(camera, { px: 38.25, py: -4.5 })).toEqual({ x: zoom, y: zoom });
    }
  });

  it('snapCamera moves the camera onto whole device pixels and changes nothing else', () => {
    const snapped = snapCamera({ x: 10.3, y: 7.49, zoom: 4 });
    expect(snapped).toEqual({ x: 10.25, y: 7.5, zoom: 4 });
    expect(snapCamera(snapped)).toEqual(snapped);
  });

  it('clampCamera lets the map be dragged until its edge reaches the middle of the canvas, and no further', () => {
    const viewport = { width: 800, height: 600 };
    const zoom = 2; // 400 x 300 art pixels fit on the canvas
    /** The art pixel shown in the middle of the canvas. */
    const middle = (camera: Camera): { px: number; py: number } => deviceToArt(camera, { x: 400, y: 300 });

    for (const size of [LARGE, { width: 4, height: 3 }, { width: 56, height: 3 }] as GridSize[]) {
      const map = mapPixelSize(size); // LARGE: 1469 x 798 art pixels; 4 x 3 tiles: 117 x 72, far smaller than the canvas

      // Too far in any direction: stopped with the middle of the canvas a small margin beyond the map's edge.
      expect(middle(clampCamera({ x: -5000, y: -5000, zoom }, viewport, size))).toEqual({ px: -CAMERA_MARGIN, py: -CAMERA_MARGIN });
      expect(middle(clampCamera({ x: 99999, y: 99999, zoom }, viewport, size))).toEqual({
        px: map.width + CAMERA_MARGIN,
        py: map.height + CAMERA_MARGIN,
      });
      // One direction can be at its limit while the other is not.
      const mixed = clampCamera({ x: -5000, y: map.height / 2 - 150, zoom }, viewport, size);
      expect(middle(mixed)).toEqual({ px: -CAMERA_MARGIN, py: map.height / 2 });

      // Every point of the map can be brought to the middle of the canvas: the camera is left alone, fractions included.
      for (const point of [{ px: 0, py: 0 }, { px: map.width, py: map.height }, { px: map.width / 3 + 0.5, py: map.height / 7 + 0.25 }]) {
        const camera = { x: point.px - 200, y: point.py - 150, zoom };
        expect(clampCamera(camera, viewport, size)).toEqual(camera);
      }
    }

    // A camera that already keeps the rule comes back with exactly the same numbers.
    expect(clampCamera({ x: 300.5, y: 200.25, zoom }, viewport, LARGE)).toEqual({ x: 300.5, y: 200.25, zoom });
    // Clamping twice changes nothing more.
    const once = clampCamera({ x: -5000, y: 99999, zoom }, viewport, LARGE);
    expect(clampCamera(once, viewport, LARGE)).toEqual(once);
    // The margin is small: less than one tile.
    expect(CAMERA_MARGIN).toBeGreaterThan(0);
    expect(CAMERA_MARGIN).toBeLessThan(TILE_WIDTH);
  });

  it('zoomCamera keeps the art pixel under the anchor in place and stays inside the zoom range', () => {
    const viewport = { width: 800, height: 600 };
    const range = { min: 1, max: 6 };
    const start: Camera = { x: 600, y: 300, zoom: 3 };

    for (const anchor of [{ x: 400, y: 300 }, { x: 123, y: 456 }]) {
      for (const steps of [1, 2, -1]) {
        const before = deviceToArt(start, anchor);
        const zoomed = zoomCamera(start, steps, anchor, range, viewport, LARGE);
        expect(zoomed.zoom).toBe(3 + steps);
        const after = deviceToArt(zoomed, anchor);
        expect(after.px).toBeCloseTo(before.px, 9);
        expect(after.py).toBeCloseTo(before.py, 9);
      }
    }

    // Steps beyond the smallest or largest zoom are ignored.
    const anchor = { x: 400, y: 300 };
    expect(zoomCamera(start, 100, anchor, range, viewport, LARGE).zoom).toBe(6);
    expect(zoomCamera(start, -100, anchor, range, viewport, LARGE).zoom).toBe(1);
    expect(zoomCamera({ ...start, zoom: 6 }, 1, anchor, range, viewport, LARGE)).toEqual({ ...start, zoom: 6 });
    expect(zoomCamera({ ...start, zoom: 1 }, -1, anchor, range, viewport, LARGE).zoom).toBe(1);
    // No steps, no change.
    expect(zoomCamera(start, 0, anchor, range, viewport, LARGE)).toEqual(start);

    // The result is clamped. Here the map's top-left corner is near the middle of the canvas and the pointer
    // is in the lower right: zooming out around the pointer would pull the whole map past the middle.
    const corner = zoomCamera({ x: -78, y: -62, zoom: 6 }, -5, { x: 799, y: 599 }, range, viewport, LARGE);
    expect(corner.zoom).toBe(1);
    expect(corner).toEqual(clampCamera(corner, viewport, LARGE));
    expect(deviceToArt(corner, { x: 400, y: 300 })).toEqual({ px: -CAMERA_MARGIN, py: -CAMERA_MARGIN });
  });

  it('visibleTileRange covers every tile that touches the viewport and stays inside the map', () => {
    const viewport = { width: 640, height: 480 };
    const cameras: Camera[] = [
      { x: -12, y: -12, zoom: 1 },
      { x: 0, y: 0, zoom: 3 },
      { x: 333.3, y: 201.7, zoom: 2 },
      { x: 700, y: 500, zoom: 4 },
      { x: 1300, y: 700, zoom: 6 },
      { x: 26, y: 22, zoom: 5 }, // exactly on tile boundaries
    ];
    for (const camera of cameras) {
      const range = visibleTileRange(camera, viewport, LARGE);
      expect(range.x0).toBeGreaterThanOrEqual(0);
      expect(range.y0).toBeGreaterThanOrEqual(0);
      expect(range.x1).toBeLessThanOrEqual(LARGE.width - 1);
      expect(range.y1).toBeLessThanOrEqual(LARGE.height - 1);

      const left = camera.x;
      const top = camera.y;
      const right = camera.x + viewport.width / camera.zoom;
      const bottom = camera.y + viewport.height / camera.zoom;
      let touching = 0;
      for (let tile = 0; tile < tileCount(LARGE); tile++) {
        const coord = tileCoord(tile, LARGE);
        const origin = tileOrigin(coord);
        const touches =
          origin.px < right && origin.px + TILE_WIDTH > left && origin.py < bottom && origin.py + TILE_HEIGHT > top;
        if (!touches) continue;
        touching += 1;
        const inside = coord.x >= range.x0 && coord.x <= range.x1 && coord.y >= range.y0 && coord.y <= range.y1;
        expect(inside, `tile (${coord.x}, ${coord.y}) with the camera at (${camera.x}, ${camera.y}) x${camera.zoom}`).toBe(true);
      }
      expect(touching).toBeGreaterThan(0);

      // It is a real saving: zoomed in, most of the large map is left out.
      const covered = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
      if (camera.zoom >= 3) expect(covered).toBeLessThan(tileCount(LARGE) / 4);
    }
  });

  it('visibleTileRange includes the row above and the row below the viewport (tall sprites, flags and banners reach across)', () => {
    // A viewport that shows exactly the box of tile (10, 10) on the large map.
    const origin = tileOrigin({ x: 10, y: 10 });
    const camera: Camera = { x: origin.px, y: origin.py + 6, zoom: 1 };
    const range = visibleTileRange(camera, { width: TILE_WIDTH, height: 16 }, LARGE);
    expect(range.y0).toBeLessThanOrEqual(9);
    expect(range.y1).toBeGreaterThanOrEqual(11);
    expect(range.x0).toBeLessThanOrEqual(9);
    expect(range.x1).toBeGreaterThanOrEqual(11);
    // The middle of a tile is where tileCenter says, inside its own box.
    expect(tileCenter({ x: 10, y: 10 })).toEqual({ px: origin.px + 13, py: origin.py + 14 });
  });
});
