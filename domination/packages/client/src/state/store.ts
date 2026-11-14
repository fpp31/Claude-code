/**
 * The client's state store (work package WP4): ONE object that holds
 * everything the screen shows, plus a way to be told when it changes.
 *
 * Rules:
 *  - Game data enters the store only from server messages
 *    (state/serverMessages.ts). The client never predicts or edits a view.
 *  - State objects are never edited in place. A change makes NEW objects, so
 *    "did the view change?" is just `state.game?.view !== before`.
 *  - The camera is not here: it changes every frame while dragging and
 *    belongs to the renderer.
 */

import type {
  CityId,
  GameCode,
  LobbyView,
  PlayerId,
  PlayerView,
  TileIndex,
  UnitId,
} from '@domination/shared';

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting';

/**
 * What the player has selected on the map. (Named MapSelection, not
 * Selection, because the browser already has a global type called
 * `Selection`: a file that forgot the import would silently get that one.)
 */
export type MapSelection = { kind: 'unit'; unitId: UnitId } | { kind: 'city'; cityId: CityId };

/** A short message that pops up and fades away. */
export interface Toast {
  /** Unique, increasing; used to remove the toast later. */
  id: number;
  text: string;
  kind: 'info' | 'error';
}

/** The running game this client is attached to. */
export interface GameSession {
  code: GameCode;
  /** The latest view from the server. Replaced, never edited. */
  view: PlayerView;
  /** Players with a live connection. */
  connected: PlayerId[];
  /** `seq` of the last gameSync/gameUpdate applied (to detect a missed update). */
  seq: number;
  /**
   * True from the moment a missed update was noticed (and `resync` was sent)
   * until the next gameSync arrives. While it is set every gameUpdate is
   * ignored: patches cannot be applied to a view that has a hole in it.
   */
  awaitingSync: boolean;
}

export interface AppState {
  connection: ConnectionStatus;
  /** The name typed on the home screen (remembered in localStorage). */
  playerName: string;
  /**
   * The game this page is trying to get back into: set when a `joinGame`
   * for the code in the address bar has been sent (page load, reconnect),
   * cleared by the answer (`lobby`, `gameSync`, `left` or any `error`). While
   * it is set the home screen shows "Opening game K7QXM..." with its buttons
   * disabled, instead of flashing an empty form.
   */
  joining: GameCode | null;
  /** Set while attached to a game that has not started. */
  lobby: LobbyView | null;
  /** Set while attached to a running game. */
  game: GameSession | null;
  selection: MapSelection | null;
  /** Tile under the mouse pointer, for the path preview. */
  hoverTile: TileIndex | null;
  /**
   * True while a game action is waiting for the server's answer. Only one
   * action is in flight at a time, so the client never has to reorder
   * anything; buttons and map taps that would send an action are ignored
   * while it is set.
   */
  busy: boolean;
  toasts: Toast[];
  /**
   * A message that blocks the whole app until the page is reloaded (for
   * example after a protocol version mismatch), or null.
   */
  fatalMessage: string | null;
}

/** (Named ScreenName, not Screen: `Screen` is a global browser type, like `Selection` above.) */
export type ScreenName = 'home' | 'lobby' | 'game';

export interface Store {
  /** The current state. Treat it as read-only. */
  get(): AppState;
  /**
   * Replaces the given fields (a shallow merge, like `{ ...state, ...changes }`)
   * and then calls every listener once.
   */
  set(changes: Partial<AppState>): void;
  /**
   * Registers a function to call after every change. Returns a function
   * that removes it again.
   */
  subscribe(listener: (state: AppState) => void): () => void;
}

/**
 * The state of a freshly opened page: connection 'connecting', no lobby, no
 * game, nothing selected, not busy, no toasts.
 *
 * @param playerName  the remembered name (loadPlayerName())
 * @param joining     the game code in the address bar (gameCodeFromUrl()),
 *                    so that a reload shows "Opening game..." from the first
 *                    moment; null if there is none
 */
export function initialState(playerName: string, joining: GameCode | null = null): AppState {
  throw new Error('not implemented: initialState');
}

/** About thirty lines: an object, a list of listeners, get/set/subscribe. No library. */
export function createStore(initial: AppState): Store {
  throw new Error('not implemented: createStore');
}

/** Which screen to show: 'game' if `game` is set, else 'lobby' if `lobby` is set, else 'home'. */
export function currentScreen(state: AppState): ScreenName {
  throw new Error('not implemented: currentScreen');
}
