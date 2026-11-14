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

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { GAME_CODE_ALPHABET, GAME_CODE_LENGTH } from '@domination/shared';
import type { GameCode } from '@domination/shared';

/** What a token made by newToken looks like. */
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** A new secret token: 32 lower-case hex characters (128 random bits). */
export function newToken(): string {
  return randomBytes(16).toString('hex');
}

/** True if `value` looks like a token made by newToken (exactly 32 lower-case hex characters). */
export function isValidToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** SHA-256 of the token as 64 hex characters. This, never the token, is what gets stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * A new game code: GAME_CODE_LENGTH random characters from
 * GAME_CODE_ALPHABET, for which `isTaken` returns false (draw again while
 * it returns true).
 */
export function newGameCode(isTaken: (code: GameCode) => boolean): GameCode {
  let code = randomCode();
  while (isTaken(code)) code = randomCode();
  return code;
}

/** One random code; every character of the alphabet is equally likely. */
function randomCode(): GameCode {
  let code = '';
  for (let i = 0; i < GAME_CODE_LENGTH; i++) {
    code += GAME_CODE_ALPHABET[randomInt(GAME_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Cleans up a code typed or pasted by a player: trims spaces, converts to
 * upper case. Returns null unless the result is GAME_CODE_LENGTH characters
 * from GAME_CODE_ALPHABET.
 */
export function normalizeGameCode(input: string): GameCode | null {
  const code = input.trim().toUpperCase();
  if (code.length !== GAME_CODE_LENGTH) return null;
  for (const character of code) {
    if (!GAME_CODE_ALPHABET.includes(character)) return null;
  }
  return code;
}

/** A new random game seed: 32 hex characters. */
export function newSeed(): string {
  return randomBytes(16).toString('hex');
}
