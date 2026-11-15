/**
 * Actions (what a player asks for), rule errors (why the answer was no) and
 * events (cosmetic news about what happened).
 *
 * An action never names the acting player: the server knows who sent it from
 * the connection and passes that player id to the rules engine.
 */

import type { ImprovementId } from './data/improvements';
import type { UnitTypeId } from './data/units';
import type { BuildItem, CityId, GameState, PlayerId, TileIndex, UnitId } from './types';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  /**
   * Move a unit along `path`: the tiles to enter, in order, start tile
   * excluded, each adjacent to the one before. The client computes the path
   * from its own view; the server walks it one step at a time and stops
   * before the first step that is not legal. See applyAction.
   */
  | { type: 'moveUnit'; unitId: UnitId; path: TileIndex[] }
  /** Found a city on the unit's tile. The unit is consumed. The name comes from the civ's list, in list order. */
  | { type: 'foundCity'; unitId: UnitId }
  /**
   * Replace a city's whole build queue with `queue` (the first entry is
   * what the city builds now; an empty list stops it). The client makes the
   * list from the queue in its own view: adding puts one item at the end,
   * removing leaves one entry out, moving swaps two neighbors. See
   * applyAction for the checks.
   */
  | { type: 'setBuildQueue'; cityId: CityId; queue: BuildItem[] }
  /**
   * Begin building an improvement on the tile the unit stands on. The work
   * takes IMPROVEMENTS[improvement].turns turn resolutions; the unit stays
   * on the tile meanwhile. See applyAction for the checks.
   */
  | { type: 'startJob'; unitId: UnitId; improvement: ImprovementId }
  /** Give up the unit's job. The turns worked are lost; the unit may move again at once. */
  | { type: 'stopJob'; unitId: UnitId }
  /** "I am done for this turn." When every player has ended, the turn resolves. */
  | { type: 'endTurn' }
  /** Take back End Turn (only possible until the turn resolves). */
  | { type: 'cancelEndTurn' };

// ---------------------------------------------------------------------------
// Rule errors
// ---------------------------------------------------------------------------

export type RuleErrorCode =
  /** The action was issued in an earlier turn than the current one. */
  | 'staleTurn'
  /** The player has ended their turn; only cancelEndTurn is accepted. */
  | 'turnAlreadyEnded'
  /** No such unit, or it belongs to someone else (same code on purpose, so ids cannot be probed). */
  | 'noSuchUnit'
  /** No such city, or it belongs to someone else. */
  | 'noSuchCity'
  /** The path is empty, too long, leaves the map or has a step that is not to an adjacent tile. */
  | 'badPath'
  | 'noMovesLeft'
  /** Water, mountains or an unknown tile. */
  | 'impassable'
  /** Another player's unit or city is there, or one of your own units of the same class. */
  | 'blocked'
  /** This unit type cannot found cities. */
  | 'cannotFoundCity'
  /** The ground does not allow a city (water, mountains, forest). */
  | 'badCityTile'
  | 'tooCloseToCity'
  /** The tile belongs to another player. */
  | 'tileOwned'
  /** The city cannot build that item. Also: an entry of a build queue that is not a buildable item. */
  | 'cannotBuild'
  /** The build queue would be longer than RULES.maxQueueLength. (Reachable over the wire: the server's message check lets up to 64 entries through.) */
  | 'queueFull'
  /** This unit type cannot build improvements, or there is no such improvement. */
  | 'cannotImprove'
  /** The unit has a job: it cannot move, or start another job, until the job is finished or stopped. */
  | 'unitBusy'
  /** The tile is not the player's own land (nobody's, or another player's). */
  | 'notYourLand'
  /** A city stands on the tile. */
  | 'cityOnTile'
  /** The ground does not suit that improvement (a farm on hills, a mine on open ground, anything on forest). */
  | 'badImprovementTile'
  /** The tile already has that improvement. */
  | 'alreadyImproved'
  /** The action is malformed or the player is not part of this game. */
  | 'badAction';

/** `code` is for programs and tests, `message` is plain English for a toast. */
export interface RuleError {
  code: RuleErrorCode;
  message: string;
}

/** The wording players see. Edit freely; tests must compare codes, never messages. */
export const RULE_ERROR_MESSAGES: Record<RuleErrorCode, string> = {
  staleTurn: 'That turn is already over.',
  turnAlreadyEnded: 'You have ended your turn. Cancel End Turn to keep playing.',
  noSuchUnit: 'That unit is not yours to command.',
  noSuchCity: 'That city is not yours to manage.',
  badPath: 'That is not a valid route.',
  noMovesLeft: 'This unit has no moves left this turn.',
  impassable: 'Land units cannot go there.',
  blocked: 'Something is in the way.',
  cannotFoundCity: 'This unit cannot found a city.',
  badCityTile: 'A city cannot be founded on this kind of tile.',
  tooCloseToCity: 'Too close to another city.',
  tileOwned: 'This land belongs to another player.',
  cannotBuild: 'This city cannot build that.',
  queueFull: 'The build queue is full.',
  cannotImprove: 'This unit cannot build that.',
  unitBusy: 'This unit is at work. Stop the work first.',
  notYourLand: 'That can only be built on your own land.',
  cityOnTile: 'Nothing can be built on the tile of a city.',
  badImprovementTile: 'That cannot be built on this kind of tile.',
  alreadyImproved: 'This tile already has one.',
  badAction: 'The game did not understand that action.',
};

/** Builds a RuleError with the standard message for its code. */
export function ruleError(code: RuleErrorCode): RuleError {
  return { code, message: RULE_ERROR_MESSAGES[code] };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * News about what an action or a turn resolution did. Events are COSMETIC:
 * they feed toasts and nothing else. The client must work correctly if every
 * event is ignored, because its picture of the game comes from views only.
 *
 * `playerId` says WHO DID IT (whose unit, whose city). It does not say who
 * may hear about it: that is the `to` of the AddressedEvent the engine wraps
 * every event in (below).
 */
export type GameEvent =
  | { type: 'unitMoved'; playerId: PlayerId; unitId: UnitId; from: TileIndex; path: TileIndex[]; stoppedEarly: boolean }
  | { type: 'cityFounded'; playerId: PlayerId; cityId: CityId; name: string; tile: TileIndex }
  | { type: 'cityGrew'; playerId: PlayerId; cityId: CityId; name: string; population: number }
  /**
   * A city completed a unit. `queueEmpty` is true if that was the last
   * entry of the city's build queue: the city builds nothing from now on
   * until its owner queues something.
   */
  | { type: 'unitBuilt'; playerId: PlayerId; cityId: CityId; cityName: string; unitId: UnitId; unitType: UnitTypeId; queueEmpty: boolean }
  /**
   * A unit finished an improvement on `tile` (where it still stands).
   * `cityName` is the city on whose land the tile lies: one of the player's
   * own cities, so that the news can say where ("near Rome").
   */
  | { type: 'improvementBuilt'; playerId: PlayerId; unitId: UnitId; improvement: ImprovementId; tile: TileIndex; cityName: string }
  | { type: 'turnStarted'; turn: number };

/**
 * An event together with the players who may receive it. The rules engine
 * decides the audience at the moment it creates the event, because only then
 * does it know who could see what happened.
 *
 * Phase 1 audiences: 'unitMoved', 'cityFounded', 'cityGrew' and 'unitBuilt'
 * go to the acting player only (`to: [event.playerId]`); 'turnStarted' goes
 * to everybody (`to: 'all'`). 'improvementBuilt' goes to the unit's owner
 * only. Changing a queue, starting a job and stopping a job make no event.
 * Phase 2 adds the victim and the onlookers of a fight to `to` without
 * changing any type.
 *
 * SERVER ONLY. The list of who saw something is itself a secret, so an
 * AddressedEvent is never sent: `filterEvents` (view/playerView.ts) picks one
 * player's events and hands back the bare GameEvents.
 */
export interface AddressedEvent {
  to: PlayerId[] | 'all';
  event: GameEvent;
}

// ---------------------------------------------------------------------------
// Result of applying an action
// ---------------------------------------------------------------------------

export type ActionResult =
  | {
      ok: true;
      /** The state after the action. A new object unless `changed` is false. */
      state: GameState;
      /** Every event with its audience, in the order things happened. Never sent as it is (see AddressedEvent). */
      events: AddressedEvent[];
      /**
       * False for an accepted action that changed nothing (for example End
       * Turn pressed twice). `state` is then the very object that was passed
       * in, `events` is empty, and the server neither saves nor broadcasts.
       */
      changed: boolean;
    }
  | {
      ok: false;
      /** The input state is untouched. */
      error: RuleError;
    };
