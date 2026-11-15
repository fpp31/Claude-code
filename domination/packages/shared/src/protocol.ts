/**
 * The wire protocol: every message that travels over the WebSocket, as JSON
 * text, one message per frame. The socket lives at the path WS_PATH on the
 * same host and port that serves the web page.
 *
 * Conversation outline
 *  1. The client opens the socket and sends `hello`. The server answers
 *     `welcome` (with the player's secret token) or `error protocolMismatch`.
 *  2. The client sends `createGame` or `joinGame`. `joinGame` is also the
 *     RECONNECT message: if the token already owns a seat in that game the
 *     socket is simply attached to it again. A socket is attached to at most
 *     one game; moving to another game only detaches the socket from the
 *     old one (the seat there is kept; only `leaveGame` gives up a seat).
 *  3. While the game is in the lobby the server sends the whole `lobby` to
 *     every attached socket whenever anything in it changes.
 *  4. Once the game has started the server sends `gameSync` (a full view) to
 *     a socket when it attaches or asks for `resync`, and `gameUpdate` (a
 *     patch) afterwards, only to players whose own view changed. Both carry
 *     `seq`, a counter per socket that goes up by one with every gameSync or
 *     gameUpdate sent on that socket.
 *  5. An `action` that reaches a started game gets exactly one reply with
 *     its `requestId`: `actionOk` or `actionRejected`. For an accepted action
 *     the sender's own `gameUpdate` arrives BEFORE the `actionOk`. An action
 *     that fails earlier (the socket is not in a started game, the message
 *     was dropped by the rate limit or was malformed) gets a plain `error`
 *     WITHOUT a requestId. The client therefore treats any `error`, any
 *     `gameSync` and a lost connection as the end of the action in flight.
 *
 * Facts that are deliberately public to every player in a game (the complete
 * list; nothing else may cross between players): player names, civilizations,
 * seat order, who is host, the map size, who has ended their turn, who is
 * connected, the turn number, whatever stands on, or is built on, tiles a
 * player can see, and what a city's name gives away: names are handed out in
 * list order (data/civs.ts), so a city's name tells how many cities its owner
 * had founded before it.
 *
 * Text sent to clients: every message with the code 'serverError' carries
 * the constant SERVER_ERROR_MESSAGE and nothing else. The text of a caught
 * exception goes to the server log only: it can name hidden units, tiles or
 * players, and this path does not pass through the view filter.
 */

import type { Action, GameEvent, RuleErrorCode } from './actions';
import type { CivId } from './data/civs';
import type { MapSizeId } from './data/rules';
import type { GameCode, PlayerId } from './types';
import type { PlayerView, ViewPatch } from './viewTypes';

/** Bump when a message changes shape. A client with another version is told to reload. */
export const PROTOCOL_VERSION = 2;

/** URL path of the WebSocket endpoint. */
export const WS_PATH = '/ws';

/**
 * LIVENESS. Browsers slow down the timers of a tab that is in the background
 * (Chrome: to about one run per MINUTE once the tab has been hidden for five
 * minutes), and this game is meant to sit in a background tab for days. So
 * neither side may conclude anything from a timer that fired late:
 *  - the client judges the connection by "did anything arrive AFTER my last
 *    ping", which a late timer can only delay, never get wrong;
 *  - the server's limit leaves room for pings that come only once a minute.
 */

/** The client sends `ping` this often while connected (less often in a background tab, see above). */
export const PING_INTERVAL_MS = 25_000;
/**
 * The client drops the socket and reconnects if NO frame at all has arrived
 * since it sent a ping at least this long ago.
 */
export const PONG_TIMEOUT_MS = 10_000;
/**
 * The server drops a socket it has received nothing from for this long: two
 * and a half minutes, so a background tab that pings once a minute is safe.
 */
export const SERVER_SILENCE_TIMEOUT_MS = 150_000;

/** The one sentence a client is ever told about an internal server problem (see "Text sent to clients" above). */
export const SERVER_ERROR_MESSAGE = 'The server had a problem. Please try again.';

/** Characters game codes are made of (no 0/O, 1/I/L look-alikes). Codes are GAME_CODE_LENGTH long, upper case. */
export const GAME_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const GAME_CODE_LENGTH = 5;

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export interface LobbySeat {
  playerId: PlayerId;
  name: string;
  /** Always set: a joining player is given the first free civilization and may change it. */
  civ: CivId;
  /** True while at least one socket is attached to this seat. */
  connected: boolean;
}

/** The lobby as sent to one player. Contains no tokens. */
export interface LobbyView {
  code: GameCode;
  /** The seat of the player receiving this message. */
  you: PlayerId;
  /** The host picks the map size and starts the game. */
  hostId: PlayerId;
  mapSize: MapSizeId;
  /** How many players may join (see maxPlayers() in data/rules.ts). */
  maxPlayers: number;
  /** Taken seats, in seat order. */
  seats: LobbySeat[];
}

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

export type ClientMessage =
  /**
   * Must be the first message on every connection. `token` is the secret from
   * localStorage, or null on the very first visit (the server then makes one).
   */
  | { type: 'hello'; protocol: number; token: string | null }
  /**
   * Create a private game and take seat p1 as host. On success the socket is
   * detached from any other game it was attached to (the seat there is kept).
   */
  | { type: 'createGame'; name: string }
  /**
   * Join a game, or come back to one.
   *  - The token already owns a seat there (lobby or running game): the
   *    socket is attached to it and `name` is ignored. The client sends
   *    `name: null` when it only wants this (page load, reconnect).
   *  - Otherwise the token takes a seat if one can be had: a new seat in a
   *    lobby that is not full, or, in any game, a seat the server's owner has
   *    freed by hand (README, "A player lost their seat"). No seat to be had:
   *    `error gameFull` or `gameAlreadyStarted`. Taking a seat needs a
   *    `name`: with `name: null` the answer is `error nameRequired` and
   *    nothing changes. So merely opening an invite link never takes a seat;
   *    the player has to press Join.
   * If the socket is already attached to this very game, the message works
   * like `resync`. On success the socket is detached from any OTHER game it
   * was attached to (the seat there is kept); on failure nothing changes.
   */
  | { type: 'joinGame'; code: string; name: string | null }
  /**
   * In the lobby: give up the seat; every socket attached to that seat
   * (other tabs) receives `left`. In a running game: only detach this socket
   * (the seat is kept and can be re-joined); this socket receives `left`.
   */
  | { type: 'leaveGame' }
  /** Lobby only. Rejected with `civTaken` if another seat has it. */
  | { type: 'chooseCiv'; civ: CivId }
  /** Lobby only, host only. */
  | { type: 'setMapSize'; mapSize: MapSizeId }
  /**
   * Lobby only, host only. One player is enough. Every seat becomes a player,
   * connected or not, and the game then waits for each of them every turn
   * (the client warns the host about seats that are not connected).
   */
  | { type: 'startGame' }
  /**
   * A game action. `requestId` is any number the client picks to match the
   * reply. `turn` is the turn shown on the client when the player acted;
   * the rules reject the action as `staleTurn` if that turn is over.
   */
  | { type: 'action'; requestId: number; turn: number; action: Action }
  /** "I missed an update (gap in seq): send me a full gameSync." */
  | { type: 'resync' }
  /** Liveness check, answered with `pong`. */
  | { type: 'ping' };

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export type ProtocolErrorCode =
  /** Client and server speak different protocol versions. The server closes the socket; the client reloads the page once. */
  | 'protocolMismatch'
  /** The message was not valid JSON of a known shape. */
  | 'badMessage'
  /** A message arrived before `hello`. */
  | 'notReady'
  | 'noSuchGame'
  /** Taking a seat needs a name (the client shows the name form with the code filled in). */
  | 'nameRequired'
  /** The name is empty after cleaning. */
  | 'badName'
  | 'gameFull'
  /** The game is running, this token has no seat in it, and no seat has been freed. */
  | 'gameAlreadyStarted'
  /** The message needs the socket to be attached to a game (or to a game in the right phase). */
  | 'notInGame'
  | 'notHost'
  | 'civTaken'
  | 'rateLimited'
  /** Something went wrong inside the server. The message is always SERVER_ERROR_MESSAGE. */
  | 'serverError';

/** Why an action failed: a rule said no, or the server could not save. */
export interface ActionRejection {
  code: RuleErrorCode | 'serverError';
  /**
   * Plain English, shown as a toast: RULE_ERROR_MESSAGES[code] for a rule
   * error, SERVER_ERROR_MESSAGE for 'serverError'. Never the text of an
   * exception.
   */
  message: string;
}

export type ServerMessage =
  /** Answer to `hello`. The client keeps `token` (in memory and in localStorage) and sends it in every later `hello`. */
  | { type: 'welcome'; protocol: number; token: string }
  /** The whole lobby. Sent on attach and on every change while the game has not started. */
  | { type: 'lobby'; lobby: LobbyView }
  /**
   * A full view. Sent when a socket attaches to a running game, when the game
   * starts, on `resync`, and instead of every `gameUpdate` when the server
   * runs with patches turned off. The client takes `seq` as it comes (a
   * gameSync is always right) and counts on from it. `connected` lists the
   * players with at least one socket attached.
   */
  | { type: 'gameSync'; code: GameCode; seq: number; view: PlayerView; connected: PlayerId[]; events: GameEvent[] }
  /**
   * A change to this player's view. `seq` is always the `seq` of the last
   * gameSync or gameUpdate on this socket plus one; on a gap the client
   * ignores the message and sends `resync`. Never sent to a player whose
   * view did not change.
   */
  | { type: 'gameUpdate'; seq: number; patch: ViewPatch; events: GameEvent[] }
  /** Who is connected changed (running games only; in the lobby the `lobby` message carries it). */
  | { type: 'presence'; connected: PlayerId[] }
  | { type: 'actionOk'; requestId: number }
  | { type: 'actionRejected'; requestId: number; error: ActionRejection }
  /**
   * This socket is no longer attached to any game: the answer to
   * `leaveGame`, also sent to the other sockets of a seat that was given up
   * in the lobby. (In a running game the seat is kept. A page that is sent
   * `left` while it shows a running game pressed Leave in the lobby just as
   * the game started; it sends `joinGame` again to stay in its game.)
   */
  | { type: 'left' }
  /**
   * Anything else that went wrong. Never carries a requestId (see point 5 at
   * the top). The socket stays open except after `protocolMismatch`.
   */
  | { type: 'error'; code: ProtocolErrorCode; message: string }
  | { type: 'pong' };
