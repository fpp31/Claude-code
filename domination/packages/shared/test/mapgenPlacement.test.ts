import { describe, expect, it } from 'vitest';
import { improvementFits } from '../src/data/improvements';
import { RULES } from '../src/data/rules';
import { tileIsWater, tileMoveCost } from '../src/data/terrain';
import { distance, neighbors, ring, tilesInRange } from '../src/hex';
import { attemptStreams, generateForSize } from '../src/mapgen/attempts';
import type { MapDimensions } from '../src/mapgen/attempts';
import { buildMap } from '../src/mapgen/buildMap';
import { generateMap } from '../src/mapgen/generateMap';
import { gridFor, labelRegions } from '../src/mapgen/grid';
import { joinedSureLand, raiseStartHills, seaCoast, sitesBySea, startNeedsHold, sureLand } from '../src/mapgen/startNeeds';
import { hardRulesHold, standardRulesHold, startScore } from '../src/mapgen/startRules';
import { placeStarts } from '../src/mapgen/starts';
import { MAPGEN } from '../src/mapgen/tuning';
import { seedRng } from '../src/rng';
import { ASCII_LEGEND, mapFromAscii } from '../src/testing/asciiMap';
import type { GameMap, TileIndex } from '../src/types';

/**
 * Tests of how the map generator (work package WP1) places the players:
 * startRules.ts, starts.ts, startNeeds.ts and attempts.ts in
 * packages/shared/src/mapgen/.
 *
 * mapgenStarts.test.ts checks the promises about start positions on
 * thousands of generated maps. The tests here use small hand-drawn maps,
 * where the right answer is plain to see, and cover the one thing the big
 * tests cannot reach: what happens when a map has no room for the starts
 * (with the real map sizes that practically never happens).
 *
 * The older examples draw the sea as open ocean and have no hills: they
 * try the choosing of starts by itself, which knows nothing of the sea and
 * the hill of round 3 (rules H6 and H7). Those have their own examples
 * further down ("startNeeds").
 */

/** Tile index of column x, row y. */
function at(map: { width: number }, x: number, y: number): TileIndex {
  return y * map.width + x;
}

/** A copy of a map that shares nothing with it. */
function copyOf(map: GameMap): GameMap {
  return JSON.parse(JSON.stringify(map)) as GameMap;
}

/**
 * A copy of the map with other ground on single tiles, each given as a
 * tile and a character of ASCII_LEGEND: [[tile, 'f'], [other, ',']].
 */
function redrawn(map: GameMap, changes: readonly (readonly [TileIndex, string])[]): GameMap {
  const copy = copyOf(map);
  for (const [tile, character] of changes) copy.tiles[tile] = { ...ASCII_LEGEND[character], improvement: null, cityId: null };
  return copy;
}

/** `character` on each of the tiles, as a list of changes for `redrawn`. */
function each(tiles: readonly TileIndex[], character: string): [TileIndex, string][] {
  return tiles.map((tile) => [tile, character]);
}

/** The tiles that are not the same in the two maps, in tile order. */
function changedTiles(before: GameMap, after: GameMap): TileIndex[] {
  const changed: TileIndex[] = [];
  before.tiles.forEach((tile, index) => {
    if (JSON.stringify(tile) !== JSON.stringify(after.tiles[index])) changed.push(index);
  });
  return changed;
}

/** The tiles in tile order. */
function inOrder(tiles: readonly TileIndex[]): TileIndex[] {
  return [...tiles].sort((a, b) => a - b);
}

/**
 * An island of open grassland in the sea: `width` x `height` tiles of land
 * with one ring of water around it.
 */
function grassIsland(width: number, height: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height + 2; y++) {
    const row: string[] = [];
    for (let x = 0; x < width + 2; x++) {
      row.push(y === 0 || y === height + 1 || x === 0 || x === width + 1 ? '~' : 'g');
    }
    rows.push(row.join(' '));
  }
  return rows;
}

/** Two grass islands side by side, `gap` columns of sea between them. */
function twoIslands(widthA: number, widthB: number, height: number, gap: number): GameMap {
  const a = grassIsland(widthA, height);
  const b = grassIsland(widthB, height);
  const sea = new Array(Math.max(0, gap - 2)).fill('~').join(' ');
  return mapFromAscii(a.map((row, y) => `${row} ${sea} ${b[y]}`));
}

/**
 * Any number of islands side by side, all `height` tiles tall, with four
 * columns of sea between two neighbors. `ground` is the character every
 * tile of an island is drawn with (see ASCII_LEGEND): 'g' open grassland,
 * 'd' desert (a city site, but a poor one), 'f' forest (walkable, no city site).
 */
function islandRow(height: number, islands: readonly { width: number; ground?: string }[]): GameMap {
  const drawn = islands.map((island) => grassIsland(island.width, height).map((row) => row.replaceAll('g', island.ground ?? 'g')));
  const rows: string[] = [];
  for (let y = 0; y < height + 2; y++) rows.push(drawn.map((island) => island[y]).join(' ~ ~ '));
  return mapFromAscii(rows);
}

/** How many of the starts lie on each walkable area, in the order the areas appear on the map (west to east for islandRow). */
function startsPerIsland(map: GameMap, starts: readonly TileIndex[]): number[] {
  const areas = labelRegions(gridFor(map), map.tiles.map((tile) => !tileIsWater(tile)));
  return areas.sizes.map((_, area) => starts.filter((start) => areas.regionOf[start] === area).length);
}

describe('startRules: the generator\'s own check of its promises', () => {
  const map = mapFromAscii(grassIsland(22, 5));
  const grid = gridFor(map);
  const west = at(map, 3, 3);
  const east = at(map, 19, 3);

  /** A copy of the island with other tiles drawn in: { '19,3': 'f' }. */
  function withTiles(changes: Record<string, string>): GameMap {
    const rows = grassIsland(22, 5).map((row) => row.split(' '));
    for (const key of Object.keys(changes)) {
      const [x, y] = key.split(',').map(Number);
      rows[y][x] = changes[key];
    }
    return mapFromAscii(rows.map((row) => row.join(' ')));
  }

  it('accepts two starts far apart on open land', () => {
    expect(hardRulesHold(grid, map, [west, east])).toBe(true);
    expect(standardRulesHold(grid, map, [west, east])).toBe(true);
    expect(hardRulesHold(grid, map, [west])).toBe(true);
    expect(standardRulesHold(grid, map, [west])).toBe(true);
  });

  it('H1 and H3: rejects a shared tile and starts closer than RULES.minCityDistance', () => {
    expect(hardRulesHold(grid, map, [west, west])).toBe(false);
    expect(hardRulesHold(grid, map, [west, at(map, 3 + RULES.minCityDistance - 1, 3)])).toBe(false);
    expect(hardRulesHold(grid, map, [west, at(map, 3 + RULES.minCityDistance, 3)])).toBe(true);
  });

  it('H2: rejects a start on forest, on mountains and in the sea', () => {
    expect(hardRulesHold(grid, withTiles({ '19,3': 'f' }), [west, east])).toBe(false);
    expect(hardRulesHold(grid, withTiles({ '19,3': 'm' }), [west, east])).toBe(false);
    expect(hardRulesHold(grid, map, [west, at(map, 0, 0)])).toBe(false);
    expect(hardRulesHold(grid, withTiles({ '19,3': 'h' }), [west, east])).toBe(true);
  });

  it('H4: rejects a start with fewer than two neighbors that can be entered', () => {
    // The six tiles around (19, 3); row 3 is an odd row.
    const wall = { '20,3': 'm', '18,3': 'm', '19,2': 'm', '20,2': 'm', '19,4': 'm', '20,4': 'm' };
    expect(hardRulesHold(grid, withTiles(wall), [west, east])).toBe(false);
    expect(hardRulesHold(grid, withTiles({ ...wall, '20,3': 'g' }), [west, east])).toBe(false);
    expect(hardRulesHold(grid, withTiles({ ...wall, '20,3': 'g', '18,3': 'g' }), [west, east])).toBe(true);
  });

  it('H5: rejects a start on land with fewer than RULES.minStartLandmass walkable tiles', () => {
    // The example is drawn for a minimum of 12 tiles: sea in columns 4 and 5
    // leaves a western island of 3 x 5 = 15 tiles; sea in column 3 too leaves 10.
    expect(RULES.minStartLandmass).toBe(12);
    const sea = (columns: number[]): Record<string, string> => {
      const changes: Record<string, string> = {};
      for (const x of columns) for (let y = 1; y <= 5; y++) changes[`${x},${y}`] = '~';
      return changes;
    };
    const onIsland = at(map, 2, 3);
    expect(hardRulesHold(grid, withTiles(sea([4, 5])), [onIsland, east])).toBe(true);
    expect(hardRulesHold(grid, withTiles(sea([3, 4, 5])), [onIsland, east])).toBe(false);
  });

  it('S1: rejects starts closer than RULES.minStartDistance', () => {
    const tooClose = [west, at(map, 3 + RULES.minStartDistance - 1, 3)];
    expect(hardRulesHold(grid, map, tooClose)).toBe(true);
    expect(standardRulesHold(grid, map, tooClose)).toBe(false);
    expect(standardRulesHold(grid, map, [west, at(map, 3 + RULES.minStartDistance, 3)])).toBe(true);
  });

  it('S2: rejects starts on land that is not connected', () => {
    const strait: Record<string, string> = {};
    for (let y = 1; y <= 5; y++) strait[`11,${y}`] = '~';
    expect(hardRulesHold(grid, withTiles(strait), [west, east])).toBe(true);
    expect(standardRulesHold(grid, withTiles(strait), [west, east])).toBe(false);
  });

  it('S3: rejects scores further apart than 70%', () => {
    // Mountains yield nothing: with 5 of them two steps away, east keeps
    // 14 / 19 of west's score (74%, fair); with 6 only 13 / 19 (68%).
    const twoStepsAway = ['18,1', '19,1', '20,1', '18,2', '21,2', '17,3'];
    const mountains = (count: number): Record<string, string> => {
      const changes: Record<string, string> = {};
      for (const key of twoStepsAway.slice(0, count)) changes[key] = 'm';
      return changes;
    };
    for (const key of twoStepsAway) {
      const [x, y] = key.split(',').map(Number);
      expect(distance(east, at(map, x, y), map)).toBe(2);
    }
    expect(startScore(grid, withTiles(mountains(5)), east) * 19).toBe(startScore(grid, map, west) * 14);
    expect(standardRulesHold(grid, withTiles(mountains(5)), [west, east])).toBe(true);
    expect(standardRulesHold(grid, withTiles(mountains(6)), [west, east])).toBe(false);
    expect(hardRulesHold(grid, withTiles(mountains(6)), [west, east])).toBe(true);
  });

  it('every step of the fairness search keeps the 70% of rule S3', () => {
    expect(MAPGEN.fairScorePercent).toBe(70);
    for (const step of MAPGEN.fairnessSteps) expect(step.scorePercent).toBeGreaterThanOrEqual(MAPGEN.fairScorePercent);
    // The last step asks for no more spacing than rule S1 itself.
    expect(MAPGEN.fairnessSteps[MAPGEN.fairnessSteps.length - 1].spacingPercent).toBe(0);
  });
});

describe('starts: placing the players', () => {
  const rng = () => seedRng('starts', 'map:starts');

  /** The smallest distance between two of the starts. */
  function closest(map: GameMap, starts: readonly TileIndex[]): number {
    let smallest = Infinity;
    for (const a of starts) for (const b of starts) if (a !== b) smallest = Math.min(smallest, distance(a, b, map));
    return smallest;
  }

  it('puts players far apart on open land, and gives the same answer for the same random stream', () => {
    const map = mapFromAscii(grassIsland(30, 9));
    const grid = gridFor(map);
    const starts = placeStarts(grid, map, 3, false, rng());
    expect(starts).not.toBeNull();
    expect(starts).toHaveLength(3);
    expect(hardRulesHold(grid, map, starts as TileIndex[])).toBe(true);
    expect(standardRulesHold(grid, map, starts as TileIndex[])).toBe(true);
    // Three players on 30 columns: better than the bare minimum distance.
    expect(closest(map, starts as TileIndex[])).toBeGreaterThan(RULES.minStartDistance);
    expect(placeStarts(grid, map, 3, false, rng())).toEqual(starts);
  });

  it('gives a single player a start on the best land', () => {
    // Desert in the west, grassland in the east.
    const rows = grassIsland(20, 5).map((row) => row.split(' '));
    for (let y = 1; y <= 5; y++) for (let x = 1; x <= 10; x++) rows[y][x] = 'd';
    const map = mapFromAscii(rows.map((row) => row.join(' ')));
    const grid = gridFor(map);
    const starts = placeStarts(grid, map, 1, false, rng()) as TileIndex[];
    expect(starts).toHaveLength(1);
    expect(map.tiles[starts[0]].terrain).toBe('grassland');
    // "Best" allows for the small random bonus that lets equally good sites take turns.
    let bestScore = 0;
    for (let tile = 0; tile < grid.count; tile++) bestScore = Math.max(bestScore, startScore(grid, map, tile));
    expect(startScore(grid, map, starts[0])).toBeGreaterThan(bestScore - MAPGEN.scoreJitter);
  });

  it('avoids forest, hills and desert as a start when there is open land', () => {
    const rows = grassIsland(24, 7).map((row) => row.split(' '));
    // Sprinkle other ground over the island in a regular pattern.
    for (let y = 1; y <= 7; y++) {
      for (let x = 1; x <= 24; x++) {
        if ((x + 2 * y) % 5 === 0) rows[y][x] = 'f';
        if ((x + 2 * y) % 7 === 0) rows[y][x] = 'h';
        if ((x * y) % 11 === 0) rows[y][x] = 'd';
      }
    }
    const map = mapFromAscii(rows.map((row) => row.join(' ')));
    const starts = placeStarts(gridFor(map), map, 2, false, rng()) as TileIndex[];
    expect(starts).toHaveLength(2);
    for (const start of starts) expect(map.tiles[start]).toEqual({ terrain: 'grassland', feature: null, improvement: null, cityId: null });
  });

  /** The largest distance between two tiles that would each be a legal start on their own. */
  function bestPossibleDistance(map: GameMap): number {
    const grid = gridFor(map);
    const sites: TileIndex[] = [];
    for (let tile = 0; tile < grid.count; tile++) if (hardRulesHold(grid, map, [tile])) sites.push(tile);
    let best = 0;
    for (const a of sites) for (const b of sites) best = Math.max(best, distance(a, b, map));
    return best;
  }

  it('returns null when an uncrowded map has no room for the standard rules', () => {
    // A strip of land 7 x 2 tiles: no two starts on it are RULES.minStartDistance apart.
    const map = mapFromAscii(grassIsland(7, 2));
    expect(bestPossibleDistance(map)).toBeLessThan(RULES.minStartDistance);
    expect(placeStarts(gridFor(map), map, 2, false, rng())).toBeNull();
  });

  it('on a crowded map gives way on the distance, as little as the land demands', () => {
    const map = mapFromAscii(grassIsland(7, 2));
    const grid = gridFor(map);
    const starts = placeStarts(grid, map, 2, true, rng()) as TileIndex[];
    expect(starts).toHaveLength(2);
    expect(hardRulesHold(grid, map, starts)).toBe(true);
    // It finds the two tiles that are furthest apart.
    expect(closest(map, starts)).toBe(bestPossibleDistance(map));
  });

  it('on a crowded map still returns null when not even the hard rules fit', () => {
    // Forest is no city site, so this island has just two legal starts, and they are only 3 apart.
    const map = mapFromAscii([
      '~ ~ ~ ~ ~ ~ ~',
      ' ~ f f f f f ~',
      '~ f g f f g ~',
      ' ~ f f f f f ~',
      '~ ~ ~ ~ ~ ~ ~',
    ]);
    expect(bestPossibleDistance(map)).toBe(3);
    expect(RULES.minCityDistance).toBeGreaterThan(3);
    expect(placeStarts(gridFor(map), map, 2, true, rng())).toBeNull();
    expect(placeStarts(gridFor(map), map, 1, true, rng())).toHaveLength(1);
  });

  it('never starts a player on land smaller than RULES.minStartLandmass', () => {
    // The western island has 2 x 5 = 10 tiles: too small even for a single player.
    const map = twoIslands(2, 12, 5, 3);
    const grid = gridFor(map);
    const areas = labelRegions(grid, map.tiles.map((tile) => !tileIsWater(tile)));
    expect(areas.sizes).toEqual([10, 60]);
    for (const crowded of [false, true]) {
      const starts = placeStarts(grid, map, 2, crowded, rng()) as TileIndex[];
      expect(starts).toHaveLength(2);
      for (const start of starts) expect(areas.regionOf[start]).toBe(1);
    }
  });

  it('would rather find no room than start a player on land smaller than RULES.minStartLandmass', () => {
    // West: 25 tiles of forest with one clearing, the only tile of that island a city may stand on.
    // East: 10 tiles of open grassland, too small an island for anybody.
    const map = mapFromAscii([
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ f f f f f ~ ~ ~ g g ~ ~',
      '~ f f f f f ~ ~ ~ g g ~ ~',
      ' ~ f f g f f ~ ~ ~ g g ~ ~',
      '~ f f f f f ~ ~ ~ g g ~ ~',
      ' ~ f f f f f ~ ~ ~ g g ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ]);
    const grid = gridFor(map);
    const clearing = at(map, 3, 3);
    expect(labelRegions(grid, map.tiles.map((tile) => !tileIsWater(tile))).sizes).toEqual([25, 10]);
    expect(RULES.minStartLandmass).toBeGreaterThan(10);
    // The small island is far enough away: only its size keeps the second player off it.
    expect(distance(clearing, at(map, 9, 3), map)).toBeGreaterThanOrEqual(RULES.minCityDistance);
    expect(hardRulesHold(grid, map, [clearing, at(map, 9, 3)])).toBe(false);

    expect(placeStarts(grid, map, 1, true, rng())).toEqual([clearing]);
    expect(placeStarts(grid, map, 2, true, rng())).toBeNull();
  });

  it('keeps everybody on one landmass when that costs no distance', () => {
    // Both islands could take a player, but the eastern one has room for both at the standard distance.
    const map = twoIslands(6, 20, 5, 4);
    const grid = gridFor(map);
    const areas = labelRegions(grid, map.tiles.map((tile) => !tileIsWater(tile)));
    const starts = placeStarts(grid, map, 2, true, rng()) as TileIndex[];
    expect(areas.regionOf[starts[0]]).toBe(1);
    expect(areas.regionOf[starts[1]]).toBe(1);
    expect(closest(map, starts)).toBeGreaterThanOrEqual(RULES.minStartDistance);
  });

  it('uses a second landmass on a crowded map rather than move the starts closer together', () => {
    // Neither island is long enough for two starts at the standard distance, but together they are.
    const map = twoIslands(6, 6, 5, 4);
    const grid = gridFor(map);
    const areas = labelRegions(grid, map.tiles.map((tile) => !tileIsWater(tile)));
    expect(areas.sizes).toEqual([30, 30]);
    expect(placeStarts(grid, map, 2, false, rng())).toBeNull();
    const starts = placeStarts(grid, map, 2, true, rng()) as TileIndex[];
    expect(starts).toHaveLength(2);
    expect(areas.regionOf[starts[0]]).not.toBe(areas.regionOf[starts[1]]);
    expect(closest(map, starts)).toBeGreaterThanOrEqual(RULES.minStartDistance);
  });
});

describe('starts: which land a crowded map falls back on', () => {
  const rng = () => seedRng('starts', 'map:starts');

  /** The smallest distance between two of the starts. */
  function closest(map: GameMap, starts: readonly TileIndex[]): number {
    let smallest = Infinity;
    for (const a of starts) for (const b of starts) if (a !== b) smallest = Math.min(smallest, distance(a, b, map));
    return smallest;
  }

  it('the examples are drawn for the numbers in the tables', () => {
    expect(RULES.minStartDistance).toBe(8);
    expect(RULES.minCityDistance).toBe(4);
    expect(RULES.minStartLandmass).toBe(12);
    expect(MAPGEN.roomyLandmassTiles).toBe(30);
  });

  it('uses a second landmass with room to grow at the full distance, and leaves a small island empty', () => {
    // 60, 30 and 15 tiles. The big island is too short for three starts 8
    // apart; with the middle one they fit. Nobody needs the small one.
    const map = islandRow(5, [{ width: 12 }, { width: 6 }, { width: 3 }]);
    const grid = gridFor(map);
    const starts = placeStarts(grid, map, 3, true, rng()) as TileIndex[];
    expect(hardRulesHold(grid, map, starts)).toBe(true);
    expect(startsPerIsland(map, starts)).toEqual([2, 1, 0]);
    expect(closest(map, starts)).toBeGreaterThanOrEqual(RULES.minStartDistance);
  });

  it('moves the starts closer together rather than leave one player alone on an island too small to grow on', () => {
    // 60 and 15 tiles. Two starts 8 apart fit on the big island, and the
    // third would fit on the small one at that distance. But whoever starts
    // there has no site for a second city and can never leave.
    const map = islandRow(5, [{ width: 12 }, { width: 3 }]);
    const grid = gridFor(map);
    const starts = placeStarts(grid, map, 3, true, rng()) as TileIndex[];
    expect(hardRulesHold(grid, map, starts)).toBe(true);
    expect(startsPerIsland(map, starts)).toEqual([3, 0]);

    // As little closer as the big island demands: the best any three tiles of it can do.
    const big: TileIndex[] = [];
    for (let tile = 0; tile < grid.count; tile++) if (!tileIsWater(map.tiles[tile]) && tile % map.width <= 12) big.push(tile);
    expect(big).toHaveLength(60);
    let best = 0;
    for (const a of big) {
      for (const b of big) {
        for (const c of big) best = Math.max(best, Math.min(distance(a, b, map), distance(a, c, map), distance(b, c, map)));
      }
    }
    expect(best).toBeLessThan(RULES.minStartDistance);
    expect(closest(map, starts)).toBe(best);
  });

  it('uses small islands when the players fit nowhere else', () => {
    // Two strips of 12 tiles: neither is long enough for two starts at any
    // distance the rules allow... so three players need both.
    const map = islandRow(2, [{ width: 6 }, { width: 6 }]);
    const grid = gridFor(map);
    expect(placeStarts(grid, map, 3, false, rng())).toBeNull();
    const starts = placeStarts(grid, map, 3, true, rng()) as TileIndex[];
    expect(starts).toHaveLength(3);
    expect(hardRulesHold(grid, map, starts)).toBe(true);
    expect([...startsPerIsland(map, starts)].sort()).toEqual([1, 2]);
  });

  it('keeps everybody together on poor land when one landmass has room, although a second one is as good', () => {
    // Desert is a legal city site but no comfortable one, so only the
    // "every site of one landmass" choice can keep these two together.
    const map = islandRow(5, [{ width: 12, ground: 'd' }, { width: 6, ground: 'd' }]);
    const grid = gridFor(map);
    expect(placeStarts(grid, map, 2, false, rng())).toBeNull();
    const starts = placeStarts(grid, map, 2, true, rng()) as TileIndex[];
    expect(hardRulesHold(grid, map, starts)).toBe(true);
    expect(startsPerIsland(map, starts)).toEqual([2, 0]);
    expect(closest(map, starts)).toBeGreaterThanOrEqual(RULES.minStartDistance);
  });

  it('tries the next largest landmass when the largest has no room, MAPGEN.homeLandmassTries landmasses in all', () => {
    // Forest can be walked on but not built on: a big forest island is the
    // largest landmass and no home for anybody.
    const forest = { width: 22, ground: 'f' };
    const open = { width: 20 };
    const forestsBefore = (count: number) => islandRow(5, [...new Array<typeof forest>(count).fill(forest), open]);

    const within = forestsBefore(MAPGEN.homeLandmassTries - 1);
    const starts = placeStarts(gridFor(within), within, 2, false, rng()) as TileIndex[];
    expect(starts).toHaveLength(2);
    expect(standardRulesHold(gridFor(within), within, starts)).toBe(true);
    expect(startsPerIsland(within, starts)[MAPGEN.homeLandmassTries - 1]).toBe(2);

    // One landmass further down the list is no longer looked at.
    const beyond = forestsBefore(MAPGEN.homeLandmassTries);
    expect(placeStarts(gridFor(beyond), beyond, 2, false, rng())).toBeNull();
  });
});

describe('startNeeds: the sea and a hill at every start', () => {
  /** An island of open grassland, 9 x 7 tiles, with one ring of open sea around it. */
  const OPEN = mapFromAscii(grassIsland(9, 7));
  const grid = gridFor(OPEN);
  /** A start in the middle of it: the eighteen tiles around it are open grassland. */
  const MIDDLE = at(OPEN, 5, 4);
  /** The six tiles next to MIDDLE, and the twelve tiles two steps from it, each in tile order. */
  const NEAR = inOrder(ring(MIDDLE, 1, OPEN));
  const FAR = inOrder(ring(MIDDLE, 2, OPEN));

  /** A wider island of the same kind, with room for two starts four tiles apart and the tile half way between them. */
  const WIDE = mapFromAscii(grassIsland(13, 7));
  const wideGrid = gridFor(WIDE);
  const WEST = at(WIDE, 5, 4);
  const EAST = at(WIDE, 9, 4);
  const HALF_WAY = at(WIDE, 7, 4);

  /**
   * For the examples about land that is cut off: a start two steps from the
   * west shore of OPEN, where three tiles are drawn as coast (SHORE is that
   * map). ACROSS is the tile two steps east of the start, and CHANNEL the
   * three tiles of the start's land that touch it: with those three shut,
   * ACROSS can only be walked to by leaving the land around the start.
   */
  const START = at(OPEN, 3, 4);
  const COAST = [at(OPEN, 1, 3), at(OPEN, 1, 4), at(OPEN, 1, 5)];
  const SHORE = redrawn(OPEN, each(COAST, ','));
  const ACROSS = at(OPEN, 5, 4);
  const CHANNEL = [at(OPEN, 4, 3), at(OPEN, 4, 4), at(OPEN, 4, 5)];

  /** The tiles around a start that are two steps from it and more than two from `other`, in tile order. */
  function secondRingClearOf(start: TileIndex, other: TileIndex): TileIndex[] {
    return inOrder(ring(start, 2, WIDE)).filter((tile) => distance(tile, other, WIDE) > 2);
  }

  /** The tiles for which the list says true. */
  function trueTiles(flags: readonly boolean[]): TileIndex[] {
    return flags.flatMap((flag, tile) => (flag ? [tile] : []));
  }

  /**
   * raiseStartHills on a copy of the map: what it answers, which tiles it
   * changed, and the map afterwards. Whatever it changed, it must have put
   * hills on land that had none (open land or forest), on the same ground,
   * and never on a start.
   */
  function raised(map: GameMap, starts: readonly TileIndex[]): { answer: number; hills: TileIndex[]; map: GameMap } {
    const after = copyOf(map);
    const answer = raiseStartHills(gridFor(map), after, starts);
    const hills = changedTiles(map, after);
    for (const tile of hills) {
      expect(after.tiles[tile]).toEqual({ ...map.tiles[tile], feature: 'hills' });
      expect([null, 'forest']).toContain(map.tiles[tile].feature);
      expect(tileIsWater(map.tiles[tile])).toBe(false);
      expect(starts).not.toContain(tile);
    }
    return { answer, hills, map: after };
  }

  it('the examples are drawn as their comments say', () => {
    expect(MAPGEN.startCoastTiles).toBe(3);
    expect(NEAR).toHaveLength(6);
    expect(FAR).toHaveLength(12);
    for (const tile of [MIDDLE, ...NEAR, ...FAR]) expect(OPEN.tiles[tile]).toEqual({ terrain: 'grassland', feature: null, improvement: null, cityId: null });

    expect(distance(WEST, EAST, WIDE)).toBe(RULES.minCityDistance);
    expect(distance(WEST, HALF_WAY, WIDE)).toBe(2);
    expect(distance(EAST, HALF_WAY, WIDE)).toBe(2);

    for (const tile of COAST) expect(distance(START, tile, OPEN)).toBe(2);
    expect(distance(START, ACROSS, OPEN)).toBe(2);
    // CHANNEL is every tile next to ACROSS that lies within two of START.
    expect(inOrder(neighbors(ACROSS, OPEN).filter((tile) => distance(START, tile, OPEN) <= 2))).toEqual(inOrder(CHANNEL));
    // The three coast tiles of SHORE touch the open sea round the island: they are coast of the sea.
    expect(trueTiles(seaCoast(grid, SHORE))).toEqual(inOrder(COAST));
  });

  it('raiseStartHills on hand-drawn land: forest before desert before plains before grassland; the second ring before the first; the lower tile; never water, mountains or a start; never a tile within two of another start; nothing for a start that has hills it can walk to', () => {
    // All open grassland: the second ring before the first, then the lower tile.
    expect(raised(OPEN, [MIDDLE])).toMatchObject({ answer: 1, hills: [FAR[0]] });

    // The ground decides before the ring does. Plains next to the start are
    // taken before grassland two steps away ...
    expect(raised(redrawn(OPEN, [[NEAR[3], 'p']]), [MIDDLE]).hills).toEqual([NEAR[3]]);
    // ... desert before plains ...
    expect(raised(redrawn(OPEN, [[NEAR[3], 'd'], [FAR[0], 'p'], [FAR[4], 'p']]), [MIDDLE]).hills).toEqual([NEAR[3]]);
    // ... and forest before everything, whatever ground it stands on. (A
    // forest tile counts 2 in the start's score, as hills do: the score stays.)
    expect(raised(redrawn(OPEN, [[NEAR[5], 'f'], [NEAR[0], 'd'], [FAR[0], 'd'], [FAR[1], 'p']]), [MIDDLE]).hills).toEqual([NEAR[5]]);
    expect(raised(redrawn(OPEN, [[NEAR[5], 'F'], [FAR[0], 'd']]), [MIDDLE]).hills).toEqual([NEAR[5]]);

    // Among tiles of one kind: the second ring before the first, then the lower tile.
    expect(raised(redrawn(OPEN, [[NEAR[0], 'p'], [FAR[7], 'p'], [FAR[9], 'p']]), [MIDDLE]).hills).toEqual([FAR[7]]);
    expect(raised(redrawn(OPEN, [[NEAR[0], 'f'], [FAR[11], 'F'], [FAR[6], 'f']]), [MIDDLE]).hills).toEqual([FAR[6]]);
    expect(raised(redrawn(OPEN, [[NEAR[4], 'd'], [NEAR[2], 'd']]), [MIDDLE]).hills).toEqual([NEAR[2]]);

    // Never water or mountains. The five lowest tiles of the second ring
    // are a pond, open sea, and mountains on every ground: the sixth is taken.
    const fiveShut = redrawn(OPEN, [[FAR[0], ','], [FAR[1], '~'], [FAR[2], 'm'], [FAR[3], 'M'], [FAR[4], 'A']]);
    expect(raised(fiveShut, [MIDDLE])).toMatchObject({ answer: 1, hills: [FAR[5]] });
    // With mountains all round two steps away and water next to the start but for one tile: that tile.
    const oneLeft = redrawn(OPEN, [...each(FAR, 'm'), ...each(NEAR.slice(0, 5), ',')]);
    expect(raised(oneLeft, [MIDDLE])).toMatchObject({ answer: 1, hills: [NEAR[5]] });

    // Never a tile within two of another start. Forest half way between two
    // starts four apart is the best tile of both by its ground, and is
    // promised to neither: each gets its hill on land of its own.
    const forestHalfWay = redrawn(WIDE, [[HALF_WAY, 'f']]);
    const both = raised(forestHalfWay, [WEST, EAST]);
    expect(both).toMatchObject({ answer: 2, hills: inOrder([secondRingClearOf(WEST, EAST)[0], secondRingClearOf(EAST, WEST)[0]]) });
    expect(both.map.tiles[HALF_WAY].feature).toBe('forest');
    for (const hill of both.hills) expect(Math.min(distance(hill, WEST, WIDE), distance(hill, EAST, WIDE))).toBe(2);
    for (const hill of both.hills) expect(Math.max(distance(hill, WEST, WIDE), distance(hill, EAST, WIDE))).toBeGreaterThan(2);
    // Alone, either of them takes that forest.
    expect(raised(forestHalfWay, [WEST]).hills).toEqual([HALF_WAY]);
    expect(raised(forestHalfWay, [EAST]).hills).toEqual([HALF_WAY]);

    // Nothing for a start that has hills it can walk to, on any ground, in either ring.
    for (const [tile, hills] of [[FAR[11], 'h'], [FAR[3], 'H'], [NEAR[2], 'D']] as const) {
      expect(raised(redrawn(OPEN, [[tile, hills]]), [MIDDLE])).toMatchObject({ answer: 0, hills: [] });
    }
    // Of two starts, only the one without hills is given one.
    const westHasHills = redrawn(WIDE, [[at(WIDE, 4, 4), 'h']]);
    expect(raised(westHasHills, [WEST, EAST])).toMatchObject({ answer: 1, hills: [secondRingClearOf(EAST, WEST)[0]] });
    // Hills half way between the two are within two of both: they count for neither.
    expect(raised(redrawn(WIDE, [[HALF_WAY, 'h']]), [WEST, EAST]).answer).toBe(2);
    expect(raised(redrawn(WIDE, [[HALF_WAY, 'h']]), [WEST]).answer).toBe(0);
  });

  it('joined land: on a hand-drawn start with forest across a channel of water, the hill is put on this side, not on the forest; a start whose only hills lie across the channel gets a second hill on this side; a start with hills behind a wall of mountains the same; startNeedsHold is false for a map whose only mine site is cut off; joinedSureLand never holds water, mountains, the start or a tile outside the sure land', () => {
    const sure = sureLand(grid, [START], START);
    /** The land on the start's side of the channel: what can be walked to once the channel is shut. */
    const thisSide = sure.filter((tile) => !COAST.includes(tile) && !CHANNEL.includes(tile) && tile !== ACROSS);
    expect(thisSide).toHaveLength(18 - 3 - 3 - 1);
    /** Where a hill goes on this side while it is all open grassland: the lowest tile of the second ring. */
    const hillThisSide = thisSide.filter((tile) => distance(START, tile, OPEN) === 2)[0];

    // Forest across a channel of water. By its ground the forest is the
    // best tile for the hill, but no Worker reaches it over the city's land.
    const forestAcross = redrawn(SHORE, [[ACROSS, 'f'], ...each(CHANNEL, ',')]);
    expect(joinedSureLand(grid, forestAcross, [START], START)).toEqual(thisSide);
    expect(raised(forestAcross, [START])).toMatchObject({ answer: 1, hills: [hillThisSide] });
    // (The forest is not on another island: a land unit can walk round the
    // channel. The promise is about the land the city is sure to own.)
    expect(labelRegions(grid, forestAcross.tiles.map((tile) => tileMoveCost(tile, 'land') !== null)).sizes).toHaveLength(1);
    // With one tile of the channel left as land the forest can be walked to, and it is taken.
    const ford = redrawn(forestAcross, [[CHANNEL[0], 'g']]);
    expect(joinedSureLand(grid, ford, [START], START)).toEqual(inOrder([...thisSide, CHANNEL[0], ACROSS]));
    expect(raised(ford, [START])).toMatchObject({ answer: 1, hills: [ACROSS] });

    // The only hills lie across the channel: they do not count, and a second hill is put on this side.
    const hillsAcross = redrawn(SHORE, [[ACROSS, 'h'], ...each(CHANNEL, ',')]);
    expect(raised(hillsAcross, [START])).toMatchObject({ answer: 1, hills: [hillThisSide] });
    expect(raised(hillsAcross, [START]).map.tiles[ACROSS].feature).toBe('hills');
    // Hills behind a wall of mountains: the same.
    const hillsBehind = redrawn(SHORE, [[ACROSS, 'h'], ...each(CHANNEL, 'm')]);
    expect(joinedSureLand(grid, hillsBehind, [START], START)).toEqual(thisSide);
    expect(raised(hillsBehind, [START])).toMatchObject({ answer: 1, hills: [hillThisSide] });
    // A pass through the wall, and the hills behind it are hills the start has: nothing is put.
    expect(raised(redrawn(hillsBehind, [[CHANNEL[2], 'f']]), [START])).toMatchObject({ answer: 0, hills: [] });

    // startNeedsHold. The sea is there in both maps (rule H6: three coast
    // tiles of the sea, the lake in the channel not counted) ...
    for (const map of [hillsAcross, hillsBehind]) {
      const isSeaCoast = seaCoast(grid, map);
      expect(sure.filter((tile) => isSeaCoast[tile])).toEqual(inOrder(COAST));
      // ... so it is the mine site out of reach that fails them (rule H7),
      expect(startNeedsHold(grid, map, [START])).toBe(false);
      // and the hill raiseStartHills puts that mends them.
      expect(startNeedsHold(grid, raised(map, [START]).map, [START])).toBe(true);
    }
    expect(startNeedsHold(grid, redrawn(hillsAcross, [[CHANNEL[1], 'g']]), [START])).toBe(true);
    // Rule H6 by itself, with hills next to the start: three coast tiles of
    // the sea are enough, two are not, and a lake's coast does not make up for the third.
    const hillNextDoor: [TileIndex, string] = [at(OPEN, 3, 3), 'h'];
    expect(startNeedsHold(grid, redrawn(SHORE, [hillNextDoor]), [START])).toBe(true);
    expect(startNeedsHold(grid, redrawn(SHORE, [hillNextDoor, [COAST[0], 'g']]), [START])).toBe(false);
    expect(startNeedsHold(grid, redrawn(SHORE, [hillNextDoor, [COAST[0], 'g'], ...each(CHANNEL, ',')]), [START])).toBe(false);
    // Every start must have both: one start in need fails the map.
    expect(startNeedsHold(grid, redrawn(SHORE, [hillNextDoor]), [START, at(OPEN, 8, 4)])).toBe(false);

    // joinedSureLand on generated maps: never water, mountains, the start
    // or a tile outside the sure land, and exactly what a land unit can
    // walk to from the start over the sure land (counted here by hex.ts).
    let startsLookedAt = 0;
    for (let i = 0; i < 16; i++) {
      const { map, starts } = generateMap(`joined-${i}`, 'small', 1 + (i % RULES.maxSeats));
      const mapGrid = gridFor(map);
      for (const start of starts) {
        const own = sureLand(mapGrid, starts, start);
        const joined = joinedSureLand(mapGrid, map, starts, start);
        for (const tile of joined) {
          expect(tile).not.toBe(start);
          expect(own).toContain(tile);
          expect(tileIsWater(map.tiles[tile])).toBe(false);
          expect(map.tiles[tile].feature).not.toBe('mountains');
        }
        const walked = new Set<TileIndex>();
        const todo = [start];
        while (todo.length > 0) {
          for (const next of neighbors(todo.pop() as TileIndex, map)) {
            if (own.includes(next) && !walked.has(next) && tileMoveCost(map.tiles[next], 'land') !== null) {
              walked.add(next);
              todo.push(next);
            }
          }
        }
        expect(joined).toEqual(inOrder([...walked]));
        // Rule H7 in the words of this file: a tile for a Mine among them.
        expect(joined.some((tile) => improvementFits('mine', map.tiles[tile]))).toBe(true);
        startsLookedAt++;
      }
    }
    expect(startsLookedAt).toBe(2 * 36);
  });

  it('raiseStartHills answers -1 for a start with no tile that could carry hills, and the loop throws that map away', () => {
    // Shut in by mountains: nothing can be walked to. (The start tile itself is open land, and is left alone.)
    expect(raised(redrawn(OPEN, each(NEAR, 'm')), [MIDDLE])).toMatchObject({ answer: -1, hills: [] });
    // On a rock in a pond: there is open land two steps away, across the water.
    expect(raised(redrawn(OPEN, each(NEAR, ',')), [MIDDLE])).toMatchObject({ answer: -1, hills: [] });
    // Two "starts" side by side: every tile next to the one is within two of the other.
    expect(raised(OPEN, [MIDDLE, NEAR[0]])).toMatchObject({ answer: -1, hills: [] });
    // The starts are served in order, so the first has its hill by the time
    // the second turns out to be hopeless: the map is the caller's to throw away.
    const eastWalledIn = redrawn(WIDE, each(ring(EAST, 1, WIDE), 'm'));
    expect(raised(eastWalledIn, [WEST, EAST])).toMatchObject({ answer: -1, hills: [secondRingClearOf(WEST, EAST)[0]] });
    expect(raised(eastWalledIn, [EAST, WEST])).toMatchObject({ answer: -1, hills: [] });

    // The loop. A placement step hands in honest starts, but has walled
    // the first of them in on the attempt's own map. That map is thrown
    // away and the second attempt is handed out.
    //
    // What this cannot show is WHICH line of the loop threw it away. A
    // start that keeps rules H1-H5 always has a tile that can carry a hill:
    // two neighbours it can walk to (H4), which no other start is within
    // two of (H3), each of them open land, forest or hills. So a start
    // with no such tile breaks H4 too, and is stopped by the check of the
    // hard rules before the hill is tried.
    const SMALL: MapDimensions = { width: 32, height: 20, recommendedPlayers: 3 };
    const smallGrid = gridFor(SMALL);
    const seed = 'checked-starts';
    let calls = 0;
    let walledIn: TileIndex[] = [];
    const result = generateForSize(seed, SMALL, 2, (...args) => {
      calls++;
      const starts = placeStarts(...args) as TileIndex[];
      if (calls > 1) return starts;
      const map = args[1];
      for (const tile of neighbors(starts[0], map)) map.tiles[tile] = { terrain: 'grassland', feature: 'mountains', improvement: null, cityId: null };
      expect(raiseStartHills(smallGrid, copyOf(map), starts)).toBe(-1);
      expect(hardRulesHold(smallGrid, map, starts)).toBe(false);
      walledIn = starts;
      return starts;
    });
    expect(calls).toBe(2);
    expect(walledIn).toHaveLength(2);
    const secondLand = buildMap(smallGrid, attemptStreams(seed, 2));
    expect(raiseStartHills(smallGrid, secondLand, result.starts)).toBeGreaterThanOrEqual(0);
    expect(result.map).toEqual(secondLand);
    expect(startNeedsHold(smallGrid, result.map, result.starts)).toBe(true);
  });

  it('sureLand leaves out what lies within two of another start', () => {
    const around = (start: TileIndex): TileIndex[] => tilesInRange(start, 2, WIDE).filter((tile) => tile !== start);
    expect(around(WEST)).toHaveLength(18);
    // Alone, a start is sure of all eighteen tiles around it (itself not counted), in tile order.
    expect(sureLand(wideGrid, [WEST], WEST)).toEqual(around(WEST));
    // With a neighbour four tiles away in the same row, the tile half way
    // goes to whoever founds first: neither is sure of it.
    expect(sureLand(wideGrid, [WEST, EAST], WEST)).toEqual(around(WEST).filter((tile) => tile !== HALF_WAY));
    expect(sureLand(wideGrid, [WEST, EAST], EAST)).toEqual(around(EAST).filter((tile) => tile !== HALF_WAY));
    // The order of the list does not matter.
    expect(sureLand(wideGrid, [EAST, WEST], WEST)).toEqual(sureLand(wideGrid, [WEST, EAST], WEST));

    // Four apart at a slant, or closer than the rules allow: whatever is within two of the other is left out.
    for (const other of [at(WIDE, 7, 1), at(WIDE, 8, 6), at(WIDE, 7, 4), at(WIDE, 6, 4)]) {
      const mine = sureLand(wideGrid, [WEST, other], WEST);
      const theirs = sureLand(wideGrid, [WEST, other], other);
      expect(mine).toEqual(around(WEST).filter((tile) => distance(tile, other, WIDE) > 2));
      expect(mine.length).toBeLessThan(18);
      // The sure lands of two starts never share a tile.
      expect(mine.filter((tile) => theirs.includes(tile))).toEqual([]);
    }
    // Five apart, nothing is shared and nothing is lost.
    expect(distance(WEST, at(WIDE, 10, 4), WIDE)).toBe(5);
    expect(sureLand(wideGrid, [WEST, at(WIDE, 10, 4)], WEST)).toEqual(around(WEST));
    // Three starts: what is within two of either of the others.
    expect(sureLand(wideGrid, [at(WIDE, 7, 1), WEST, EAST], WEST)).toEqual(
      around(WEST).filter((tile) => tile !== HALF_WAY && distance(tile, at(WIDE, 7, 1), WIDE) > 2),
    );
  });

  it('startNeedsHold counts only what a start is sure of: coast half way between two starts four apart counts for neither', () => {
    // Two arms of the sea come down from the north. The western one ends on
    // the tile half way between the starts and gives WEST three coast
    // tiles within two, that tile among them; the eastern one gives EAST
    // three of its own. Each start has hills next to it.
    const westArm = [at(WIDE, 6, 1), at(WIDE, 6, 2), at(WIDE, 6, 3), HALF_WAY];
    const eastArm = [at(WIDE, 8, 1), at(WIDE, 9, 1), at(WIDE, 8, 2), at(WIDE, 9, 2), at(WIDE, 10, 2)];
    const map = redrawn(WIDE, [...each([...westArm, ...eastArm], ','), [at(WIDE, 4, 4), 'h'], [at(WIDE, 10, 4), 'h']]);
    const isSeaCoast = seaCoast(wideGrid, map);
    expect(trueTiles(isSeaCoast)).toEqual(inOrder([...westArm, ...eastArm]));
    const inReachOf = (start: TileIndex): TileIndex[] => tilesInRange(start, 2, map).filter((tile) => isSeaCoast[tile]);
    expect(inReachOf(WEST)).toEqual(inOrder([at(WIDE, 6, 2), at(WIDE, 6, 3), HALF_WAY]));
    expect(inReachOf(EAST)).toEqual(inOrder([HALF_WAY, at(WIDE, 8, 2), at(WIDE, 9, 2), at(WIDE, 10, 2)]));

    // Alone, either start has the sea. Together, WEST is sure of two coast tiles only.
    expect(startNeedsHold(wideGrid, map, [WEST])).toBe(true);
    expect(startNeedsHold(wideGrid, map, [EAST])).toBe(true);
    expect(startNeedsHold(wideGrid, map, [WEST, EAST])).toBe(false);
    expect(startNeedsHold(wideGrid, map, [EAST, WEST])).toBe(false);
    // One more coast tile on WEST's own side, and both are served.
    expect(startNeedsHold(wideGrid, redrawn(map, [[at(WIDE, 5, 2), ',']]), [WEST, EAST])).toBe(true);
  });

  it('seaCoast is the coast of the largest body of water: a lake\'s coast is not; of two bodies of one size the one with the lower tile', () => {
    const coastOfTheSea = (map: GameMap): TileIndex[] => trueTiles(seaCoast(gridFor(map), map));

    // An island with its shore drawn as coast, and a lake of two tiles in it.
    const withLake = mapFromAscii([
      '~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ , , , , , , , ~',
      '~ , g g g g g , ~',
      ' ~ , g , , g g , ~',
      '~ , g g g g g , ~',
      ' ~ , , , , , , , ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~',
    ]);
    const lake = [at(withLake, 3, 3), at(withLake, 4, 3)];
    expect(labelRegions(gridFor(withLake), withLake.tiles.map((tile) => tileIsWater(tile))).sizes).toEqual([48, 2]);
    const coast = coastOfTheSea(withLake);
    // Every coast tile but the lake's two; no open sea, no land.
    expect(coast).toEqual(trueTiles(withLake.tiles.map((tile, index) => tile.terrain === 'coast' && !lake.includes(index))));
    expect(coast).toHaveLength(20);

    // Two bodies of water of six tiles each, with land between them: the sea is the one that holds the lower tile.
    const twoSeas = mapFromAscii([
      '~ , g g g , ~',
      ' ~ , g g g , ~',
      '~ , g g g , ~',
    ]);
    expect(labelRegions(gridFor(twoSeas), twoSeas.tiles.map((tile) => tileIsWater(tile))).sizes).toEqual([6, 6]);
    expect(coastOfTheSea(twoSeas)).toEqual([at(twoSeas, 1, 0), at(twoSeas, 1, 1), at(twoSeas, 1, 2)]);
    // One tile more in the east, and the east is the sea.
    const eastLarger = redrawn(twoSeas, [[at(twoSeas, 4, 1), ',']]);
    expect(coastOfTheSea(eastLarger)).toEqual([at(twoSeas, 5, 0), at(twoSeas, 4, 1), at(twoSeas, 5, 1), at(twoSeas, 5, 2)]);
    // One more in the west as well: of one size again, and the west again.
    const evenAgain = redrawn(eastLarger, [[at(twoSeas, 2, 1), ',']]);
    expect(coastOfTheSea(evenAgain)).toEqual([at(twoSeas, 1, 0), at(twoSeas, 1, 1), at(twoSeas, 2, 1), at(twoSeas, 1, 2)]);

    // A map without water has no sea and no coast of it.
    expect(coastOfTheSea(mapFromAscii(['g g g', ' g h g', 'g g g']))).toEqual([]);
  });

  it('sitesBySea allows the tiles with three coast tiles of the sea within two of them; a lake\'s coast does not count', () => {
    // SHORE with the channel as a lake: three coast tiles of the sea in the west, three of a lake further east.
    const map = redrawn(SHORE, each(CHANNEL, ','));
    const isSeaCoast = seaCoast(grid, map);
    expect(trueTiles(isSeaCoast)).toEqual(inOrder(COAST));
    const allowed = sitesBySea(grid, isSeaCoast);
    // For every tile of the map, by this file's own count.
    for (let tile = 0; tile < grid.count; tile++) {
      const inReach = tilesInRange(tile, 2, map).filter((near) => near !== tile && isSeaCoast[near]).length;
      expect(allowed[tile], `tile ${tile}`).toBe(inReach >= 3);
    }
    expect(allowed[START]).toBe(true);
    // East of the lake all three of its coast tiles are within two, and none of the sea's.
    const eastOfLake = at(OPEN, 6, 4);
    expect(CHANNEL.every((tile) => distance(eastOfLake, tile, OPEN) <= 2)).toBe(true);
    expect(allowed[eastOfLake]).toBe(false);
    // From the tile north-east of START only one of the three is within two.
    expect(allowed[at(OPEN, 3, 3)]).toBe(false);
    // With two coast tiles of the sea START is not allowed either.
    expect(sitesBySea(grid, seaCoast(grid, redrawn(map, [[COAST[2], 'g']])))[START]).toBe(false);
  });

  it('placeStarts takes its starts from the allowed sites only, and nothing else about its choice changes', () => {
    const map = mapFromAscii(grassIsland(30, 9));
    const mapGrid = gridFor(map);
    const rng = () => seedRng('starts', 'map:starts');
    const free = placeStarts(mapGrid, map, 3, false, rng()) as TileIndex[];
    expect(free).toHaveLength(3);
    // No list, null, and a list that allows every tile are one and the same.
    expect(placeStarts(mapGrid, map, 3, false, rng(), null)).toEqual(free);
    expect(placeStarts(mapGrid, map, 3, false, rng(), map.tiles.map(() => true))).toEqual(free);

    // Only the western half is allowed: the starts are there, and keep the rules as before.
    const westHalf = map.tiles.map((_, tile) => tile % map.width <= 16);
    expect(free.some((start) => !westHalf[start])).toBe(true);
    const starts = placeStarts(mapGrid, map, 2, false, rng(), westHalf) as TileIndex[];
    expect(starts).toHaveLength(2);
    for (const start of starts) expect(westHalf[start]).toBe(true);
    expect(hardRulesHold(mapGrid, map, starts)).toBe(true);
    expect(standardRulesHold(mapGrid, map, starts)).toBe(true);

    // One allowed site: a single player gets it, and two players find no room, crowded or not.
    const only = at(map, 20, 5);
    const justOne = map.tiles.map((_, tile) => tile === only);
    expect(placeStarts(mapGrid, map, 1, false, rng(), justOne)).toEqual([only]);
    expect(placeStarts(mapGrid, map, 2, false, rng(), justOne)).toBeNull();
    expect(placeStarts(mapGrid, map, 2, true, rng(), justOne)).toBeNull();
    // No allowed site at all: no room for anybody.
    expect(placeStarts(mapGrid, map, 1, true, rng(), map.tiles.map(() => false))).toBeNull();
  });
});

describe('attempts: trying again when a map has no room', () => {
  /** A made-up size, so small that three players often do not fit the standard rules on the first map. */
  const CRAMPED: MapDimensions = { width: 18, height: 12, recommendedPlayers: 3 };
  /**
   * A made-up size on which two players can never have the standard rules:
   * the map is too small for two tiles RULES.minStartDistance apart.
   */
  const HOPELESS: MapDimensions = { width: 8, height: 6, recommendedPlayers: 2 };

  it('names the random streams as the doc comment of generateMap says', () => {
    expect(attemptStreams('s', 1)('')).toEqual(seedRng('s', 'map'));
    expect(attemptStreams('s', 1)('moisture')).toEqual(seedRng('s', 'map:moisture'));
    expect(attemptStreams('s', 2)('')).toEqual(seedRng('s', 'map#2'));
    expect(attemptStreams('s', 2)('moisture')).toEqual(seedRng('s', 'map#2:moisture'));
    expect(attemptStreams('s', 17)('starts')).toEqual(seedRng('s', 'map#17:starts'));
  });

  it('returns the map of the first attempt that has room, built from that attempt\'s streams', () => {
    const grid = gridFor(CRAMPED);
    let neededMoreThanOneAttempt = 0;
    for (let i = 0; i < 30; i++) {
      const seed = `cramped-${i}`;
      const result = generateForSize(seed, CRAMPED, 3);

      // Every promise holds, however many attempts it took.
      expect(result.starts).toHaveLength(3);
      expect(hardRulesHold(grid, result.map, result.starts)).toBe(true);
      expect(startNeedsHold(grid, result.map, result.starts)).toBe(true);
      expect(standardRulesHold(grid, result.map, result.starts)).toBe(true);

      // Walk through the attempts as the doc comment describes them: the
      // land, the starts among the sites with the sea in reach, a hill for
      // every start that has none, and every check on the map with those
      // hills. All attempts before the one that was returned must have
      // failed. (On these seeds every one of them failed for lack of room.)
      let attempt = 1;
      while (attempt <= MAPGEN.maxAttempts) {
        const streams = attemptStreams(seed, attempt);
        const map = buildMap(grid, streams);
        const starts = placeStarts(grid, map, 3, false, streams('starts'), sitesBySea(grid, seaCoast(grid, map)));
        if (
          starts !== null &&
          hardRulesHold(grid, map, starts) &&
          raiseStartHills(grid, map, starts) !== -1 &&
          startNeedsHold(grid, map, starts) &&
          standardRulesHold(grid, map, starts)
        ) {
          // (raiseStartHills has edited `map`: it is the land with its new hills.)
          expect(result.map, `${seed}, attempt ${attempt}`).toEqual(map);
          // (The starts come back shuffled, so compare them in tile order.)
          expect([...result.starts].sort((a, b) => a - b)).toEqual([...starts].sort((a, b) => a - b));
          break;
        }
        attempt++;
      }
      expect(attempt).toBeLessThanOrEqual(MAPGEN.maxAttempts);
      if (attempt > 1) neededMoreThanOneAttempt++;
    }
    // The point of the made-up size: this test really does see retries.
    expect(neededMoreThanOneAttempt).toBeGreaterThanOrEqual(5);
  });

  it('gives the same result every time, also when it needed several attempts', () => {
    for (let i = 0; i < 10; i++) {
      expect(generateForSize(`cramped-${i}`, CRAMPED, 3)).toEqual(generateForSize(`cramped-${i}`, CRAMPED, 3));
    }
  });

  it('gives up with an error after MAPGEN.maxAttempts attempts (100, as the doc comment says)', () => {
    expect(MAPGEN.maxAttempts).toBe(100);
    // The size really is hopeless: the outer ring is always water, and no
    // two of the tiles inside it are RULES.minStartDistance apart.
    const inside: TileIndex[] = [];
    for (let y = 1; y < HOPELESS.height - 1; y++) {
      for (let x = 1; x < HOPELESS.width - 1; x++) inside.push(at(HOPELESS, x, y));
    }
    let furthest = 0;
    for (const a of inside) for (const b of inside) furthest = Math.max(furthest, distance(a, b, HOPELESS));
    expect(furthest).toBeLessThan(RULES.minStartDistance);
    for (const seed of ['hopeless-1', 'hopeless-2', 'hopeless-3']) {
      expect(() => generateForSize(seed, HOPELESS, 2)).toThrow(Error);
    }
  });

  describe('the generator checks what the placement step hands it', () => {
    const SMALL: MapDimensions = { width: 32, height: 20, recommendedPlayers: 3 };
    const grid = gridFor(SMALL);
    const seed = 'checked-starts';
    // The land of the first two attempts, as the terrain steps make it: before the starts and their hills.
    const firstMap = buildMap(grid, attemptStreams(seed, 1));
    const secondMap = buildMap(grid, attemptStreams(seed, 2));
    const bySea = sitesBySea(grid, seaCoast(grid, firstMap));
    const honest = placeStarts(grid, firstMap, 2, false, attemptStreams(seed, 1)('starts'), bySea) as TileIndex[];

    /**
     * The land of an attempt as the generator hands it out with these
     * starts: with a hill for every start that has none (rule H7).
     */
    function withStartHills(land: GameMap, starts: readonly TileIndex[]): GameMap {
      const map = copyOf(land);
      expect(raiseStartHills(grid, map, starts)).toBeGreaterThanOrEqual(0);
      return map;
    }

    /** A placement step that hands out `starts` for the first map it is asked about, and does its real work afterwards. */
    function cheatingOnce(starts: TileIndex[]): { place: typeof placeStarts; calls: number } {
      const cheat: { place: typeof placeStarts; calls: number } = {
        calls: 0,
        place: (...args) => {
          cheat.calls++;
          return cheat.calls === 1 ? starts : placeStarts(...args);
        },
      };
      return cheat;
    }

    it('the example: the first map of this seed has room, and the second map is another one', () => {
      // Both starts of this example need a hill, so the map that is handed out is not the bare land.
      const handedOut = withStartHills(firstMap, honest);
      expect(changedTiles(firstMap, handedOut)).toHaveLength(2);
      expect(hardRulesHold(grid, handedOut, honest)).toBe(true);
      expect(startNeedsHold(grid, handedOut, honest)).toBe(true);
      expect(standardRulesHold(grid, handedOut, honest)).toBe(true);
      const result = generateForSize(seed, SMALL, 2);
      expect(result.map).toEqual(handedOut);
      expect(inOrder(result.starts)).toEqual(inOrder(honest));
      expect(secondMap).not.toEqual(firstMap);
    });

    it('throws a map away whose starts break a hard rule, and goes on with the next attempt', () => {
      const breaking: TileIndex[][] = [
        [honest[0], honest[0]], // H1: one tile for two players
        [honest[0], 0], // H2: the corner of the map is sea
        [honest[0]], // one start for two players
      ];
      for (const starts of breaking) {
        const cheat = cheatingOnce(starts);
        const result = generateForSize(seed, SMALL, 2, cheat.place);
        expect(cheat.calls).toBe(2);
        expect(result.map).toEqual(withStartHills(secondMap, result.starts));
        expect(hardRulesHold(grid, result.map, result.starts)).toBe(true);
        expect(startNeedsHold(grid, result.map, result.starts)).toBe(true);
        expect(standardRulesHold(grid, result.map, result.starts)).toBe(true);
      }
    });

    it('throws a map away whose starts are out of reach of the sea (rule H6), crowded or not', () => {
      // A second start inland: a legal city site, far enough away and on
      // land as good, so that H1-H5 and S1-S3 all hold. Only the sea is missing.
      let inland: TileIndex[] | null = null;
      for (let tile = 0; tile < grid.count && inland === null; tile++) {
        const starts = [honest[0], tile];
        if (bySea[tile] || !hardRulesHold(grid, firstMap, starts)) continue;
        if (standardRulesHold(grid, withStartHills(firstMap, starts), starts)) inland = starts;
      }
      expect(inland).not.toBeNull();
      expect(startNeedsHold(grid, withStartHills(firstMap, inland as TileIndex[]), inland as TileIndex[])).toBe(false);

      // H6 is a hard rule: it is not let off on a crowded map.
      for (const size of [SMALL, { ...SMALL, recommendedPlayers: 1 }]) {
        const cheat = cheatingOnce(inland as TileIndex[]);
        const result = generateForSize(seed, size, 2, cheat.place);
        expect(cheat.calls).toBe(2);
        expect(result.map).toEqual(withStartHills(secondMap, result.starts));
        expect(startNeedsHold(grid, result.map, result.starts)).toBe(true);
      }
    });

    it('gives the starts a placement step hands in their hills (rule H7), like its own', () => {
      // The honest starts, handed in by a stand-in for the placement step:
      // the map that comes back is the first land with a hill by each of them.
      const result = generateForSize(seed, SMALL, 2, () => [...honest]);
      expect(result.map).toEqual(withStartHills(firstMap, honest));
      expect(result.map).not.toEqual(firstMap);
      expect(inOrder(result.starts)).toEqual(inOrder(honest));
    });

    it('checks the fairness of rule S3 on the map with its new hills, not on the bare land', () => {
      // A hill moves a start's score by one, and for some pairs of starts
      // that one decides whether the lower score is 70% of the higher.
      // Two such pairs on the first land of this seed, each with the sea
      // in reach and far enough apart: one that is fair on the bare land
      // and not with its hills, and one the other way round.
      let fairBefore: TileIndex[] | null = null;
      let fairAfter: TileIndex[] | null = null;
      const sites: TileIndex[] = [];
      for (let tile = 0; tile < grid.count; tile++) if (bySea[tile] && hardRulesHold(grid, firstMap, [tile])) sites.push(tile);
      for (const a of sites) {
        for (const b of sites) {
          if (b <= a || (fairBefore !== null && fairAfter !== null)) continue;
          // Only a pair close to the line can change sides (this saves looking at every pair in full).
          const low = Math.min(startScore(grid, firstMap, a), startScore(grid, firstMap, b));
          const high = Math.max(startScore(grid, firstMap, a), startScore(grid, firstMap, b));
          if (Math.abs(low * 100 - MAPGEN.fairScorePercent * high) > 100 + MAPGEN.fairScorePercent) continue;
          const starts = [a, b];
          if (distance(a, b, SMALL) < RULES.minStartDistance || !hardRulesHold(grid, firstMap, starts)) continue;
          const onBareLand = standardRulesHold(grid, firstMap, starts);
          const withHills = standardRulesHold(grid, withStartHills(firstMap, starts), starts);
          if (onBareLand && !withHills && fairBefore === null) fairBefore = starts;
          if (!onBareLand && withHills && fairAfter === null) fairAfter = starts;
        }
      }
      expect(fairBefore).not.toBeNull();
      expect(fairAfter).not.toBeNull();

      // Fair only before the hills were put: the map is thrown away.
      const unfair = cheatingOnce(fairBefore as TileIndex[]);
      const refused = generateForSize(seed, SMALL, 2, unfair.place);
      expect(unfair.calls).toBe(2);
      expect(refused.map).toEqual(withStartHills(secondMap, refused.starts));

      // Fair only with the hills: the map is handed out.
      const fair = cheatingOnce(fairAfter as TileIndex[]);
      const accepted = generateForSize(seed, SMALL, 2, fair.place);
      expect(fair.calls).toBe(1);
      expect(accepted.map).toEqual(withStartHills(firstMap, fairAfter as TileIndex[]));
      expect(inOrder(accepted.starts)).toEqual(fairAfter);
    });

    it('throws a map away whose starts break a standard rule, but only when the map is not crowded', () => {
      // A second start that is a legal city site in its own right, with the
      // sea in reach and a hill (H6 and H7 hold), but closer than rule S1 allows.
      let tooClose: TileIndex[] | null = null;
      for (let tile = 0; tile < grid.count && tooClose === null; tile++) {
        const starts = [honest[0], tile];
        if (!hardRulesHold(grid, firstMap, starts) || distance(honest[0], tile, SMALL) >= RULES.minStartDistance) continue;
        const map = withStartHills(firstMap, starts);
        if (startNeedsHold(grid, map, starts) && !standardRulesHold(grid, map, starts)) tooClose = starts;
      }
      expect(tooClose).not.toBeNull();

      const uncrowded = cheatingOnce(tooClose as TileIndex[]);
      const refused = generateForSize(seed, SMALL, 2, uncrowded.place);
      expect(uncrowded.calls).toBe(2);
      expect(refused.map).toEqual(withStartHills(secondMap, refused.starts));
      expect(standardRulesHold(grid, refused.map, refused.starts)).toBe(true);

      // The same starts on the same map are good enough when two players are more than the size recommends.
      const crowded = cheatingOnce(tooClose as TileIndex[]);
      const accepted = generateForSize(seed, { ...SMALL, recommendedPlayers: 1 }, 2, crowded.place);
      expect(crowded.calls).toBe(1);
      expect(accepted.map).toEqual(withStartHills(firstMap, tooClose as TileIndex[]));
      expect(inOrder(accepted.starts)).toEqual(inOrder(tooClose as TileIndex[]));
    });
  });

  it('gets the starts on the same small map when it counts as crowded: only the hard rules are demanded then', () => {
    const crowdedSize: MapDimensions = { ...HOPELESS, recommendedPlayers: 1 };
    const grid = gridFor(crowdedSize);
    for (const seed of ['hopeless-1', 'hopeless-2', 'hopeless-3']) {
      const result = generateForSize(seed, crowdedSize, 2);
      expect(result.starts).toHaveLength(2);
      expect(hardRulesHold(grid, result.map, result.starts)).toBe(true);
      // The sea and the hill are hard rules: they hold on this tiny crowded map too.
      expect(startNeedsHold(grid, result.map, result.starts)).toBe(true);
      expect(standardRulesHold(grid, result.map, result.starts)).toBe(false);
    }
  });
});
