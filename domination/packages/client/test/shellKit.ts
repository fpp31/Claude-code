/**
 * Shared helpers for the app-shell tests (work package WP4): a store that is
 * already in a game, and a stand-in Connection that records what was sent.
 * Everything is built from sampleView() / sampleLobby(), so the tests need
 * neither a server nor the rules engine.
 */

import { cloneJson } from '@domination/shared';
import type { ClientMessage, PlayerView } from '@domination/shared';
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
  foreignWarriorId: 'u2_b8nq4t',
  foreignWarriorTile: 4 * 14 + 7,
  romeId: 'c1_r6wz2e',
  romeTile: 4 * 14 + 3,
  thebesId: 'c2_h5yd7m',
  thebesTile: 3 * 14 + 10,
  /** A land tile with nothing on it. */
  emptyTile: 5 * 14 + 4,
} as const;

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
