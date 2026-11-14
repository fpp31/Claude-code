/**
 * Hand-drawn maps for tests and demos.
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
 */

import type { FeatureId, TerrainId } from '../data/terrain';
import type { GameMap, Tile } from '../types';

/** What each character means. Lower-case features stand on grassland, upper-case ones on plains. */
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
};

/**
 * Builds a GameMap from rows of characters (see ASCII_LEGEND). Every tile
 * gets `cityId: null`. Throws on an unknown character, on an empty map, or
 * if the rows do not all have the same number of tiles.
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
      tiles.push({ terrain: entry.terrain, feature: entry.feature, cityId: null });
    }
  });
  return { width, height: rows.length, tiles };
}
