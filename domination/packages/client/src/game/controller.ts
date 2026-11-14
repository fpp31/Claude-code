/**
 * What the player's taps, clicks and keys MEAN (work package WP4).
 *
 * The controller reads the store, changes only the selection/hover part of
 * it, and sends actions to the server. It never changes game data itself:
 * after sending an action it waits for the server's view.
 */

import type { BuildItem, TileIndex } from '@domination/shared';
import type { Connection } from '../net/connection';
import type { Store } from '../state/store';
import type { ReachFunction } from './selectors';

/**
 * For this long after the End Turn button has changed its meaning, a press
 * of it is ignored (see Controller.toggleEndTurn).
 */
export const END_TURN_GUARD_MS = 600;

export interface Controller {
  /**
   * A tap or click on a map tile.
   *  1. A unit is selected and the tile is in its reachable set
   *     (reach(view, unit)):
   *       - if canActNow(state): send `moveUnit` with pathTo(reach, tile);
   *       - if not (busy, offline, or the turn is ended): do NOTHING.
   *     Either way the unit stays selected and rules 2 and 3 are skipped.
   *     (The highlight uses the same canActNow, so a tap never does what the
   *     map does not show.)
   *  2. Otherwise look at the player's own things on the tile (military
   *     unit, civilian unit, city, in that order): if the current selection
   *     is one of them select the next one (wrapping around), else select
   *     the first.
   *  3. Nothing of the player's there: clear the selection.
   */
  onTileTap(tile: TileIndex): void;

  /** The mouse moved over a tile (null: it left the map). Updates hoverTile if it changed. */
  onTileHover(tile: TileIndex | null): void;

  /** Found City button / F key: send `foundCity` for the selected unit, if its `own.foundCityError` is null. */
  foundCity(): void;

  /** City panel: send `setProduction` for the selected city. */
  setProduction(item: BuildItem): void;

  /**
   * End Turn button / Enter key: send `endTurn`, or `cancelEndTurn` if the
   * player has already ended the turn (view.players says so).
   *
   * DOUBLE-PRESS GUARD. One control means two opposite things, and its
   * meaning flips the moment the server answers (a few milliseconds on a
   * local network). Without a guard a double-click sends "end" and then
   * "cancel", and for the last player to end it would end the NEXT turn too.
   * So: the controller watches the store, and whenever the player's own
   * `endedTurn` or `view.turn` changes it notes the time; a call within
   * END_TURN_GUARD_MS of that moment does nothing. (`busy` alone is not
   * enough: it only covers the round trip.)
   */
  toggleEndTurn(): void;

  /** Escape key: clear the selection. */
  deselect(): void;

  /** N key: select the next own unit with moves left (by id, after the current one) and return its tile, or null if none. */
  selectNextIdleUnit(): TileIndex | null;

  /** Stops watching the store. Called when the game screen is unmounted. */
  destroy(): void;
}

/** Things tests replace. The app passes nothing. */
export interface ControllerOptions {
  /** How to find the tiles a unit can reach. Default: reachableFor (game/selectors.ts). */
  reach?: ReachFunction;
  /** The clock for the End Turn guard, in milliseconds. Default: Date.now. */
  now?: () => number;
}

/**
 * Every action is sent as `{ type: 'action', requestId, turn: view.turn,
 * action }` with a fresh increasing requestId. Nothing is sent while `busy`
 * is set or while the connection is not 'online': the request is dropped
 * with no queueing (the player simply taps again).
 *
 * `busy` is set ONLY if connection.send returned true, and stays set until
 * the answer arrives (see serverMessages.ts). If send returned false (the
 * socket just dropped, or demo mode's dummy connection) nothing happens and
 * nothing can get stuck.
 */
export function createController(store: Store, connection: Connection, options: ControllerOptions = {}): Controller {
  throw new Error('not implemented: createController');
}
