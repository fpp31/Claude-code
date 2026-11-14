/**
 * The sprite gallery (work package WP5), a development page:
 *
 *   npm run dev, then open http://localhost:5173/sprites.html
 *
 * It shows every picture of the sprite sheet enlarged, so the art can be
 * checked and changed without hunting for a place on the map where it
 * appears: every ground with its variants, every feature on every land
 * ground (bright and fogged), the city and the three units in every
 * civilization's colours (as drawn, spent, fogged), the units as they are
 * drawn among trees (with a pale line around them), the markers, the pixel
 * font and the banners.
 *
 * Add ?zoom=6 to the address for another enlargement (default 4).
 * The page is only served by the development server; `npm run build` does
 * not include it.
 */

import { CIVS, CIV_IDS, FEATURE_IDS, TERRAIN_IDS, UNIT_TYPE_IDS } from '@domination/shared';
import type { CivId, TerrainId } from '@domination/shared';
import '../styles.css';
import { bannerFrame, bannerLayout, bannerScale, drawBanner } from '../render/banner';
import { TILE_HEIGHT, TILE_WIDTH } from '../render/geometry';
import { ownerColors } from '../render/owners';
import { MARKER_IDS } from '../sprites/art/markers';
import { groundVariantCount } from '../sprites/catalog';
import { context2d } from '../sprites/canvas';
import { drawText } from '../sprites/font';
import type { SpriteLook } from '../sprites/looks';
import { PALETTE } from '../sprites/palette';
import { createTextSpriteSheet, pickVariant } from '../sprites/spriteSheet';
import type { Sprite, SpriteId } from '../sprites/spriteSheet';

const zoom = Math.max(1, Math.round(Number(new URLSearchParams(location.search).get('zoom') ?? '4')));
const LAND: TerrainId[] = ['grassland', 'plains', 'desert'];
const OWNERS: (CivId | undefined)[] = [...CIV_IDS, undefined];

/** The gallery is a grid of cells, each a little larger than a tile. */
const CELL_WIDTH = TILE_WIDTH + 4;
const CELL_HEIGHT = TILE_HEIGHT + 8;
const COLUMNS = 22;
const ROWS = 15;

const canvas = document.createElement('canvas');
canvas.width = COLUMNS * CELL_WIDTH * zoom;
canvas.height = ROWS * CELL_HEIGHT * zoom;
canvas.style.width = `${canvas.width / devicePixelRatio}px`;
canvas.style.height = `${canvas.height / devicePixelRatio}px`;
document.body.style.overflow = 'auto';
document.body.append(canvas);

const context = context2d(canvas);
context.imageSmoothingEnabled = false;
context.fillStyle = PALETTE.outline;
context.fillRect(0, 0, canvas.width, canvas.height);

const sheet = createTextSpriteSheet();

/** Draws a sprite into the cell (column, row), as it would sit on a tile there. */
function draw(sprite: Sprite, column: number, row: number): void {
  context.drawImage(
    sprite.image,
    sprite.sx, sprite.sy, sprite.width, sprite.height,
    (column * CELL_WIDTH + 2 + sprite.offsetX) * zoom, (row * CELL_HEIGHT + 6 + sprite.offsetY) * zoom,
    sprite.width * zoom, sprite.height * zoom,
  );
}

/** A tile index that gets the wanted variant of a ground (the sheet picks variants from tile indexes). */
function tileNumberFor(terrain: TerrainId, variant: number): number {
  const count = groundVariantCount(terrain);
  for (let number = 0; number < 1000; number++) {
    if (pickVariant(number, count) === variant) return number;
  }
  return 0;
}

function ground(terrain: TerrainId, column: number, row: number, look: SpriteLook = 'normal', variant = 0): void {
  draw(sheet.get(`ground.${terrain}`, undefined, { look, variant }), column, row);
}

function label(text: string, column: number, row: number): void {
  drawText(context, text, (column * CELL_WIDTH + 2) * zoom, (row * CELL_HEIGHT) * zoom + 2, Math.max(1, Math.floor(zoom / 2)), '#f8f0d8');
}

// Row 0: every ground with all its variants, then fogged.
let column = 0;
label('GROUNDS AND THEIR VARIANTS THEN FOGGED', 0, 0);
for (const terrain of TERRAIN_IDS) {
  for (let variant = 0; variant < groundVariantCount(terrain); variant++) {
    ground(terrain, column++, 0, 'normal', tileNumberFor(terrain, variant));
  }
}
for (const terrain of TERRAIN_IDS) ground(terrain, column++, 0, 'fogged');

// Rows 1-2: every feature on every land ground, bright and fogged.
label('FEATURES ON EACH GROUND', 0, 1);
label('THE SAME FOGGED', 0, 2);
column = 0;
for (const feature of FEATURE_IDS) {
  for (const terrain of LAND) {
    for (const [row, look] of [[1, 'normal'], [2, 'fogged']] as const) {
      draw(sheet.get(`ground.${terrain}`, undefined, { look, bare: true }), column, row);
      draw(sheet.get(`feature.${feature}`, undefined, { look, on: terrain }), column, row);
    }
    column++;
  }
  column++;
}

// Rows 1-2, to the right: units among trees, with the pale line around them (as drawn, then spent).
label('UNITS AMONG TREES  AS DRAWN  SPENT', 13, 1);
(['rome', 'norse'] as const).forEach((owner, index) => {
  column = 13;
  for (const look of ['normal', 'spent'] as const) {
    for (const unitType of UNIT_TYPE_IDS) {
      draw(sheet.get('ground.grassland', undefined, { bare: true }), column, 1 + index);
      draw(sheet.get('feature.forest'), column, 1 + index);
      draw(sheet.get(`unit.${unitType}`, owner, { look, rim: true }), column, 1 + index);
      column++;
    }
  }
});

// Rows 3-9: city and units for every civilization (and the neutral fallback).
label('CITY AND UNITS PER CIVILIZATION  AS DRAWN  SPENT  FOGGED  ON EACH GROUND', 0, 3);
OWNERS.forEach((owner, index) => {
  const row = 3 + index;
  const ids: SpriteId[] = ['city', ...UNIT_TYPE_IDS.map((unitType): SpriteId => `unit.${unitType}`)];
  column = 0;
  for (const look of ['normal', 'spent', 'fogged'] as const) {
    for (const id of ids) {
      ground('grassland', column, row, look === 'fogged' ? 'fogged' : 'normal');
      draw(sheet.get(id, owner, { look }), column, row);
      column++;
    }
  }
  for (const terrain of ['plains', 'desert'] as const) {
    for (const id of ids) {
      ground(terrain, column, row);
      draw(sheet.get(id, owner), column, row);
      column++;
    }
  }
});

// Row 10-11: markers on each land ground, and on a forest.
label('MARKERS', 0, 10);
column = 0;
for (const marker of MARKER_IDS) {
  for (const terrain of LAND) {
    ground(terrain, column, 10);
    draw(sheet.get(`marker.${marker}`), column, 10);
    column++;
  }
}
column = 0;
for (const marker of MARKER_IDS) {
  for (const feature of FEATURE_IDS) {
    draw(sheet.get('ground.grassland', undefined, { bare: true }), column, 11);
    draw(sheet.get(`feature.${feature}`), column, 11);
    draw(sheet.get(`marker.${marker}`), column, 11);
    column++;
  }
}

// Rows 12-14: the pixel font and one banner per civilization.
label('FONT AND BANNERS AS AT ZOOM 1  3  6  AND FOGGED', 0, 12);
const fontY = (12 * CELL_HEIGHT + 8) * zoom;
drawText(context, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789', 2 * zoom, fontY, 2, '#ffffff');
drawText(context, 'the quick brown fox jumps over the lazy dog', 2 * zoom, fontY + 20, 2, '#ffffff');
let bannerX = 2 * zoom;
[...CIV_IDS, undefined].forEach((civ, index) => {
  const name = civ === undefined ? 'Nowhere' : CIVS[civ].cityNames[index % 3];
  const layout = bannerLayout(name, index * 3 + 1);
  // As at zoom 1, 3 and 6, then fogged as at zoom 3.
  [1, 3, 6].forEach((atZoom, line) => {
    drawBanner(context, layout, ownerColors(civ), false, bannerX, fontY + 50 + line * 44, bannerScale(atZoom), bannerFrame(atZoom));
  });
  drawBanner(context, layout, ownerColors(civ), true, bannerX, fontY + 50 + 3 * 44, bannerScale(3), bannerFrame(3));
  bannerX += layout.width * 3 + 12;
});
