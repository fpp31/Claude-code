/**
 * Who this browser is, and which game the address bar points at
 * (work package WP4).
 *
 * There are no accounts. The server gives each browser a secret token on its
 * first visit; keeping it in localStorage is what lets a player come back to
 * their seat after a reload or days later. Losing it (clearing site data)
 * loses the seat; only the server's owner can free it again (README).
 *
 * TWO RULES FOR EVERY FUNCTION IN THIS FILE
 *  1. This is the ONLY file of the app shell that touches localStorage,
 *     sessionStorage, `location` and `history`. Everything else (the message
 *     handler, the controller...) goes through these functions.
 *  2. Every function must work where those things do not exist or refuse to
 *     work: in the unit tests (plain Node: no window, no location, no
 *     storage) and in a browser that blocks storage (private mode, strict
 *     settings). In that case reads return null / '' and writes quietly do
 *     nothing. Never let an exception out of this file.
 *
 * PROFILES, for trying several players on one computer. All tabs of one
 * browser share localStorage, so they are all the same player. Opening the
 * page with `?profile=NAME` (letters and digits, at most 16; for example
 * /?profile=2) makes that tab a different player: every key below gets the
 * suffix `.NAME` (domination.token.2). setGameCodeInUrl keeps the parameter
 * in the address bar; shareLink leaves it out.
 */

import type { GameCode } from '@domination/shared';

/** localStorage keys used by the game (before the profile suffix, see above). */
export const STORAGE_KEYS = {
  token: 'domination.token',
  playerName: 'domination.name',
  lastGame: 'domination.lastGame',
} as const;

/**
 * The player's token, or null on the first visit.
 *
 * The token is ALSO kept in a variable inside this module (set by saveToken),
 * and that copy wins. So a page that is open never forgets who it is, even
 * where storage is blocked: without this, the first network hiccup would
 * send `hello` with no token, get a new identity and lose the seat.
 */
export function loadToken(): string | null {
  throw new Error('not implemented: loadToken');
}

/**
 * Remembers the token the server sent in `welcome`: in the module variable
 * (always) and in localStorage (if possible). Returns false if it could NOT
 * be stored durably (read it back to be sure); the app then warns the player
 * once that closing this tab will lose their seat.
 */
export function saveToken(token: string): boolean {
  throw new Error('not implemented: saveToken');
}

/** The name the player used last time, or '' if none. */
export function loadPlayerName(): string {
  throw new Error('not implemented: loadPlayerName');
}

export function savePlayerName(name: string): void {
  throw new Error('not implemented: savePlayerName');
}

/** The game this browser was last attached to (offered on the home screen as "Rejoin"), or null. */
export function loadLastGame(): GameCode | null {
  throw new Error('not implemented: loadLastGame');
}

export function saveLastGame(code: GameCode | null): void {
  throw new Error('not implemented: saveLastGame');
}

/** The game code in the address bar (`?g=CODE`), trimmed and upper-cased, or null. */
export function gameCodeFromUrl(): GameCode | null {
  throw new Error('not implemented: gameCodeFromUrl');
}

/**
 * Puts `?g=CODE` into the address bar (or removes it for null) with
 * history.replaceState: no page load, and Reload brings the player back to
 * the same game. Other parameters (`profile`) are kept.
 */
export function setGameCodeInUrl(code: GameCode | null): void {
  throw new Error('not implemented: setGameCodeInUrl');
}

/**
 * The link to send to friends: the page's own address with `?g=CODE` and no
 * other parameter (a friend must not inherit this tab's `profile`).
 */
export function shareLink(code: GameCode): string {
  throw new Error('not implemented: shareLink');
}

/**
 * Reloads the page, at most once per browser tab (a sessionStorage flag
 * remembers that it happened). Returns true if a reload was started, false
 * if this tab has already been reloaded once or cannot reload (no browser).
 * Used after `error protocolMismatch`: one reload fetches the new client; a
 * second mismatch means reloading does not help, and the app shows a fatal
 * message instead of looping.
 */
export function reloadPageOnce(): boolean {
  throw new Error('not implemented: reloadPageOnce');
}
