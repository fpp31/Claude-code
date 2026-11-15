/**
 * Balance constants and map sizes. All numbers the group may want to tune live
 * here or in the other files of this folder; rules code must read them from
 * the tables and never hard-code a number.
 *
 * Changing a number changes the rules of running games too (the tables are
 * code, not part of the save). Never remove or rename an id that saved games
 * may contain without writing a save migration.
 */

import { CIV_IDS } from './civs';
import type { Yields } from './terrain';
import type { UnitTypeId } from './units';

export type MapSizeId = 'small' | 'medium' | 'large';

export interface MapSizeDef {
  /** Name shown to players. */
  name: string;
  /** Tiles per row. */
  width: number;
  /** Number of rows. */
  height: number;
  /**
   * Shown in the lobby as a hint ("best for up to N players"). It is NOT
   * enforced: the host may start a crowded map, the generator copes.
   */
  recommendedPlayers: number;
}

/** All map size ids, smallest first. */
export const MAP_SIZE_IDS: readonly MapSizeId[] = ['small', 'medium', 'large'];

export const MAP_SIZES: Record<MapSizeId, MapSizeDef> = {
  small:  { name: 'Small',  width: 32, height: 20, recommendedPlayers: 3 },
  medium: { name: 'Medium', width: 44, height: 28, recommendedPlayers: 5 },
  large:  { name: 'Large',  width: 56, height: 36, recommendedPlayers: 8 },
};

export interface RulesTable {
  /** Seats a game is designed for. See `maxPlayers()` for the limit that applies today. */
  maxSeats: number;
  /** Longest allowed player name, in characters. */
  maxNameLength: number;
  /** Units every player starts with, all on the start tile, created in this order. */
  startingUnits: UnitTypeId[];
  /**
   * The map generator keeps start positions at least this far apart whenever
   * the game has no more players than the map size recommends. On a crowded
   * map they may be closer, but never closer than minCityDistance.
   */
  minStartDistance: number;
  /**
   * Every start position has at least this many land tiles a land unit can
   * walk to (the start tile included), so nobody begins on a rock in the sea.
   */
  minStartLandmass: number;
  /** Longest path (in steps) a single move action may carry. */
  maxPathLength: number;
  /** A new city needs every existing city to be at least this many tiles away. */
  minCityDistance: number;
  /** Founding a city claims every unowned tile within this distance. */
  cityClaimRadius: number;
  /** A player sees all tiles their cities own, plus this many rings around them. */
  territorySightMargin: number;
  /** The city's own tile is worked for free and yields at least this much. */
  cityCenterMinYields: Yields;
  /** Food each citizen eats per turn. */
  foodPerCitizen: number;
  /** Stored food needed to grow from population 1 to 2. */
  growthBase: number;
  /** Extra stored food needed for each further population point. */
  growthPerPopulation: number;
  /**
   * The most entries a city's build queue may hold. An action that asks for
   * more is refused ('queueFull').
   *
   * NEVER LOWER THIS NUMBER while games are running without writing a save
   * migration that shortens the queues: a queue longer than the limit could
   * not be shortened one entry at a time (every such edit would itself be
   * too long and be refused); only "Empty the queue" would still work.
   * Raising it is always safe, up to the 64 entries the server's message
   * check lets through (server/src/parseMessage.ts).
   */
  maxQueueLength: number;
  /**
   * How many turns ahead a city's forecast looks (buildPlan in
   * rules/city.ts): the "in N turns" of the city panel is never larger than
   * this, and an entry that would take longer says so in words. It also
   * bounds the work of building a view.
   */
  forecastTurns: number;
  /**
   * Citizens give up production for food until the city's food surplus per
   * turn is at least this much, as far as its land allows (cityEconomy,
   * step 2). 1 = a city that could grow does grow. A city that cannot grow
   * whatever its citizens do gives up nothing (cityEconomy, step 3).
   */
  minFoodSurplus: number;
}

export const RULES: RulesTable = {
  maxSeats: 8,
  maxNameLength: 20,
  startingUnits: ['settler', 'warrior'],
  minStartDistance: 8,
  minStartLandmass: 12,
  maxPathLength: 32,
  minCityDistance: 4,
  cityClaimRadius: 2,
  territorySightMargin: 1,
  cityCenterMinYields: { food: 2, production: 1 },
  foodPerCitizen: 2,
  growthBase: 10,
  growthPerPopulation: 6,
  maxQueueLength: 8,
  forecastTurns: 50,
  minFoodSurplus: 1,
};

/**
 * How many players can join one game today. Civilizations are unique per game,
 * so this is the smaller of the seat count and the number of civilizations
 * (6 in phase 1). Adding two civilizations to the table lifts it to 8.
 */
export function maxPlayers(): number {
  return Math.min(RULES.maxSeats, CIV_IDS.length);
}

/**
 * Stored food a city of the given population needs before it grows by one:
 * growthBase + growthPerPopulation * (population - 1).
 */
export function foodToGrow(population: number): number {
  return RULES.growthBase + RULES.growthPerPopulation * (population - 1);
}
