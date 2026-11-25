import { describe, expect, it } from 'vitest';
import {
  CIVS, CIV_IDS, FEATURE_IDS, IMPROVEMENT_IDS, MAP_SIZES, TERRAIN_IDS, UNITS, UNIT_TYPE_IDS, tileCoord, tileCount,
} from '@domination/shared';
import type { GridSize, UnitTypeId } from '@domination/shared';
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
import { BORDER_INNER, BORDER_OUTER } from '../src/render/borders';
import { ROW_PITCH, TILE_HEIGHT, TILE_WIDTH, hexDepth, isInsideHex, mapPixelSize, tileCenter, tileOrigin } from '../src/render/geometry';
import { tree } from '../src/sprites/art/features';
import { MARKER_IDS } from '../src/sprites/art/markers';
import { ALL_SPRITE_IDS, buildCatalog, featureOf, improvementOf } from '../src/sprites/catalog';
import { FONT_HEIGHT, GLYPHS, GLYPH_WIDTH, drawText, measureText } from '../src/sprites/font';
import type { SpriteSource } from '../src/sprites/format';
import { getPixel } from '../src/sprites/image';
import { SPRITE_LOOKS } from '../src/sprites/looks';
import { PALETTE } from '../src/sprites/palette';
import { ownerRamp, rasterizeSprite } from '../src/sprites/rasterize';
import { RIM_ROWS_ADDED } from '../src/sprites/rim';
import { buildSpriteImages, spriteKey } from '../src/sprites/spriteSheet';
import type { SpriteId, SpriteImage } from '../src/sprites/spriteSheet';
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

  /**
   * A picture laid into a tile box where the map draws it, one text per pixel ('' where nothing is painted), so
   * that sprites of different sizes can be compared pixel by pixel. `solidOnly` leaves out see-through pixels (shadows).
   */
  function inTileBox(sprite: SpriteImage, solidOnly = false): string[] {
    const box: string[] = new Array(TILE_WIDTH * TILE_HEIGHT).fill('');
    for (let y = 0; y < sprite.image.height; y++) {
      for (let x = 0; x < sprite.image.width; x++) {
        const pixel = getPixel(sprite.image, x, y);
        if (pixel[3] === 0 || (solidOnly && pixel[3] !== 255)) continue;
        box[(y + sprite.offsetY) * TILE_WIDTH + x + sprite.offsetX] = pixel.join();
      }
    }
    return box;
  }

  /** In how many pixels of the tile box two pictures differ. */
  function pixelsApart(first: string[], second: string[]): number {
    return first.filter((pixel, index) => pixel !== second[index]).length;
  }

  function spriteImage(id: SpriteId, version = '', owner: 'rome' | '' = '', look: 'normal' | 'fogged' | 'spent' = 'normal'): SpriteImage {
    const found = byKey.get(spriteKey(id, version, owner, look));
    if (found === undefined) throw new Error(`no picture ${id} ${version} ${owner} ${look}`);
    return found;
  }

  it('there is a sprite for every SpriteId (every terrain, feature, improvement and unit type in the tables, and the city)', () => {
    const wanted: SpriteId[] = [
      ...TERRAIN_IDS.map((terrain): SpriteId => `ground.${terrain}`),
      ...FEATURE_IDS.map((feature): SpriteId => `feature.${feature}`),
      ...IMPROVEMENT_IDS.map((improvement): SpriteId => `improvement.${improvement}`),
      ...UNIT_TYPE_IDS.map((unitType): SpriteId => `unit.${unitType}`),
      'city',
      ...MARKER_IDS.map((marker): SpriteId => `marker.${marker}`),
    ];
    // The same ids in the same order: grounds, features, improvements, units, the city, markers.
    expect([...ALL_SPRITE_IDS]).toEqual(wanted);
    // Round 3: the two boats and the net come from the tables like every other id.
    for (const id of ['unit.fishingBoat', 'unit.scoutBoat', 'improvement.fishingNet'] as const) expect(wanted, id).toContain(id);
    expect(MARKER_IDS).toEqual(['selection', 'reachable', 'hover', 'worked', 'pathStep', 'pathEnd', 'working', 'idle']);
    expect(IMPROVEMENT_IDS.map((improvement) => improvementOf(`improvement.${improvement}`))).toEqual([...IMPROVEMENT_IDS]);
    expect(improvementOf('feature.hills')).toBeNull();
    expect(featureOf('improvement.mine')).toBeNull();

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

  it('ground, feature and improvement sprites stay inside their own 26 x 28 tile box (repainting a few tiles relies on it)', () => {
    // render/terrainLayer.ts repaints a changed tile together with its neighbors only. That is enough exactly
    // because nothing on the terrain picture reaches beyond its own tile box. (Cities and units may stick out.)
    const terrainArt = buildCatalog().filter(
      (entry) => entry.id.startsWith('ground.') || entry.id.startsWith('feature.') || entry.id.startsWith('improvement.'),
    );
    expect(terrainArt.length).toBeGreaterThan(30);
    expect(terrainArt.filter((entry) => entry.id.startsWith('improvement.')).length).toBe(IMPROVEMENT_IDS.length * TERRAIN_IDS.length);
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

  it('the six unit types have clearly different pictures; the two boats differ from each other by more than 80 pixels', () => {
    const ids = UNIT_TYPE_IDS.map((unitType): SpriteId => `unit.${unitType}`);
    expect(ids.length).toBe(6);
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const different = pixelsApart(inTileBox(spriteImage(ids[a], '', 'rome')), inTileBox(spriteImage(ids[b], '', 'rome')));
        expect(different, `${ids[a]} against ${ids[b]}`).toBeGreaterThan(40);
      }
    }
    // The two boats do different things (one builds nets, one explores): never mixed up.
    const fishingBoat = inTileBox(spriteImage('unit.fishingBoat', '', 'rome'));
    const scoutBoat = inTileBox(spriteImage('unit.scoutBoat', '', 'rome'));
    expect(pixelsApart(fishingBoat, scoutBoat)).toBeGreaterThan(80);
    // And a boat is a hull under a mast, not a figure that stands in the water: far from every land unit.
    const landUnits = UNIT_TYPE_IDS.filter((unitType) => UNITS[unitType].domain === 'land');
    expect(landUnits.length).toBe(4);
    for (const unitType of landUnits) {
      const figure = inTileBox(spriteImage(`unit.${unitType}`, '', 'rome'));
      expect(pixelsApart(fishingBoat, figure), `the Fishing Boat against the ${unitType}`).toBeGreaterThan(150);
      expect(pixelsApart(scoutBoat, figure), `the Scout Boat against the ${unitType}`).toBeGreaterThan(150);
    }
  });

  it('a boat is 26 x 17 and sits one row lower than the figures; its colours are its owner\'s where the eye looks first', () => {
    /** How many pixels of a unit's picture are in the owner's primary colour (lit, plain, shaded), in the second colour, and the longest row of primary. */
    const ownerPixels = (unitType: UnitTypeId): { primary: number; secondary: number; longestRow: number } => {
      const ramp = ownerRamp(CIVS.rome.primary);
      const primary = [ramp.lit, ramp.base, ramp.shaded].map((color) => rgba(color).join());
      const secondary = rgba(CIVS.rome.secondary).join();
      const picture = inTileBox(spriteImage(`unit.${unitType}`, '', 'rome'));
      let longestRow = 0;
      for (let y = 0; y < TILE_HEIGHT; y++) {
        let run = 0;
        for (let x = 0; x < TILE_WIDTH; x++) {
          run = primary.includes(picture[y * TILE_WIDTH + x]) ? run + 1 : 0;
          longestRow = Math.max(longestRow, run);
        }
      }
      return {
        primary: picture.filter((pixel) => primary.includes(pixel)).length,
        secondary: picture.filter((pixel) => pixel === secondary).length,
        longestRow,
      };
    };
    for (const boat of ['fishingBoat', 'scoutBoat'] as const) {
      const sprite = spriteImage(`unit.${boat}`, '', 'rome');
      expect([sprite.image.width, sprite.image.height, sprite.offsetX, sprite.offsetY], boat).toEqual([TILE_WIDTH, 17, 0, 5]);
      // Its last row (the shadow, the oars) is the last row of the hexagon that has the full width.
      const rows = inTileBox(sprite).map((pixel, index) => (pixel === '' ? -1 : Math.floor(index / TILE_WIDTH))).filter((row) => row >= 0);
      expect([Math.min(...rows), Math.max(...rows)], boat).toEqual([5, ROW_PITCH - 1]);
    }
    // The Fishing Boat: the upper plank of the hull is one long line of the owner's colour (what is left of the
    // colour at the smallest zoom), and the pennant is in the second colour.
    const fishing = ownerPixels('fishingBoat');
    expect(fishing.longestRow).toBeGreaterThanOrEqual(18);
    expect(fishing.secondary).toBeGreaterThanOrEqual(3);
    // The Scout Boat: its sail is the largest patch of owner colour any unit has, with stripes of the second colour.
    const scout = ownerPixels('scoutBoat');
    expect(scout.secondary).toBeGreaterThanOrEqual(8);
    for (const unitType of UNIT_TYPE_IDS) {
      if (unitType === 'scoutBoat') continue;
      const other = ownerPixels(unitType);
      expect(scout.primary + scout.secondary, unitType).toBeGreaterThan(other.primary + other.secondary);
    }
    // Every land unit keeps its colour in short rows (a tunic, a helmet): only a boat has the long line.
    for (const unitType of UNIT_TYPE_IDS) {
      if (UNITS[unitType].domain === 'land') expect(ownerPixels(unitType).longestRow, unitType).toBeLessThan(10);
    }
  });

  it('the Worker is told apart from each of the other three units by more than 80 pixels, and from the Settler by more than 200', () => {
    const worker = inTileBox(spriteImage('unit.worker', '', 'rome'));
    for (const other of ['unit.warrior', 'unit.scout', 'unit.settler'] as const) {
      expect(pixelsApart(worker, inTileBox(spriteImage(other, '', 'rome'))), other).toBeGreaterThan(80);
    }
    // The two civilians must never be mixed up: one founds a city (and is gone), the other builds.
    expect(pixelsApart(worker, inTileBox(spriteImage('unit.settler', '', 'rome')))).toBeGreaterThan(200);
  });

  it('every improvement has one picture per terrain, in every look, and none is in owner colours', () => {
    const catalog = buildCatalog();
    for (const improvement of IMPROVEMENT_IDS) {
      const entries = catalog.filter((entry) => entry.id === `improvement.${improvement}`);
      expect(entries.map((entry) => entry.version).sort()).toEqual([...TERRAIN_IDS].sort());
      for (const entry of entries) {
        expect(entry.owned, `${entry.id} ${entry.version}`).toBe(false);
        expect(entry.rim).toBe(false);
        // No owner characters in the art: it rasterises without an owner (once, under the owner name '').
        expect(() => rasterizeSprite(entry.source)).not.toThrow();
        for (const look of SPRITE_LOOKS) {
          expect(byKey.has(spriteKey(entry.id, entry.version, '', look)), `${entry.id} ${entry.version} ${look}`).toBe(true);
          expect(byKey.has(spriteKey(entry.id, entry.version, 'rome', look))).toBe(false);
        }
        // The fogged twin is another picture of the same shape.
        const bright = spriteImage(entry.id, entry.version);
        const fogged = spriteImage(entry.id, entry.version, '', 'fogged');
        expect(fogged.image.pixels.join()).not.toBe(bright.image.pixels.join());
        expect([fogged.image.width, fogged.image.height, fogged.offsetX, fogged.offsetY]).toEqual(
          [bright.image.width, bright.image.height, bright.offsetX, bright.offsetY],
        );
      }
    }
  });

  it('improvement sprites stay inside their tile box and at least 3 pixels inside the hexagon, clear of the border strip', () => {
    // A territory's border strip is this deep (render/borders.ts); an improvement is painted over it.
    const strip = BORDER_OUTER + BORDER_INNER;
    expect(strip).toBe(3);
    for (const improvement of IMPROVEMENT_IDS) {
      for (const terrain of TERRAIN_IDS) {
        const sprite = spriteImage(`improvement.${improvement}`, terrain);
        let painted = 0;
        for (let y = 0; y < sprite.image.height; y++) {
          for (let x = 0; x < sprite.image.width; x++) {
            if (getPixel(sprite.image, x, y)[3] === 0) continue; // shadows count: they would darken the strip
            painted += 1;
            const [px, py] = [x + sprite.offsetX, y + sprite.offsetY];
            expect(px >= 0 && px < TILE_WIDTH && py >= 0 && py < TILE_HEIGHT, `${improvement} on ${terrain} at (${px}, ${py})`).toBe(true);
            expect(hexDepth(px, py), `${improvement} on ${terrain} at (${px}, ${py})`).toBeGreaterThanOrEqual(strip);
          }
        }
        expect(painted).toBeGreaterThan(40);
      }
    }
  });

  it('the net stays inside its tile box and 3 pixels inside the hexagon', () => {
    const sprite = spriteImage('improvement.fishingNet', 'coast');
    expect([sprite.image.width, sprite.image.height, sprite.offsetX, sprite.offsetY]).toEqual([20, 18, 3, 6]);
    const net = inTileBox(sprite); // with its lattice, which is see-through
    const painted = net.map((pixel, index) => (pixel === '' ? -1 : index)).filter((index) => index >= 0);
    // Enough of it to be seen at the smallest zoom, all of it clear of the border strip.
    expect(painted.length).toBeGreaterThan(100);
    for (const index of painted) {
      expect(hexDepth(index % TILE_WIDTH, Math.floor(index / TILE_WIDTH)), `pixel ${index}`).toBeGreaterThanOrEqual(BORDER_OUTER + BORDER_INNER);
    }
    // One picture on every ground (only coast is ever drawn), and nobody takes it for a farm or a mine.
    expect(new Set(TERRAIN_IDS.map((terrain) => inTileBox(spriteImage('improvement.fishingNet', terrain)).join('|'))).size).toBe(1);
    expect(pixelsApart(net, inTileBox(spriteImage('improvement.farm', 'coast')))).toBeGreaterThan(150);
    expect(pixelsApart(net, inTileBox(spriteImage('improvement.mine', 'coast')))).toBeGreaterThan(150);

    // Six floats: an orange disc of three pixels with a light one, bright and fogged alike.
    const [cork, light] = [rgba(PALETTE.bow).join(), rgba(PALETTE.strawLight).join()];
    expect(net.filter((pixel) => pixel === cork).length).toBe(6 * 3);
    expect(net.filter((pixel) => pixel === light).length).toBe(6);
    const fogged = inTileBox(spriteImage('improvement.fishingNet', 'coast', '', 'fogged'));
    expect(new Set(fogged.filter((pixel, index) => net[index] === cork)).size).toBe(1);
    expect(fogged.filter((pixel, index) => net[index] === cork)[0]).not.toBe(cork);

    // The worked-tile token lies in the top point, the ring's top float right under it: they share no pixel, so
    // a fished tile that a citizen gathers from shows both whole.
    const token = inTileBox(spriteImage('marker.worked'));
    expect(painted.filter((index) => token[index] !== '')).toEqual([]);
    const tokenRows = token.map((pixel, index) => (pixel === '' ? -1 : Math.floor(index / TILE_WIDTH))).filter((row) => row >= 0);
    expect(Math.min(...painted.map((index) => Math.floor(index / TILE_WIDTH)))).toBe(Math.max(...tokenRows) + 1);
  });

  it('a net under a boat is still seen: under a Fishing Boat three floats stay whole, under a Scout Boat or under both boats one', () => {
    // The inner pixels (orange and light) of each float, as lists of places in the tile box.
    const net = inTileBox(spriteImage('improvement.fishingNet', 'coast'));
    const inner = [rgba(PALETTE.bow).join(), rgba(PALETTE.strawLight).join()];
    const floats: number[][] = [];
    net.forEach((pixel, index) => {
      if (!inner.includes(pixel)) return;
      const near = floats.find((float) => float.some((other) => Math.abs((other % TILE_WIDTH) - (index % TILE_WIDTH)) <= 1 && Math.abs(Math.floor(other / TILE_WIDTH) - Math.floor(index / TILE_WIDTH)) <= 1));
      if (near === undefined) floats.push([index]);
      else near.push(index);
    });
    expect(floats.map((float) => float.length)).toEqual([4, 4, 4, 4, 4, 4]);

    /** The places a boat's solid pixels cover when it is drawn (dx, dy) art pixels from the middle of the tile. */
    const covered = (boat: SpriteId, dx = 0, dy = 0): Set<number> => {
      const sprite = spriteImage(boat, '', 'rome');
      const places = new Set<number>();
      for (let y = 0; y < sprite.image.height; y++) {
        for (let x = 0; x < sprite.image.width; x++) {
          const [px, py] = [x + sprite.offsetX + dx, y + sprite.offsetY + dy];
          if (getPixel(sprite.image, x, y)[3] === 255 && px >= 0 && px < TILE_WIDTH && py >= 0 && py < TILE_HEIGHT) places.add(py * TILE_WIDTH + px);
        }
      }
      return places;
    };
    /** How many floats keep at least `pixels` of their four inner pixels in view. */
    const inView = (cover: Set<number>, pixels: number): number =>
      floats.filter((float) => float.filter((index) => !cover.has(index)).length >= pixels).length;

    // Whoever draws a boat anew looks at it on a net (sprites.html) before changing these.
    expect(inView(covered('unit.fishingBoat'), 4)).toBeGreaterThanOrEqual(3);
    expect(inView(covered('unit.scoutBoat'), 3)).toBeGreaterThanOrEqual(1);
    // Both on the tile, where render/scene.ts puts a pair: the Fishing Boat behind (-5, -3), the Scout Boat in front (4, 2).
    const both = new Set([...covered('unit.fishingBoat', -5, -3), ...covered('unit.scoutBoat', 4, 2)]);
    expect(inView(both, 3)).toBeGreaterThanOrEqual(1);
  });

  it('the farm\'s three colourings are three different pictures, and a farm paints more than 150 pixels of its tile', () => {
    const land = ['grassland', 'plains', 'desert'] as const;
    const pictures = land.map((terrain) => inTileBox(spriteImage('improvement.farm', terrain)));
    expect(new Set(pictures.map((picture) => picture.join('|'))).size).toBe(3);
    for (const picture of pictures) {
      // A farm must be seen at the smallest zoom: it fills the middle of the tile, not a corner of it.
      expect(picture.filter((pixel) => pixel !== '').length).toBeGreaterThan(150);
    }
    // The three differ in colour only: the same pixels are painted.
    const shapes = new Set(pictures.map((picture) => picture.map((pixel) => (pixel === '' ? '.' : '#')).join('')));
    expect(shapes.size).toBe(1);
    // The mine is one picture on every ground.
    expect(new Set(land.map((terrain) => inTileBox(spriteImage('improvement.mine', terrain)).join('|'))).size).toBe(1);
    // And nobody can take a farm for a mine.
    expect(pixelsApart(pictures[0], inTileBox(spriteImage('improvement.mine', 'grassland')))).toBeGreaterThan(150);
  });

  it('the mine\'s timber frame shares no pixel with the worked-tile token (marker.worked)', () => {
    // With a city selected every worked tile carries the gold token. The frame around the mouth of the mine is
    // what tells a mined hill from a plain one, so the token must never lie on it.
    const timber = [PALETTE.strawLight, PALETTE.bow, PALETTE.plankShade].map((color) => rgba(color).join());
    const token = inTileBox(spriteImage('marker.worked'), true);
    expect(token.filter((pixel) => pixel !== '').length).toBeGreaterThan(30);
    for (const terrain of TERRAIN_IDS) {
      const mine = inTileBox(spriteImage('improvement.mine', terrain));
      const frame = mine.map((pixel, index) => (timber.includes(pixel) ? index : -1)).filter((index) => index >= 0);
      expect(frame.length, terrain).toBeGreaterThanOrEqual(12); // a beam and two posts
      // The frame and the dark mouth inside it: everything from its first to its last column and row.
      const columns = frame.map((index) => index % TILE_WIDTH);
      const rows = frame.map((index) => Math.floor(index / TILE_WIDTH));
      const [left, right, top, bottom] = [Math.min(...columns), Math.max(...columns), Math.min(...rows), Math.max(...rows)];
      expect(right - left).toBeGreaterThanOrEqual(4);
      expect(bottom - top).toBeGreaterThanOrEqual(4);
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          expect(mine[y * TILE_WIDTH + x], `the frame at (${x}, ${y})`).not.toBe('');
          expect(token[y * TILE_WIDTH + x], `the token at (${x}, ${y})`).toBe('');
        }
      }
    }
  });

  it('the worked-tile token lies in the top point of the hexagon, where no improvement, no "at work" sign and no unit but a Scout\'s feather reaches', () => {
    // The token is drawn AFTER the units (render/frame.ts). In the middle of the tile it lay under whatever stood
    // there, and the worked tiles are where the Workers stand.
    const sprite = spriteImage('marker.worked');
    expect([sprite.offsetX, sprite.offsetY, sprite.image.height]).toEqual([9, 0, 6]);
    const token = inTileBox(sprite); // with its shadow
    const painted = token.map((pixel, index) => (pixel === '' ? -1 : index)).filter((index) => index >= 0);
    // Wholly inside its own tile's hexagon: it can be taken for no other tile's.
    for (const index of painted) expect(isInsideHex(index % TILE_WIDTH, Math.floor(index / TILE_WIDTH)), `pixel ${index}`).toBe(true);
    const lastRow = Math.max(...painted.map((index) => Math.floor(index / TILE_WIDTH)));
    expect(lastRow).toBe(5);

    // Nothing built on a tile reaches it, and the "at work" sign does not either, wherever its unit stands (it is
    // moved up by one art pixel at most: workingSignOffset in render/scene.ts).
    for (const terrain of TERRAIN_IDS) {
      for (const improvement of IMPROVEMENT_IDS) {
        const built = inTileBox(spriteImage(`improvement.${improvement}`, terrain));
        expect(painted.filter((index) => built[index] !== ''), `${improvement} on ${terrain}`).toEqual([]);
      }
    }
    expect(spriteImage('marker.working').offsetY - 1).toBeGreaterThan(lastRow);

    // A unit alone on its tile. Where the token lies on a pixel of the unit, both are the dark line (the token ends
    // on the line around the head), so nothing of the unit is seen to be covered. The Scout is the one exception:
    // the feather on its cap is the only part of a unit that reaches higher than a head.
    const covered = (unit: SpriteId): number => {
      const figure = inTileBox(spriteImage(unit, '', 'rome'));
      const outline = OUTLINE.join();
      return painted.filter((index) => figure[index] !== '' && !(figure[index] === outline && (token[index] === outline || token[index] === SHADOW.join()))).length;
    };
    expect(covered('unit.warrior')).toBe(0);
    expect(covered('unit.worker')).toBe(0);
    expect(covered('unit.settler')).toBe(0);
    expect(covered('unit.scout')).toBeGreaterThan(0);
    expect(covered('unit.scout')).toBeLessThanOrEqual(12);
    // A boat's mast top is that dark line too: the token of a fished tile covers nothing of the boat on it.
    expect(covered('unit.fishingBoat')).toBe(0);
    expect(covered('unit.scoutBoat')).toBe(0);
  });

  it('the worked-tile token has what no hill has: a white face inside its gold rim; no hill on any ground, and no float of a net, has a pixel near white', () => {
    // The token was a gold oval with a dark line, as one mound of hills on plains is, in nearly the same three
    // colours; "Build first" puts the citizens on hills, and such a tile showed three gold lumps.
    const token = spriteImage('marker.worked').image;
    const white = rgba(PALETTE.tokenFace);
    expect(white).toEqual([255, 255, 255, 255]);
    // The picture: a face of 4 x 2 white pixels in the middle, a rim of gold around it that is deeper at the
    // lower right, the dark line and the shadow as they always were.
    expect([token.width, token.height]).toEqual([10, 6]);
    for (const y of [2, 3]) for (const x of [2, 3, 4, 5]) expect(getPixel(token, x, y), `the face at (${x}, ${y})`).toEqual(white);
    expect(countPixels(token, white)).toBe(8);
    expect(countPixels(token, rgba(PALETTE.gold))).toBe(7);
    expect(countPixels(token, rgba(PALETTE.tokenShade))).toBe(5);
    expect(countPixels(token, OUTLINE)).toBe(16);
    expect(countPixels(token, SHADOW)).toBe(7);
    expect(countPixels(token, NOTHING)).toBe(60 - 8 - 7 - 5 - 16 - 7);
    // Still a gold token: more gold than white inside the dark line, and the gold touches the line all around.
    expect(countPixels(token, rgba(PALETTE.gold)) + countPixels(token, rgba(PALETTE.tokenShade))).toBeGreaterThan(countPixels(token, white));
    // The rim alone would not do: the token's gold is nearly the gold of a hill on plains.
    const apart = (a: number[], b: number[]): number => Math.max(...[0, 1, 2].map((channel) => Math.abs(a[channel] - b[channel])));
    expect(apart(rgba(PALETTE.gold), rgba(PALETTE.plainsHill))).toBeLessThan(32);

    // No hill has a pixel that could be taken for the face: on every ground, bright and fogged, each of its
    // pixels is more than 48 away from white in some colour channel. The same for the floats of a fishing net,
    // the top one of which lies right under the token.
    let looked = 0;
    for (const terrain of TERRAIN_IDS) {
      for (const look of ['normal', 'fogged'] as const) {
        for (const id of ['feature.hills', 'improvement.fishingNet', 'improvement.mine'] as const) {
          const picture = spriteImage(id, terrain, '', look).image;
          for (let y = 0; y < picture.height; y++) {
            for (let x = 0; x < picture.width; x++) {
              const pixel = getPixel(picture, x, y);
              if (pixel[3] !== 255) continue;
              looked += 1;
              expect(apart(pixel, white), `${id} on ${terrain}, ${look}, at (${x}, ${y}): ${pixel.join()}`).toBeGreaterThan(48);
            }
          }
        }
      }
    }
    expect(looked).toBeGreaterThan(5 * 2 * 3 * 60);
    // The lightest pixel of a hill, the lit edge of one on desert, is the nearest any comes.
    expect(apart(rgba(PALETTE.desertHillLight), white)).toBe(55);
    expect(apart(rgba(PALETTE.plainsHillLight), white)).toBe(87);
  });

  it('the "at work" sign is 7 x 7 and the "builds nothing" sign 7 x 9; they differ from each other and from the path dot in more than 12 pixels', () => {
    const working = spriteImage('marker.working');
    const idle = spriteImage('marker.idle');
    expect([working.image.width, working.image.height]).toEqual([7, 7]);
    expect([idle.image.width, idle.image.height]).toEqual([7, 9]);
    // Where they sit in the tile box: left of the figure; at the upper left of a city's hall, right under the banner.
    expect([working.offsetX, working.offsetY]).toEqual([1, 7]);
    expect([idle.offsetX, idle.offsetY]).toEqual([0, 2]);

    // Compared as shapes, each with its top-left corner in the same place: where a sign lies on the tile must not
    // be what tells it from another one.
    const shape = (sprite: SpriteImage): string[] => inTileBox({ ...sprite, offsetX: 0, offsetY: 0 });
    const dot = spriteImage('marker.pathStep');
    const token = spriteImage('marker.worked');
    expect(pixelsApart(shape(working), shape(idle))).toBeGreaterThan(12);
    expect(pixelsApart(shape(working), shape(dot))).toBeGreaterThan(12);
    expect(pixelsApart(shape(idle), shape(dot))).toBeGreaterThan(12);
    // The gold sign over a city is not the gold token of a worked tile either.
    expect(pixelsApart(shape(idle), shape(token))).toBeGreaterThan(12);

    // The "at work" sign is a square (the path dot is round): all four corners are painted. One colour besides the outline.
    for (const [x, y] of [[0, 0], [6, 0], [0, 6], [6, 6]]) expect(getPixel(working.image, x, y)).toEqual(OUTLINE);
    expect(getPixel(dot.image, 0, 0)).toEqual(NOTHING);
    expect(countPixels(working.image, rgba(PALETTE.markerWhite)) + countPixels(working.image, OUTLINE)).toBe(49);
    expect(countPixels(idle.image, rgba(PALETTE.gold)) + countPixels(idle.image, OUTLINE)).toBe(63);
    // The exclamation mark has gold all around it: it touches the frame nowhere.
    for (let x = 1; x <= 5; x++) {
      expect(getPixel(idle.image, x, 1)).toEqual(rgba(PALETTE.gold));
      expect(getPixel(idle.image, x, 7)).toEqual(rgba(PALETTE.gold));
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
