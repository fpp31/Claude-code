/**
 * Telling "not written yet" apart from "broken".
 *
 * Every function a work package still has to write throws an Error whose
 * message starts with "not implemented: ". While the five work packages are
 * built side by side, code and tests that depend on ANOTHER package's
 * unfinished function use these two helpers to step aside politely instead
 * of failing:
 *
 *   // A test file that needs the real rules engine:
 *   describe.skipIf(!isImplemented(() => createGame(setup)))('with real rules', () => { ... });
 *
 * Such a block switches itself on the moment the other package lands; nobody
 * has to remember to un-skip it. After the merge no test may still be
 * skipped for this reason (the integrator checks the test summary).
 */

/** True if `error` is the scaffold's "not implemented: ..." error. */
export function isNotImplementedError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('not implemented');
}

/**
 * Calls `probe` and returns false if it (or anything it calls) is still a
 * scaffold stub. Returns true in every other case, also when `probe` throws
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
