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

import { WS_PATH } from '@domination/shared';
import type { GameCode } from '@domination/shared';

/** localStorage keys used by the game (before the profile suffix, see above). */
export const STORAGE_KEYS = {
  token: 'domination.token',
  playerName: 'domination.name',
  lastGame: 'domination.lastGame',
} as const;

/** sessionStorage key of the "this tab has already been reloaded once" flag (see reloadPageOnce). */
const RELOADED_FLAG_KEY = 'domination.reloaded';

/** What a `?profile=` value must look like to be used. */
const PROFILE_PATTERN = /^[A-Za-z0-9]{1,16}$/;

/** The token as last given to saveToken. Wins over the stored copy (see loadToken). */
let tokenInMemory: string | null = null;

// ---------------------------------------------------------------------------
// Safe access to the browser. Each helper returns null where the thing does
// not exist or throws when touched (rule 2 above).
// ---------------------------------------------------------------------------

function pageLocation(): Location | null {
  try {
    return typeof location === 'undefined' ? null : location;
  } catch {
    return null;
  }
}

function pageHistory(): History | null {
  try {
    return typeof history === 'undefined' ? null : history;
  } catch {
    return null;
  }
}

/** localStorage, or null. Merely touching it can throw in a browser that blocks storage. */
function durableStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** sessionStorage (lives as long as the tab), or null. */
function tabStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The page's `?a=1&b=2` part as a lookup table (empty where there is no address bar). */
function urlParameters(): URLSearchParams {
  try {
    return new URLSearchParams(pageLocation()?.search ?? '');
  } catch {
    return new URLSearchParams('');
  }
}

/** '' normally, or '.NAME' in a tab opened with a valid `?profile=NAME`. */
function profileSuffix(): string {
  const profile = urlParameters().get('profile');
  return profile !== null && PROFILE_PATTERN.test(profile) ? `.${profile}` : '';
}

function readStored(key: string): string | null {
  try {
    return durableStorage()?.getItem(key + profileSuffix()) ?? null;
  } catch {
    return null;
  }
}

/** Stores a value, or removes it for null. Returns true only if reading it back gives the same value. */
function writeStored(key: string, value: string | null): boolean {
  try {
    const storage = durableStorage();
    if (storage === null) return false;
    const fullKey = key + profileSuffix();
    if (value === null) storage.removeItem(fullKey);
    else storage.setItem(fullKey, value);
    return storage.getItem(fullKey) === value;
  } catch {
    return false;
  }
}

/** A game code as the rest of the app expects it: trimmed, upper case; null if nothing is left. */
function cleanGameCode(text: string | null): GameCode | null {
  const code = (text ?? '').trim().toUpperCase();
  return code === '' ? null : code;
}

// ---------------------------------------------------------------------------
// The token
// ---------------------------------------------------------------------------

/**
 * The player's token, or null on the first visit.
 *
 * The token is ALSO kept in a variable inside this module (set by saveToken),
 * and that copy wins. So a page that is open never forgets who it is, even
 * where storage is blocked: without this, the first network hiccup would
 * send `hello` with no token, get a new identity and lose the seat.
 */
export function loadToken(): string | null {
  if (tokenInMemory !== null) return tokenInMemory;
  const stored = readStored(STORAGE_KEYS.token);
  return stored === null || stored === '' ? null : stored;
}

/**
 * Remembers the token the server sent in `welcome`: in the module variable
 * (always) and in localStorage (if possible). Returns false if it could NOT
 * be stored durably (read it back to be sure); the app then warns the player
 * once that closing this tab will lose their seat.
 */
export function saveToken(token: string): boolean {
  tokenInMemory = token;
  return writeStored(STORAGE_KEYS.token, token);
}

// ---------------------------------------------------------------------------
// The player's name and last game
// ---------------------------------------------------------------------------

/** The name the player used last time, or '' if none. */
export function loadPlayerName(): string {
  return readStored(STORAGE_KEYS.playerName) ?? '';
}

export function savePlayerName(name: string): void {
  writeStored(STORAGE_KEYS.playerName, name);
}

/** The game this browser was last attached to (offered on the home screen as "Rejoin"), or null. */
export function loadLastGame(): GameCode | null {
  return cleanGameCode(readStored(STORAGE_KEYS.lastGame));
}

export function saveLastGame(code: GameCode | null): void {
  writeStored(STORAGE_KEYS.lastGame, code);
}

// ---------------------------------------------------------------------------
// The address bar
// ---------------------------------------------------------------------------

/**
 * One parameter of the page address: the text after `name=`, '' for a bare
 * `?name`, or null if the parameter is not there (or there is no address
 * bar). Demo mode (`?demo`, `?demo=lobby`) is read through this.
 */
export function urlParameter(name: string): string | null {
  return urlParameters().get(name);
}

/** The game code in the address bar (`?g=CODE`), trimmed and upper-cased, or null. */
export function gameCodeFromUrl(): GameCode | null {
  return cleanGameCode(urlParameters().get('g'));
}

/**
 * Puts `?g=CODE` into the address bar (or removes it for null) with
 * history.replaceState: no page load, and Reload brings the player back to
 * the same game. Other parameters (`profile`) are kept.
 */
export function setGameCodeInUrl(code: GameCode | null): void {
  try {
    const where = pageLocation();
    const past = pageHistory();
    if (where === null || past === null) return;
    if (gameCodeFromUrl() === code) return; // already right: leave the address alone

    const parameters = urlParameters();
    if (code === null) parameters.delete('g');
    else parameters.set('g', code);
    const query = parameters.toString();
    past.replaceState(past.state, '', where.pathname + (query === '' ? '' : `?${query}`) + where.hash);
  } catch {
    // An address bar that cannot be changed (a sandboxed frame) is not worth stopping the game for.
  }
}

/**
 * The link to send to friends: the page's own address with `?g=CODE` and no
 * other parameter (a friend must not inherit this tab's `profile`).
 */
export function shareLink(code: GameCode): string {
  const query = `?g=${encodeURIComponent(code)}`;
  try {
    const where = pageLocation();
    return where === null ? query : where.origin + where.pathname + query;
  } catch {
    return query;
  }
}

/**
 * The address of the server's WebSocket: `ws://` or `wss://` (matching how
 * the page itself was loaded) + the page's host + WS_PATH. null where there
 * is no page address (the unit tests).
 */
export function webSocketUrl(): string | null {
  try {
    const where = pageLocation();
    if (where === null || where.host === '') return null;
    return (where.protocol === 'https:' ? 'wss://' : 'ws://') + where.host + WS_PATH;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reloading the page
// ---------------------------------------------------------------------------

/**
 * Reloads the page, at most once per browser tab (a sessionStorage flag
 * remembers that it happened). Returns true if a reload was started, false
 * if this tab has already been reloaded once, cannot reload (no browser),
 * or cannot keep the flag (then "at most once" could not be promised).
 * Used after `error protocolMismatch`: one reload fetches the new client; a
 * second mismatch means reloading does not help, and the app shows a fatal
 * message instead of looping.
 */
export function reloadPageOnce(): boolean {
  try {
    const where = pageLocation();
    const flags = tabStorage();
    if (where === null || flags === null) return false;
    if (flags.getItem(RELOADED_FLAG_KEY) !== null) return false;
    // If the flag cannot be kept, "at most once" cannot be promised, and a
    // page that reloads itself for ever is worse than one that asks to be reloaded.
    flags.setItem(RELOADED_FLAG_KEY, '1');
    if (flags.getItem(RELOADED_FLAG_KEY) === null) return false;
    where.reload();
    return true;
  } catch {
    return false;
  }
}

/** Reloads the page because the player pressed a Reload button. Does nothing where there is no browser. */
export function reloadPage(): void {
  try {
    pageLocation()?.reload();
  } catch {
    // Nothing to do: the player can still use the browser's own reload button.
  }
}
