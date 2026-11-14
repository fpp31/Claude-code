/**
 * Map generation (work package WP1).
 *
 * WP1 owns this folder (packages/shared/src/mapgen/) and may add more files
 * to it (noise, land shaping, start placement...). Only `generateMap` and
 * `GeneratedMap` are used by the rest of the code.
 */

import type { MapSizeId } from '../data/rules';
import type { GameMap, TileIndex } from '../types';

export interface GeneratedMap {
  /** The finished map. Every tile has `cityId: null`. */
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
 *
 * Start positions
 *  Exactly `playerCount` tiles are returned, for any playerCount from 1 to
 *  RULES.maxSeats, on every map size.
 *
 *  HARD RULES. They hold for every result, however crowded the map (the
 *  rules engine, the client and the end-to-end test rely on them):
 *   H1. The starts are distinct tiles.
 *   H2. Every start is a legal city site for its ground (`tileAllowsCity`)
 *       and can be entered by land units (`tileMoveCost` is not null).
 *   H3. Any two starts are at least RULES.minCityDistance tiles apart, so
 *       every player can found a capital on the start tile on turn 1.
 *   H4. Every start has at least 2 neighbors that land units can enter.
 *   H5. From every start a land unit can walk to at least
 *       RULES.minStartLandmass tiles (the start itself included).
 *
 *  STANDARD RULES. They hold whenever playerCount is at most
 *  MAP_SIZES[mapSize].recommendedPlayers:
 *   S1. Any two starts are at least RULES.minStartDistance tiles apart.
 *   S2. All starts are on one landmass (a land unit can walk from any start
 *       to any other).
 *   S3. Fairness. The score of a start is the sum of food + production
 *       (`tileYields`) over the workable tiles within 2 tiles of it, the
 *       start included. The lowest score is at least 70% of the highest.
 *
 *  On a crowded map (more players than recommended) S1-S3 become aims: keep
 *  the smallest distance between two starts as large as the land allows,
 *  prefer one landmass, prefer similar scores, in that order of importance.
 *
 *  How the promises are kept: check the rules after placing the starts; if
 *  they do not hold, generate again from the next attempt stream (see
 *  Determinism). With 35-45% land this succeeds within a few attempts. Give
 *  up with a thrown Error after 100 attempts: that would be a bug in the
 *  generator, and the tests run enough seeds to show it never happens.
 *
 *  The order of `starts` is shuffled with the map RNG, so seat 1 has no
 *  systematic advantage.
 *
 * Invalid input (unknown mapSize, playerCount < 1 or > RULES.maxSeats, empty
 * seed) is a programming error: throw an Error with a clear message.
 */
export function generateMap(seed: string, mapSize: MapSizeId, playerCount: number): GeneratedMap {
  throw new Error('not implemented: generateMap');
}
