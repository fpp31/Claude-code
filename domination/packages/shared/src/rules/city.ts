/**
 * City rules (work package WP2): founding checks, the city economy and the
 * build menu.
 */

import type { RuleErrorCode } from '../actions';
import type { UnitTypeId } from '../data/units';
import type { BuildItem, City, GameState, TileIndex, Unit } from '../types';
import type { BuildOption, ProductionBlock } from '../viewTypes';

/** What a city produces in one turn. Derived from the state every time; never stored. */
export interface CityEconomy {
  /** Tiles worked by citizens, ascending. The city centre is always worked on top of these and is not listed. */
  worked: TileIndex[];
  /** Total food per turn (centre + worked tiles), before citizens eat. */
  food: number;
  /** Total production per turn (centre + worked tiles). */
  production: number;
  /** food - RULES.foodPerCitizen * population. May be negative. */
  foodSurplus: number;
}

/**
 * May this unit found a city on the tile it stands on, right now? Returns
 * null if yes, otherwise the first reason in this order:
 *  1. 'cannotFoundCity'  UNITS[unit.type].canFoundCity is false;
 *  2. 'noMovesLeft'      the unit has 0 moves left;
 *  3. 'badCityTile'      tileAllowsCity(tile) is false (water, mountains, forest);
 *  4. 'tileOwned'        the tile belongs to a city of ANOTHER player
 *                        (founding inside your own territory is allowed);
 *  5. 'tooCloseToCity'   some city (anyone's, your own included) is closer
 *                        than RULES.minCityDistance, i.e. at hex distance
 *                        <= minCityDistance - 1.
 *
 * Fog note: every fact used here is visible to the unit's owner (its own
 * tile, and cities within minCityDistance - 1 <= settler sight; a table test
 * guards that inequality), so the answer gives nothing hidden away. That is
 * why it may be shown in the view (OwnUnitDetail.foundCityError).
 */
export function foundCityError(state: GameState, unit: Unit): RuleErrorCode | null {
  throw new Error('not implemented: foundCityError');
}

/**
 * Assigns the city's citizens automatically and adds up the yields.
 *
 *  - The city centre is worked for free (it does not use a citizen) and
 *    yields at least RULES.cityCenterMinYields in each of food and
 *    production: max(tile yield, minimum).
 *  - Candidates for citizens: tiles whose `cityId` is this city, except the
 *    centre, that are workable (tileIsWorkable). Units standing on a tile do
 *    not matter in phase 1.
 *  - `population` citizens each take the best remaining candidate, ranked by
 *    (1) food + production, higher first; (2) food, higher first; (3) lower
 *    tile index. Citizens left over when the candidates run out work nothing.
 *  - food/production = centre + sum of tileYields of the worked tiles.
 *
 * Pure and deterministic.
 */
export function cityEconomy(state: GameState, city: City): CityEconomy {
  throw new Error('not implemented: cityEconomy');
}

/** Production needed for an item. Phase 1: UNITS[item.unitType].cost. */
export function buildCost(item: BuildItem): number {
  throw new Error('not implemented: buildCost');
}

/**
 * The city's build menu for the view: one entry per unit type in
 * UNIT_TYPE_IDS order (every unit type is always available in phase 1).
 * `turns` = how many turn resolutions until the stored production reaches the
 * cost at the city's current production per turn:
 * max(1, ceil((cost - productionStored) / production)), or null if the city
 * makes 0 production. It ignores the population requirement of settlers
 * (OwnCityDetail.productionBlocked reports that separately).
 */
export function buildOptions(state: GameState, city: City): BuildOption[] {
  throw new Error('not implemented: buildOptions');
}

/**
 * Where a unit completed by this city appears, or null if there is no room
 * (the city then keeps its stored production and tries again next turn).
 *
 * A tile has room if canEnterTile allows a unit of this type and owner to
 * stand there. Candidates in order: the city tile; then the tiles owned by
 * this city (`cityId`), nearest to the centre first, ties by lower tile index.
 */
export function findSpawnTile(state: GameState, city: City, unitType: UnitTypeId): TileIndex | null {
  throw new Error('not implemented: findSpawnTile');
}

/**
 * What, other than production, keeps this city from completing its current
 * item right now; null if nothing does (and null when nothing is chosen).
 * Checked in this order:
 *  - 'needsPopulation': the item's populationCost would leave the city with
 *    fewer than 1 citizen (population - populationCost < 1: a Settler in a
 *    population-1 city);
 *  - 'noRoom': findSpawnTile(state, city, unitType) is null.
 * It does not look at productionStored.
 *
 * ONE implementation for two users, so they can never disagree:
 *  - resolveTurn (step 1c) completes an item only if this returns null;
 *  - buildPlayerView puts it into OwnCityDetail.productionBlocked, so the
 *    city panel can say why a full progress bar is not turning into a unit.
 *
 * Fog note: it reads only the city's own population and what stands on the
 * city's own tiles, all of which the owner sees, so showing it leaks nothing.
 */
export function productionBlocked(state: GameState, city: City): ProductionBlock | null {
  throw new Error('not implemented: productionBlocked');
}
