/**
 * The sprite gallery (work package WP5), a development page:
 *
 *   npm run dev, then open http://localhost:5173/sprites.html
 *
 * It shows every picture of the sprite sheet enlarged, so the art can be
 * checked and changed without hunting for a place on the map where it
 * appears: every ground with its variants, every feature on every land
 * ground (bright and fogged), the city and the four units in every
 * civilization's colours (as drawn, spent, fogged), the units as they are
 * drawn among trees (with a pale line around them), the markers, the
 * improvements on every ground they fit (bright and fogged, beside plain
 * hills, under the worked-tile token and under units), the "at work" sign
 * for every place a unit can stand, the "builds nothing" sign over a city
 * with and without units, the pixel font and the banners.
 *
 * Add ?zoom=6 to the address for another enlargement (default 4).
 * The page is only served by the development server; `npm run build` does
 * not include it.
 */

import { CIVS, CIV_IDS, FEATURE_IDS, IMPROVEMENTS, TERRAIN_IDS, UNIT_TYPE_IDS } from '@domination/shared';
import type { CivId, FeatureId, ImprovementId, PlayerView, TerrainId, UnitTypeId } from '@domination/shared';
import '../styles.css';
import { bannerFrame, bannerLayout, bannerScale, drawBanner } from '../render/banner';
import { TILE_HEIGHT, TILE_WIDTH } from '../render/geometry';
import { ownerColors } from '../render/owners';
import { cityIsIdle, unitDrawings, workingSignOffset } from '../render/scene';
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
const COLUMNS = 26;
const ROWS = 17;

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

/** Draws a sprite into the cell (column, row), as it would sit on a tile there, moved by (dx, dy) art pixels. */
function draw(sprite: Sprite, column: number, row: number, dx = 0, dy = 0): void {
  context.drawImage(
    sprite.image,
    sprite.sx, sprite.sy, sprite.width, sprite.height,
    (column * CELL_WIDTH + 2 + sprite.offsetX + dx) * zoom, (row * CELL_HEIGHT + 6 + sprite.offsetY + dy) * zoom,
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

/** One tile with what stands on it. Everything but the ground is optional. */
interface TileScene {
  terrain: TerrainId;
  feature?: FeatureId;
  improvement?: ImprovementId;
  /** True for a tile out of sight: every picture is its fogged twin. */
  fogged?: boolean;
  /** True to lay the gold token of a worked tile on it. */
  worked?: boolean;
  /** A city of Rome on the tile: one with something in its build queue, or one that builds nothing. */
  city?: 'building' | 'idle';
  /** Units of Rome on the tile, as [type, 'atWork' | 'idle' | 'spent']. */
  units?: [type: UnitTypeId, state: 'atWork' | 'idle' | 'spent'][];
  /** Which of `units` is the selected one (it stands in front). */
  selected?: number;
}

/**
 * Draws one tile into the cell (column, row) the way the map does: the
 * order of render/terrainLayer.ts and render/frame.ts, and the places and
 * looks render/scene.ts gives the units and the two signs. It is made from
 * a view of one tile, so the gallery cannot drift away from the map.
 */
function tileScene(scene: TileScene, column: number, row: number): void {
  const look: SpriteLook = scene.fogged ? 'fogged' : 'normal';
  const view: PlayerView = {
    you: 'p1', turn: 1, width: 1, height: 1,
    tiles: [{ terrain: scene.terrain, feature: scene.feature ?? null, improvement: scene.improvement ?? null, owner: 'p1', visible: !scene.fogged }],
    units: (scene.units ?? []).map(([type, state], index) => ({
      id: `unit${index}`, type, owner: 'p1', tile: 0,
      own: {
        movesLeft: state === 'spent' ? 0 : 2,
        foundCityError: 'cannotFoundCity',
        job: state === 'atWork' ? { improvement: 'farm', turnsWorked: 1, turnsTotal: IMPROVEMENTS.farm.turns, turnsLeft: IMPROVEMENTS.farm.turns - 1 } : null,
        jobOptions: [],
      },
    })),
    cities: scene.city === undefined ? [] : [{
      id: 'city', owner: 'p1', name: 'Rome', tile: 0, population: 1, visible: !scene.fogged,
      own: {
        foodStored: 0, foodToGrow: 10, foodPerTurn: 2,
        buildQueue: scene.city === 'idle' ? [] : [{ item: { kind: 'unit', unitType: 'warrior' }, cost: 18, turns: 9, wait: null }],
        held: null, productionStored: 0, productionPerTurn: 2, worked: [], buildOptions: [],
      },
    }],
    players: [{ id: 'p1', name: 'Ada', civ: 'rome', endedTurn: false }],
  };
  const tile = view.tiles[0]!;

  draw(sheet.get(`ground.${tile.terrain}`, undefined, { look, bare: tile.feature !== null || tile.improvement !== null }), column, row);
  if (tile.feature !== null) draw(sheet.get(`feature.${tile.feature}`, undefined, { look, on: tile.terrain }), column, row);
  if (tile.improvement !== null) draw(sheet.get(`improvement.${tile.improvement}`, undefined, { look, on: tile.terrain }), column, row);
  if (scene.worked) draw(sheet.get('marker.worked'), column, row);
  if (view.cities.length > 0) draw(sheet.get('city', 'rome', { look }), column, row);
  for (const drawing of unitDrawings(view, scene.selected === undefined ? null : `unit${scene.selected}`)) {
    draw(sheet.get(`unit.${drawing.unit.type}`, 'rome', { look: drawing.look, rim: drawing.rim }), column, row, drawing.dx, drawing.dy);
    if (drawing.working) {
      const sign = workingSignOffset(drawing);
      draw(sheet.get('marker.working'), column, row, sign.dx, sign.dy);
    }
  }
  for (const city of view.cities) {
    if (cityIsIdle(city)) draw(sheet.get('marker.idle'), column, row);
  }
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

// Rows 12-13: what a Worker builds, and the two small signs, each drawn as the map draws it.
label('FARM AND MINE ON EACH GROUND', 0, 12);
label('THE SAME FOGGED', 0, 13);
label('PLAIN HILLS', 7, 12);
LAND.forEach((terrain, index) => {
  for (const [row, fogged] of [[12, false], [13, true]] as const) {
    tileScene({ terrain, improvement: 'farm', fogged }, index, row);
    tileScene({ terrain, feature: 'hills', improvement: 'mine', fogged }, 3 + index, row);
    tileScene({ terrain, feature: 'hills', fogged }, 7 + index, row);
  }
});

label('WORKED BY A CITIZEN', 11, 12);
LAND.forEach((terrain, index) => {
  tileScene({ terrain, improvement: 'farm', worked: true }, 11 + index, 12);
  tileScene({ terrain, feature: 'hills', improvement: 'mine', worked: true }, 14 + index, 12);
});

label('WITH UNITS ON THE TILE  AND WORKED AS WELL', 18, 12);
tileScene({ terrain: 'grassland', improvement: 'farm', units: [['worker', 'idle']] }, 18, 12);
tileScene({ terrain: 'plains', improvement: 'farm', units: [['warrior', 'idle']] }, 19, 12);
tileScene({ terrain: 'desert', improvement: 'farm', units: [['warrior', 'idle'], ['worker', 'idle']] }, 20, 12);
tileScene({ terrain: 'grassland', feature: 'hills', improvement: 'mine', units: [['worker', 'idle']] }, 21, 12);
tileScene({ terrain: 'plains', feature: 'hills', improvement: 'mine', units: [['warrior', 'idle']] }, 22, 12);
tileScene({ terrain: 'desert', feature: 'hills', improvement: 'mine', units: [['scout', 'idle'], ['worker', 'idle']] }, 23, 12);
tileScene({ terrain: 'grassland', improvement: 'farm', worked: true, units: [['worker', 'idle']] }, 24, 12);
tileScene({ terrain: 'grassland', feature: 'hills', improvement: 'mine', worked: true, units: [['warrior', 'idle']] }, 25, 12);

label('AT WORK  ALONE  IN FRONT  BEHIND  ON HILLS  NOT AT WORK', 11, 13);
tileScene({ terrain: 'plains', units: [['worker', 'atWork']] }, 11, 13);
tileScene({ terrain: 'grassland', units: [['warrior', 'idle'], ['worker', 'atWork']], selected: 1 }, 12, 13);
tileScene({ terrain: 'grassland', units: [['warrior', 'idle'], ['worker', 'atWork']] }, 13, 13);
tileScene({ terrain: 'desert', feature: 'hills', units: [['worker', 'atWork']] }, 14, 13);
tileScene({ terrain: 'plains', units: [['worker', 'idle']] }, 15, 13);
tileScene({ terrain: 'plains', units: [['worker', 'spent']] }, 16, 13);

label('BUILDS NOTHING  WITH UNITS  AND A CITY THAT BUILDS', 18, 13);
tileScene({ terrain: 'grassland', city: 'idle' }, 18, 13);
tileScene({ terrain: 'grassland', city: 'idle', units: [['warrior', 'idle']] }, 19, 13);
tileScene({ terrain: 'grassland', city: 'idle', units: [['warrior', 'idle'], ['worker', 'idle']] }, 20, 13);
tileScene({ terrain: 'plains', city: 'idle' }, 21, 13);
tileScene({ terrain: 'desert', city: 'idle', units: [['scout', 'spent']] }, 22, 13);
tileScene({ terrain: 'grassland', city: 'building', units: [['warrior', 'idle']] }, 23, 13);

// Rows 14-16: the pixel font and one banner per civilization.
label('FONT AND BANNERS AS AT ZOOM 1  3  6  AND FOGGED', 0, 14);
const fontY = (14 * CELL_HEIGHT + 8) * zoom;
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
