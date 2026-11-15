/**
 * Maps as text, for tests, demos and for looking at a map.
 *
 * Drawing a map as text lets a rules test say exactly what the land looks
 * like without needing the map generator:
 *
 *   const map = mapFromAscii([
 *     '~ ~ ~ ~ ~',
 *     ' , g f , ~',
 *     '~ g h m ~',
 *   ]);
 *
 * One character per tile; spaces are ignored, so odd rows can be indented by
 * one space to look like the real hex layout (odd rows sit half a tile to
 * the right).
 *
 * `mapToAscii` goes the other way: it draws any map, also a generated one,
 * with the same characters.
 */

import type { FeatureId, Ground, TerrainId } from '../data/terrain';
import type { GameMap, Tile, TileIndex } from '../types';

/**
 * What each character means. There is one for every kind of tile the game
 * has: every ground, and every feature on every ground it may stand on.
 * Lower-case features stand on grassland, upper-case F H M on plains; D and
 * A are the hills and the mountains of the desert.
 */
export const ASCII_LEGEND: Record<string, { terrain: TerrainId; feature: FeatureId | null }> = {
  '~': { terrain: 'ocean', feature: null },
  ',': { terrain: 'coast', feature: null },
  g: { terrain: 'grassland', feature: null },
  p: { terrain: 'plains', feature: null },
  d: { terrain: 'desert', feature: null },
  f: { terrain: 'grassland', feature: 'forest' },
  h: { terrain: 'grassland', feature: 'hills' },
  m: { terrain: 'grassland', feature: 'mountains' },
  F: { terrain: 'plains', feature: 'forest' },
  H: { terrain: 'plains', feature: 'hills' },
  M: { terrain: 'plains', feature: 'mountains' },
  D: { terrain: 'desert', feature: 'hills' },
  A: { terrain: 'desert', feature: 'mountains' },
};

/**
 * Builds a GameMap from rows of characters (see ASCII_LEGEND). Every tile
 * has `cityId: null` and `improvement: null`. Throws on an unknown character,
 * on an empty map, or if the rows do not all have the same number of tiles.
 */
export function mapFromAscii(rows: readonly string[]): GameMap {
  if (rows.length === 0) throw new Error('mapFromAscii: no rows');
  const tiles: Tile[] = [];
  let width = -1;
  rows.forEach((row, y) => {
    const characters = row.replace(/ /g, '');
    if (width === -1) width = characters.length;
    if (characters.length === 0 || characters.length !== width) {
      throw new Error(`mapFromAscii: row ${y} has ${characters.length} tiles, expected ${width}`);
    }
    for (const character of characters) {
      const entry = ASCII_LEGEND[character];
      if (entry === undefined) throw new Error(`mapFromAscii: unknown character '${character}' in row ${y}`);
      tiles.push({ terrain: entry.terrain, feature: entry.feature, improvement: null, cityId: null });
    }
  });
  return { width, height: rows.length, tiles };
}

/** The character for one tile ('?' for a combination the legend does not have). */
export function tileToAscii(tile: Ground): string {
  for (const character of Object.keys(ASCII_LEGEND)) {
    const entry = ASCII_LEGEND[character];
    if (entry.terrain === tile.terrain && entry.feature === tile.feature) return character;
  }
  return '?';
}

/**
 * Draws a map as rows of characters (see ASCII_LEGEND), top row first, odd
 * rows indented by one space as on the real hex map:
 *
 *   ~ ~ ~ ~ ~ ~
 *    ~ , , , ~ ~
 *   ~ , g f , ~
 *    ~ , p 1 , ~
 *
 * Start positions, if given, are drawn as the seat number 1..8 in place of
 * the tile. Without starts, mapFromAscii reads the rows back into the same
 * map (apart from who owns which tile, which a drawing does not show).
 *
 * A tool for people and for the failure messages of tests; the game itself
 * never calls it.
 */
export function mapToAscii(map: GameMap, starts: readonly TileIndex[] = []): string[] {
  const rows: string[] = [];
  for (let y = 0; y < map.height; y++) {
    const characters: string[] = [];
    for (let x = 0; x < map.width; x++) {
      const tile = y * map.width + x;
      const seat = starts.indexOf(tile);
      characters.push(seat === -1 ? tileToAscii(map.tiles[tile]) : String(seat + 1));
    }
    rows.push((y % 2 === 1 ? ' ' : '') + characters.join(' '));
  }
  return rows;
}
