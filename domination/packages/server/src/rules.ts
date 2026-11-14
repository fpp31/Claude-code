/**
 * The seam between the server and the rules engine.
 *
 * The server never looks inside a game state. Everything it needs from
 * packages/shared goes through this small bundle of functions, which makes
 * the boundary easy to see and lets server tests swap in a tiny fake engine
 * (so lobby, reconnect and persistence tests do not have to wait for WP2).
 *
 * `diffViews` is used directly from the shared package (it is not part of
 * the rules).
 */

import {
  applyAction,
  buildPlayerView,
  checkInvariants,
  createGame,
  filterEvents,
} from '@domination/shared';
import type {
  Action,
  ActionResult,
  AddressedEvent,
  GameEvent,
  GameSetup,
  GameState,
  PlayerId,
  PlayerView,
} from '@domination/shared';

export interface Rules {
  /** Builds the initial state when the host starts the game. */
  createGame(setup: GameSetup): GameState;
  /** The single gate for player actions. Pure: returns a new state, never edits the old one. */
  applyAction(state: GameState, playerId: PlayerId, turn: number, action: Action): ActionResult;
  /** The one filter: what a player may see. Nothing else about a game is ever sent. */
  buildPlayerView(state: GameState, playerId: PlayerId): PlayerView;
  /** The events a player may receive, without their audience lists (which never leave the server). */
  filterEvents(events: AddressedEvent[], playerId: PlayerId): GameEvent[];
  /** Health check, run when a save is loaded (problems are logged, not fatal). */
  checkInvariants(state: GameState): string[];
}

/** The real rules engine from packages/shared. */
export const realRules: Rules = {
  createGame: (setup) => createGame(setup),
  applyAction,
  buildPlayerView,
  filterEvents,
  checkInvariants,
};
