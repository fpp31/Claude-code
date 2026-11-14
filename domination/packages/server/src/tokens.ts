/**
 * Secrets and codes. All randomness here comes from node:crypto; it has
 * nothing to do with the seeded game randomness in packages/shared.
 *
 * Identity model: there are no accounts. On a browser's first visit the
 * server makes a random TOKEN and the browser keeps it in localStorage. A
 * seat in a game remembers only the SHA-256 hash of its owner's token.
 * Whoever presents a token with that hash is that player: this is how a
 * player gets back to their seat after a reload, days later, or after a
 * server restart.
 */

import type { GameCode } from '@domination/shared';

/** A new secret token: 32 lower-case hex characters (128 random bits). */
export function newToken(): string {
  throw new Error('not implemented: newToken');
}

/** True if `value` looks like a token made by newToken (exactly 32 lower-case hex characters). */
export function isValidToken(value: unknown): value is string {
  throw new Error('not implemented: isValidToken');
}

/** SHA-256 of the token as 64 hex characters. This, never the token, is what gets stored. */
export function hashToken(token: string): string {
  throw new Error('not implemented: hashToken');
}

/**
 * A new game code: GAME_CODE_LENGTH random characters from
 * GAME_CODE_ALPHABET, for which `isTaken` returns false (draw again while
 * it returns true).
 */
export function newGameCode(isTaken: (code: GameCode) => boolean): GameCode {
  throw new Error('not implemented: newGameCode');
}

/**
 * Cleans up a code typed or pasted by a player: trims spaces, converts to
 * upper case. Returns null unless the result is GAME_CODE_LENGTH characters
 * from GAME_CODE_ALPHABET.
 */
export function normalizeGameCode(input: string): GameCode | null {
  throw new Error('not implemented: normalizeGameCode');
}

/** A new random game seed: 32 hex characters. */
export function newSeed(): string {
  throw new Error('not implemented: newSeed');
}
