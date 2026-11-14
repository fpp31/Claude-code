/**
 * City rules (work package WP2): founding checks, the city economy and the
 * build menu.
 */

import type { RuleErrorCode } from '../actions';
import { RULES } from '../data/rules';
import { tileAllowsCity, tileIsWorkable, tileYields } from '../data/terrain';
import { UNITS, UNIT_TYPE_IDS } from '../data/units';
import type { UnitTypeId } from '../data/units';
import { distance } from '../hex';
import type { BuildItem, City, GameState, TileIndex, Unit } from '../types';
import type { BuildOption, ProductionBlock } from '../viewTypes';
import { boardFromState, canEnterTile } from './movement';
import { tileOwner, tilesOfCity } from './stateQueries';

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
  if (!UNITS[unit.type].canFoundCity) return 'cannotFoundCity';
  if (unit.movesLeft <= 0) return 'noMovesLeft';
  if (!tileAllowsCity(state.map.tiles[unit.tile])) return 'badCityTile';

  const owner = tileOwner(state, unit.tile);
  if (owner !== null && owner !== unit.owner) return 'tileOwned';

  for (const city of Object.values(state.cities)) {
    if (distance(city.tile, unit.tile, state.map) < RULES.minCityDistance) return 'tooCloseToCity';
  }
  return null;
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
  const tiles = state.map.tiles;

  // The centre: free, and never worse than the guaranteed minimum.
  const centre = tileYields(tiles[city.tile]);
  let food = Math.max(centre.food, RULES.cityCenterMinYields.food);
  let production = Math.max(centre.production, RULES.cityCenterMinYields.production);

  // Every other tile of the city a citizen could work, best first.
  const candidates = tilesOfCity(state, city.id)
    .filter((tile) => tile !== city.tile && tileIsWorkable(tiles[tile]))
    .map((tile) => ({ tile, yields: tileYields(tiles[tile]) }));
  candidates.sort((a, b) => {
    const totalA = a.yields.food + a.yields.production;
    const totalB = b.yields.food + b.yields.production;
    if (totalA !== totalB) return totalB - totalA;
    if (a.yields.food !== b.yields.food) return b.yields.food - a.yields.food;
    return a.tile - b.tile;
  });

  // One tile per citizen; citizens left over when the tiles run out work nothing.
  const chosen = candidates.slice(0, Math.max(0, city.population));
  for (const candidate of chosen) {
    food += candidate.yields.food;
    production += candidate.yields.production;
  }

  return {
    worked: chosen.map((candidate) => candidate.tile).sort((a, b) => a - b),
    food,
    production,
    foodSurplus: food - RULES.foodPerCitizen * city.population,
  };
}

/** Production needed for an item. Phase 1: UNITS[item.unitType].cost. */
export function buildCost(item: BuildItem): number {
  return UNITS[item.unitType].cost;
}

/**
 * How many turn resolutions until `stored` production reaches `cost` when
 * the city adds `perTurn` each turn: at least 1 (even an item that is paid
 * for only appears when a turn resolves), or null if the city makes no
 * production at all.
 */
function turnsToBuild(cost: number, stored: number, perTurn: number): number | null {
  if (perTurn <= 0) return null;
  return Math.max(1, Math.ceil((cost - stored) / perTurn));
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
  const perTurn = cityEconomy(state, city).production;
  return UNIT_TYPE_IDS.map((unitType) => {
    const item: BuildItem = { kind: 'unit', unitType };
    const cost = buildCost(item);
    return { item, cost, turns: turnsToBuild(cost, city.productionStored, perTurn) };
  });
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
  const board = boardFromState(state);
  const newcomer = { owner: city.owner, type: unitType };

  // The city tile first; then the rest of the city's land, nearest first,
  // equal distances in tile order.
  const others = tilesOfCity(state, city.id)
    .filter((tile) => tile !== city.tile)
    .sort((a, b) => distance(city.tile, a, state.map) - distance(city.tile, b, state.map) || a - b);

  for (const tile of [city.tile, ...others]) {
    if (canEnterTile(board, newcomer, tile) === null) return tile;
  }
  return null;
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
  if (city.production === null) return null;
  const unitType = city.production.unitType;
  if (city.population - UNITS[unitType].populationCost < 1) return 'needsPopulation';
  if (findSpawnTile(state, city, unitType) === null) return 'noRoom';
  return null;
}
