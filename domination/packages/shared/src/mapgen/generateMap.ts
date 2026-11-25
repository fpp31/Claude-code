/**
 * Map generation.
 *
 * Only `generateMap`, `GeneratedMap` and `MapGenerator` are used by the rest
 * of the code; everything else in this folder (packages/shared/src/mapgen/)
 * is the generator's own.
 *
 * The files of this folder, in the order a map is made:
 *   generateMap.ts      this file: the contract, and the check of the input
 *   attempts.ts         makes a map, checks the promises, tries again if needed
 *   buildMap.ts         the terrain of one attempt, in five steps:
 *     land.ts             1. land or sea
 *     ground.ts           2. coast and ocean; desert, plains, grassland
 *     mountains.ts        3. mountain ranges
 *     hillsAndForest.ts   4. hills and forest
 *     passes.ts           5. a way into every valley the mountains sealed off
 *   starts.ts           6. where the players begin
 *   startNeeds.ts       the sea and a hill at every start (rules H6 and H7):
 *                       which sites have the sea in reach, the one hill
 *                       that is put, and both as checks
 *   startRules.ts       the other promises about starts, as checks
 *   tuning.ts           every number that shapes the look of the maps
 *   grid.ts, noise.ts   tools the steps share
 *
 * To look at a map, draw it as text with mapToAscii (testing/asciiMap.ts).
 */

import { MAP_SIZES, MAP_SIZE_IDS, RULES } from '../data/rules';
import type { MapSizeId } from '../data/rules';
import type { GameMap, TileIndex } from '../types';
import { generateForSize } from './attempts';

/** What generateMap returns: a map and where each player starts on it. */
export interface GeneratedMap {
  /**
   * The finished map. Every tile has `cityId: null` and `improvement: null`.
   * It is the land the seed makes, but for the hills by the starts: see
   * "The map" below.
   */
  map: GameMap;
  /**
   * One start tile per player: starts[i] belongs to the i-th player in seat
   * order. See "Start positions" below for what every start is guaranteed
   * to be. (A hand-made generator in a test only has to return distinct,
   * enterable tiles.)
   */
  starts: TileIndex[];
}

/** The shape of generateMap, so tests of createGame can pass in a hand-made map instead. */
export type MapGenerator = (seed: string, mapSize: MapSizeId, playerCount: number) => GeneratedMap;

/**
 * Builds a map and fair start positions from a seed.
 *
 * Determinism
 *  - Pure function: the same arguments always return a deep-equal result, on
 *    every machine. No clock, no built-in random function.
 *  - All randomness comes from `seedRng(seed, stream)` (rng.ts) with stream
 *    names that start with 'map' (for example 'map', 'map:moisture').
 *  - Avoid results that depend on floating-point library differences. Use
 *    only + - * / %, comparisons, and these Math functions, which give the
 *    same answer on every machine: floor, ceil, round, trunc, abs, sign,
 *    min, max, sqrt, imul. Do NOT use sin, cos, tan, exp, log, pow, hypot,
 *    cbrt and friends, nor the ** operator (write x * x). test/purity.test.ts
 *    enforces this for the whole shared package.
 *  - If an attempt cannot satisfy the hard rules for start positions below,
 *    generate again from the next attempt stream: attempt 1 uses the stream
 *    names 'map', 'map:moisture', ...; attempt 2 uses 'map#2',
 *    'map#2:moisture', ...; and so on. The retry is part of the function, so
 *    the result is still a pure function of the arguments.
 *
 * The map
 *  - Size is MAP_SIZES[mapSize] (width x height); `tiles.length` is width * height.
 *  - Ground terrains: ocean, coast, grassland, plains, desert. Features:
 *    forest, hills, mountains; a feature is only placed on a ground listed in
 *    FEATURES[feature].allowedOn, and never on water.
 *  - Every tile on the outer edge of the map is water.
 *  - A water tile is `coast` if at least one of its neighbors is land,
 *    otherwise `ocean`. (So every tile next to land is coast, never ocean.)
 *  - Aim for roughly 35-45% land, mostly in one or a few large landmasses,
 *    with grassland and plains dominant, desert in patches, and forest,
 *    hills and mountains as clusters rather than noise.
 *  - The land is the seed's but for the hills by the starts. The terrain
 *    steps read the seed alone, so asking for more players moves no coast.
 *    Then at most ONE tile per player, within two of that player's start,
 *    is turned into hills (rule H7 below; forest or open land before, never
 *    water or mountains). So the maps of one seed for two and for five
 *    players can differ in up to seven tiles, and such a hill may stand
 *    alone, outside every cluster. (A failed attempt, which is very rare,
 *    makes the whole map another one.)
 *
 * Start positions
 *  Exactly `playerCount` tiles are returned, for any playerCount from 1 to
 *  RULES.maxSeats, on every map size.
 *
 *  HARD RULES. They hold for every result, however crowded the map, for
 *  1 to RULES.maxSeats players (the rules engine, the client and the
 *  end-to-end test rely on them):
 *   H1. The starts are distinct tiles.
 *   H2. Every start is a legal city site for its ground (`tileAllowsCity`)
 *       and can be entered by land units (`tileMoveCost` is not null).
 *   H3. Any two starts are at least RULES.minCityDistance tiles apart, so
 *       every player can found a capital on the start tile on turn 1.
 *   H4. Every start has at least 2 neighbors that land units can enter.
 *   H5. From every start a land unit can walk to at least
 *       RULES.minStartLandmass tiles (the start itself included).
 *   H6. The sea. Inside the land a capital founded on the start is sure to
 *       own there are at least MAPGEN.startCoastTiles (3) coast tiles of
 *       the sea. So every capital can build boats, a Fishing Boat has work
 *       for three nets or more, and a boat can sail from every capital to
 *       every other.
 *   H7. A hill. Inside that land there is at least one tile a Mine fits
 *       (`improvementFits('mine', ...)`: hills on grassland, plains or
 *       desert) that can be walked to: a land unit reaches it from the
 *       start without leaving that land. A hill across a strip of water or
 *       behind mountains keeps no promise, because no Worker reaches it
 *       over the city's own land.
 *
 *  The words of H6 and H7 (startNeeds.ts has them as functions):
 *   - "The sea" is the largest connected body of water of the map, coast
 *     and ocean together; of two bodies of one size, the one that holds
 *     the lower tile. A lake's coast is not coast of the sea.
 *   - "Sure to own": the tiles within two of the start, the start itself
 *     not counted, that are within two of NO other start. A founder claims
 *     what nobody owns yet, so where two starts are four tiles apart (H3
 *     allows it on a crowded map) the tiles between them go to whoever
 *     founds first, and no promise is built on them.
 *   - H7 promises a tile to build on, not a mine in use: whether citizens
 *     gather from a mine is the city's matter (rules/city.ts).
 *
 *  STANDARD RULES. They hold whenever playerCount is at most
 *  MAP_SIZES[mapSize].recommendedPlayers:
 *   S1. Any two starts are at least RULES.minStartDistance tiles apart.
 *   S2. All starts are on one landmass (a land unit can walk from any start
 *       to any other).
 *   S3. Fairness. The score of a start is the sum of food + production
 *       (`tileYields`) over the workable tiles within 2 tiles of it, the
 *       start included. The lowest score is at least 70% of the highest.
 *       (Counted on the map as it is handed out, with the hills of H7. The
 *       score knows nothing of improvements: once everybody fishes, the
 *       players' production differs more than their scores do.)
 *
 *  On a crowded map (more players than recommended) S1-S3 become aims, in
 *  this order of importance:
 *   1. nobody cut off on a small island: a landmass with fewer than
 *      MAPGEN.roomyLandmassTiles walkable tiles gets a start only if every
 *      start is on it, or if the starts fit nowhere else at any distance
 *      rule H3 allows. (A player alone on such an island has no site for a
 *      second city, and land units cannot leave it.)
 *   2. distance: the smallest distance between two starts is as large as
 *      the land allows, up to RULES.minStartDistance (the S1 value; more
 *      than that is not chased at the cost of the next two aims);
 *   3. one landmass for everybody;
 *   4. similar scores.
 *  So six players on the small map nearly always start 8 tiles apart on
 *  one landmass, but their land can differ a good deal in quality. About
 *  one such map in 160 gives way a little: the starts are 7 apart, or 8
 *  apart with one or two players on a second landmass of at least
 *  MAPGEN.roomyLandmassTiles tiles. The lobby shows the recommended player
 *  count for this reason.
 *
 *  How the promises are kept. H6 by choosing the sites: only a tile with
 *  three coast tiles of the sea within two of it is offered as a start
 *  (the sea cannot be put inland). H7 by putting one hill: a start that
 *  has no tile for a Mine it can walk to gets one, on the tile that changes
 *  its score least (forest first; the score moves by 1 at most), after the
 *  starts are chosen, so it moves no start. Then every rule is checked on
 *  the map as it is handed out; if one does not hold, generate again from
 *  the next attempt stream (see Determinism). Give up with a thrown Error
 *  after 100 attempts: with the numbers the game came with that would be a
 *  bug in the generator (the error also names mapgen/tuning.ts, whose
 *  numbers can ask for more than a map can give). In practice
 *  the first attempt succeeds on every map size of the game (a test counts
 *  it over thousands of maps), so the tests reach the retry and the giving
 *  up through `generateForSize` (attempts.ts) with map sizes too small for
 *  their players.
 *
 *  Where the numbers of this section live: the distances are in RULES
 *  (data/rules.ts); the 70% of S3, the 100 attempts and the three coast
 *  tiles of H6 are MAPGEN.fairScorePercent, MAPGEN.maxAttempts and
 *  MAPGEN.startCoastTiles (mapgen/tuning.ts); the "within 2 tiles" of S3,
 *  H6 and H7 is the land a city claims (RULES.cityClaimRadius) and is built
 *  into the generator (a table test says so if the two ever part ways).
 *
 *  The order of `starts` is shuffled with the map RNG, so seat 1 has no
 *  systematic advantage.
 *
 * Invalid input (unknown mapSize, playerCount < 1 or > RULES.maxSeats, empty
 * seed) is a programming error: throw an Error with a clear message.
 */
export function generateMap(seed: string, mapSize: MapSizeId, playerCount: number): GeneratedMap {
  checkInput(seed, mapSize, playerCount);
  return generateForSize(seed, MAP_SIZES[mapSize], playerCount);
}

/** Throws a clear Error for input that can only come from a programming mistake. */
function checkInput(seed: string, mapSize: MapSizeId, playerCount: number): void {
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new Error('generateMap: the seed must be a non-empty string');
  }
  if (!MAP_SIZE_IDS.includes(mapSize)) {
    throw new Error(`generateMap: unknown map size '${String(mapSize)}' (expected one of: ${MAP_SIZE_IDS.join(', ')})`);
  }
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > RULES.maxSeats) {
    throw new Error(`generateMap: playerCount must be a whole number from 1 to ${RULES.maxSeats}, got ${String(playerCount)}`);
  }
}
