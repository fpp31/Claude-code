import { describe, expect, it } from 'vitest';
import { RULES } from '../src/data/rules';
import { tileIsWater } from '../src/data/terrain';
import { distance } from '../src/hex';
import { attemptStreams, generateForSize } from '../src/mapgen/attempts';
import type { MapDimensions } from '../src/mapgen/attempts';
import { buildMap } from '../src/mapgen/buildMap';
import { gridFor, labelRegions } from '../src/mapgen/grid';
import { hardRulesHold, standardRulesHold, startScore } from '../src/mapgen/startRules';
import { placeStarts } from '../src/mapgen/starts';
import { MAPGEN } from '../src/mapgen/tuning';
import { seedRng } from '../src/rng';
import { mapFromAscii } from '../src/testing/asciiMap';
import type { GameMap, TileIndex } from '../src/types';

/**
 * Tests of how the map generator (work package WP1) places the players:
 * startRules.ts, starts.ts and attempts.ts in packages/shared/src/mapgen/.
 *
 * mapgenStarts.test.ts checks the promises about start positions on
 * thousands of generated maps. The tests here use small hand-drawn maps,
 * where the right answer is plain to see, and cover the one thing the big
 * tests cannot reach: what happens when a map has no room for the starts
 * (with the real map sizes that practically never happens).
 */

/** Tile index of column x, row y. */
function at(map: { width: number }, x: number, y: number): TileIndex {
  return y * map.width + x;
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
      expect(standardRulesHold(grid, result.map, result.starts)).toBe(true);

      // Walk through the attempts as the doc comment describes them. All
      // attempts before the one that was returned must have had no room.
      let attempt = 1;
      while (attempt <= MAPGEN.maxAttempts) {
        const streams = attemptStreams(seed, attempt);
        const map = buildMap(grid, streams);
        const starts = placeStarts(grid, map, 3, false, streams('starts'));
        if (starts !== null) {
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
    const firstMap = buildMap(grid, attemptStreams(seed, 1));
    const secondMap = buildMap(grid, attemptStreams(seed, 2));
    const honest = placeStarts(grid, firstMap, 2, false, attemptStreams(seed, 1)('starts')) as TileIndex[];

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
      expect(hardRulesHold(grid, firstMap, honest)).toBe(true);
      expect(standardRulesHold(grid, firstMap, honest)).toBe(true);
      expect(generateForSize(seed, SMALL, 2).map).toEqual(firstMap);
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
        expect(result.map).toEqual(secondMap);
        expect(hardRulesHold(grid, result.map, result.starts)).toBe(true);
        expect(standardRulesHold(grid, result.map, result.starts)).toBe(true);
      }
    });

    it('throws a map away whose starts break a standard rule, but only when the map is not crowded', () => {
      // A second start that is a legal city site in its own right, but closer than rule S1 allows.
      let tooClose: TileIndex[] | null = null;
      for (let tile = 0; tile < grid.count && tooClose === null; tile++) {
        const starts = [honest[0], tile];
        if (hardRulesHold(grid, firstMap, starts) && !standardRulesHold(grid, firstMap, starts)) tooClose = starts;
      }
      expect(tooClose).not.toBeNull();

      const uncrowded = cheatingOnce(tooClose as TileIndex[]);
      const refused = generateForSize(seed, SMALL, 2, uncrowded.place);
      expect(uncrowded.calls).toBe(2);
      expect(refused.map).toEqual(secondMap);
      expect(standardRulesHold(grid, refused.map, refused.starts)).toBe(true);

      // The same starts on the same map are good enough when two players are more than the size recommends.
      const crowded = cheatingOnce(tooClose as TileIndex[]);
      const accepted = generateForSize(seed, { ...SMALL, recommendedPlayers: 1 }, 2, crowded.place);
      expect(crowded.calls).toBe(1);
      expect(accepted.map).toEqual(firstMap);
      expect([...accepted.starts].sort((a, b) => a - b)).toEqual([...(tooClose as TileIndex[])].sort((a, b) => a - b));
    });
  });

  it('gets the starts on the same small map when it counts as crowded: only the hard rules are demanded then', () => {
    const crowdedSize: MapDimensions = { ...HOPELESS, recommendedPlayers: 1 };
    const grid = gridFor(crowdedSize);
    for (const seed of ['hopeless-1', 'hopeless-2', 'hopeless-3']) {
      const result = generateForSize(seed, crowdedSize, 2);
      expect(result.starts).toHaveLength(2);
      expect(hardRulesHold(grid, result.map, result.starts)).toBe(true);
      expect(standardRulesHold(grid, result.map, result.starts)).toBe(false);
    }
  });
});
