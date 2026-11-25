import { beforeAll, describe, expect, it } from 'vitest';
import { CIV_IDS } from '../src/data/civs';
import { improvementFits } from '../src/data/improvements';
import { MAP_SIZES, MAP_SIZE_IDS, RULES } from '../src/data/rules';
import type { MapSizeId } from '../src/data/rules';
import { tileAllowsCity, tileIsWater, tileIsWorkable, tileMoveCost, tileYields } from '../src/data/terrain';
import type { TerrainId } from '../src/data/terrain';
import { UNITS } from '../src/data/units';
import { distance, isValidTile, neighbors, ring, tilesInRange } from '../src/hex';
import { playerIdForSeat } from '../src/ids';
import { attemptStreams, generateForSize } from '../src/mapgen/attempts';
import type { MapDimensions } from '../src/mapgen/attempts';
import { buildMap } from '../src/mapgen/buildMap';
import { generateMap } from '../src/mapgen/generateMap';
import type { MapGenerator } from '../src/mapgen/generateMap';
import { gridFor } from '../src/mapgen/grid';
import { MAPGEN } from '../src/mapgen/tuning';
import { applyAction } from '../src/rules/applyAction';
import { createGame } from '../src/rules/createGame';
import { mapFromAscii } from '../src/testing/asciiMap';
import type { GameMap, GameState, TileIndex } from '../src/types';

/**
 * Tests of generateMap (work package WP1): the START POSITIONS it returns.
 *
 * The doc comment of generateMap promises the hard rules H1-H7 for every
 * result and the standard rules S1-S3 whenever the map is not crowded.
 * This file
 *
 *  1. writes each rule down as a small check that knows nothing about how
 *     the generator works (it only uses hex.ts and the tables of terrain
 *     and improvements);
 *  2. shows on hand-drawn maps that each check really notices a broken rule;
 *  3. runs all checks on 200 seeds x 3 map sizes x 1..8 players = 4800
 *     generated maps (the "sweep");
 *  4. looks at what a crowded map must still give every player: land to
 *     grow on (nobody alone on a small island);
 *  5. looks at the sea and the hill of every start (rules H6 and H7, round
 *     3) from three more sides: which tiles the generator turned into
 *     hills (every map is compared with the land its first attempt makes
 *     before the starts are chosen), whether one body of water joins all
 *     the starts, and what the capitals own once they are really founded,
 *     in either order.
 *
 * The sweep is by far the slowest test of the shared package: 15 to 30
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
  /**
   * waterOf[tile]: the number of the body of water the tile lies in, or -1
   * for land. Two water tiles have the same number exactly if a boat can
   * sail from one to the other.
   */
  waterOf: number[];
  /** waterSizes[body]: how many tiles the body of water has. */
  waterSizes: number[];
  /**
   * The number of THE SEA: the largest body of water of the map, and of two
   * bodies of one size the one that holds the lower tile. -1 on a map
   * without water.
   */
  sea: number;
}

/** A rule check: null if the rule holds, otherwise a few words about what is wrong. */
type RuleCheck = (placement: Placement) => string | null;

function canEnter(map: GameMap, tile: TileIndex): boolean {
  return tileMoveCost(map.tiles[tile], 'land') !== null;
}

/** Can a boat enter this tile? */
function canSail(map: GameMap, tile: TileIndex): boolean {
  return tileMoveCost(map.tiles[tile], 'sea') !== null;
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

/**
 * Groups the tiles for which `isMember` is true by flood fill: two members
 * are in one group if one can be reached from the other by stepping from
 * member to member. Groups are numbered in the order their first tile
 * appears on the map.
 */
function groupsOf(map: GameMap, isMember: (tile: TileIndex) => boolean): { groupOf: number[]; sizes: number[] } {
  const table = neighborsOf(map);
  const groupOf: number[] = new Array(map.tiles.length).fill(-1);
  const sizes: number[] = [];
  for (let first = 0; first < map.tiles.length; first++) {
    if (!isMember(first) || groupOf[first] !== -1) continue;
    const group = sizes.length;
    let size = 0;
    const todo = [first];
    groupOf[first] = group;
    while (todo.length > 0) {
      const tile = todo.pop() as TileIndex;
      size++;
      for (const next of table[tile]) {
        if (isMember(next) && groupOf[next] === -1) {
          groupOf[next] = group;
          todo.push(next);
        }
      }
    }
    sizes.push(size);
  }
  return { groupOf, sizes };
}

/** Works out the walkable areas and the bodies of water of a map by flood fill over tileMoveCost. */
function examine(map: GameMap, starts: TileIndex[], playerCount: number): Placement {
  const land = groupsOf(map, (tile) => canEnter(map, tile));
  const water = groupsOf(map, (tile) => canSail(map, tile));
  // The largest body; the first of them in tile order if two are of one size.
  let sea = -1;
  water.sizes.forEach((size, body) => {
    if (sea === -1 || size > water.sizes[sea]) sea = body;
  });
  return { map, starts, playerCount, areaOf: land.groupOf, areaSizes: land.sizes, waterOf: water.groupOf, waterSizes: water.sizes, sea };
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

/**
 * The land a capital founded on `start` is sure to own, whoever founds
 * first: the tiles within two of the start, itself not counted, that are
 * within two of no other start.
 */
function sureLandOf(map: GameMap, starts: readonly TileIndex[], start: TileIndex): TileIndex[] {
  return tilesInRange(start, 2, map).filter(
    (tile) => tile !== start && starts.every((other) => other === start || distance(other, tile, map) > 2),
  );
}

/**
 * The tiles among `land` that a land unit can walk to from `from` without
 * stepping on a tile that is not in `land` (`from` itself is not counted).
 */
function walkedTo(map: GameMap, land: readonly TileIndex[], from: TileIndex): TileIndex[] {
  const table = neighborsOf(map);
  const allowed = new Set(land);
  const reached = new Set<TileIndex>();
  const todo = [from];
  while (todo.length > 0) {
    const tile = todo.pop() as TileIndex;
    for (const next of table[tile]) {
      if (next !== from && allowed.has(next) && !reached.has(next) && canEnter(map, next)) {
        reached.add(next);
        todo.push(next);
      }
    }
  }
  return [...reached];
}

/** The tiles for a Mine that a land unit can walk to from the start over the land the start is sure to own. */
function mineSitesInReach(map: GameMap, starts: readonly TileIndex[], start: TileIndex): TileIndex[] {
  return walkedTo(map, sureLandOf(map, starts, start), start).filter((tile) => improvementFits('mine', map.tiles[tile]));
}

/** The coast tiles of body of water `body` inside the land the start is sure to own. */
function coastOwned({ map, starts, waterOf }: Placement, start: TileIndex, body: number): TileIndex[] {
  return sureLandOf(map, starts, start).filter((tile) => body !== -1 && waterOf[tile] === body && map.tiles[tile].terrain === 'coast');
}

/**
 * The two hard rules of round 3, the sea and a hill: like H1-H5 they hold
 * for every result. They are kept in a list of their own because the
 * hand-drawn island of the older checks below has neither coast nor hills.
 */
const START_NEEDS: Record<'H6' | 'H7', RuleCheck> = {
  H6: (placement) => {
    for (const start of placement.starts) {
      const coast = coastOwned(placement, start, placement.sea).length;
      if (coast < MAPGEN.startCoastTiles) return `start ${start} is sure of only ${coast} coast tiles of the sea`;
    }
    return null;
  },
  H7: ({ map, starts }) => {
    for (const start of starts) {
      if (mineSitesInReach(map, starts, start).length === 0) return `start ${start} is sure of no tile for a Mine that a land unit can walk to`;
    }
    return null;
  },
};

type RuleName = keyof typeof HARD_RULES | keyof typeof STANDARD_RULES | keyof typeof START_NEEDS;

/**
 * The bodies of water in which EVERY start is sure of at least
 * MAPGEN.startCoastTiles coast tiles. With one such body a boat can sail
 * from each capital to each other, whichever body is the largest.
 */
function watersSharedByAll(placement: Placement): number[] {
  const shared: number[] = [];
  for (let body = 0; body < placement.waterSizes.length; body++) {
    if (placement.starts.every((start) => coastOwned(placement, start, body).length >= MAPGEN.startCoastTiles)) shared.push(body);
  }
  return shared;
}

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

/** The names of the two rules of round 3 (H6, H7) that the placement breaks. */
function brokenNeeds(map: GameMap, starts: TileIndex[]): RuleName[] {
  const placement = examine(map, starts, starts.length);
  return (Object.keys(START_NEEDS) as (keyof typeof START_NEEDS)[]).filter((name) => START_NEEDS[name](placement) !== null);
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

  /**
   * Three coast tiles of the sea, two steps west of WEST: (1, 3) touches the
   * open sea around the island, the other two touch (1, 3).
   */
  const SHORE = all(['1,3', '2,2', '2,4'], ',');
  /** The three tiles that lie between WEST and the tile (5, 3) two steps east of it. */
  const BETWEEN = ['4,3', '5,2', '5,4'];

  it('H6 and H7: find nothing wrong with a start that is sure of three coast tiles of the sea and of a hill it can walk to', () => {
    // The examples are drawn for three coast tiles.
    expect(MAPGEN.startCoastTiles).toBe(3);
    const map = island({ ...SHORE, '5,3': 'h' });
    for (const key of [...Object.keys(SHORE), '5,3']) {
      const [x, y] = key.split(',').map(Number);
      expect(distance(WEST, at(x, y), map), key).toBe(2);
    }
    expect(brokenNeeds(map, [WEST])).toEqual([]);
    expect(brokenRules(map, [WEST])).toEqual([]);
    // Hills on plains and on desert carry a Mine as well.
    expect(brokenNeeds(island({ ...SHORE, '5,3': 'H' }), [WEST])).toEqual([]);
    expect(brokenNeeds(island({ ...SHORE, '5,3': 'D' }), [WEST])).toEqual([]);
    // The island as the older checks draw it has neither coast nor hills.
    expect(brokenNeeds(island(), [WEST, EAST])).toEqual(['H6', 'H7']);
  });

  it('H6: fewer than three coast tiles of the sea; open sea, a lake, and coast that another start is as near to do not count', () => {
    const hill = { '2,3': 'h' };
    // Two coast tiles are one too few.
    expect(brokenNeeds(island({ ...all(['1,3', '2,2'], ','), ...hill }), [WEST])).toEqual(['H6']);
    // Open sea in place of the third: ocean is water of the sea, but not coast.
    expect(brokenNeeds(island({ ...SHORE, '2,4': '~', ...hill }), [WEST])).toEqual(['H6']);
    // Three coast tiles of a lake two steps east, shut in by land: not the sea.
    const lake = all(['5,2', '5,3', '5,4'], ',');
    const lakeOnly = examine(island({ ...lake, ...hill }), [WEST], 1);
    expect(lakeOnly.waterSizes).toEqual([58, 3]);
    expect(lakeOnly.sea).toBe(0);
    expect(brokenNeeds(island({ ...lake, ...hill }), [WEST])).toEqual(['H6']);
    expect(brokenNeeds(island({ ...lake, ...SHORE, ...hill }), [WEST])).toEqual([]);

    // An arm of the sea from the north reaches the tile half way between
    // two starts four apart. Alone, WEST is sure of three coast tiles; with
    // the neighbour the tile between them goes to whoever founds first.
    const neighbour = at(7, 3);
    const arm = island({ '1,3': ',', '5,1': ',', '5,2': ',', '5,3': ',', '6,1': ',', '7,1': ',', '8,1': ',', '2,3': 'h', '8,3': 'h' });
    expect(distance(WEST, neighbour, arm)).toBe(RULES.minCityDistance);
    expect(distance(WEST, at(5, 3), arm)).toBe(2);
    expect(distance(neighbour, at(5, 3), arm)).toBe(2);
    expect(brokenNeeds(arm, [WEST])).toEqual([]);
    expect(brokenNeeds(arm, [neighbour])).toEqual([]);
    expect(brokenNeeds(arm, [WEST, neighbour])).toEqual(['H6']);
    // It is WEST that comes up short: the neighbour has three coast tiles to the north.
    expect(START_NEEDS.H6(examine(arm, [WEST, neighbour], 2))).toContain(`start ${WEST} `);
    expect(START_NEEDS.H6(examine(arm, [neighbour, WEST], 2))).toContain(`start ${WEST} `);
  });

  it('H7: no hill; a hill under the city, across water, behind mountains, or as near to another start', () => {
    expect(brokenNeeds(island(SHORE), [WEST])).toEqual(['H7']);
    // The start tile is where the city will stand: no Mine there.
    expect(brokenNeeds(island({ ...SHORE, '3,3': 'h' }), [WEST])).toEqual(['H7']);

    // A hill two steps east with a lake of three tiles between it and the
    // start. A Worker can walk round the lake, but not over the city's land.
    const acrossWater = island({ ...SHORE, '5,3': 'h', ...all(BETWEEN, ',') });
    const examined = examine(acrossWater, [WEST], 1);
    expect(examined.areaOf[at(5, 3)]).toBe(examined.areaOf[WEST]);
    expect(brokenNeeds(acrossWater, [WEST])).toEqual(['H7']);
    // The same behind three mountains; one gap in them is enough.
    expect(brokenNeeds(island({ ...SHORE, '5,3': 'h', ...all(BETWEEN, 'm') }), [WEST])).toEqual(['H7']);
    expect(brokenNeeds(island({ ...SHORE, '5,3': 'h', ...all(BETWEEN, 'm'), '5,2': 'f' }), [WEST])).toEqual([]);

    // A hill half way between two starts four apart is promised to neither.
    const shared = island({ ...SHORE, '5,3': 'h' });
    expect(brokenNeeds(shared, [WEST])).not.toContain('H7');
    expect(brokenNeeds(shared, [WEST, at(7, 3)])).toContain('H7');
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
  broken: { H1: [], H2: [], H3: [], H4: [], H5: [], H6: [], H7: [], S1: [], S2: [], S3: [] } as Record<RuleName, string[]>,
  /** For every "size/players" combination: one entry per map (see `measure`). */
  measured: new Map<string, Measurement[]>(),
  /** How many start tiles the sweep saw. */
  starts: 0,
  /** Cases in which no single body of water gives every start its three coast tiles (see watersSharedByAll). */
  noSharedWater: [] as string[],
  /** Cases whose map is not the land of the seed's FIRST attempt: the generator had to try again. */
  laterAttempts: [] as string[],
  /** Cases in which the map differs from that land by more than a hill by a start (see startHills). */
  hillProblems: [] as string[],
  /** How many tiles the generator turned into hills, over all cases. */
  hillsPut: 0,
};

/** Numbers about one placement, kept for the tests about crowded maps and about seat order. */
interface Measurement {
  smallestDistance: number;
  landmassesUsed: number;
  /** Lowest start score divided by the highest. */
  fairness: number;
  /** Starts on a landmass under MAPGEN.roomyLandmassTiles tiles that not all players share (see playersCutOff). */
  cutOff: number;
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
    cutOff: playersCutOff(placement).length,
    seatOneAdvantage: starts.length < 2 ? 0 : Math.sign(scores[0] - scores[1]),
    seatOneFirstOnMap: starts.length >= 2 && starts[0] < starts[1],
  };
}

/**
 * The starts whose player is cut off on an island too small to grow on: the
 * landmass has fewer than MAPGEN.roomyLandmassTiles walkable tiles, and at
 * least one other player starts somewhere else. (Land units cannot cross
 * water, so such a player never meets the others.)
 */
function playersCutOff({ starts, areaOf, areaSizes }: Placement): TileIndex[] {
  const together = new Set(starts.map((start) => areaOf[start])).size === 1;
  return together ? [] : starts.filter((start) => areaSizes[areaOf[start]] < MAPGEN.roomyLandmassTiles);
}

/**
 * The starts whose player could never found a second city: once every
 * capital stands on its start tile, no tile of the player's own landmass is
 * a legal city site at least RULES.minCityDistance from every capital.
 */
function playersWithoutSecondCity({ map, starts, areaOf }: Placement): TileIndex[] {
  return starts.filter((start) => {
    for (let tile = 0; tile < map.tiles.length; tile++) {
      if (areaOf[tile] !== areaOf[start] || !tileAllowsCity(map.tiles[tile])) continue;
      if (starts.every((capital) => distance(capital, tile, map) >= RULES.minCityDistance)) return false;
    }
    return true;
  });
}

/** firstLand, by 'size/seed': the land is the same for every player count, so it is built once. */
const firstLands = new Map<string, GameMap>();

/**
 * The land the FIRST attempt of a seed makes before any start is chosen:
 * the five terrain steps (buildMap) on the first attempt's random streams.
 */
function firstLand(seed: string, mapSize: MapSizeId): GameMap {
  const key = `${mapSize}/${seed}`;
  let land = firstLands.get(key);
  if (land === undefined) {
    land = buildMap(gridFor(MAP_SIZES[mapSize]), attemptStreams(seed, 1));
    firstLands.set(key, land);
  }
  return land;
}

/**
 * What the generator did to the land after the terrain steps: the tiles
 * that differ between the map it handed out and `before`, and whether each
 * is what rule H7 allows. That is: a tile that was forest or open land and
 * is hills now, on land its start is sure to own and can walk to; at most
 * one for a start, none for a start that had a tile for a Mine in reach
 * already; and no start's score moved by more than 1.
 */
function startHills({ map, starts }: Placement, before: GameMap): { hills: TileIndex[]; problem: string | null } {
  const hills: TileIndex[] = [];
  for (let tile = 0; tile < map.tiles.length; tile++) {
    const now = map.tiles[tile];
    const was = before.tiles[tile];
    if (now.feature === was.feature && now.terrain === was.terrain) continue;
    if (now.terrain !== was.terrain) return { hills, problem: `tile ${tile} was ${was.terrain} and is ${now.terrain}` };
    if (now.feature !== 'hills' || (was.feature !== null && was.feature !== 'forest')) {
      return { hills, problem: `tile ${tile} carried ${was.feature} and carries ${now.feature}` };
    }
    hills.push(tile);
  }
  for (const tile of hills) {
    const near = starts.filter((start) => distance(start, tile, map) <= 2);
    if (near.length !== 1) return { hills, problem: `the new hill on tile ${tile} is within two of ${near.length} starts` };
    if (!mineSitesInReach(map, starts, near[0]).includes(tile)) return { hills, problem: `the new hill on tile ${tile} cannot be walked to from start ${near[0]}` };
  }
  for (const start of starts) {
    const own = hills.filter((tile) => distance(start, tile, map) <= 2);
    if (own.length > 1) return { hills, problem: `start ${start} was given ${own.length} hills` };
    if (own.length === 1 && mineSitesInReach(before, starts, start).length > 0) return { hills, problem: `start ${start} was given a hill it did not need` };
    const change = startScore(map, start) - startScore(before, start);
    if (Math.abs(change) > 1) return { hills, problem: `the score of start ${start} moved by ${change}` };
  }
  return { hills, problem: null };
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
        for (const name of Object.keys(START_NEEDS) as (keyof typeof START_NEEDS)[]) {
          const problem = START_NEEDS[name](placement);
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

        sweep.starts += placement.starts.length;
        if (watersSharedByAll(placement).length === 0) sweep.noSharedWater.push(label);
        // Another attempt draws from other random streams and makes another
        // coastline, so the ground alone tells the first attempt from a later one.
        const before = firstLand(seed, mapSize);
        if (placement.map.tiles.some((tile, index) => tile.terrain !== before.tiles[index].terrain)) {
          sweep.laterAttempts.push(label);
        } else {
          const { hills, problem } = startHills(placement, before);
          sweep.hillsPut += hills.length;
          if (problem !== null) sweep.hillProblems.push(`${label}: ${problem}`);
        }
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

  // The sea and a hill (round 3): hard rules too, counted by START_NEEDS above, not by the generator's own check.
  it('H6 and H7 hold for every start of 200 seeds x 3 sizes x 1 to 8 players', () => {
    expect(sweep.broken.H6).toEqual([]);
    expect(sweep.broken.H7).toEqual([]);
    // 200 x 3 x (1 + 2 + ... + 8) start tiles.
    expect(sweep.starts).toBe(SEEDS_PER_SIZE * MAP_SIZE_IDS.length * 36);
  });

  it('every start\'s coast belongs to one body of water: a boat can sail from each capital to each other', () => {
    expect(sweep.noSharedWater).toEqual([]);
  });

  it('the generator never needs a second attempt on the game\'s own sizes', () => {
    // The doc comment of generateMap says so in words; this is the count.
    expect(sweep.laterAttempts).toEqual([]);
  });

  it('at most one hill is put per player, it is hills in the handed-out map and not in buildMap\'s, and a start\'s score changes by 1 at most', () => {
    expect(sweep.hillProblems).toEqual([]);
    // The sweep really sees such hills: about three starts in four need one (15 978 of 21 600 when this was written).
    expect(sweep.hillsPut).toBeGreaterThan(sweep.starts / 2);
    expect(sweep.hillsPut).toBeLessThan(sweep.starts);
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

// ---------------------------------------------------------------------------
// The sea and the hill in a real game: the capitals are founded
// ---------------------------------------------------------------------------

/** A new game for `playerCount` players. Without `generate` it is played on the map generateMap makes for the seed. */
function newGame(seed: string, mapSize: MapSizeId, playerCount: number, generate?: MapGenerator): GameState {
  const players = [];
  for (let seat = 1; seat <= playerCount; seat++) {
    players.push({ id: playerIdForSeat(seat), name: `Player ${seat}`, civ: CIV_IDS[(seat - 1) % CIV_IDS.length] });
  }
  return createGame({ seed, settings: { mapSize, turnMode: 'simultaneous' }, players }, generate);
}

/**
 * Every player founds a capital where their Settler stands, in the given
 * order of seats (0 is seat 1). Returns the game afterwards.
 */
function foundCapitals(start: GameState, order: readonly number[]): GameState {
  let state = start;
  for (const seat of order) {
    const player = state.players[seat];
    const settler = Object.values(state.units).find((unit) => unit.owner === player.id && UNITS[unit.type].canFoundCity);
    if (settler === undefined) throw new Error(`${player.id} has no Settler`);
    const result = applyAction(state, player.id, state.turn, { type: 'foundCity', unitId: settler.id });
    if (!result.ok) throw new Error(`${player.id} may not found a city: ${result.error.code}`);
    state = result.state;
  }
  return state;
}

/**
 * What the capitals of a game lack of the two things every start promises,
 * counted on what each city really OWNS (tile.cityId): three coast tiles of
 * the sea, and a tile for a Mine that a Worker can walk to from the city
 * over the city's own land. One line per capital that lacks something.
 */
function capitalsInNeed(state: GameState): string[] {
  const { map } = state;
  const examined = examine(map, [], 0);
  const lacking: string[] = [];
  for (const city of Object.values(state.cities)) {
    const own: TileIndex[] = [];
    map.tiles.forEach((tile, index) => {
      if (tile.cityId === city.id) own.push(index);
    });
    const coast = own.filter((tile) => examined.waterOf[tile] === examined.sea && map.tiles[tile].terrain === 'coast').length;
    if (coast < MAPGEN.startCoastTiles) lacking.push(`${city.name} on tile ${city.tile} owns ${coast} coast tiles of the sea`);
    const sites = walkedTo(map, own, city.tile).filter((tile) => improvementFits('mine', map.tiles[tile]));
    if (sites.length === 0) lacking.push(`${city.name} on tile ${city.tile} owns no tile for a Mine that can be walked to`);
  }
  return lacking;
}

/** For every tile: the seat of the player whose city owns it, or -1. Two games can be compared by it (city ids differ). */
function ownerSeats(state: GameState): number[] {
  return state.map.tiles.map((tile) => (tile.cityId === null ? -1 : state.players.findIndex((player) => player.id === state.cities[tile.cityId as string].owner)));
}

describe('generateMap: the sea and a hill, once the capitals are founded', () => {
  it('whoever founds first: after all capitals are founded in seat order and in reverse order, every capital owns three coast tiles of the sea and a tile for a Mine that a Worker can walk to from the city over the city\'s own land', () => {
    // A sample of the sweep: every twentieth seed of every size and player count.
    let games = 0;
    for (const mapSize of MAP_SIZE_IDS) {
      for (let playerCount = 1; playerCount <= RULES.maxSeats; playerCount++) {
        for (let i = 0; i < SEEDS_PER_SIZE; i += 20) {
          const seed = `start-${i}`;
          const start = newGame(seed, mapSize, playerCount);
          const seats = start.players.map((_, seat) => seat);
          for (const order of [seats, [...seats].reverse()]) {
            const founded = foundCapitals(start, order);
            expect(Object.keys(founded.cities)).toHaveLength(playerCount);
            expect(capitalsInNeed(founded), `seed '${seed}', ${mapSize}, ${playerCount} players, seats ${order.join()}`).toEqual([]);
            games++;
          }
        }
      }
    }
    expect(games).toBe(2 * (SEEDS_PER_SIZE / 20) * MAP_SIZE_IDS.length * RULES.maxSeats);
  }, 120_000);

  it('whoever founds first, where it matters: on a map so small that capitals stand four apart, the tiles between them go to the first founder and both capitals still own the sea and a hill', () => {
    // On the game's own sizes no two starts of the sweep are closer than 6,
    // so no tile is within two of two capitals. On this made-up size, with
    // six players, nearly every map has capitals four apart: on 28 of these
    // 30 the order of founding decides who owns a tile.
    const TIGHT: MapDimensions = { width: 16, height: 10, recommendedPlayers: 1 };
    let contested = 0;
    for (let i = 0; i < 30; i++) {
      const seed = `tight-${i}`;
      const generated = generateForSize(seed, TIGHT, 6);
      const start = newGame(seed, 'small', 6, () => generated);
      const seats = start.players.map((_, seat) => seat);
      const inSeatOrder = foundCapitals(start, seats);
      const inReverse = foundCapitals(start, [...seats].reverse());
      expect(capitalsInNeed(inSeatOrder), `seed '${seed}', in seat order`).toEqual([]);
      expect(capitalsInNeed(inReverse), `seed '${seed}', in reverse order`).toEqual([]);
      // A map on which the order of founding decided who owns a tile.
      if (JSON.stringify(ownerSeats(inSeatOrder)) !== JSON.stringify(ownerSeats(inReverse))) contested++;
    }
    // The point of the made-up size: this test really does see tiles change hands.
    expect(contested).toBeGreaterThanOrEqual(20);
  });

  it('the fixed seeds: \'end-to-end-boats\' on the small map gives the starts 178 and 395 for two players and 395 for one', () => {
    // The end-to-end test (e2e/two-players.ts) plays on this seed and knows
    // where things are. A change of the generator that moves them shows
    // here, in a few milliseconds, before it shows there after a minute and a half.
    const two = generateMap('end-to-end-boats', 'small', 2);
    expect(two.starts).toEqual([178, 395]);
    const one = generateMap('end-to-end-boats', 'small', 1);
    expect(one.starts).toEqual([395]);

    // What each capital is sure of there: three coast tiles of the sea, all
    // two steps away, and its tiles for a Mine.
    const placement = examine(two.map, two.starts, 2);
    expect(coastOwned(placement, 178, placement.sea)).toEqual([113, 114, 115]);
    expect(coastOwned(placement, 395, placement.sea)).toEqual([458, 459, 460]);
    expect(mineSitesInReach(two.map, two.starts, 178).sort((a, b) => a - b)).toEqual([148, 179, 180, 212]);
    expect(mineSitesInReach(two.map, two.starts, 395)).toEqual([361]);
    for (const [start, coast] of [[178, 114], [395, 459]]) expect(distance(start, coast, two.map)).toBe(2);
    expect(distance(178, 395, two.map)).toBe(11);
    // The lone player of the same seed has the second player's land.
    const lone = examine(one.map, one.starts, 1);
    expect(coastOwned(lone, 395, lone.sea)).toEqual([458, 459, 460]);
    expect(mineSitesInReach(one.map, one.starts, 395)).toEqual([361]);
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

  it('on a crowded map puts nobody alone on an island too small to grow on (every crowded combination of the sweep)', () => {
    let crowdedMaps = 0;
    for (const mapSize of MAP_SIZE_IDS) {
      for (let playerCount = MAP_SIZES[mapSize].recommendedPlayers + 1; playerCount <= RULES.maxSeats; playerCount++) {
        const measurements = measuredFor(mapSize, playerCount);
        crowdedMaps += measurements.length;
        const cutOff = measurements.filter((m) => m.cutOff > 0).length;
        expect(cutOff, `${mapSize}, ${playerCount} players: maps with a player cut off`).toBe(0);
      }
    }
    // Small with 4 to 8 players and medium with 6 to 8.
    expect(crowdedMaps).toBe(SEEDS_PER_SIZE * 8);
  });

  it('six players on the small map: the seeds that once left players on islands of 12 to 26 tiles now keep everybody on land with room for a second city', () => {
    // Each of these maps has one continent of about 200 tiles and two or
    // three islands; the starts used to be 8 apart with up to three players
    // on the islands. (The first two are from the report of the fault.)
    const seeds = ['121b3f99cd657f21007326e03a53142f', 'wide-1272', 'fix-319', 'fix-1359', 'fix-4122'];
    for (const seed of seeds) {
      const { map, starts } = generateMap(seed, 'small', 6);
      const placement = examine(map, starts, 6);
      for (const name of Object.keys(HARD_RULES) as (keyof typeof HARD_RULES)[]) {
        expect(HARD_RULES[name](placement), `${seed}: ${name}`).toBeNull();
      }
      // The islands are there, and nobody is on them.
      expect(placement.areaSizes.filter((size) => size >= RULES.minStartLandmass && size < MAPGEN.roomyLandmassTiles).length, seed).toBeGreaterThanOrEqual(2);
      expect(playersCutOff(placement), seed).toEqual([]);
      expect(playersWithoutSecondCity(placement), seed).toEqual([]);
      // It cost a single tile of distance.
      expect(smallestDistance(placement), seed).toBe(RULES.minStartDistance - 1);
    }
  });

  it('the checks for "cut off" and "no second city" notice both on a hand-drawn map', () => {
    // A long island and a small one of 15 tiles, 4 columns of sea apart.
    const rows: string[] = [];
    for (let y = 0; y < 7; y++) {
      const row: string[] = [];
      for (let x = 0; x < 24; x++) {
        const land = y >= 1 && y <= 5 && ((x >= 1 && x <= 14) || (x >= 19 && x <= 21));
        row.push(land ? 'g' : '~');
      }
      rows.push(row.join(' '));
    }
    const map = mapFromAscii(rows);
    const onIsland = at(20, 3);
    const split = examine(map, [at(2, 3), at(12, 3), onIsland], 3);
    expect(split.areaSizes).toEqual([70, 15]);
    expect(playersCutOff(split)).toEqual([onIsland]);
    // Between the two capitals on the long island there is room for a third city; on the small one there is none.
    expect(playersWithoutSecondCity(split)).toEqual([onIsland]);

    const together = examine(map, [at(2, 3), at(12, 3)], 2);
    expect(playersCutOff(together)).toEqual([]);
    expect(playersWithoutSecondCity(together)).toEqual([]);
    // Everybody together on the small island is cramped, but nobody is cut off from the others.
    expect(playersCutOff(examine(map, [at(19, 1), at(21, 5)], 2))).toEqual([]);
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
