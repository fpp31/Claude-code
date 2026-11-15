/**
 * Shared helpers for the app-shell tests (work package WP4): a store that is
 * already in a game, and a stand-in Connection that records what was sent.
 * Everything is built from sampleView() / sampleLobby(), so the tests need
 * neither a server nor the rules engine.
 */

import { cloneJson } from '@domination/shared';
import type { CityView, ClientMessage, OwnCityDetail, OwnUnitDetail, PlayerView, UnitView } from '@domination/shared';
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
  /** Own grassland with a finished farm; a citizen of Rome works it. */
  farmTile: 3 * 14 + 3,
  /** Desert hills on Egypt's land, out of sight: a mine the player remembers. */
  rememberedMineTile: 2 * 14 + 10,
  foreignWarriorId: 'u2_b8nq4t',
  foreignWarriorTile: 4 * 14 + 7,
  romeId: 'c1_r6wz2e',
  romeTile: 4 * 14 + 3,
  thebesId: 'c2_h5yd7m',
  thebesTile: 3 * 14 + 10,
  /** A land tile with nothing on it (own grassland that no citizen works). */
  emptyTile: 5 * 14 + 4,
} as const;

/** The tile at column x, row y of the sample map (14 tiles wide). */
export function at(x: number, y: number): number {
  return y * 14 + x;
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
