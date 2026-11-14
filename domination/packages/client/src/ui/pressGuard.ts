/**
 * A guard against one press arriving twice (work package WP4).
 *
 * A double-click on "Start game" or "Leave" sends the message twice. The
 * first one does the job and takes the page to another screen; the server
 * can only answer the second with "You are not in a game where that is
 * possible right now", a red message on the very screen the first press led
 * to. Nothing is wrong, and the player is told that something is.
 *
 * The guard is a short stretch of time, not a wait for the server's answer:
 * a button that waited for an answer would stay dead if the message was
 * lost together with the connection. No browser in here, so it is tested in
 * plain Node.
 */

/** How long after a press that went out the next one is ignored, in milliseconds (a double-click takes less than half of it). */
export const PRESS_GUARD_MS = 1000;

export interface PressGuard {
  /**
   * Runs `send` unless an earlier press went out less than the guard time
   * ago. `send` answers whether its message really went out; only then does
   * the guard time start (a press the connection refused may be tried again
   * at once).
   */
  press(send: () => boolean): void;
}

/**
 * @param guardMs  how long presses are ignored after one that went out
 * @param now      the clock in milliseconds; only tests pass one
 */
export function createPressGuard(guardMs: number = PRESS_GUARD_MS, now: () => number = Date.now): PressGuard {
  let lastSentAt: number | null = null;
  return {
    press(send) {
      const time = now();
      if (lastSentAt !== null && time - lastSentAt < guardMs) return;
      if (send()) lastSentAt = time;
    },
  };
}
