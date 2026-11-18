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

/**
 * A press guard for a GROUP of buttons, each with a key of its own (the
 * rows of the build queue: 'up:2' is the up arrow of the third row place).
 *
 * A row button keeps its place on the screen while the entries move through
 * the rows. So the second click of a double-click lands on the SAME button,
 * which by then holds another entry: that press must be ignored. A press on
 * another button is a new decision of the player's and counts at once,
 * however soon it comes: "up on row 6, up on row 5, up on row 4" carries
 * one entry to the top at any pace.
 */
export interface KeyedPressGuard {
  /**
   * Runs `send` unless a press with the SAME key went out less than the
   * guard time ago. `send` answers whether its message really went out;
   * only then does the guard time of that key start.
   */
  press(key: string, send: () => boolean): void;
  /**
   * The button that was pressed last has gone from the screen, and the
   * keyboard focus was moved to the button with this key (see the city
   * panel). A press on that button is then ignored for the rest of the
   * guard time of that last press: the second Enter of a double press must
   * not count there. Does nothing if no press went out within the guard time.
   */
  carryOver(key: string): void;
  /**
   * The change the last press asked for has shown on the screen: the
   * server's answer has arrived. The guard time of that press starts again
   * from this moment, for its button (and for a button it is then carried
   * over to). The guard is there because another entry slides under the
   * pointer, and on a slow link it slides there only now: counted from the
   * press alone, a tap "to make sure" 0.7 s later hit the next entry 0.2 s
   * after it had appeared. Does nothing if no press has gone out.
   */
  changeShown(): void;
}

/**
 * @param guardMs  how long a press on a key is ignored after one on the same key that went out
 * @param now      the clock in milliseconds; only tests pass one
 */
export function createKeyedPressGuard(guardMs: number, now: () => number = Date.now): KeyedPressGuard {
  /** When the last press that went out was, key by key. */
  const sentAt = new Map<string, number>();
  let lastSentAt: number | null = null;
  return {
    press(key, send) {
      const time = now();
      const before = sentAt.get(key);
      if (before !== undefined && time - before < guardMs) return;
      if (!send()) return;
      // Times that are over are of no use any more: the map never holds more than the presses of one guard time.
      for (const [other, at] of sentAt) if (time - at >= guardMs) sentAt.delete(other);
      sentAt.set(key, time);
      lastSentAt = time;
    },
    carryOver(key) {
      if (lastSentAt === null || now() - lastSentAt >= guardMs) return;
      const before = sentAt.get(key);
      if (before === undefined || before < lastSentAt) sentAt.set(key, lastSentAt);
    },
    changeShown() {
      if (lastSentAt === null) return;
      const time = now();
      // The button that was pressed last, and any button its time was carried over to.
      for (const [key, at] of sentAt) if (at === lastSentAt) sentAt.set(key, time);
      lastSentAt = time;
    },
  };
}
