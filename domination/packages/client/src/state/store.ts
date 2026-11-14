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
  ProtocolErrorCode,
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

/**
 * The answers to "let me into this game" that pressing Join again will not
 * change: the game does not exist, it has started without this player, or
 * every seat is taken.
 */
export type JoinProblem = Extract<ProtocolErrorCode, 'noSuchGame' | 'gameAlreadyStarted' | 'gameFull'>;

/** The JoinProblem codes as a list (for telling them apart from the other errors). */
export const JOIN_PROBLEMS: readonly JoinProblem[] = ['noSuchGame', 'gameAlreadyStarted', 'gameFull'];

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
  /**
   * Why the game named on the home screen cannot be joined, or null. Set
   * when the server refuses a `joinGame` for one of the JoinProblem reasons
   * (also the page's own automatic one, after opening an invite link), and
   * cleared when a game is entered, when the server says the game can be
   * joined after all, and by the home screen when the code is edited or
   * Join is pressed again. A toast fades after four seconds; this stays, so
   * the home screen can go on saying why the invitation leads nowhere.
   */
  joinProblem: JoinProblem | null;
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
 * game, no join problem, nothing selected, not busy, no toasts.
 *
 * @param playerName  the remembered name (loadPlayerName())
 * @param joining     the game code in the address bar (gameCodeFromUrl()),
 *                    so that a reload shows "Opening game..." from the first
 *                    moment; null if there is none
 */
export function initialState(playerName: string, joining: GameCode | null = null): AppState {
  return {
    connection: 'connecting',
    playerName,
    joining,
    joinProblem: null,
    lobby: null,
    game: null,
    selection: null,
    hoverTile: null,
    busy: false,
    toasts: [],
    fatalMessage: null,
  };
}

/** About thirty lines: an object, a list of listeners, get/set/subscribe. No library. */
export function createStore(initial: AppState): Store {
  let state = initial;
  let listeners: ((state: AppState) => void)[] = [];

  return {
    get() {
      return state;
    },

    set(changes) {
      state = { ...state, ...changes };
      // `listeners` is replaced, never edited, when somebody subscribes or
      // unsubscribes, so walking the list as it was at this moment is safe
      // even if a listener does either. Two details:
      //  - a listener that has been unsubscribed meanwhile is skipped: when
      //    the app swaps screens in answer to this very change, the old
      //    screen's parts must not be called after they were taken down;
      //  - each listener is handed the state as it is when its turn comes:
      //    should a listener call `set` itself, the ones after it see the
      //    newest state (twice, which is harmless because all they do is
      //    bring the screen in line with it).
      for (const listener of listeners) {
        if (listeners.includes(listener)) listener(state);
      }
    },

    subscribe(listener) {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((other) => other !== listener);
      };
    },
  };
}

/** Which screen to show: 'game' if `game` is set, else 'lobby' if `lobby` is set, else 'home'. */
export function currentScreen(state: AppState): ScreenName {
  if (state.game !== null) return 'game';
  if (state.lobby !== null) return 'lobby';
  return 'home';
}
