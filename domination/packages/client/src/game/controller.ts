/**
 * What the player's taps, clicks and keys MEAN (work package WP4).
 *
 * The controller reads the store, changes only the selection/hover part of
 * it, and sends actions to the server. It never changes game data itself:
 * after sending an action it waits for the server's view.
 */

import { pathTo } from '@domination/shared';
import type { Action, BuildItem, TileIndex } from '@domination/shared';
import type { Connection } from '../net/connection';
import type { AppState, MapSelection, Store } from '../state/store';
import {
  canActNow,
  citiesWithoutProduction,
  compareIds,
  idleUnits,
  myPlayer,
  ownThingsAt,
  reachableFor,
  selectedCity,
  selectedUnit,
} from './selectors';
import type { OwnThing, ReachFunction } from './selectors';

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

  /**
   * "Show me" button: select the next thing that still needs the player
   * this turn and return its tile, or null if nothing does. Cities with
   * nothing to build come first (by id), then units with moves left (by id);
   * pressing again goes on to the one after the current selection, wrapping
   * around. This is what turns the hint "2 units can still move" into
   * something a player can follow without hunting on the map.
   */
  selectNextTask(): TileIndex | null;

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
  const reach = options.reach ?? reachableFor;
  const now = options.now ?? Date.now;

  let nextRequestId = 1;

  // ---- The End Turn guard ---------------------------------------------------
  // What the End Turn button means is decided by two facts: has the player
  // ended this turn, and which turn is it. Whenever either changes, the time
  // is noted (see toggleEndTurn).
  let watched = endTurnFacts(store.get());
  let meaningChangedAt = Number.NEGATIVE_INFINITY;

  const stopWatching = store.subscribe((state) => {
    const facts = endTurnFacts(state);
    if (facts.ended !== watched.ended || facts.turn !== watched.turn) meaningChangedAt = now();
    watched = facts;
  });

  /** Sends one game action, unless one is already in flight or there is no connection. */
  function sendAction(action: Action): void {
    const state = store.get();
    if (state.game === null || state.busy || state.connection !== 'online') return;
    const sent = connection.send({ type: 'action', requestId: nextRequestId, turn: state.game.view.turn, action });
    if (!sent) return;
    nextRequestId += 1;
    store.set({ busy: true });
  }

  function select(selection: MapSelection | null): void {
    if (!sameSelection(store.get().selection, selection)) store.set({ selection });
  }

  /** Selects the entry after the current selection in `things` (the first one if the selection is not among them). */
  function selectAfterCurrent(things: OwnThing[]): TileIndex | null {
    if (things.length === 0) return null;
    const current = store.get().selection;
    const index = things.findIndex((thing) => sameSelection(selectionOf(thing), current));
    const next = things[(index + 1) % things.length];
    select(selectionOf(next));
    return next.kind === 'unit' ? next.unit.tile : next.city.tile;
  }

  return {
    onTileTap(tile) {
      const state = store.get();
      if (state.game === null) return;
      const view = state.game.view;

      // 1. A tap on a tile the selected unit can reach is an order to go there.
      const unit = selectedUnit(state);
      if (unit !== null) {
        const reachMap = reach(view, unit);
        if (reachMap.has(tile)) {
          const path = pathTo(reachMap, tile);
          if (path !== null && canActNow(state)) sendAction({ type: 'moveUnit', unitId: unit.id, path });
          return;
        }
      }

      // 2. and 3. Otherwise the tap selects what the player owns there, or nothing.
      const things = ownThingsAt(view, tile);
      if (things.length === 0) select(null);
      else selectAfterCurrent(things);
    },

    onTileHover(tile) {
      if (store.get().hoverTile !== tile) store.set({ hoverTile: tile });
    },

    foundCity() {
      const unit = selectedUnit(store.get());
      if (unit === null || unit.own === null || unit.own.foundCityError !== null) return;
      sendAction({ type: 'foundCity', unitId: unit.id });
    },

    setProduction(item) {
      const city = selectedCity(store.get());
      if (city === null || city.own === null) return;
      sendAction({ type: 'setProduction', cityId: city.id, item });
    },

    toggleEndTurn() {
      const state = store.get();
      if (state.game === null) return;
      if (now() - meaningChangedAt < END_TURN_GUARD_MS) return;
      sendAction({ type: myPlayer(state.game.view).endedTurn ? 'cancelEndTurn' : 'endTurn' });
    },

    deselect() {
      select(null);
    },

    selectNextIdleUnit() {
      const state = store.get();
      if (state.game === null) return null;
      const idle = idleUnits(state.game.view);
      if (idle.length === 0) return null;
      // "After the current one" goes by id even when the selected unit itself
      // has no moves left, so N always walks through the units in one order.
      const currentId = state.selection !== null && state.selection.kind === 'unit' ? state.selection.unitId : null;
      const after = currentId === null ? undefined : idle.find((unit) => compareIds(unit.id, currentId) > 0);
      const next = after ?? idle[0];
      select({ kind: 'unit', unitId: next.id });
      return next.tile;
    },

    selectNextTask() {
      const game = store.get().game;
      if (game === null) return null;
      const cities: OwnThing[] = citiesWithoutProduction(game.view).map((city) => ({ kind: 'city', city }));
      const units: OwnThing[] = idleUnits(game.view).map((unit) => ({ kind: 'unit', unit }));
      return selectAfterCurrent([...cities, ...units]);
    },

    destroy() {
      stopWatching();
    },
  };
}

/** The two facts that decide what the End Turn button means (both null outside a game). */
function endTurnFacts(state: AppState): { ended: boolean | null; turn: number | null } {
  if (state.game === null) return { ended: null, turn: null };
  const view = state.game.view;
  // Read straight from the list: a view without its own player must not make
  // this watcher (and with it every store update) throw.
  const me = view.players.find((player) => player.id === view.you);
  return { ended: me?.endedTurn ?? null, turn: view.turn };
}

function selectionOf(thing: OwnThing): MapSelection {
  return thing.kind === 'unit' ? { kind: 'unit', unitId: thing.unit.id } : { kind: 'city', cityId: thing.city.id };
}

function sameSelection(a: MapSelection | null, b: MapSelection | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'unit') return b.kind === 'unit' && a.unitId === b.unitId;
  return b.kind === 'city' && a.cityId === b.cityId;
}
