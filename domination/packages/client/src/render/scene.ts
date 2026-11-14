/**
 * What stands on the map and in which order it is drawn (work package WP5).
 * Pure: no canvas, so the rules for stacking and dimming are tested in Node.
 */

import { UNITS, areAdjacent, isValidTile, tileCoord } from '@domination/shared';
import type { CityView, FeatureId, PlayerView, TileIndex, UnitId, UnitView } from '@domination/shared';
import type { SpriteLook } from '../sprites/looks';
import { tileOrigin } from './geometry';
import type { ArtPoint } from './geometry';

/** One unit as it will be drawn. */
export interface UnitDrawing {
  unit: UnitView;
  /** How far the sprite is moved away from its tile's normal unit position, in art pixels. */
  dx: number;
  dy: number;
  /** 'spent' for an own unit with no moves left, otherwise 'normal'. */
  look: SpriteLook;
  /** True if the unit stands among trees: it is then drawn with a pale line around it, so it does not get lost (sprites/rim.ts). */
  rim: boolean;
}

/** The features a unit is hard to make out on. (Hills are low and mountains cannot be entered.) */
const FEATURES_THAT_HIDE_UNITS: readonly FeatureId[] = ['forest'];

/**
 * Where units stand inside their tile, in art pixels from the normal spot.
 *  - Alone on open ground: the normal spot, in the middle.
 *  - Two on a tile: one in front (lower right), one behind (upper left),
 *    both in view.
 *  - On a city tile: at the right-hand side in front of the hall, so the
 *    roof and the flag stay visible; a second unit stands at the left.
 */
const ALONE = { dx: 0, dy: 0 };
const PAIR_FRONT = { dx: 4, dy: 2 };
const PAIR_BACK = { dx: -5, dy: -3 };
const CITY_FRONT = { dx: 8, dy: 4 };
const CITY_BACK = { dx: -8, dy: 3 };

/**
 * The units of a view in drawing order: row by row from the top (so a unit
 * further down overlaps one further up), and on a shared tile the one
 * behind before the one in front.
 *
 * On a tile with two units the military unit stands in front and the
 * civilian behind it, unless `selectedUnitId` is one of the two: then the
 * selected unit stands in front.
 */
export function unitDrawings(view: PlayerView, selectedUnitId: UnitId | null): UnitDrawing[] {
  const cityTiles = new Set(view.cities.map((city) => city.tile));

  // Front-most last within a tile: the selected unit, then military, then civilian.
  const frontRank = (unit: UnitView): number => {
    if (unit.id === selectedUnitId) return 2;
    return UNITS[unit.type].unitClass === 'military' ? 1 : 0;
  };
  const ordered = view.units
    .map((unit, index) => ({ unit, index }))
    .sort((a, b) => a.unit.tile - b.unit.tile || frontRank(a.unit) - frontRank(b.unit) || a.index - b.index)
    .map((entry) => entry.unit);

  const drawings: UnitDrawing[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const unit = ordered[i];
    const sharesWithNext = i + 1 < ordered.length && ordered[i + 1].tile === unit.tile;
    const sharesWithPrevious = i > 0 && ordered[i - 1].tile === unit.tile;
    const inCity = cityTiles.has(unit.tile);
    let place = ALONE;
    if (sharesWithNext) place = inCity ? CITY_BACK : PAIR_BACK;
    else if (sharesWithPrevious) place = inCity ? CITY_FRONT : PAIR_FRONT;
    else if (inCity) place = CITY_FRONT;
    drawings.push({
      unit,
      dx: place.dx,
      dy: place.dy,
      look: unit.own !== null && unit.own.movesLeft === 0 ? 'spent' : 'normal',
      rim: FEATURES_THAT_HIDE_UNITS.some((feature) => view.tiles[unit.tile]?.feature === feature),
    });
  }
  return drawings;
}

/** The cities of a view in drawing order: row by row from the top. */
export function citiesInDrawingOrder(view: PlayerView): CityView[] {
  return view.cities
    .map((city, index) => ({ city, index }))
    .sort((a, b) => a.city.tile - b.city.tile || a.index - b.index)
    .map((entry) => entry.city);
}

/** One mark of the path preview: which marker, and the top-left art pixel of the tile box it is drawn for. */
export interface PathMark {
  kind: 'step' | 'end';
  px: number;
  py: number;
}

/**
 * The path preview as a dotted line: a dot on every tile of the path, a dot
 * halfway between each tile and the next, and the "stop here" ring on the
 * last tile. The line starts at `start` (the selected unit's tile) with a
 * halfway dot if that tile is next to the first tile of the path; the start
 * tile itself gets no mark. Tiles that are not on the map are left out.
 */
export function pathMarks(view: PlayerView, start: TileIndex | null, path: readonly TileIndex[]): PathMark[] {
  const origin = (tile: TileIndex): ArtPoint => tileOrigin(tileCoord(tile, view));
  const marks: PathMark[] = [];
  let previous = start !== null && isValidTile(start, view) ? start : null;
  path.forEach((tile, index) => {
    if (!isValidTile(tile, view)) {
      previous = null;
      return;
    }
    const here = origin(tile);
    if (previous !== null && areAdjacent(previous, tile, view)) {
      const from = origin(previous);
      marks.push({ kind: 'step', px: Math.round((from.px + here.px) / 2), py: Math.round((from.py + here.py) / 2) });
    }
    marks.push({ kind: index === path.length - 1 ? 'end' : 'step', px: here.px, py: here.py });
    previous = tile;
  });
  return marks;
}
