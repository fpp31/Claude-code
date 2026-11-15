/**
 * Read-only questions about the current view (work package WP4). Pure
 * functions of the view/state: easy to test without a browser.
 */

import { UNITS, boardFromView, pathTo, reachableTiles } from '@domination/shared';
import type {
  CityView,
  PlayerPublic,
  PlayerView,
  ReachStep,
  TileIndex,
  UnitView,
} from '@domination/shared';
import { EMPTY_OVERLAY } from '../render/api';
import type { MapOverlay } from '../render/api';
import type { AppState } from '../state/store';

/** The viewer's own entry in view.players. */
export function myPlayer(view: PlayerView): PlayerPublic {
  const me = view.players.find((player) => player.id === view.you);
  // The server builds every view with its owner in the player list; a view
  // without one is a programming error, not something to paper over.
  if (me === undefined) throw new Error(`myPlayer: the view has no player "${view.you}"`);
  return me;
}

/** The selected unit, if a unit is selected and it is still in the view. */
export function selectedUnit(state: AppState): UnitView | null {
  const selection = state.selection;
  if (state.game === null || selection === null || selection.kind !== 'unit') return null;
  return state.game.view.units.find((unit) => unit.id === selection.unitId) ?? null;
}

/** The selected city, if a city is selected and it is still in the view. */
export function selectedCity(state: AppState): CityView | null {
  const selection = state.selection;
  if (state.game === null || selection === null || selection.kind !== 'city') return null;
  return state.game.view.cities.find((city) => city.id === selection.cityId) ?? null;
}

/** Something of the viewer's own that can be selected on the map. */
export type OwnThing = { kind: 'unit'; unit: UnitView } | { kind: 'city'; city: CityView };

/** The viewer's own units and city on a tile, in tap-cycle order: military unit, civilian unit, city. */
export function ownThingsAt(view: PlayerView, tile: TileIndex): OwnThing[] {
  const things: OwnThing[] = [];
  const ownUnits = view.units.filter((unit) => unit.tile === tile && unit.owner === view.you);
  for (const unitClass of ['military', 'civilian'] as const) {
    for (const unit of ownUnits) {
      if (UNITS[unit.type].unitClass === unitClass) things.push({ kind: 'unit', unit });
    }
  }
  for (const city of view.cities) {
    if (city.tile === tile && city.owner === view.you) things.push({ kind: 'city', city });
  }
  return things;
}

/**
 * The shape of reachableFor. The controller and overlayFor take one as an
 * optional argument, so their tests can pass a hand-made answer and check
 * the controller on its own, apart from the movement rules.
 */
export type ReachFunction = (view: PlayerView, unit: UnitView) => Map<TileIndex, ReachStep>;

/** Why the player cannot give orders for now, for longer than the blink of a round trip. */
export type OrdersClosed = 'offline' | 'turnEnded';

/**
 * Is there a lasting reason why the player cannot give orders? 'offline' if
 * the connection is not 'online'; else 'turnEnded' if the player has ended
 * their turn; else null (also when there is no game). ONE question for
 * every button that gives an order: the panels grey their buttons by it and
 * print the sentence that goes with it (decision G7). `busy` is NOT part of
 * it: a round trip is over in a blink and must not make the panels flicker.
 */
export function ordersClosed(state: AppState): OrdersClosed | null {
  if (state.connection !== 'online') return 'offline';
  if (state.game !== null && myPlayer(state.game.view).endedTurn) return 'turnEnded';
  return null;
}

/**
 * May the player give an order right now? True only if there is a game, the
 * connection is 'online', no action is in flight (`busy` is false) and the
 * player has not ended their turn. ONE definition, used both by overlayFor
 * (whether reachable tiles are highlighted) and by the controller (whether a
 * tap on such a tile moves the unit), so the map never shows a move the tap
 * would not make, and the other way round.
 *
 * Now: there is a game, ordersClosed(state) is null and no action is in flight.
 */
export function canActNow(state: AppState): boolean {
  return state.game !== null && ordersClosed(state) === null && !state.busy;
}

/**
 * The tile that carries the selection ring: the selected unit's or city's
 * tile, or, when nothing is selected, the tile whose tile card is open.
 * Null if there is neither.
 */
export function markedTile(state: AppState): TileIndex | null {
  const unit = selectedUnit(state);
  if (unit !== null) return unit.tile;
  const city = selectedCity(state);
  if (city !== null) return city.tile;
  return state.game !== null && state.selection === null ? state.inspectedTile : null;
}

/** What reachableFor worked out last time (see there). */
let lastReachView: PlayerView | null = null;
let lastReachUnitId: string | null = null;
let lastReach: Map<TileIndex, ReachStep> = new Map();

/**
 * Where an own unit can go this turn: reachableTiles(boardFromView(view), ...)
 * from the shared rules, so the highlight matches what the server accepts.
 * Remember the last result (same view object and same unit id -> same Map),
 * because this is asked on every pointer move.
 * Empty for foreign units, for units without moves and for units at work.
 */
export function reachableFor(view: PlayerView, unit: UnitView): Map<TileIndex, ReachStep> {
  if (view === lastReachView && unit.id === lastReachUnitId) return lastReach;

  let reach = new Map<TileIndex, ReachStep>();
  if (unit.owner === view.you && unit.own !== null && unit.own.movesLeft > 0 && unit.own.job === null) {
    reach = reachableTiles(boardFromView(view), {
      owner: unit.owner,
      type: unit.type,
      tile: unit.tile,
      movesLeft: unit.own.movesLeft,
    });
  }

  lastReachView = view;
  lastReachUnitId = unit.id;
  lastReach = reach;
  return reach;
}

/**
 * The overlay for the renderer, derived from the state:
 *  - selectedTile from the selection, or the inspected tile when nothing is
 *    selected (markedTile); selectedUnitId from the selection;
 *  - reachable: the keys of reach(view, selected unit) if canActNow(state),
 *    otherwise [] (nothing is highlighted while busy, offline, or after the
 *    player has ended their turn; and never for a unit at work, which has
 *    no reachable tiles);
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
  if (state.game === null) return EMPTY_OVERLAY;
  const view = state.game.view;
  const unit = selectedUnit(state);
  const city = selectedCity(state);

  let reachable: TileIndex[] = [];
  let path: TileIndex[] = [];
  if (unit !== null && canActNow(state)) {
    const reachMap = reach(view, unit);
    reachable = [...reachMap.keys()].sort((a, b) => a - b);
    if (state.hoverTile !== null) path = pathTo(reachMap, state.hoverTile) ?? [];
  }

  return {
    selectedTile: markedTile(state),
    selectedUnitId: unit?.id ?? null,
    reachable,
    path,
    workedTiles: city !== null && city.own !== null ? city.own.worked : [],
    hoverTile: state.hoverTile,
  };
}

/** True if two overlays would draw the same thing (so the renderer need not be told again). */
export function sameOverlay(a: MapOverlay, b: MapOverlay): boolean {
  return (
    a.selectedTile === b.selectedTile &&
    a.selectedUnitId === b.selectedUnitId &&
    a.hoverTile === b.hoverTile &&
    sameTiles(a.reachable, b.reachable) &&
    sameTiles(a.path, b.path) &&
    sameTiles(a.workedTiles, b.workedTiles)
  );
}

function sameTiles(a: TileIndex[], b: TileIndex[]): boolean {
  return a.length === b.length && a.every((tile, index) => tile === b[index]);
}

/**
 * Orders ids the same way on every computer (plain character order, not the
 * language-dependent order of localeCompare).
 */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Own units that can still be given a move: moves left and no job, sorted by id (for "next unit" and the End Turn hint). */
export function idleUnits(view: PlayerView): UnitView[] {
  return view.units
    .filter((unit) => unit.owner === view.you && unit.own !== null && unit.own.movesLeft > 0 && unit.own.job === null)
    .sort((a, b) => compareIds(a.id, b.id));
}

/** Own cities with an empty build queue (for the End Turn hint). */
export function citiesWithoutProduction(view: PlayerView): CityView[] {
  return view.cities
    .filter((city) => city.owner === view.you && city.own !== null && city.own.buildQueue.length === 0)
    .sort((a, b) => compareIds(a.id, b.id));
}

/**
 * Own cities whose first queue entry is paid for, held, and has no end in
 * sight (own.held !== null and own.buildQueue[0].turns === null), sorted by
 * id: for the End Turn hint and "Show me". Everything behind such an entry
 * waits with it, perhaps for the rest of the game.
 */
export function citiesWaiting(view: PlayerView): CityView[] {
  return view.cities
    .filter((city) => {
      if (city.owner !== view.you || city.own === null || city.own.held === null) return false;
      const first = city.own.buildQueue[0];
      return first !== undefined && first.turns === null;
    })
    .sort((a, b) => compareIds(a.id, b.id));
}
