/**
 * Shared helpers for the app-shell tests (work package WP4): a store that is
 * already in a game, and a stand-in Connection that records what was sent.
 * Everything is built from sampleView() / sampleLobby(), so the tests need
 * neither a server nor the rules engine.
 */

import { IMPROVEMENTS, UNITS, cloneJson } from '@domination/shared';
import type { CityView, ClientMessage, OwnCityDetail, OwnUnitDetail, PlayerView, TileView, UnitTypeId, UnitView } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import type { Connection } from '../src/net/connection';
import { createStore, initialState } from '../src/state/store';
import type { AppState, Store } from '../src/state/store';

/** Where things stand in sampleView() (see shared/src/testing/fixtures.ts). The map is 14 tiles wide. */
export const SAMPLE = {
  code: 'K7QXM',
  me: 'p1',
  other: 'p2',
  warriorId: 'u1_k7m2qd',
  warriorTile: 3 * 14 + 5,
  settlerId: 'u1_x3fp9a',
  settlerTile: 6 * 14 + 8,
  /** The player's Worker, at work: it is building a farm on plains and has three turns to go. */
  workerId: 'u1_m4wq7e',
  workerTile: 5 * 14 + 3,
  /** Own grassland with a finished farm; a citizen of Rome gathers from it. */
  farmTile: 3 * 14 + 3,
  /** Desert hills on Egypt's land, out of sight: a mine the player remembers. */
  rememberedMineTile: 2 * 14 + 10,
  foreignWarriorId: 'u2_b8nq4t',
  foreignWarriorTile: 4 * 14 + 7,
  romeId: 'c1_r6wz2e',
  romeTile: 4 * 14 + 3,
  thebesId: 'c2_h5yd7m',
  thebesTile: 3 * 14 + 10,
  /** A land tile with nothing on it (own grassland that no citizen gathers from). */
  emptyTile: 5 * 14 + 4,
} as const;

/** The tile at column x, row y of the sample map (14 tiles wide). */
export function at(x: number, y: number): number {
  return y * 14 + x;
}

/**
 * The shore west of Rome in sampleView(): three coast tiles in sight, one
 * under the other, three tiles from the city. In the sample view they are
 * nobody's: Rome owns no water there, which is why its two boats are
 * greyed. shoreView() puts them inside Rome's borders.
 */
export const SHORE = {
  north: at(0, 3),
  middle: at(0, 4),
  south: at(0, 5),
  /** Coast in sight further south, outside every border also in shoreView(). */
  free: at(1, 6),
  /** Own grassland of Rome beside the middle coast tile. */
  beach: at(1, 4),
} as const;

/** The tile of a view the viewer has seen; throws for a never-seen one. */
export function seenTile(view: PlayerView, tile: number): TileView {
  const seen = view.tiles[tile];
  if (seen === null || seen === undefined) throw new Error(`tile ${tile} is not explored in this view`);
  return seen;
}

/**
 * The sample view as it would be if Rome's borders reached the sea: the
 * three coast tiles of SHORE are Rome's, and Rome's menu says what a city
 * with water says about its boats (a number of turns and no addError).
 * `change` is applied on top.
 */
export function shoreView(change: (view: PlayerView) => void = () => {}): PlayerView {
  const view = sampleView();
  for (const tile of [SHORE.north, SHORE.middle, SHORE.south]) seenTile(view, tile).owner = SAMPLE.me;
  for (const option of romeOf(view).buildOptions) {
    if (UNITS[option.item.unitType].domain !== 'sea') continue;
    option.turns = 15;
    option.wait = null;
    option.addError = null;
  }
  change(view);
  return view;
}

/**
 * Adds a unit of the viewer's own to a view, as the server would list it:
 * full moves, no job, and one job option per improvement its type builds,
 * each with `jobError` (null: the job can be started where it stands).
 * Returns the unit, so that a test can change it further.
 */
export function addOwnUnit(view: PlayerView, id: string, type: UnitTypeId, tile: number, jobError: OwnUnitDetail['jobOptions'][number]['error'] = null): UnitView {
  const unit: UnitView = {
    id,
    type,
    owner: view.you,
    tile,
    own: {
      movesLeft: UNITS[type].moves,
      foundCityError: UNITS[type].canFoundCity ? null : 'cannotFoundCity',
      job: null,
      jobOptions: UNITS[type].improvements.map((improvement) => ({ improvement, turns: IMPROVEMENTS[improvement].turns, error: jobError })),
    },
  };
  view.units.push(unit);
  return unit;
}

/**
 * Puts an own unit to work on what its type builds first (a Worker on a
 * farm, a Fishing Boat on a net), as the server's view shows a unit at
 * work: the job with its turns, and every option busy.
 */
export function putToWork(unit: UnitView, turnsWorked: number): void {
  if (unit.own === null) throw new Error(`unit ${unit.id} is not the viewer's own`);
  const improvement = UNITS[unit.type].improvements[0];
  if (improvement === undefined) throw new Error(`a ${unit.type} builds nothing`);
  const turnsTotal = IMPROVEMENTS[improvement].turns;
  unit.own.job = { improvement, turnsWorked, turnsTotal, turnsLeft: Math.max(1, turnsTotal - turnsWorked) };
  for (const option of unit.own.jobOptions) option.error = 'unitBusy';
}

/**
 * A store attached to the sample game: online, not busy, nothing selected,
 * seq 5. `changes` are applied on top (for example { busy: true }).
 */
export function storeInGame(changes: Partial<AppState> = {}, view: PlayerView = sampleView()): Store {
  const store = createStore(initialState('Ada'));
  store.set({
    connection: 'online',
    game: { code: SAMPLE.code, view, connected: [SAMPLE.me, SAMPLE.other], seq: 5, awaitingSync: false },
    ...changes,
  });
  return store;
}

/** The view of the store's game (the tests only use it while there is one). */
export function viewOf(store: Store): PlayerView {
  const game = store.get().game;
  if (game === null) throw new Error('viewOf: the store has no game');
  return game.view;
}

/** Replaces the view of the store's game, as a server update would. */
export function setView(store: Store, change: (view: PlayerView) => void): void {
  const game = store.get().game;
  if (game === null) throw new Error('setView: the store has no game');
  const view = cloneJson(game.view);
  change(view);
  store.set({ game: { ...game, view } });
}

/** The unit with this id in a view; throws if the view has none (the fixture changed). */
export function unitIn(view: PlayerView, id: string): UnitView {
  const unit = view.units.find((candidate) => candidate.id === id);
  if (unit === undefined) throw new Error(`the view has no unit ${id}`);
  return unit;
}

/** What only its owner knows about one of the viewer's own units; throws for anybody else's. */
export function ownOf(view: PlayerView, id: string): OwnUnitDetail {
  const own = unitIn(view, id).own;
  if (own === null) throw new Error(`unit ${id} is not the viewer's own`);
  return own;
}

/** The city with this id in a view; throws if the view has none. */
export function cityIn(view: PlayerView, id: string): CityView {
  const city = view.cities.find((candidate) => candidate.id === id);
  if (city === undefined) throw new Error(`the view has no city ${id}`);
  return city;
}

/** Rome's own details in a view (food, queue, menu); throws if they are missing. */
export function romeOf(view: PlayerView): OwnCityDetail {
  const own = cityIn(view, SAMPLE.romeId).own;
  if (own === null) throw new Error('Rome is not the viewer\'s own city in this view');
  return own;
}

/** A Connection that goes nowhere but remembers every message it was given. */
export interface FakeConnection extends Connection {
  /** Every message `send` accepted, oldest first. */
  sent: ClientMessage[];
  /** What `send` answers. Set to false to play a socket that has just dropped. */
  accepts: boolean;
}

export function fakeConnection(): FakeConnection {
  const connection: FakeConnection = {
    sent: [],
    accepts: true,
    send(message) {
      if (!connection.accepts) return false;
      connection.sent.push(message);
      return true;
    },
    close() {},
  };
  return connection;
}

/** The game actions among the sent messages, without the envelope. */
export function sentActions(connection: FakeConnection): unknown[] {
  return connection.sent.flatMap((message) => (message.type === 'action' ? [message.action] : []));
}
