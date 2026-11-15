/**
 * The per-player view: everything one player is allowed to know, and nothing
 * else. This is the ONLY game data a client ever receives.
 *
 * It is "render ready": numbers a panel prints (food per turn, turns left...)
 * are already computed by the server. The client needs no rule maths, with
 * two exceptions, both on facts of its own view and both through shared
 * functions: the reachable-tile highlight
 * (`reachableTiles(boardFromView(view), unit)`), and the tile information
 * (`tileYields`, `tileMoveCost`, `tileIsWorkable`, `cityCenterYields`,
 * `improvementSiteError(siteInView(view, tile), id)`). Nothing else is
 * worked out on the client.
 *
 * What a view contains:
 *  - terrain and feature of every tile the player has ever seen;
 *  - on tiles in sight now: the current owner, improvement, units and cities;
 *  - on tiles seen before but not in sight: the owner, improvement and city
 *    as LAST SEEN;
 *  - the player's own units and cities in full;
 *  - other players' units only while they stand on tiles in sight, public fields only;
 *  - other players' cities: public fields only (id, owner, name, tile, population);
 *  - the public player list.
 *
 * What a view never contains: anything about never-seen tiles, units on tiles
 * out of sight, other players' moves left / food / production / worked tiles,
 * build queues, other players' units' jobs, which city owns a foreign tile,
 * other players' knowledge, seeds, RNG states.
 */

import type { RuleErrorCode } from './actions';
import type { CivId } from './data/civs';
import type { ImprovementId } from './data/improvements';
import type { FeatureId, TerrainId } from './data/terrain';
import type { UnitTypeId } from './data/units';
import type { BuildItem, CityId, PlayerId, TileIndex, UnitId } from './types';

export interface TileView {
  terrain: TerrainId;
  feature: FeatureId | null;
  /** What is built on the tile (a farm, a mine): current if `visible`, otherwise as last seen. null = nothing (as far as the player knows). */
  improvement: ImprovementId | null;
  /** Owner of the tile: current if `visible`, otherwise as last seen. null = unowned (as far as the player knows). */
  owner: PlayerId | null;
  /** True if the tile is in sight right now; false = remembered ("fogged"). */
  visible: boolean;
}

/** The job of one of the viewer's own units. Every number the unit panel prints about it. */
export interface UnitJobView {
  improvement: ImprovementId;
  /** Turn resolutions already spent on it. */
  turnsWorked: number;
  /** Turn resolutions it takes from start to finish (IMPROVEMENTS[improvement].turns). */
  turnsTotal: number;
  /** Turn resolutions until it is finished, counting the one that ends this turn. Never less than 1. */
  turnsLeft: number;
}

/** One job the viewer's own unit could do on the tile it stands on. */
export interface JobOption {
  improvement: ImprovementId;
  /** Turn resolutions the job takes from start to finish. */
  turns: number;
  /**
   * Why the unit cannot start this job where it stands right now, or null
   * if it can (the button is offered when this is null). Like
   * foundCityError it is about the unit and its tile only: after End Turn
   * this can still be null, and a startJob action is then answered
   * 'turnAlreadyEnded'. While the unit has a job every option says
   * 'unitBusy'.
   */
  error: RuleErrorCode | null;
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
  /** The work the unit is doing on its tile, or null. A unit with a job cannot be moved until the job is finished or stopped. */
  job: UnitJobView | null;
  /**
   * For a unit that can build improvements (UNITS[type].canImprove): one
   * entry per improvement, in IMPROVEMENT_IDS order. Empty for every other
   * unit.
   */
  jobOptions: JobOption[];
}

export interface UnitView {
  id: UnitId;
  type: UnitTypeId;
  owner: PlayerId;
  tile: TileIndex;
  /** Present for the viewer's own units, null for everybody else's. */
  own: OwnUnitDetail | null;
}

/** Why a city cannot complete an entry that is paid for: it cannot spare the citizen the item takes, or there is no free tile for the unit. */
export type ProductionBlock = 'needsPopulation' | 'noRoom';

/**
 * Why an entry of a build queue, or of the build menu, has no "in N turns"
 * (see buildPlan in rules/city.ts, which plays the city forward):
 *  - 'needsPopulation'  when the forecast ends the entry is paid for and
 *                       the city still cannot spare the citizen it takes;
 *  - 'noRoom'           when the forecast ends the entry is paid for and
 *                       there is no free tile for the unit (on the map as
 *                       it is now);
 *  - 'noProduction'     the entry is not paid for and the city makes no
 *                       production;
 *  - 'tooFar'           it would take more than RULES.forecastTurns turns;
 *  - 'earlier'          an entry above it has no number, so nobody can say
 *                       when this one will be done.
 */
export type BuildWait = ProductionBlock | 'noProduction' | 'tooFar' | 'earlier';

/** One entry of a city's build queue, as its owner sees it. */
export interface QueueEntryView {
  item: BuildItem;
  /** Production needed in total. */
  cost: number;
  /**
   * How many turn resolutions from now until this entry is completed: 1 =
   * when this turn resolves. A forecast: the city is played forward with
   * the rules of turn resolution, growth included, with everything outside
   * the city taken as it is now. Never more than RULES.forecastTurns. null
   * if the forecast does not see the entry completed; `wait` then says why.
   */
  turns: number | null;
  /** Set exactly when `turns` is null. */
  wait: BuildWait | null;
}

/** One entry of a city's build menu: something that can be added to the queue. */
export interface BuildOption {
  item: BuildItem;
  /** Production needed in total. */
  cost: number;
  /**
   * How many turn resolutions from now until it would be completed if it
   * were added to the END of the queue now (see QueueEntryView.turns); null
   * if the forecast does not see it completed.
   */
  turns: number | null;
  /** Set exactly when `turns` is null. */
  wait: BuildWait | null;
  /**
   * Why the item cannot be added right now, or null if it can (the button is
   * offered when this is null): 'queueFull' when the queue already holds
   * RULES.maxQueueLength entries. Like OwnUnitDetail.foundCityError, it is
   * about the city only; whether the player may give any order at this
   * moment is a separate question.
   */
  addError: RuleErrorCode | null;
}

/** Extra facts about one of the viewer's own cities. Every number the city panel prints. */
export interface OwnCityDetail {
  foodStored: number;
  /** Stored food needed to grow by one. */
  foodToGrow: number;
  /** Food surplus per turn after citizens have eaten. May be negative. */
  foodPerTurn: number;
  /**
   * The build queue, in order. Entry 0 is what the city is building now.
   * Empty = the city builds nothing and its production is lost each turn.
   */
  buildQueue: QueueEntryView[];
  /**
   * Set while the first entry of the queue is paid for and the city, as it
   * is now, still cannot complete it: the reason. The city panel then says
   * "Waiting: ...". null otherwise, also for an entry that is not paid for
   * yet and for an empty queue. (The entry's `turns` can be a number at
   * the same time: the forecast then says when the wait will be over.)
   */
  held: ProductionBlock | null;
  /**
   * Production in the city's one store. It counts towards entry 0 of the
   * queue, whatever that is, and can be larger than its cost while it waits.
   */
  productionStored: number;
  productionPerTurn: number;
  /**
   * Tiles worked by citizens (the city centre is always worked and is not
   * listed). Ascending. The client marks them on the map while the city is
   * selected (MapOverlay.workedTiles in client/src/render/api.ts).
   */
  worked: TileIndex[];
  /** Everything the city could add to its queue, in UNIT_TYPE_IDS order. */
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
