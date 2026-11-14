/**
 * Telling "not written yet" apart from "broken".
 *
 * A tool for building the game in several work packages at the same time.
 * Phase 1 was built that way; every part of it is finished now, so nothing
 * in the game uses this file today. It stays for the next phase.
 *
 * How it is used: a function that still has to be written gets its final
 * signature and doc comment, and a body that says so:
 *
 *   export function resolveCombat(...): CombatResult {
 *     throw notImplementedError('resolveCombat');
 *   }
 *
 * Tests that need ANOTHER package's unfinished function step aside politely
 * instead of failing:
 *
 *   describe.skipIf(!isImplemented(() => resolveCombat(...)))('with real combat', () => { ... });
 *
 * Such a block switches itself on the moment the other package lands. When
 * the packages are merged, the guards are taken out again, so that a test
 * can never be skipped without anybody noticing.
 */

/** How the message of every "not written yet" error begins. */
const NOT_IMPLEMENTED = 'not implemented';

/** The error a function throws while it is still to be written. `name` is the function's name. */
export function notImplementedError(name: string): Error {
  return new Error(`${NOT_IMPLEMENTED}: ${name}`);
}

/** True if `error` is a "not written yet" error (see notImplementedError). */
export function isNotImplementedError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(NOT_IMPLEMENTED);
}

/**
 * Calls `probe` and returns false if it (or anything it calls) is still to
 * be written. Returns true in every other case, also when `probe` throws
 * some other error: the code exists then, and its own tests will complain.
 */
export function isImplemented(probe: () => unknown): boolean {
  try {
    probe();
  } catch (error) {
    if (isNotImplementedError(error)) return false;
  }
  return true;
}
