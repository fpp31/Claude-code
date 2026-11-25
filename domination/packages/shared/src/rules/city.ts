/**
 * City rules (work package WP2): founding checks, the city economy, one turn
 * of a city, and the forecast of its build queue and build menu.
 *
 * Since round 3 also: the two ways a city places its citizens ("Grow first"
 * and "Build first", economyOnLand), where a finished boat appears
 * (findSpawnTile, boatTilesInOrder), and what a city can never build
 * (buildItemError: a boat without water in the city's land).
 */

import type { RuleErrorCode } from '../actions';
import type { CityFocusId } from '../data/cityFocus';
import { RULES, foodToGrow } from '../data/rules';
import { tileAllowsCity, tileIsWorkable, tileMoveCost, tileYields } from '../data/terrain';
import type { Ground, Yields } from '../data/terrain';
import { UNITS, UNIT_TYPE_IDS } from '../data/units';
import type { UnitTypeId } from '../data/units';
import { distance, neighbors } from '../hex';
import type { BuildItem, City, GameMap, GameState, TileIndex, Unit } from '../types';
import type { BuildOption, BuildWait, ProductionBlock, QueueEntryView } from '../viewTypes';
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
 * What the tile under a city gives that city each turn: the tile's own
 * yields (tileYields), but never less than RULES.cityCenterMinYields in
 * food and in production. The centre is worked for free.
 *
 * ONE implementation for two users: cityEconomy (turn resolution and the
 * city panel) and the client's tile information (game/tileInfo.ts), which
 * calls it for any tile a city stands on as far as the viewer knows. It
 * needs only the ground, which every player who has seen the tile knows,
 * and a public table, so showing the result gives nothing away. (A city's
 * tile never carries an improvement, so there is no bonus to count here.)
 */
export function cityCenterYields(ground: Ground): Yields {
  const own = tileYields(ground);
  return {
    food: Math.max(own.food, RULES.cityCenterMinYields.food),
    production: Math.max(own.production, RULES.cityCenterMinYields.production),
  };
}

/** A tile a citizen could work, with what it yields. */
interface WorkTile {
  tile: TileIndex;
  yields: Yields;
}

/** The part of a city's economy that does not depend on how many citizens it has. */
interface CityLand {
  /** What the centre gives (cityCenterYields). */
  center: Yields;
  /**
   * Every other tile of the city a citizen could work, best first for a
   * city that GROWS: (1) food + production, higher first; (2) food, higher
   * first; (3) lower tile index.
   */
  candidates: WorkTile[];
  /**
   * The same tiles, best first for a city that BUILDS: (1) production,
   * higher first; (2) food, higher first; (3) lower tile index.
   */
  forBuild: WorkTile[];
}

/** Reads a city's land from the state: ONE walk over the map's tiles. */
function cityLand(state: GameState, city: City): CityLand {
  const tiles = state.map.tiles;
  const candidates = tilesOfCity(state, city.id)
    .filter((tile) => tile !== city.tile && tileIsWorkable(tiles[tile]))
    .map((tile): WorkTile => ({ tile, yields: tileYields(tiles[tile]) }));
  candidates.sort((a, b) => {
    const totalA = a.yields.food + a.yields.production;
    const totalB = b.yields.food + b.yields.production;
    if (totalA !== totalB) return totalB - totalA;
    if (a.yields.food !== b.yields.food) return b.yields.food - a.yields.food;
    return a.tile - b.tile;
  });
  const forBuild = [...candidates].sort((a, b) => {
    if (a.yields.production !== b.yields.production) return b.yields.production - a.yields.production;
    if (a.yields.food !== b.yields.food) return b.yields.food - a.yields.food;
    return a.tile - b.tile;
  });
  return { center: cityCenterYields(tiles[city.tile]), candidates, forBuild };
}

/** What `population` citizens make of this land under this focus. Arithmetic only: no look at the state. */
function economyOnLand(land: CityLand, population: number, focus: CityFocusId): CityEconomy {
  // One tile per citizen; citizens left over when the tiles run out work nothing.
  const count = Math.max(0, Math.min(population, land.candidates.length));
  const eaten = RULES.foodPerCitizen * population;

  // BUILD: the tiles with the most production, and nothing is given up for food.
  if (focus === 'build') return economyOf(land, land.forBuild.slice(0, count), eaten);

  // GROW (and anything that is not 'build': a city whose field was lost by
  // hand behaves as every city did before round 3). 1. The best tiles first.
  const firstChoice = land.candidates.slice(0, count);

  // 2. A city that could grow must grow: while it would not, a citizen
  //    moves from the tile with the least food to the spare tile with the
  //    most. Every swap raises the food, so this ends.
  const chosen = [...firstChoice];
  const spare = land.candidates.slice(count);
  let food = foodOn(land, chosen);
  while (food - eaten < RULES.minFoodSurplus) {
    const out = leastFood(chosen);
    const into = mostFood(spare);
    if (out === -1 || into === -1 || spare[into].yields.food <= chosen[out].yields.food) break;
    food += spare[into].yields.food - chosen[out].yields.food;
    const given = chosen[out];
    chosen[out] = spare[into];
    spare[into] = given;
  }

  // 3. The swaps have ended with the most food this many citizens can find.
  //    If the city still cannot grow, they bought nothing: the first choice stands.
  const surplus = food - eaten;
  const cannotGrow = surplus < RULES.minFoodSurplus && surplus <= 0;
  return economyOf(land, cannotGrow ? firstChoice : chosen, eaten);
}

/** The food of the centre and of these worked tiles together. */
function foodOn(land: CityLand, worked: readonly WorkTile[]): number {
  let food = land.center.food;
  for (const tile of worked) food += tile.yields.food;
  return food;
}

/** Adds up what the centre and these worked tiles give a city whose citizens eat `eaten`. */
function economyOf(land: CityLand, worked: readonly WorkTile[], eaten: number): CityEconomy {
  const food = foodOn(land, worked);
  let production = land.center.production;
  for (const tile of worked) production += tile.yields.production;
  return {
    worked: worked.map((tile) => tile.tile).sort((a, b) => a - b),
    food,
    production,
    foodSurplus: food - eaten,
  };
}

/** Index of the tile with the least food (ties: the lower food + production, then the HIGHER tile index); -1 for an empty list. */
function leastFood(tiles: readonly WorkTile[]): number {
  let least = -1;
  for (let index = 0; index < tiles.length; index++) {
    if (least === -1) {
      least = index;
      continue;
    }
    const a = tiles[index];
    const b = tiles[least];
    const totalA = a.yields.food + a.yields.production;
    const totalB = b.yields.food + b.yields.production;
    if (a.yields.food !== b.yields.food) {
      if (a.yields.food < b.yields.food) least = index;
    } else if (totalA !== totalB) {
      if (totalA < totalB) least = index;
    } else if (a.tile > b.tile) {
      least = index;
    }
  }
  return least;
}

/** Index of the tile with the most food (ties: the higher food + production, then the LOWER tile index); -1 for an empty list. */
function mostFood(tiles: readonly WorkTile[]): number {
  let most = -1;
  for (let index = 0; index < tiles.length; index++) {
    if (most === -1) {
      most = index;
      continue;
    }
    const a = tiles[index];
    const b = tiles[most];
    const totalA = a.yields.food + a.yields.production;
    const totalB = b.yields.food + b.yields.production;
    if (a.yields.food !== b.yields.food) {
      if (a.yields.food > b.yields.food) most = index;
    } else if (totalA !== totalB) {
      if (totalA > totalB) most = index;
    } else if (a.tile < b.tile) {
      most = index;
    }
  }
  return most;
}

/**
 * Assigns the city's citizens automatically and adds up the yields. ONE
 * function for turn resolution, the view and the forecast (buildPlan calls
 * the same arithmetic, economyOnLand, for every population it passes
 * through), so the three can never disagree about a city's focus.
 *
 *  - The city centre is worked for free (it does not use a citizen) and
 *    yields cityCenterYields, under both ways of placing citizens.
 *  - Candidates for citizens: tiles whose `cityId` is this city, except the
 *    centre, that are workable (tileIsWorkable). Units standing on a tile do
 *    not matter. An improvement counts (tileYields).
 *
 * A city whose focus is 'build' ("Build first", City.focus):
 *  - `population` citizens each take the best remaining candidate, ranked
 *    by (1) production, higher first; (2) food, higher first; (3) lower
 *    tile index. Nothing else: no second step, no look at the surplus, which
 *    may be 0 or negative. Build costs growth and nothing else: the food
 *    store never falls below 0 and a shortage never removes a citizen
 *    (runCityTurn), so such a city grows when its production tiles happen
 *    to feed it and otherwise stands still.
 *
 * Every other city ("Grow first"; also a city whose focus is neither of the
 * two, which the health check names), the three steps cities have always
 * taken:
 *  - 1. `population` citizens each take the best remaining candidate, ranked
 *    by (1) food + production, higher first; (2) food, higher first;
 *    (3) lower tile index. Citizens left over when the candidates run out
 *    work nothing.
 *  - 2. Then, while the food surplus is below RULES.minFoodSurplus: the
 *    chosen tile with the least food (ties: the lower food + production,
 *    then the higher tile index) is given up for the candidate not chosen
 *    with the most food (ties: the higher food + production, then the lower
 *    tile index), provided the newcomer has strictly more food. This stops
 *    when the surplus is reached or no such swap is left. So a city never
 *    stands still over a mine, a hill or plains while it owns food that
 *    nobody works. (Without it a mined hill, 0 food and 5 production, would
 *    be taken before every unimproved tile, and could stop a city growing
 *    for good.)
 *  - 3. When no swap is left and the city still cannot grow (the surplus is
 *    below RULES.minFoodSurplus and not above 0), no placement of its
 *    citizens lets it grow: the swaps of step 2 would give production away
 *    for food that changes nothing. The citizens then keep the choice of
 *    step 1. Every city comes to this point when it has outgrown the food of
 *    its land. Its food store then runs empty if the first choice eats more
 *    than it makes, and stays empty; that costs nothing today, because a
 *    shortage never removes a citizen (runCityTurn). LOOK AT THIS RULE AGAIN
 *    on the day a hungry city can lose citizens: from then on the first
 *    choice would starve a city that the swaps could have kept fed, and a
 *    city on Build, which never looks at its surplus, would starve first.
 *
 * For both: food/production = centre + sum of tileYields of the worked
 * tiles; RULES.minFoodSurplus is read under Grow only.
 *
 * It reads `city.id`, `city.tile`, `city.population` and `city.focus` and
 * nothing else of the city, so the forecast may pass a scratch copy.
 *
 * Pure and deterministic.
 */
export function cityEconomy(state: GameState, city: City): CityEconomy {
  return economyOnLand(cityLand(state, city), city.population, city.focus);
}

/** Production needed for an item. Phase 1: UNITS[item.unitType].cost. */
export function buildCost(item: BuildItem): number {
  return UNITS[item.unitType].cost;
}

/**
 * Where a unit completed by this city appears, or null if there is no room
 * (the city then keeps its stored production and tries again next turn).
 *
 * A tile has room if canEnterTile allows a unit of this type and owner to
 * stand there. The first candidate with room is the answer:
 *  1. the city tile. (Land units. Never a boat: a city stands on land.)
 *  2. A LAND unit, otherwise: the tiles owned by this city (`cityId`) that
 *     are joined to the city tile by the city's own land (joinedByOwnLand),
 *     nearest to the centre first, ties by LOWER tile index.
 *  3. A SEA unit: the city's own tiles a sea unit can enter, in the order
 *     of boatTilesInOrder: the tile whose body of water is LARGER first,
 *     then the tile nearer to the city tile, then the HIGHER tile index.
 *     There is no "joined" condition: a boat does not walk from the city.
 *
 * Why "joined" on land: a city by the sea may own land on the far side of a
 * channel. A unit that appeared there would stand where no land unit could
 * have walked to, and could never come back. Such a tile is no room; when
 * everything nearer is full the city waits.
 *
 * Why the larger body of water first: the player has no say in where a
 * boat appears. A city that owns water of the sea and of a lake would, by
 * "nearest first" alone, put every boat into the lake whenever the lake's
 * tile is nearer, and a Scout Boat born there could never leave.
 *
 * Why the HIGHER tile among equals, unlike on land: the lower tile index is
 * the tile further up the map, and a city's name plate lies on the two
 * tiles above the city. With the higher tile first, half as many first
 * boats stand under the plate.
 *
 * Fog note: WHETHER some candidate has room depends on the city's own tiles
 * and the units on them, which the owner always sees. WHICH free water tile
 * is taken also depends on the size of bodies of water on the true map,
 * part of which the owner may never have seen: an accepted public fact
 * about ground (see the list in protocol.ts). A view never holds the tile
 * before the boat exists.
 *
 * @param boatTiles  the answer of boatTilesInOrder(state, city), for a
 *                   caller that asks for several unit types of one city
 *                   (buildPlan): the order is worked out once. Left out, it
 *                   is worked out here.
 */
export function findSpawnTile(state: GameState, city: City, unitType: UnitTypeId, boatTiles?: readonly TileIndex[]): TileIndex | null {
  const board = boardFromState(state);
  const newcomer = { owner: city.owner, type: unitType };
  if (canEnterTile(board, newcomer, city.tile) === null) return city.tile; // never for a boat: a city stands on land

  let candidates: readonly TileIndex[];
  if (UNITS[unitType].domain === 'land') {
    // A land unit must be able to walk back to the city over the city's own land. Nearest first, the lower tile among equals.
    const map = state.map;
    const others = tilesOfCity(state, city.id).filter((tile) => tile !== city.tile);
    const near = (a: TileIndex, b: TileIndex): number => distance(city.tile, a, map) - distance(city.tile, b, map);
    const joined = joinedByOwnLand(map, city.tile, others);
    candidates = others.filter((tile) => joined.has(tile)).sort((a, b) => near(a, b) || a - b);
  } else {
    candidates = boatTiles ?? boatTilesInOrder(state, city);
  }
  for (const tile of candidates) if (canEnterTile(board, newcomer, tile) === null) return tile;
  return null;
}

/**
 * The water tiles a city owns, in the order its boats take them: the larger
 * body of water first, then the nearer tile, then the HIGHER tile. Ground
 * only: no look at units, so one answer serves every boat type.
 *
 * The sizes of the bodies are counted only when they can matter: if the
 * city's water tiles all hang together among themselves (each can be
 * reached from the first by steps between neighbors over the city's OWN
 * water tiles) they are one body, and the order is "nearer, then higher"
 * without a flood of the map. That is so for nearly every city, and a flood
 * for every view of every city made a view several times as dear.
 */
function boatTilesInOrder(state: GameState, city: City): TileIndex[] {
  const map = state.map;
  const water = tilesOfCity(state, city.id).filter((tile) => tileMoveCost(map.tiles[tile], 'sea') !== null);
  const near = (a: TileIndex, b: TileIndex): number => distance(city.tile, a, map) - distance(city.tile, b, map);
  if (inOnePiece(map, water)) return water.sort((a, b) => near(a, b) || b - a);
  const size = waterBodySizes(map, water);
  return water.sort((a, b) => (size.get(b) ?? 0) - (size.get(a) ?? 0) || near(a, b) || b - a);
}

/** Do these tiles hang together: can each be reached from the first by steps between neighbors over the tiles of the list alone? True for none and for one. */
function inOnePiece(map: GameMap, tiles: readonly TileIndex[]): boolean {
  if (tiles.length <= 1) return true;
  const wanted = new Set(tiles);
  const seen = new Set<TileIndex>([tiles[0]]);
  const queue: TileIndex[] = [tiles[0]];
  for (let next = 0; next < queue.length; next++) {
    for (const tile of neighbors(queue[next], map)) {
      if (!wanted.has(tile) || seen.has(tile)) continue;
      seen.add(tile);
      queue.push(tile);
    }
  }
  return seen.size === tiles.length;
}

/**
 * For each of `tiles` (water tiles): the number of tiles of its body of
 * water, that is, of the tiles a sea unit could reach from it over the
 * ground alone (units and owners ignored), on the whole map. One flood per
 * body: a tile of a body that was flooded for an earlier tile takes its
 * size.
 */
function waterBodySizes(map: GameMap, tiles: readonly TileIndex[]): Map<TileIndex, number> {
  const sizes = new Map<TileIndex, number>();
  const wanted = new Set(tiles);
  for (const from of tiles) {
    if (sizes.has(from)) continue;
    const seen = new Set<TileIndex>([from]);
    const queue: TileIndex[] = [from];
    for (let next = 0; next < queue.length; next++) {
      for (const tile of neighbors(queue[next], map)) {
        if (seen.has(tile) || tileMoveCost(map.tiles[tile], 'sea') === null) continue;
        seen.add(tile);
        queue.push(tile);
      }
    }
    for (const tile of seen) if (wanted.has(tile)) sizes.set(tile, seen.size);
  }
  return sizes;
}

/**
 * Can this city build this item at all, as its land is? null if yes,
 * otherwise the reason: 'noWaterForBoat' for a sea unit in a city that owns
 * no tile a sea unit can enter. A lasting answer, not "is there a free tile
 * right now" (that is findSpawnTile, and a city without one waits): a tile
 * gets its city when the city is founded and never changes it, and ground
 * never changes. Units are not looked at. A land unit always gets null.
 *
 * setBuildQueue refuses a queue that holds an item with such an error.
 */
export function buildItemError(state: GameState, city: City, item: BuildItem): RuleErrorCode | null {
  return itemErrorOnTiles(state.map, tilesOfCity(state, city.id), item);
}

/**
 * THE one implementation, for both users: setBuildQueue (through
 * buildItemError) refuses a queue with such an entry, and buildPlan marks
 * the option of its menu (BuildOption.addError) by calling this with the
 * city's tiles, which it has at hand. A new kind of "this city can never
 * build that" (a building with a need of its own) is added HERE and
 * nowhere else.
 */
function itemErrorOnTiles(map: GameMap, cityTiles: readonly TileIndex[], item: BuildItem): RuleErrorCode | null {
  if (UNITS[item.unitType].domain !== 'sea') return null; // the city's own tile is land
  return cityTiles.some((tile) => tileMoveCost(map.tiles[tile], 'sea') !== null) ? null : 'noWaterForBoat';
}

/**
 * The tiles of `land` (a city's tiles) that a land unit could walk to from
 * `from` (the city tile) without leaving `land`, as far as the ground goes:
 * units in the way are ignored (they move on; water does not).
 *
 * The walk stays on the city's own land on purpose. The answer ends up in
 * the owner's view (OwnCityDetail.held and the forecast of buildPlan), and
 * a view may depend only on what its player sees: a city's tiles are always in its owner's sight, the land
 * beyond them need not be. (It also keeps the walk short: a city has at
 * most 19 tiles.) Land that is joined to the city only by a way around
 * outside its borders therefore counts as not joined.
 */
function joinedByOwnLand(map: GameMap, from: TileIndex, land: readonly TileIndex[]): Set<TileIndex> {
  const notReached = new Set(land.filter((tile) => tileMoveCost(map.tiles[tile], 'land') !== null));
  const reached = new Set<TileIndex>();
  const queue: TileIndex[] = [from];
  for (let next = 0; next < queue.length; next++) {
    for (const tile of neighbors(queue[next], map)) {
      if (!notReached.delete(tile)) continue; // not the city's, not walkable, or reached before
      reached.add(tile);
      queue.push(tile);
    }
  }
  return reached;
}

/** What one turn did to a city (runCityTurn). */
export interface CityTurn {
  /** The city gained a citizen. */
  grew: boolean;
  /**
   * The entry that was completed (it has left the queue), with the tile the
   * new unit appears on; null if nothing was completed.
   */
  completed: { unitType: UnitTypeId; tile: TileIndex } | null;
}

/** The answer to "can the city let a paid-for unit of this type go?": a tile for it, or the reason why not. */
type Release = { block: null; tile: TileIndex } | { block: ProductionBlock; tile: null };

/** First the citizen (population - populationCost >= 1), then the tile (spawnTile). */
function releaseOf(population: number, unitType: UnitTypeId, spawnTile: (unitType: UnitTypeId) => TileIndex | null): Release {
  if (population - UNITS[unitType].populationCost < 1) return { block: 'needsPopulation', tile: null };
  const tile = spawnTile(unitType);
  return tile === null ? { block: 'noRoom', tile: null } : { block: null, tile };
}

/**
 * One turn of ONE city, as far as the city itself goes: steps 1b and 1c of
 * resolveTurn (rules/turn.ts has the wording). EDITS `city`.
 *
 * ONE implementation for two users, so they can never disagree:
 *  - resolveTurn calls it on its working copy of the state and then creates
 *    the unit and the events;
 *  - buildPlan calls it on a scratch copy of the city, turn after turn, to
 *    forecast when each entry of the queue will be completed.
 *
 * @param economy    cityEconomy of the city as it is BEFORE this turn
 * @param spawnTile  where a unit of this type completed by the city would
 *                   appear, or null (findSpawnTile). Asked only for a first
 *                   entry that is paid for and that the population allows.
 */
export function runCityTurn(
  city: City,
  economy: CityEconomy,
  spawnTile: (unitType: UnitTypeId) => TileIndex | null,
): CityTurn {
  // 1b. Food. A shortage empties the store but never removes a citizen.
  let grew = false;
  city.foodStored = Math.max(0, city.foodStored + economy.foodSurplus);
  const needed = foodToGrow(city.population);
  if (city.foodStored >= needed) {
    city.foodStored -= needed;
    city.population += 1;
    grew = true;
  }

  // 1c. Production. An empty queue: this turn's production is lost.
  const first = city.buildQueue[0];
  if (first === undefined) return { grew, completed: null };
  city.productionStored += economy.production;
  const cost = buildCost(first);
  if (city.productionStored < cost) return { grew, completed: null };

  // Paid for. The entry stays first and the city waits (keeping what it
  // stored) while it lacks the citizen the item takes or a free tile for the
  // new unit. No later entry is looked at.
  const release = releaseOf(city.population, first.unitType, spawnTile);
  if (release.block !== null) return { grew, completed: null };

  city.productionStored -= cost;
  city.population -= UNITS[first.unitType].populationCost;
  city.buildQueue.shift(); // the completed entry leaves the queue
  return { grew, completed: { unitType: first.unitType, tile: release.tile } };
}

/** A city's economy, build queue and build menu as its owner sees them. */
export interface BuildPlan {
  /** cityEconomy(state, city): handed out so that the view reads the city's land only once. */
  economy: CityEconomy;
  queue: QueueEntryView[];
  options: BuildOption[];
  /** See OwnCityDetail.held. */
  held: ProductionBlock | null;
}

/**
 * The rows of the city's build queue and the entries of its build menu, with
 * a FORECAST of when each will be completed. The city is played forward on
 * a scratch copy with runCityTurn, the function turn resolution uses, one
 * turn at a time, for at most RULES.forecastTurns turns. So growth is
 * counted (a Settler in a young city gets a real number), and the panel can
 * never promise what the engine does not do.
 *
 * What happens OUTSIDE the city is not guessed: its land, its improvements
 * and the units standing on its tiles are taken as they are now, and units
 * completed in the forecast take up no room in it.
 *
 * The city's focus stays as it is for all turns of the forecast, like its
 * land. The menu has one option per unit type, always; an item the city
 * can never build (itemErrorOnTiles: a boat in a city without water) gets
 * no forecast, `wait: 'noRoom'` and that reason as its `addError`.
 *
 * Cost: one walk over the map for the city's land; at most one
 * findSpawnTile per unit type, and the order of the city's water tiles
 * (boatTilesInOrder) at most once for both boat types; the rest is
 * arithmetic (the economy is worked out once per population the forecast
 * passes through).
 *
 * Every `item` in the result is a fresh object with exactly `kind` and
 * `unitType` (the view's allow-list rule). `state` and `city` are not changed.
 *
 * Fog note: it reads the city's own queue, stores, population and land, and
 * what stands on the city's own tiles (findSpawnTile), all of which the
 * owner sees. It is only ever put into the owner's view.
 */
export function buildPlan(state: GameState, city: City): BuildPlan {
  const land = cityLand(state, city);
  const economies = new Map<number, CityEconomy>();
  const economyAt = (population: number): CityEconomy => {
    let economy = economies.get(population);
    if (economy === undefined) {
      economy = economyOnLand(land, population, city.focus);
      economies.set(population, economy);
    }
    return economy;
  };
  const tiles = new Map<UnitTypeId, TileIndex | null>();
  let boatTiles: TileIndex[] | undefined;
  const spawnTile = (unitType: UnitTypeId): TileIndex | null => {
    let tile = tiles.get(unitType);
    if (tile === undefined) {
      if (UNITS[unitType].domain === 'sea') boatTiles ??= boatTilesInOrder(state, city);
      tile = findSpawnTile(state, city, unitType, boatTiles);
      tiles.set(unitType, tile);
    }
    return tile;
  };

  /** Why the first entry of `scratch` was not completed when the forecast ended. */
  const whyNot = (scratch: City): BuildWait => {
    const first = scratch.buildQueue[0];
    if (scratch.productionStored >= buildCost(first)) {
      return releaseOf(scratch.population, first.unitType, spawnTile).block ?? 'tooFar';
    }
    return economyAt(scratch.population).production <= 0 ? 'noProduction' : 'tooFar';
  };

  // The queue: play the city forward until the queue has run out or the forecast ends.
  const scratch: City = { ...city, buildQueue: city.buildQueue.map((entry): BuildItem => ({ kind: 'unit', unitType: entry.unitType })) };
  const doneIn: number[] = [];
  let turn = 0;
  while (scratch.buildQueue.length > 0 && turn < RULES.forecastTurns) {
    turn += 1;
    if (runCityTurn(scratch, economyAt(scratch.population), spawnTile).completed !== null) doneIn.push(turn);
  }
  const stuck = scratch.buildQueue.length > 0 ? whyNot(scratch) : null;
  const queue = city.buildQueue.map((entry, index): QueueEntryView => {
    const item: BuildItem = { kind: 'unit', unitType: entry.unitType };
    const cost = buildCost(item);
    if (index < doneIn.length) return { item, cost, turns: doneIn[index], wait: null };
    return { item, cost, turns: null, wait: index === doneIn.length ? stuck : 'earlier' };
  });

  // The menu: each option as if it were added at the end. The forecast goes
  // on from where the queue ran out, on a copy of its own for every option.
  const full = city.buildQueue.length >= RULES.maxQueueLength;
  const cityTiles = tilesOfCity(state, city.id);
  const options = UNIT_TYPE_IDS.map((unitType): BuildOption => {
    const item: BuildItem = { kind: 'unit', unitType };
    const cost = buildCost(item);
    // An item this city can never build (a boat in a city without water): never, whatever the queue holds.
    const never = itemErrorOnTiles(state.map, cityTiles, item);
    if (never !== null) return { item, cost, turns: null, wait: 'noRoom', addError: never };
    const addError: RuleErrorCode | null = full ? 'queueFull' : null;
    if (stuck !== null) return { item, cost, turns: null, wait: 'earlier', addError };
    const trial: City = { ...scratch, buildQueue: [{ kind: 'unit', unitType }] };
    let at = turn;
    while (at < RULES.forecastTurns) {
      at += 1;
      if (runCityTurn(trial, economyAt(trial.population), spawnTile).completed !== null) {
        return { item, cost, turns: at, wait: null, addError };
      }
    }
    return { item, cost, turns: null, wait: whyNot(trial), addError };
  });

  // Is the first entry paid for and held, as the city is now?
  const first = city.buildQueue[0];
  const held =
    first !== undefined && city.productionStored >= buildCost(first)
      ? releaseOf(city.population, first.unitType, spawnTile).block
      : null;

  return { economy: economyAt(city.population), queue, options, held };
}
