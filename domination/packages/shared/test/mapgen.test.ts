import { beforeAll, describe, expect, it } from 'vitest';
import { MAP_SIZES, MAP_SIZE_IDS, RULES } from '../src/data/rules';
import type { MapSizeId } from '../src/data/rules';
import { FEATURES, FEATURE_IDS, TERRAIN_IDS, tileIsWater, tileMoveCost } from '../src/data/terrain';
import type { FeatureId, TerrainId } from '../src/data/terrain';
import { distance, neighbors, tileCoord } from '../src/hex';
import { attemptStreams } from '../src/mapgen/attempts';
import { buildMap } from '../src/mapgen/buildMap';
import { generateMap } from '../src/mapgen/generateMap';
import { gridFor } from '../src/mapgen/grid';
import type { GameMap, Tile, TileIndex } from '../src/types';

/**
 * Tests of generateMap (work package WP1): the MAP it returns.
 * (The start positions have their own file, mapgenStarts.test.ts; the
 * parts the generator is built from are tested in mapgenParts.test.ts and
 * mapgenPlacement.test.ts.)
 *
 * Every promise in the doc comment of generateMap about the map is checked
 * on 200 seeds for each of the three map sizes: 600 maps. The player count
 * goes round from 1 to RULES.maxSeats with the seeds, so every size is seen
 * with every player count.
 *
 * Since round 3 the finished map is the land the terrain steps make plus up
 * to one hill by every start (rule H7). The checks here look at the
 * finished map, with one exception that says so: "in clusters" is a claim
 * about the terrain steps and is measured on their land.
 *
 * (The rule "only Math functions that give the same result everywhere" is
 * checked for the whole shared package by purity.test.ts.)
 */

const SEEDS_PER_SIZE = 200;

/** One generated map, with what it was generated from (so that a failure can be reproduced). */
interface Sample {
  /** For failure messages: seed, size and player count. */
  label: string;
  seed: string;
  mapSize: MapSizeId;
  map: GameMap;
  starts: TileIndex[];
  /** neighborsOf[tile]: the tiles next to it (looked up once, because many checks need it). */
  neighborsOf: TileIndex[][];
}

const samples: Sample[] = [];

beforeAll(() => {
  for (const mapSize of MAP_SIZE_IDS) {
    // The same for every map of one size, so it is looked up only once per size.
    const size = MAP_SIZES[mapSize];
    const neighborsOf: TileIndex[][] = [];
    for (let tile = 0; tile < size.width * size.height; tile++) neighborsOf.push(neighbors(tile, size));

    for (let i = 0; i < SEEDS_PER_SIZE; i++) {
      const seed = `map-${i}`;
      const playerCount = 1 + (i % RULES.maxSeats);
      const { map, starts } = generateMap(seed, mapSize, playerCount);
      samples.push({ label: `seed '${seed}', ${mapSize}, ${playerCount} players`, seed, mapSize, map, starts, neighborsOf });
    }
  }
}, 120_000);

/**
 * Runs `check` on every sample (or on every sample of `among`). `check`
 * returns null if all is well, or a few words about what is wrong. The
 * result lists the samples that failed, so that a failing test names the seed.
 */
function problemsIn(check: (sample: Sample) => string | null, among: readonly Sample[] = samples): string[] {
  const problems: string[] = [];
  for (const sample of among) {
    const problem = check(sample);
    if (problem !== null) problems.push(`${sample.label}: ${problem}`);
  }
  return problems;
}

/** The share (0..1) of the tiles for which `test` is true. */
function shareOf(tiles: readonly Tile[], test: (tile: Tile) => boolean): number {
  return tiles.filter(test).length / tiles.length;
}

function isLand(tile: Tile): boolean {
  return !tileIsWater(tile);
}

/** A number such as 0.4321 as '43.2%', for failure messages. */
function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * Sizes of the groups of connected tiles for which `isMember` is true,
 * largest first. With "is land" these are the landmasses.
 */
function groupSizes(sample: Sample, isMember: (tile: Tile) => boolean): number[] {
  const seen = new Set<TileIndex>();
  const sizes: number[] = [];
  sample.map.tiles.forEach((first, firstIndex) => {
    if (!isMember(first) || seen.has(firstIndex)) return;
    let size = 0;
    const todo = [firstIndex];
    seen.add(firstIndex);
    while (todo.length > 0) {
      const tile = todo.pop() as TileIndex;
      size++;
      for (const next of sample.neighborsOf[tile]) {
        if (isMember(sample.map.tiles[next]) && !seen.has(next)) {
          seen.add(next);
          todo.push(next);
        }
      }
    }
    sizes.push(size);
  });
  return sizes.sort((a, b) => b - a);
}

/** Of the tiles for which `isKind` is true, the share that touch another such tile. 1 if there are none. */
function shareWithLikeNeighbor(sample: Sample, isKind: (tile: Tile) => boolean): number {
  let total = 0;
  let withLikeNeighbor = 0;
  sample.map.tiles.forEach((tile, index) => {
    if (!isKind(tile)) return;
    total++;
    if (sample.neighborsOf[index].some((neighbor) => isKind(sample.map.tiles[neighbor]))) withLikeNeighbor++;
  });
  return total === 0 ? 1 : withLikeNeighbor / total;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

describe('generateMap: the same input always gives the same result', () => {
  // A smaller set is enough here: every case is generated twice.
  const SOME_SEEDS = ['repeat-1', 'repeat-2', 'repeat-3', 'repeat-4', 'repeat-5'];

  it('returns a deep-equal result for the same seed, size and player count', () => {
    for (const mapSize of MAP_SIZE_IDS) {
      for (const playerCount of [1, MAP_SIZES[mapSize].recommendedPlayers, RULES.maxSeats]) {
        for (const seed of SOME_SEEDS) {
          const first = generateMap(seed, mapSize, playerCount);
          const second = generateMap(seed, mapSize, playerCount);
          expect(second, `seed '${seed}', ${mapSize}, ${playerCount} players`).toEqual(first);
        }
      }
    }
  });

  it('does not depend on which maps were generated before', () => {
    const alone = generateMap('order-a', 'medium', 4);
    generateMap('order-b', 'large', 8);
    generateMap('order-c', 'small', 2);
    expect(generateMap('order-a', 'medium', 4)).toEqual(alone);
  });

  it('hands out a fresh result every time: changing one does not change the next', () => {
    const first = generateMap('fresh', 'small', 3);
    const untouched = JSON.parse(JSON.stringify(first));
    // Vandalise the first result ...
    first.map.tiles[0].terrain = 'desert';
    first.map.tiles.length = 5;
    first.starts.length = 0;
    // ... and ask again.
    const second = generateMap('fresh', 'small', 3);
    expect(second).toEqual(untouched);
    expect(second.map).not.toBe(first.map);
  });

  it('returns plain JSON data (it survives being saved and loaded)', () => {
    for (const mapSize of MAP_SIZE_IDS) {
      const result = generateMap('json', mapSize, 2);
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    }
  });

  it('returns different maps for different seeds', () => {
    for (const mapSize of MAP_SIZE_IDS) {
      const drawings = new Set<string>();
      const startLists = new Set<string>();
      for (const sample of samples.filter((s) => s.mapSize === mapSize)) {
        drawings.add(sample.map.tiles.map((tile) => `${tile.terrain}/${tile.feature}`).join(' '));
        startLists.add(sample.starts.join(' '));
      }
      // Every one of the 200 seeds made a map of its own ...
      expect(drawings.size, mapSize).toBe(SEEDS_PER_SIZE);
      // ... and hardly ever the same start tiles.
      expect(startLists.size, mapSize).toBeGreaterThanOrEqual(SEEDS_PER_SIZE - 5);
    }
  });

  it('the land is the seed\'s but for the hills by the starts: the maps for two and for five players differ in at most 2 + 5 tiles, each of them hills in one map, within two of a start of that map, and forest or open land in the other', () => {
    // The seed alone fixes the land: asking for more players moves no coast.
    // Then every start that has no tile for a Mine is given one hill, so
    // each map has up to one tile per player that the other may not have.
    // (Only a failed attempt, which a test of mapgenStarts.test.ts counts
    // and never finds on the game's sizes, would make the maps differ more.)
    let mapsThatDiffer = 0;
    for (const seed of ['same-land', 'same-land-2', 'same-land-3', 'same-land-4', 'same-land-5', 'same-land-6']) {
      const two = generateMap(seed, 'large', 2);
      const five = generateMap(seed, 'large', 5);
      expect(two.starts).toHaveLength(2);
      expect(five.starts).toHaveLength(5);
      expect(five.map.tiles).toHaveLength(two.map.tiles.length);

      const differing: TileIndex[] = [];
      two.map.tiles.forEach((tile, index) => {
        if (JSON.stringify(tile) !== JSON.stringify(five.map.tiles[index])) differing.push(index);
      });
      expect(differing.length, seed).toBeLessThanOrEqual(2 + 5);
      if (differing.length > 0) mapsThatDiffer++;
      for (const tile of differing) {
        const inTwo = two.map.tiles[tile];
        const inFive = five.map.tiles[tile];
        // One of the two maps has hills there, by one of ITS starts ...
        const hillsInTwo = inTwo.feature === 'hills';
        const [withHills, itsStarts, other] = hillsInTwo ? [inTwo, two.starts, inFive] : [inFive, five.starts, inTwo];
        expect(withHills.feature, `${seed}, tile ${tile}`).toBe('hills');
        expect(itsStarts.some((start) => distance(start, tile, two.map) <= 2), `${seed}, tile ${tile}`).toBe(true);
        // ... and the other has the land the seed made: forest or open ground, the same ground.
        expect([null, 'forest'], `${seed}, tile ${tile}`).toContain(other.feature);
        expect(other, `${seed}, tile ${tile}`).toEqual({ ...withHills, feature: other.feature });
      }
    }
    // The examples really show the difference: the first seed alone would do.
    expect(mapsThatDiffer).toBeGreaterThanOrEqual(1);
  });
});

describe('generateMap: the shape of the map', () => {
  it('generated 200 maps of every size, each with every player count', () => {
    expect(samples).toHaveLength(SEEDS_PER_SIZE * MAP_SIZE_IDS.length);
    const seen = new Set(samples.map((sample) => `${sample.mapSize} with ${sample.starts.length}`));
    expect(seen.size).toBe(MAP_SIZE_IDS.length * RULES.maxSeats);
  });

  it('has width * height tiles of the requested size, all with cityId null and nothing built on them', () => {
    const problems = problemsIn(({ map, mapSize }) => {
      const size = MAP_SIZES[mapSize];
      if (map.width !== size.width || map.height !== size.height) return `is ${map.width} x ${map.height}`;
      if (map.tiles.length !== size.width * size.height) return `has ${map.tiles.length} tiles`;
      if (map.tiles.some((tile) => tile.cityId !== null)) return 'a tile has a cityId';
      if (map.tiles.some((tile) => tile.improvement !== null)) return 'a tile has an improvement';
      return null;
    });
    expect(problems).toEqual([]);
  });

  it('uses only the terrains and features of the tables, and gives every tile exactly terrain, feature, improvement and cityId', () => {
    const problems = problemsIn(({ map }) => {
      for (const tile of map.tiles) {
        if (!TERRAIN_IDS.includes(tile.terrain)) return `unknown terrain '${tile.terrain}'`;
        if (tile.feature !== null && !FEATURE_IDS.includes(tile.feature)) return `unknown feature '${tile.feature}'`;
        if (Object.keys(tile).sort().join() !== 'cityId,feature,improvement,terrain') return `a tile has the keys ${Object.keys(tile).join()}`;
      }
      return null;
    });
    expect(problems).toEqual([]);
  });

  it('makes every tile on the map edge water', () => {
    const problems = problemsIn(({ map }) => {
      for (let tile = 0; tile < map.tiles.length; tile++) {
        const { x, y } = tileCoord(tile, map);
        const onEdge = x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;
        if (onEdge && isLand(map.tiles[tile])) return `tile ${tile} on the edge is land`;
      }
      return null;
    });
    expect(problems).toEqual([]);
  });

  it('marks water next to land as coast and all other water as ocean', () => {
    const problems = problemsIn(({ map, neighborsOf }) => {
      for (let tile = 0; tile < map.tiles.length; tile++) {
        if (isLand(map.tiles[tile])) continue;
        const touchesLand = neighborsOf[tile].some((neighbor) => isLand(map.tiles[neighbor]));
        const expected: TerrainId = touchesLand ? 'coast' : 'ocean';
        if (map.tiles[tile].terrain !== expected) return `water tile ${tile} is ${map.tiles[tile].terrain}, expected ${expected}`;
      }
      return null;
    });
    expect(problems).toEqual([]);
  });

  it('only places features on grounds listed in FEATURES[feature].allowedOn, and never on water', () => {
    const problems = problemsIn(({ map }) => {
      for (let tile = 0; tile < map.tiles.length; tile++) {
        const { terrain, feature } = map.tiles[tile];
        if (feature === null) continue;
        if (tileIsWater(map.tiles[tile])) return `tile ${tile}: ${feature} on water`;
        if (!FEATURES[feature].allowedOn.includes(terrain)) return `tile ${tile}: ${feature} on ${terrain}`;
      }
      return null;
    });
    expect(problems).toEqual([]);
  });
});

describe('generateMap: sensible terrain', () => {
  it('has a sensible share of land (35-45%) on every map', () => {
    const problems = problemsIn(({ map }) => {
      const land = shareOf(map.tiles, isLand);
      return land >= 0.35 && land <= 0.45 ? null : `${percent(land)} land`;
    });
    expect(problems).toEqual([]);
  });

  it('contains every terrain and feature kind (on small maps too, not only on medium and large ones)', () => {
    const problems = problemsIn(({ map }) => {
      for (const terrain of TERRAIN_IDS) {
        if (!map.tiles.some((tile) => tile.terrain === terrain)) return `no ${terrain}`;
      }
      for (const feature of FEATURE_IDS) {
        if (!map.tiles.some((tile) => tile.feature === feature)) return `no ${feature}`;
      }
      return null;
    });
    expect(problems).toEqual([]);
  });

  it('is surrounded by open sea: plenty of ocean, and a coast around the land', () => {
    const problems = problemsIn(({ map }) => {
      const ocean = shareOf(map.tiles, (tile) => tile.terrain === 'ocean');
      const coast = shareOf(map.tiles, (tile) => tile.terrain === 'coast');
      if (ocean < 0.35) return `only ${percent(ocean)} ocean`;
      if (coast < 0.05 || coast > 0.25) return `${percent(coast)} coast`;
      return null;
    });
    expect(problems).toEqual([]);
  });

  it('has most of its land in one or a few large landmasses', () => {
    const problems = problemsIn((sample) => {
      const sizes = groupSizes(sample, isLand);
      const land = sizes.reduce((sum, size) => sum + size, 0);
      const largest = sizes[0] / land;
      const largestThree = (sizes[0] + (sizes[1] ?? 0) + (sizes[2] ?? 0)) / land;
      if (largest < 0.6) return `the largest landmass has only ${percent(largest)} of the land`;
      if (largestThree < 0.85) return `the three largest landmasses have only ${percent(largestThree)} of the land`;
      if (sizes[sizes.length - 1] < 3) return 'there is an island of fewer than 3 tiles';
      return null;
    });
    expect(problems).toEqual([]);
  });

  it('makes grassland and plains dominant, with desert, forest, hills and mountains in moderation', () => {
    // Shares of the LAND tiles. The generator aims at: desert 8-12%, forest
    // 15-19%, hills 10-13%, mountains 4-6%; the limits here leave some slack.
    const limits: { name: string; test: (tile: Tile) => boolean; min: number; max: number }[] = [
      { name: 'grassland or plains ground', test: (t) => t.terrain === 'grassland' || t.terrain === 'plains', min: 0.85, max: 0.95 },
      { name: 'open grassland or plains', test: (t) => t.terrain !== 'desert' && t.feature === null, min: 0.45, max: 0.75 },
      { name: 'grassland', test: (t) => t.terrain === 'grassland', min: 0.35, max: 0.6 },
      { name: 'plains', test: (t) => t.terrain === 'plains', min: 0.3, max: 0.55 },
      { name: 'desert', test: (t) => t.terrain === 'desert', min: 0.05, max: 0.15 },
      { name: 'forest', test: (t) => t.feature === 'forest', min: 0.1, max: 0.25 },
      { name: 'hills', test: (t) => t.feature === 'hills', min: 0.06, max: 0.18 },
      { name: 'mountains', test: (t) => t.feature === 'mountains', min: 0.02, max: 0.09 },
    ];
    const problems = problemsIn(({ map }) => {
      const land = map.tiles.filter(isLand);
      for (const { name, test, min, max } of limits) {
        const share = shareOf(land, test);
        if (share < min || share > max) return `${percent(share)} of the land is ${name} (expected ${percent(min)} to ${percent(max)})`;
      }
      return null;
    });
    expect(problems).toEqual([]);
  });

  it('places desert, forest, hills and mountains in clusters and ranges, not as scattered single tiles', () => {
    // The measure: of the tiles of a kind, how many touch another tile of
    // the same kind? Scattered at random it would be about 47% for desert,
    // 67% for forest, 53% for hills and 26% for mountains (at the shares
    // the generator uses). Clusters score far higher.
    //
    // The claim is about the terrain steps, so it is measured on the land
    // they make, before the starts are chosen: buildMap on the streams of
    // the first attempt. The one hill that is then put by a start which has
    // none may stand alone, on purpose (rule H7), and is no cluster.
    const lands: Sample[] = samples.map((sample) => ({
      ...sample,
      map: buildMap(gridFor(MAP_SIZES[sample.mapSize]), attemptStreams(sample.seed, 1)),
    }));
    // The finished map IS that land but for hills: the same coast, desert, forest elsewhere and mountains.
    for (let i = 0; i < samples.length; i++) {
      const changed = samples[i].map.tiles.filter((tile, index) => JSON.stringify(tile) !== JSON.stringify(lands[i].map.tiles[index]));
      expect(changed.length, samples[i].label).toBeLessThanOrEqual(samples[i].starts.length);
      expect(changed.every((tile) => tile.feature === 'hills'), samples[i].label).toBe(true);
    }
    const kinds: { name: string; test: (tile: Tile) => boolean; everyMap: number; onAverage: number }[] = [
      { name: 'desert', test: (t) => t.terrain === 'desert', everyMap: 0.8, onAverage: 0.95 },
      { name: 'forest', test: (t) => t.feature === 'forest', everyMap: 0.75, onAverage: 0.9 },
      { name: 'hills', test: (t) => t.feature === 'hills', everyMap: 0.75, onAverage: 0.9 },
      { name: 'mountains', test: (t) => t.feature === 'mountains', everyMap: 0.5, onAverage: 0.85 },
    ];
    for (const { name, test, everyMap, onAverage } of kinds) {
      const problems = problemsIn((land) => {
        const share = shareWithLikeNeighbor(land, test);
        return share >= everyMap ? null : `only ${percent(share)} of the ${name} tiles touch another one`;
      }, lands);
      expect(problems, name).toEqual([]);
      for (const mapSize of MAP_SIZE_IDS) {
        const shares = lands.filter((s) => s.mapSize === mapSize).map((s) => shareWithLikeNeighbor(s, test));
        expect(average(shares), `${name} on ${mapSize} maps`).toBeGreaterThanOrEqual(onAverage);
      }
    }
  });

  it('lays the desert out as a band across the land: wide, but only a few tiles thick', () => {
    // For every map: in what part of the columns that have land is there
    // desert, in what part of the rows, and how many desert tiles are there
    // per column with desert? A band that runs roughly west-east is in many
    // columns, in fewer rows, and thin. (The same number of desert tiles in
    // one round patch would be in about a quarter of the columns and two or
    // three times as thick.)
    for (const mapSize of MAP_SIZE_IDS) {
      const partOfColumns: number[] = [];
      const partOfRows: number[] = [];
      const thickness: number[] = [];
      for (const { map } of samples.filter((sample) => sample.mapSize === mapSize)) {
        const landColumns = new Set<number>();
        const landRows = new Set<number>();
        const desertColumns = new Set<number>();
        const desertRows = new Set<number>();
        let desertTiles = 0;
        map.tiles.forEach((tile, index) => {
          if (!isLand(tile)) return;
          const { x, y } = tileCoord(index, map);
          landColumns.add(x);
          landRows.add(y);
          if (tile.terrain !== 'desert') return;
          desertColumns.add(x);
          desertRows.add(y);
          desertTiles++;
        });
        partOfColumns.push(desertColumns.size / landColumns.size);
        partOfRows.push(desertRows.size / landRows.size);
        thickness.push(desertTiles / desertColumns.size);
      }
      expect(average(partOfColumns), `${mapSize}: part of the columns`).toBeGreaterThan(0.45);
      expect(average(partOfColumns), `${mapSize}: columns against rows`).toBeGreaterThan(average(partOfRows));
      // Thin: on average the band is less than an eighth of the map's height thick.
      expect(average(thickness), `${mapSize}: desert tiles per column`).toBeLessThan(MAP_SIZES[mapSize].height / 8);
    }
  });

  it('never seals a valley off with mountains: a land unit can walk all over each landmass', () => {
    // If mountains cut a landmass in two, its walkable tiles would form more
    // groups than there are landmasses.
    const problems = problemsIn((sample) => {
      const landmasses = groupSizes(sample, isLand).length;
      const walkableAreas = groupSizes(sample, (tile) => tileMoveCost(tile, 'land') !== null).length;
      return walkableAreas === landmasses ? null : `${landmasses} landmasses but ${walkableAreas} separate walkable areas`;
    });
    expect(problems).toEqual([]);
  });

  it('keeps mountains off the shore, so there is a way along every coast', () => {
    const problems = problemsIn(({ map, neighborsOf }) => {
      for (let tile = 0; tile < map.tiles.length; tile++) {
        const feature: FeatureId | null = map.tiles[tile].feature;
        if (feature !== 'mountains') continue;
        if (neighborsOf[tile].some((neighbor) => tileIsWater(map.tiles[neighbor]))) return `mountain tile ${tile} touches water`;
      }
      return null;
    });
    expect(problems).toEqual([]);
  });
});

describe('generateMap: invalid input', () => {
  it('throws a clear error for invalid input (unknown size, 0 players, too many players, empty seed)', () => {
    // An invalid call is a programming error, so these throw (they do not return an error code).
    expect(() => generateMap('seed', 'huge' as MapSizeId, 2)).toThrow(Error);
    expect(() => generateMap('seed', 'toString' as MapSizeId, 2)).toThrow(Error);
    expect(() => generateMap('seed', 'small', 0)).toThrow(Error);
    expect(() => generateMap('seed', 'small', -1)).toThrow(Error);
    expect(() => generateMap('seed', 'small', RULES.maxSeats + 1)).toThrow(Error);
    expect(() => generateMap('', 'small', 2)).toThrow(Error);
  });

  it('throws for a player count that is not a whole number', () => {
    expect(() => generateMap('seed', 'small', 2.5)).toThrow(Error);
    expect(() => generateMap('seed', 'small', Number.NaN)).toThrow(Error);
    expect(() => generateMap('seed', 'small', '2' as unknown as number)).toThrow(Error);
  });

  it('accepts every valid combination at its limits', () => {
    for (const mapSize of MAP_SIZE_IDS) {
      expect(generateMap('x', mapSize, 1).starts).toHaveLength(1);
      expect(generateMap('x', mapSize, RULES.maxSeats).starts).toHaveLength(RULES.maxSeats);
    }
  });
});

describe('generateMap: speed', () => {
  it('generates the largest map for the most players in well under half a second', () => {
    // Measured while writing this test, on a busy 4-core machine: about 5 ms
    // per map on average and 30 ms at worst (the very first map in a fresh
    // process takes about 100 ms). The limit is set far above that, so that
    // the test only fails if the generator has become slow by a large factor
    // (for example by needing dozens of attempts), not because the machine
    // was busy.
    const LIMIT_MS = 500;
    const largest = MAP_SIZE_IDS[MAP_SIZE_IDS.length - 1];
    const times: number[] = [];
    for (let i = 0; i < 25; i++) {
      const before = performance.now();
      generateMap(`speed-${i}`, largest, RULES.maxSeats);
      times.push(performance.now() - before);
    }
    expect(Math.max(...times)).toBeLessThan(LIMIT_MS);
    expect(average(times)).toBeLessThan(LIMIT_MS / 5);
  });
});
