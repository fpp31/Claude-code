import { beforeAll, describe, expect, it } from 'vitest';
import { MAP_SIZES, MAP_SIZE_IDS, RULES } from '../src/data/rules';
import type { MapSizeId } from '../src/data/rules';
import { tileAllowsCity, tileIsWorkable, tileMoveCost, tileYields } from '../src/data/terrain';
import type { TerrainId } from '../src/data/terrain';
import { distance, isValidTile, neighbors, ring, tilesInRange } from '../src/hex';
import { generateMap } from '../src/mapgen/generateMap';
import { mapFromAscii } from '../src/testing/asciiMap';
import type { GameMap, TileIndex } from '../src/types';

/**
 * Tests of generateMap (work package WP1): the START POSITIONS it returns.
 *
 * The doc comment of generateMap promises the hard rules H1-H5 for every
 * result and the standard rules S1-S3 whenever the map is not crowded.
 * This file
 *
 *  1. writes each rule down as a small check that knows nothing about how
 *     the generator works (it only uses hex.ts and the terrain tables);
 *  2. shows on hand-drawn maps that each check really notices a broken rule;
 *  3. runs all checks on 200 seeds x 3 map sizes x 1..8 players = 4800
 *     generated maps (the "sweep").
 *
 * The sweep is by far the slowest test of the shared package: 10 to 20
 * seconds, depending on how busy the machine is. Its length is in
 * proportion to SEEDS_PER_SIZE.
 */

const SEEDS_PER_SIZE = 200;

// ---------------------------------------------------------------------------
// The rules, as checks
// ---------------------------------------------------------------------------

/** A map with the starts chosen on it, plus what several checks need to know about it. */
interface Placement {
  map: GameMap;
  starts: TileIndex[];
  /** How many starts were asked for. */
  playerCount: number;
  /**
   * areaOf[tile]: the number of the "walkable area" the tile lies in, or -1
   * if a land unit cannot enter the tile. Two tiles have the same number
   * exactly if a land unit can walk from one to the other.
   */
  areaOf: number[];
  /** areaSizes[area]: how many tiles the area has. */
  areaSizes: number[];
}

/** A rule check: null if the rule holds, otherwise a few words about what is wrong. */
type RuleCheck = (placement: Placement) => string | null;

function canEnter(map: GameMap, tile: TileIndex): boolean {
  return tileMoveCost(map.tiles[tile]) !== null;
}

/** neighbors() of every tile of a map size, looked up once per size (the sweep asks millions of times). */
const neighborTables = new Map<string, TileIndex[][]>();
function neighborsOf(map: GameMap): TileIndex[][] {
  const key = `${map.width}x${map.height}`;
  let table = neighborTables.get(key);
  if (table === undefined) {
    table = map.tiles.map((_, tile) => neighbors(tile, map));
    neighborTables.set(key, table);
  }
  return table;
}

/** Works out the walkable areas of a map by flood fill over tileMoveCost. */
function examine(map: GameMap, starts: TileIndex[], playerCount: number): Placement {
  const table = neighborsOf(map);
  const areaOf: number[] = new Array(map.tiles.length).fill(-1);
  const areaSizes: number[] = [];
  for (let first = 0; first < map.tiles.length; first++) {
    if (!canEnter(map, first) || areaOf[first] !== -1) continue;
    const area = areaSizes.length;
    let size = 0;
    const todo = [first];
    areaOf[first] = area;
    while (todo.length > 0) {
      const tile = todo.pop() as TileIndex;
      size++;
      for (const next of table[tile]) {
        if (canEnter(map, next) && areaOf[next] === -1) {
          areaOf[next] = area;
          todo.push(next);
        }
      }
    }
    areaSizes.push(size);
  }
  return { map, starts, playerCount, areaOf, areaSizes };
}

/** The smallest distance between any two starts (Infinity for a single start). */
function smallestDistance({ map, starts }: Placement): number {
  let smallest = Infinity;
  for (let i = 0; i < starts.length; i++) {
    for (let j = i + 1; j < starts.length; j++) smallest = Math.min(smallest, distance(starts[i], starts[j], map));
  }
  return smallest;
}

/** The score of rule S3: food + production of the workable tiles within 2 tiles of the start, itself included. */
function startScore(map: GameMap, start: TileIndex): number {
  let score = 0;
  for (const tile of tilesInRange(start, 2, map)) {
    if (!tileIsWorkable(map.tiles[tile])) continue;
    const yields = tileYields(map.tiles[tile]);
    score += yields.food + yields.production;
  }
  return score;
}

/** The hard rules: they hold for every result. */
const HARD_RULES: Record<'H1' | 'H2' | 'H3' | 'H4' | 'H5', RuleCheck> = {
  H1: ({ map, starts, playerCount }) => {
    if (starts.length !== playerCount) return `${starts.length} starts for ${playerCount} players`;
    if (!starts.every((start) => isValidTile(start, map))) return 'a start is not a tile of the map';
    if (new Set(starts).size !== starts.length) return 'two players share a start tile';
    return null;
  },
  H2: ({ map, starts }) => {
    for (const start of starts) {
      if (!tileAllowsCity(map.tiles[start])) return `no city may be founded on start ${start}`;
      if (!canEnter(map, start)) return `land units cannot enter start ${start}`;
    }
    return null;
  },
  H3: (placement) => {
    const smallest = smallestDistance(placement);
    return smallest >= RULES.minCityDistance ? null : `two starts are only ${smallest} apart`;
  },
  H4: ({ map, starts }) => {
    for (const start of starts) {
      const open = neighbors(start, map).filter((neighbor) => canEnter(map, neighbor)).length;
      if (open < 2) return `start ${start} has only ${open} neighbors a land unit can enter`;
    }
    return null;
  },
  H5: ({ starts, areaOf, areaSizes }) => {
    for (const start of starts) {
      const reachable = areaOf[start] === -1 ? 0 : areaSizes[areaOf[start]];
      if (reachable < RULES.minStartLandmass) return `only ${reachable} tiles can be walked to from start ${start}`;
    }
    return null;
  },
};

/** The standard rules: they hold whenever there are no more players than the map size recommends. */
const STANDARD_RULES: Record<'S1' | 'S2' | 'S3', RuleCheck> = {
  S1: (placement) => {
    const smallest = smallestDistance(placement);
    return smallest >= RULES.minStartDistance ? null : `two starts are only ${smallest} apart`;
  },
  S2: ({ starts, areaOf }) => {
    const areas = new Set(starts.map((start) => areaOf[start]));
    return areas.size === 1 && !areas.has(-1) ? null : `the starts are on ${areas.size} separate landmasses`;
  },
  S3: ({ map, starts }) => {
    const scores = starts.map((start) => startScore(map, start));
    const lowest = Math.min(...scores);
    const highest = Math.max(...scores);
    // "lowest >= 70% of highest", in whole numbers so that rounding cannot blur the line.
    return lowest * 10 >= highest * 7 ? null : `the scores range from ${lowest} to ${highest}`;
  },
};

type RuleName = keyof typeof HARD_RULES | keyof typeof STANDARD_RULES;

// ---------------------------------------------------------------------------
// The checks notice broken rules (hand-drawn maps)
// ---------------------------------------------------------------------------

/**
 * A flat island of grassland, 22 x 5 tiles, in a 24 x 7 sea. `changes` puts
 * other characters (see ASCII_LEGEND) on single tiles: { '19,3': 'f' }
 * plants a forest in column 19 of row 3.
 */
function island(changes: Record<string, string> = {}): GameMap {
  const rows: string[][] = [];
  for (let y = 0; y < 7; y++) {
    const row: string[] = [];
    for (let x = 0; x < 24; x++) {
      const isSea = y === 0 || y === 6 || x === 0 || x === 23;
      row.push(changes[`${x},${y}`] ?? (isSea ? '~' : 'g'));
    }
    rows.push(row);
  }
  return mapFromAscii(rows.map((row) => row.join(' ')));
}

/** Tile index of column x, row y on the island map. */
function at(x: number, y: number): TileIndex {
  return y * 24 + x;
}

/** The six tiles around (19, 3) on the island map (row 3 is an odd row). */
const AROUND_19_3 = ['20,3', '18,3', '19,2', '20,2', '19,4', '20,4'];

/** `character` on each of the listed tiles. */
function all(tiles: readonly string[], character: string): Record<string, string> {
  const changes: Record<string, string> = {};
  for (const tile of tiles) changes[tile] = character;
  return changes;
}

/** A column of the island (rows 1 to 5) as a list of 'x,y' keys. */
function column(x: number): string[] {
  return [1, 2, 3, 4, 5].map((y) => `${x},${y}`);
}

/** The names of the rules that the placement breaks. */
function brokenRules(map: GameMap, starts: TileIndex[], playerCount = starts.length): RuleName[] {
  const placement = examine(map, starts, playerCount);
  const broken: RuleName[] = [];
  for (const name of Object.keys(HARD_RULES) as (keyof typeof HARD_RULES)[]) {
    if (HARD_RULES[name](placement) !== null) broken.push(name);
  }
  for (const name of Object.keys(STANDARD_RULES) as (keyof typeof STANDARD_RULES)[]) {
    if (STANDARD_RULES[name](placement) !== null) broken.push(name);
  }
  return broken;
}

describe('the rule checks of this file notice a broken rule', () => {
  const WEST = at(3, 3);
  const EAST = at(19, 3);

  it('find nothing wrong with two starts far apart on one open island', () => {
    expect(distance(WEST, EAST, island())).toBe(16);
    expect(brokenRules(island(), [WEST, EAST])).toEqual([]);
  });

  it('H1: a missing start, and two players on one tile', () => {
    expect(brokenRules(island(), [WEST, EAST], 3)).toContain('H1');
    expect(brokenRules(island(), [WEST, WEST])).toContain('H1');
  });

  it('H2: a start on forest, on mountains, or in the sea', () => {
    expect(brokenRules(island({ '19,3': 'f' }), [WEST, EAST])).toContain('H2');
    expect(brokenRules(island({ '19,3': 'm' }), [WEST, EAST])).toContain('H2');
    expect(brokenRules(island(), [WEST, at(0, 0)])).toContain('H2');
    // Hills are a legal city site.
    expect(brokenRules(island({ '19,3': 'h' }), [WEST, EAST])).toEqual([]);
  });

  it('H3: starts closer than RULES.minCityDistance', () => {
    const tooClose = at(3 + RULES.minCityDistance - 1, 3);
    const justEnough = at(3 + RULES.minCityDistance, 3);
    expect(brokenRules(island(), [WEST, tooClose])).toContain('H3');
    expect(brokenRules(island(), [WEST, justEnough])).not.toContain('H3');
  });

  it('H4: a start with fewer than 2 neighbors that can be entered', () => {
    const walledIn = all(AROUND_19_3, 'm');
    expect(brokenRules(island(walledIn), [WEST, EAST])).toContain('H4');
    // One gap in the wall is not enough, two are.
    expect(brokenRules(island({ ...walledIn, '20,3': 'g' }), [WEST, EAST])).toContain('H4');
    expect(brokenRules(island({ ...walledIn, '20,3': 'g', '18,3': 'g' }), [WEST, EAST])).not.toContain('H4');
  });

  it('H5: a start on a piece of land with fewer than RULES.minStartLandmass walkable tiles', () => {
    // The example is drawn for a minimum of 12 tiles.
    expect(RULES.minStartLandmass).toBe(12);
    // A strait two tiles wide (columns 3 and 4) leaves a western island of 2 x 5 = 10 tiles.
    const strait = all([...column(3), ...column(4)], '~');
    const onSmallIsland = at(1, 3);
    expect(brokenRules(island(strait), [onSmallIsland, EAST])).toContain('H5');
    // One more tile makes 11: still too small. Two more make 12: enough.
    expect(brokenRules(island({ ...strait, '3,1': 'g' }), [onSmallIsland, EAST])).toContain('H5');
    expect(brokenRules(island({ ...strait, '3,1': 'g', '3,2': 'g' }), [onSmallIsland, EAST])).not.toContain('H5');
    // Mountains cut land off just as water does.
    expect(brokenRules(island(all(column(3), 'm')), [onSmallIsland, EAST])).toContain('H5');
  });

  it('S1: starts closer than RULES.minStartDistance', () => {
    const tooClose = at(3 + RULES.minStartDistance - 1, 3);
    const justEnough = at(3 + RULES.minStartDistance, 3);
    expect(brokenRules(island(), [WEST, tooClose])).toEqual(['S1']);
    expect(brokenRules(island(), [WEST, justEnough])).toEqual([]);
  });

  it('S2: starts that cannot walk to each other', () => {
    expect(brokenRules(island(all(column(11), '~')), [WEST, EAST])).toEqual(['S2']);
    expect(brokenRules(island(all(column(11), 'm')), [WEST, EAST])).toEqual(['S2']);
    // A single gap in the mountains joins the two halves again.
    expect(brokenRules(island({ ...all(column(11), 'm'), '11,3': 'h' }), [WEST, EAST])).toEqual([]);
  });

  it('S3: a start whose land is worth less than 70% of the best start', () => {
    // WEST has 19 open grassland tiles within two steps. Mountains yield
    // nothing, so with 5 of them nearby EAST keeps 14 / 19 = 74% of WEST's
    // score (fair), and with 6 only 13 / 19 = 68% (not fair).
    const twoStepsFromEast = ring(EAST, 2, island()).map((tile) => `${tile % 24},${Math.floor(tile / 24)}`);
    expect(twoStepsFromEast).toHaveLength(12);
    const fiveMountains = island(all(twoStepsFromEast.slice(0, 5), 'm'));
    const sixMountains = island(all(twoStepsFromEast.slice(0, 6), 'm'));
    expect(startScore(fiveMountains, EAST) * 19).toBe(startScore(fiveMountains, WEST) * 14);
    expect(brokenRules(fiveMountains, [WEST, EAST])).toEqual([]);
    expect(startScore(sixMountains, EAST) * 19).toBe(startScore(sixMountains, WEST) * 13);
    expect(brokenRules(sixMountains, [WEST, EAST])).toEqual(['S3']);
  });

  it('S3: the score is food + production of the workable tiles within two steps, water included', () => {
    const worth = (terrain: TerrainId): number => {
      const yields = tileYields({ terrain, feature: null });
      return yields.food + yields.production;
    };
    // In the middle of the island: 19 grassland tiles.
    expect(startScore(island(), WEST)).toBe(19 * worth('grassland'));
    // A mountain cannot be worked and counts nothing; desert counts as desert.
    expect(startScore(island({ '4,3': 'm' }), WEST)).toBe(18 * worth('grassland'));
    expect(startScore(island({ '4,3': 'd' }), WEST)).toBe(18 * worth('grassland') + worth('desert'));
    // A feature's yields replace the ground's.
    const forest = tileYields({ terrain: 'grassland', feature: 'forest' });
    expect(startScore(island({ '4,3': 'f' }), WEST)).toBe(18 * worth('grassland') + forest.food + forest.production);
    // In the corner of the island part of the 19 tiles are sea (drawn as ocean on this map).
    const map = island();
    const corner = at(1, 1);
    const seaTiles = tilesInRange(corner, 2, map).filter((tile) => map.tiles[tile].terrain === 'ocean').length;
    const landTiles = tilesInRange(corner, 2, map).length - seaTiles;
    expect(seaTiles).toBeGreaterThan(0);
    expect(startScore(map, corner)).toBe(landTiles * worth('grassland') + seaTiles * worth('ocean'));
  });
});

// ---------------------------------------------------------------------------
// The sweep: every rule on 4800 generated maps
// ---------------------------------------------------------------------------

/** What the sweep found. Filled once, before the tests below run. */
const sweep = {
  /** How many maps were generated and checked. */
  cases: 0,
  /** How many of them were not crowded (so S1-S3 applied). */
  uncrowdedCases: 0,
  /** Cases in which generateMap threw. */
  threw: [] as string[],
  /** For every rule: the cases that broke it. */
  broken: { H1: [], H2: [], H3: [], H4: [], H5: [], S1: [], S2: [], S3: [] } as Record<RuleName, string[]>,
  /** For every "size/players" combination: one entry per map (see `measure`). */
  measured: new Map<string, Measurement[]>(),
};

/** Numbers about one placement, kept for the tests about crowded maps and about seat order. */
interface Measurement {
  smallestDistance: number;
  landmassesUsed: number;
  /** Lowest start score divided by the highest. */
  fairness: number;
  /** Is seat 1's start worth more / less than seat 2's? (0 for a tie or a single player.) */
  seatOneAdvantage: number;
  /** Does seat 1's start come before seat 2's in tile order? */
  seatOneFirstOnMap: boolean;
}

function measure(placement: Placement): Measurement {
  const { map, starts, areaOf } = placement;
  const scores = starts.map((start) => startScore(map, start));
  return {
    smallestDistance: smallestDistance(placement),
    landmassesUsed: new Set(starts.map((start) => areaOf[start])).size,
    fairness: Math.min(...scores) / Math.max(...scores),
    seatOneAdvantage: starts.length < 2 ? 0 : Math.sign(scores[0] - scores[1]),
    seatOneFirstOnMap: starts.length >= 2 && starts[0] < starts[1],
  };
}

/** The measurements of one combination, for example measuredFor('small', 8). */
function measuredFor(mapSize: MapSizeId, playerCount: number): Measurement[] {
  return sweep.measured.get(`${mapSize}/${playerCount}`) ?? [];
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

beforeAll(() => {
  for (const mapSize of MAP_SIZE_IDS) {
    for (let playerCount = 1; playerCount <= RULES.maxSeats; playerCount++) {
      const crowded = playerCount > MAP_SIZES[mapSize].recommendedPlayers;
      const measurements: Measurement[] = [];
      for (let i = 0; i < SEEDS_PER_SIZE; i++) {
        const seed = `start-${i}`;
        const label = `seed '${seed}', ${mapSize}, ${playerCount} players`;
        sweep.cases++;
        let placement: Placement;
        try {
          const { map, starts } = generateMap(seed, mapSize, playerCount);
          placement = examine(map, starts, playerCount);
        } catch {
          sweep.threw.push(label);
          continue;
        }
        for (const name of Object.keys(HARD_RULES) as (keyof typeof HARD_RULES)[]) {
          const problem = HARD_RULES[name](placement);
          if (problem !== null) sweep.broken[name].push(`${label}: ${problem}`);
        }
        if (!crowded) {
          sweep.uncrowdedCases++;
          for (const name of Object.keys(STANDARD_RULES) as (keyof typeof STANDARD_RULES)[]) {
            const problem = STANDARD_RULES[name](placement);
            if (problem !== null) sweep.broken[name].push(`${label}: ${problem}`);
          }
        }
        measurements.push(measure(placement));
      }
      sweep.measured.set(`${mapSize}/${playerCount}`, measurements);
    }
  }
}, 600_000);

describe('generateMap: start positions on 200 seeds x every map size x 1 to RULES.maxSeats players', () => {
  it('covered every combination', () => {
    expect(RULES.maxSeats).toBe(8);
    expect(sweep.cases).toBe(SEEDS_PER_SIZE * MAP_SIZE_IDS.length * RULES.maxSeats);
    // Not crowded: 1-3 players on small, 1-5 on medium, 1-8 on large.
    const uncrowdedCombinations = MAP_SIZE_IDS.reduce(
      (sum, mapSize) => sum + Math.min(MAP_SIZES[mapSize].recommendedPlayers, RULES.maxSeats),
      0,
    );
    expect(sweep.uncrowdedCases).toBe(SEEDS_PER_SIZE * uncrowdedCombinations);
  });

  it('never throws for valid input, even 8 players on the small map', () => {
    expect(sweep.threw).toEqual([]);
    expect(measuredFor('small', RULES.maxSeats)).toHaveLength(SEEDS_PER_SIZE);
  });

  // Hard rules H1-H5: every map size, 1 to RULES.maxSeats players.
  it('H1: returns exactly playerCount distinct start tiles, for 1 to RULES.maxSeats players, on every map size', () => {
    expect(sweep.broken.H1).toEqual([]);
  });

  it('H2: puts every start on a legal, enterable city site (tileAllowsCity, tileMoveCost not null)', () => {
    expect(sweep.broken.H2).toEqual([]);
  });

  it('H3: keeps any two starts at least RULES.minCityDistance apart, even with 8 players on the small map', () => {
    expect(sweep.broken.H3).toEqual([]);
  });

  it('H4: gives every start at least 2 neighbors that land units can enter', () => {
    expect(sweep.broken.H4).toEqual([]);
  });

  it('H5: gives every start at least RULES.minStartLandmass walkable tiles (flood fill over tileMoveCost)', () => {
    expect(sweep.broken.H5).toEqual([]);
  });

  // Standard rules S1-S3: only for playerCount <= MAP_SIZES[size].recommendedPlayers.
  it('S1: keeps starts at least RULES.minStartDistance apart when the map is not crowded', () => {
    expect(sweep.broken.S1).toEqual([]);
  });

  it('S2: puts all starts on one landmass (walkable from one to another) when the map is not crowded', () => {
    expect(sweep.broken.S2).toEqual([]);
  });

  it('S3: fairness when the map is not crowded: the lowest start score (food + production of workable tiles within 2) is at least 70% of the highest', () => {
    expect(sweep.broken.S3).toEqual([]);
  });
});

describe('generateMap: what the starts are like beyond the rules', () => {
  it('spreads few players far over a big map instead of settling for the minimum distance', () => {
    // Two players on the large map: on average more than twice the minimum apart.
    const distances = measuredFor('large', 2).map((m) => m.smallestDistance);
    expect(average(distances)).toBeGreaterThanOrEqual(2 * RULES.minStartDistance);
  });

  it('usually gives better than the 70% fairness the rules demand', () => {
    for (const mapSize of MAP_SIZE_IDS) {
      const fairness = measuredFor(mapSize, MAP_SIZES[mapSize].recommendedPlayers).map((m) => m.fairness);
      expect(average(fairness), mapSize).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('still keeps the standard rules on most maps with one player more than recommended', () => {
    // S1-S3 are only aims on a crowded map, but a map that is barely crowded should rarely miss them.
    for (const mapSize of MAP_SIZE_IDS) {
      const playerCount = MAP_SIZES[mapSize].recommendedPlayers + 1;
      if (playerCount > RULES.maxSeats) continue;
      const measurements = measuredFor(mapSize, playerCount);
      const allKept = measurements.filter(
        (m) => m.smallestDistance >= RULES.minStartDistance && m.landmassesUsed === 1 && m.fairness >= 0.7,
      );
      expect(allKept.length / measurements.length, `${mapSize}, ${playerCount} players`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('on the most crowded map (8 players, small) keeps the starts well above the hard minimum distance on average', () => {
    const distances = measuredFor('small', RULES.maxSeats).map((m) => m.smallestDistance);
    expect(Math.min(...distances)).toBeGreaterThanOrEqual(RULES.minCityDistance);
    expect(average(distances)).toBeGreaterThanOrEqual(RULES.minCityDistance + 2);
  });

  it('shuffles the starts, so seat 1 has no systematic advantage', () => {
    // Over all two-player maps: seat 1 has the better start about as often
    // as seat 2, and its tile comes first on the map about half the time.
    const twoPlayers = MAP_SIZE_IDS.flatMap((mapSize) => measuredFor(mapSize, 2));
    expect(twoPlayers).toHaveLength(SEEDS_PER_SIZE * MAP_SIZE_IDS.length);

    const seatOneBetter = twoPlayers.filter((m) => m.seatOneAdvantage > 0).length;
    const seatTwoBetter = twoPlayers.filter((m) => m.seatOneAdvantage < 0).length;
    const shareBetter = seatOneBetter / (seatOneBetter + seatTwoBetter);
    expect(shareBetter).toBeGreaterThan(0.4);
    expect(shareBetter).toBeLessThan(0.6);

    const shareFirstOnMap = twoPlayers.filter((m) => m.seatOneFirstOnMap).length / twoPlayers.length;
    expect(shareFirstOnMap).toBeGreaterThan(0.4);
    expect(shareFirstOnMap).toBeLessThan(0.6);
  });
});
