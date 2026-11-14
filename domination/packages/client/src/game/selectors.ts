/**
 * Read-only questions about the current view (work package WP4). Pure
 * functions of the view/state: easy to test without a browser.
 */

import type {
  CityView,
  PlayerPublic,
  PlayerView,
  ReachStep,
  TileIndex,
  UnitView,
} from '@domination/shared';
import type { MapOverlay } from '../render/api';
import type { AppState } from '../state/store';

/** The viewer's own entry in view.players. */
export function myPlayer(view: PlayerView): PlayerPublic {
  throw new Error('not implemented: myPlayer');
}

/** The selected unit, if a unit is selected and it is still in the view. */
export function selectedUnit(state: AppState): UnitView | null {
  throw new Error('not implemented: selectedUnit');
}

/** The selected city, if a city is selected and it is still in the view. */
export function selectedCity(state: AppState): CityView | null {
  throw new Error('not implemented: selectedCity');
}

/** The viewer's own units and city on a tile, in tap-cycle order: military unit, civilian unit, city. */
export function ownThingsAt(view: PlayerView, tile: TileIndex): ({ kind: 'unit'; unit: UnitView } | { kind: 'city'; city: CityView })[] {
  throw new Error('not implemented: ownThingsAt');
}

/**
 * The shape of reachableFor. The controller and overlayFor take one as an
 * optional argument, so their tests can pass a hand-made answer and do not
 * have to wait for the movement rules (WP2).
 */
export type ReachFunction = (view: PlayerView, unit: UnitView) => Map<TileIndex, ReachStep>;

/**
 * May the player give an order right now? True only if there is a game, the
 * connection is 'online', no action is in flight (`busy` is false) and the
 * player has not ended their turn. ONE definition, used both by overlayFor
 * (whether reachable tiles are highlighted) and by the controller (whether a
 * tap on such a tile moves the unit), so the map never shows a move the tap
 * would not make, and the other way round.
 */
export function canActNow(state: AppState): boolean {
  throw new Error('not implemented: canActNow');
}

/**
 * Where an own unit can go this turn: reachableTiles(boardFromView(view), ...)
 * from the shared rules, so the highlight matches what the server accepts.
 * Remember the last result (same view object and same unit id -> same Map),
 * because this is asked on every pointer move.
 * Empty for foreign units and for units without moves.
 *
 * Until the rules engine (WP2) has landed, the shared functions throw
 * "not implemented"; catch exactly that here (isNotImplementedError from
 * '@domination/shared/testing') and return an empty Map so the rest of the
 * client can be developed in demo mode. The integrator removes the catch
 * after the merge.
 */
export function reachableFor(view: PlayerView, unit: UnitView): Map<TileIndex, ReachStep> {
  throw new Error('not implemented: reachableFor');
}

/**
 * The overlay for the renderer, derived from the state:
 *  - selectedTile / selectedUnitId from the selection;
 *  - reachable: the keys of reach(view, selected unit) if canActNow(state),
 *    otherwise [] (nothing is highlighted while busy, offline, or after the
 *    player has ended their turn);
 *  - path: pathTo(that reach map, hoverTile) if the hovered tile is among
 *    `reachable`, else [];
 *  - workedTiles: city.own.worked of the selected city if it is the
 *    player's own, else [];
 *  - hoverTile from the state.
 * Returns EMPTY_OVERLAY when there is no game.
 *
 * @param reach  how to find the reachable tiles; tests pass a stub
 */
export function overlayFor(state: AppState, reach: ReachFunction = reachableFor): MapOverlay {
  throw new Error('not implemented: overlayFor');
}

/** Own units that still have moves left, sorted by id (for "next unit" and the End Turn hint). */
export function idleUnits(view: PlayerView): UnitView[] {
  throw new Error('not implemented: idleUnits');
}

/** Own cities with nothing selected to build (for the End Turn hint). */
export function citiesWithoutProduction(view: PlayerView): CityView[] {
  throw new Error('not implemented: citiesWithoutProduction');
}
