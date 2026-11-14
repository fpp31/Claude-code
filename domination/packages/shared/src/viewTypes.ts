/**
 * The per-player view: everything one player is allowed to know, and nothing
 * else. This is the ONLY game data a client ever receives.
 *
 * It is "render ready": numbers a panel prints (food per turn, turns left...)
 * are already computed by the server, so the client needs no rule maths
 * except the reachable-tile highlight (rules/movement.ts).
 *
 * What a view contains:
 *  - terrain and feature of every tile the player has ever seen;
 *  - on tiles in sight now: the current owner, units and cities;
 *  - on tiles seen before but not in sight: the owner and city as LAST SEEN;
 *  - the player's own units and cities in full;
 *  - other players' units only while they stand on tiles in sight, public fields only;
 *  - other players' cities: public fields only (id, owner, name, tile, population);
 *  - the public player list.
 *
 * What a view never contains: anything about never-seen tiles, units on tiles
 * out of sight, other players' moves left / food / production / worked tiles,
 * which city owns a foreign tile, other players' knowledge, seeds, RNG states.
 */

import type { RuleErrorCode } from './actions';
import type { CivId } from './data/civs';
import type { FeatureId, TerrainId } from './data/terrain';
import type { UnitTypeId } from './data/units';
import type { BuildItem, CityId, PlayerId, TileIndex, UnitId } from './types';

export interface TileView {
  terrain: TerrainId;
  feature: FeatureId | null;
  /** Owner of the tile: current if `visible`, otherwise as last seen. null = unowned (as far as the player knows). */
  owner: PlayerId | null;
  /** True if the tile is in sight right now; false = remembered ("fogged"). */
  visible: boolean;
}

/** Extra facts about one of the viewer's own units. */
export interface OwnUnitDetail {
  movesLeft: number;
  /**
   * Why this unit cannot found a city where it stands right now, or null if
   * it can (the Found City button is offered when this is null).
   * Units that are not settlers always carry 'cannotFoundCity'.
   *
   * It is about the unit and the tile only. Whether the player may give any
   * order at this moment is a separate question: after End Turn this can
   * still be null, and a foundCity action is then answered
   * 'turnAlreadyEnded'.
   */
  foundCityError: RuleErrorCode | null;
}

export interface UnitView {
  id: UnitId;
  type: UnitTypeId;
  owner: PlayerId;
  tile: TileIndex;
  /** Present for the viewer's own units, null for everybody else's. */
  own: OwnUnitDetail | null;
}

/** One entry of a city's build menu. */
export interface BuildOption {
  item: BuildItem;
  /** Production needed in total. */
  cost: number;
  /** Turns until done if chosen now (counting what is already stored); null if the city makes no production. */
  turns: number | null;
}

/**
 * Why a city cannot complete its current item even with enough production
 * stored: 'needsPopulation' = the item takes a citizen and the city would be
 * left with none (a Settler in a population-1 city); 'noRoom' = no free tile
 * for the new unit. See productionBlocked in rules/city.ts.
 */
export type ProductionBlock = 'needsPopulation' | 'noRoom';

/** Extra facts about one of the viewer's own cities. Every number the city panel prints. */
export interface OwnCityDetail {
  foodStored: number;
  /** Stored food needed to grow by one. */
  foodToGrow: number;
  /** Food surplus per turn after citizens have eaten. May be negative (stored food then shrinks, the city does not). */
  foodPerTurn: number;
  production: BuildItem | null;
  productionStored: number;
  /** Cost of the current item; null if nothing is chosen. */
  productionCost: number | null;
  productionPerTurn: number;
  /**
   * Turns until the current item is paid for; null if nothing is chosen or
   * the city makes no production. Never less than 1: an item that is already
   * paid for appears when the turn resolves. It is the `turns` of the item's
   * entry in `buildOptions`, and it ignores `productionBlocked`.
   */
  turnsLeft: number | null;
  /**
   * Set while something other than production keeps the current item from
   * being completed (the city panel then explains the wait instead of showing
   * a full bar that never turns into a unit); null otherwise, and null when
   * nothing is chosen. It is independent of `productionStored` and of
   * `turnsLeft`, which ignores it.
   */
  productionBlocked: ProductionBlock | null;
  /**
   * Tiles worked by citizens (the city centre is always worked and is not
   * listed). Ascending. The client marks them on the map while the city is
   * selected (MapOverlay.workedTiles in client/src/render/api.ts).
   */
  worked: TileIndex[];
  /** Everything the city could build, in UNIT_TYPE_IDS order. */
  buildOptions: BuildOption[];
}

export interface CityView {
  id: CityId;
  owner: PlayerId;
  name: string;
  tile: TileIndex;
  /** Current if `visible`, otherwise as last seen (may be out of date). */
  population: number;
  /** True if the city's tile is in sight right now; false = remembered. */
  visible: boolean;
  /** Present for the viewer's own cities, null for everybody else's. */
  own: OwnCityDetail | null;
}

/** What every player may know about every player. */
export interface PlayerPublic {
  id: PlayerId;
  name: string;
  civ: CivId;
  endedTurn: boolean;
}

export interface PlayerView {
  /** The player this view was built for. */
  you: PlayerId;
  turn: number;
  /** Map size in tiles. */
  width: number;
  height: number;
  /** Row by row, length width * height. null = never seen. */
  tiles: (TileView | null)[];
  /** The viewer's units plus other players' units on tiles in sight. Sorted by id, so the order tells nothing. */
  units: UnitView[];
  /** The viewer's cities, cities in sight and remembered cities. Sorted by id. */
  cities: CityView[];
  /** All players, in seat order. */
  players: PlayerPublic[];
}

/**
 * The difference between two views of the same player, as sent in a
 * `gameUpdate` message. A section is present only if it changed, and then it
 * replaces the old section whole; `tiles` lists only the tiles that changed.
 * See view/patch.ts.
 */
export interface ViewPatch {
  turn?: number;
  players?: PlayerPublic[];
  units?: UnitView[];
  cities?: CityView[];
  tiles?: [tile: TileIndex, view: TileView | null][];
}
