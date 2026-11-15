/**
 * The game state: everything the server knows about one running game.
 *
 * Rules for everything in this file:
 *  - It is plain JSON data (numbers, strings, booleans, null, arrays, plain
 *    objects). No classes, Maps, Sets, Dates or undefined values, so that
 *    saving is JSON.stringify and loading is JSON.parse.
 *  - Only the server ever holds a GameState. Clients receive a `PlayerView`
 *    (see viewTypes.ts), which is built from scratch for one player.
 *  - Positions are always a `TileIndex`. Coordinates ({x, y}) only exist
 *    inside hex.ts and the renderer.
 */

import type { CivId } from './data/civs';
import type { ImprovementId } from './data/improvements';
import type { MapSizeId } from './data/rules';
import type { FeatureId, TerrainId } from './data/terrain';
import type { UnitTypeId } from './data/units';
import type { RngState } from './rng';

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/** A seat in a game: 'p1' .. 'p8'. Public, and stable for the life of the game. */
export type PlayerId = string;

/**
 * Opaque unit id such as 'u1_k7m2qd' (see ids.ts). It is random on purpose:
 * a counter would tell a player how many units everybody else has built.
 */
export type UnitId = string;

/** Opaque city id such as 'c2_p9xw3a' (see ids.ts). */
export type CityId = string;

/** Position of a tile: `y * width + x` in the odd-r offset grid (see hex.ts). */
export type TileIndex = number;

/** Five-character code that identifies a game, for example 'K7QXM' (shareable link /?g=K7QXM). */
export type GameCode = string;

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export interface Tile {
  terrain: TerrainId;
  /** The raised object on the ground, if any. Only on grounds listed in FEATURES[feature].allowedOn. */
  feature: FeatureId | null;
  /**
   * What a Worker has built on the tile (a farm, a mine), or null. At most
   * one per tile, only where improvementFits allows it, and never on the
   * tile a city stands on. It changes only when a job is finished
   * (resolveTurn, step runJobs) and when a city is founded on the tile.
   */
  improvement: ImprovementId | null;
  /**
   * The city whose territory this tile belongs to, or null if nobody owns it.
   * This is the single source of truth for territory; the tile's owner is the
   * owner of that city.
   */
  cityId: CityId | null;
}

export interface GameMap {
  width: number;
  height: number;
  /** Row by row: tiles[y * width + x]. Length is always width * height. */
  tiles: Tile[];
}

// ---------------------------------------------------------------------------
// Units and cities
// ---------------------------------------------------------------------------

/** The work a unit is doing on the tile it stands on. */
export interface UnitJob {
  /** What is being built. */
  improvement: ImprovementId;
  /**
   * Turn resolutions spent on it so far: 0 from the moment the job is
   * started until that turn resolves. The job is finished when this reaches
   * IMPROVEMENTS[improvement].turns.
   */
  turnsWorked: number;
}

export interface Unit {
  id: UnitId;
  type: UnitTypeId;
  owner: PlayerId;
  tile: TileIndex;
  /** Movement points left this turn; reset to UNITS[type].moves when a turn resolves. */
  movesLeft: number;
  /**
   * The work this unit is doing on its tile, or null. Only units whose type
   * has `canImprove` ever have one. A unit with a job does not move
   * (moveUnit answers 'unitBusy') until the job is finished or stopped; its
   * `movesLeft` is counted as for any unit and simply cannot be used
   * meanwhile. See rules/improvements.ts.
   */
  job: UnitJob | null;
  // Phase 2 adds: hit points, multi-turn orders.
}

/** Something a city can build. Phase 2 adds `{ kind: 'building'; ... }`. */
export type BuildItem = { kind: 'unit'; unitType: UnitTypeId };

export interface City {
  id: CityId;
  owner: PlayerId;
  name: string;
  /** The city centre. A tile holds at most one city. */
  tile: TileIndex;
  /** Number of citizens, at least 1. */
  population: number;
  /** Food saved towards the next population point (never negative). */
  foodStored: number;
  /**
   * What the city builds, in order. The first entry is what it is building
   * now; when that is completed it leaves the list and the next entry takes
   * its place. The same item may be listed more than once. An empty list
   * means the city builds nothing, and each turn's production is then lost.
   * Never longer than RULES.maxQueueLength. Every entry is an object the
   * engine made itself, with exactly the fields of BuildItem (see
   * rules/setBuildQueue.ts).
   */
  buildQueue: BuildItem[];
  /**
   * Production the city has saved: ONE store, whatever is in the queue. It
   * pays for the first entry of the queue. It is kept when entries are
   * added, removed or moved, and while the queue is empty. It can be larger
   * than the cost of the first entry while that entry is waiting (see
   * runCityTurn in rules/city.ts and OwnCityDetail.held).
   */
  productionStored: number;
  // Territory is NOT stored here: a city owns the tiles whose `cityId` is its id.
  // Worked tiles and yields are NOT stored either: they are derived by cityEconomy().
}

/** The facts about a city that any player who sees it may know. */
export interface CityPublic {
  id: CityId;
  owner: PlayerId;
  name: string;
  tile: TileIndex;
  population: number;
}

// ---------------------------------------------------------------------------
// Players and what they know
// ---------------------------------------------------------------------------

/**
 * What a player last saw on a tile that can change over time. Stored only for
 * tiles where there is something to remember (an owner, a city or an
 * improvement).
 *
 * Rule for later phases: every per-tile fact that can change (improvements,
 * roads, ...) gets a last-seen twin here, so fogged tiles never show the truth.
 */
export interface RememberedTile {
  /** Owner of the tile when last seen. */
  owner: PlayerId | null;
  /** The city standing on the tile when last seen. */
  city: CityPublic | null;
  /** The improvement on the tile when last seen. */
  improvement: ImprovementId | null;
}

/** A player's fog-of-war memory. Lives on the server so it survives reconnects and new devices. */
export interface PlayerKnowledge {
  /** One entry per tile: 1 = the player has seen this tile at some point, 0 = never. Never goes back to 0. */
  explored: number[];
  /** Last-seen owner/city/improvement, keyed by tile index. Only tiles that had an owner, a city or an improvement when last seen. */
  remembered: Record<TileIndex, RememberedTile>;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  civ: CivId;
  /** True once the player has pressed End Turn this turn. Cleared when the turn resolves. */
  endedTurn: boolean;
  /**
   * How many cities this player has founded so far (picks the next city
   * name). Not secret in effect: a city's name gives it away to whoever sees
   * the city (see the list of public facts in protocol.ts).
   */
  citiesFounded: number;
  /**
   * SECRET. Random stream used only to make this player's unit and city ids,
   * so a player's ids depend on nothing but their own actions.
   */
  idRng: RngState;
  knowledge: PlayerKnowledge;
}

// ---------------------------------------------------------------------------
// The whole game
// ---------------------------------------------------------------------------

export interface GameSettings {
  mapSize: MapSizeId;
  /** Phase 3 widens this to ordered and planned-orders modes. */
  turnMode: 'simultaneous';
}

/**
 * Version of the GameState layout. Bump it when the layout changes, and add a
 * migration next to it in this package: a pure function from the old layout
 * to the new one, which the server's storage calls when it loads a save.
 * The server refuses to load a game whose `schema` it cannot bring to this
 * number (see server/src/storage.ts), so an old or newer save is never
 * played, and then overwritten, with the wrong layout.
 *
 * Layouts so far:
 *   1  phase 1.
 *   2  City.production (one item or null) became City.buildQueue (a list);
 *      Tile.improvement, Unit.job and RememberedTile.improvement were added.
 * The migrations live in stateMigrations.ts.
 */
export const STATE_SCHEMA = 2;

export interface GameState {
  /** Always STATE_SCHEMA for states made by this code. */
  schema: number;
  /** SECRET. The seed the game was created from (it regenerates the whole map). */
  seed: string;
  /** SECRET. Random stream for gameplay dice. Nothing rolls dice in phase 1; combat will. */
  rng: RngState;
  settings: GameSettings;
  /** Current turn number, starting at 1. */
  turn: number;
  map: GameMap;
  /** In seat order. Every per-player loop in the rules uses this order. */
  players: PlayerState[];
  /** Keyed by unit id. Insertion order is creation order (JSON keeps it). */
  units: Record<UnitId, Unit>;
  /** Keyed by city id. Insertion order is founding order. */
  cities: Record<CityId, City>;
}

/** Everything needed to create a game. Built by the server when the host presses Start. */
export interface GameSetup {
  /** Any non-empty string. The server uses 32 random hex characters. */
  seed: string;
  settings: GameSettings;
  /**
   * 1 to RULES.maxSeats players. Every id must be a seat name made by
   * playerIdForSeat(n) with n from 1 to RULES.maxSeats ('p1'..'p8'), each at
   * most once, in ascending seat order. Gaps are fine ('p1', 'p3': somebody
   * left the lobby). Anything else makes createGame throw. The rules engine
   * does not require distinct civilizations (the lobby does).
   */
  players: { id: PlayerId; name: string; civ: CivId }[];
}
