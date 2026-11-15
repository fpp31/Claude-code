/**
 * The timing rules of the build queue's buttons, beside the press guards of
 * ui/pressGuard.ts. Each is a small object with a clock handed in; nothing
 * in here touches the page, so all of it is tested in plain Node. The city
 * panel (ui/cityPanel.ts) only calls them and prints what they say.
 *
 * Why there are rules at all: a button of the queue changes what lies under
 * the pointer. A row goes away and another slides into its place; the last
 * row goes away and the add list moves up. A second press on the same spot,
 * the second click of a double-click or a tap "to make sure", must never do
 * something the player did not choose.
 */

/**
 * For this long after a press of a queue ROW button (up, down, remove) went
 * out, a press on the SAME button of the SAME row place is ignored (the
 * keyed guard of ui/pressGuard.ts). A double-click then removes one entry,
 * not two, and an arrow does not undo itself. A press on another row's
 * button, or on another button of the same row, counts at once. The same
 * time is the quiet time of the add buttons after a removal, and the time
 * "Empty the queue" takes a second press for the end of a double-click.
 */
export const QUEUE_ROW_GUARD_MS = 600;

/** How long "Empty the queue" waits for its second press before it goes back to asking. */
export const CLEAR_ASKS_FOR_MS = 4000;

/**
 * How long the rows of the queue keep their place after a removal when no
 * mouse rests on them (a finger, the keyboard): until nothing has been
 * pressed in the panel for this long.
 */
export const ROW_HOLD_MS = 1500;

// ---------------------------------------------------------------------------
// "Empty the queue" asks once
// ---------------------------------------------------------------------------

/** What a press of "Empty the queue" does: ask first, ignore the end of a double-click, or empty the queue. */
export type ClearPress = 'ask' | 'ignore' | 'empty';

/**
 * "Empty the queue" asks once: the first press only turns the button into
 * "Tap again to empty the queue". A queue is named by a string (the city
 * and its entries); a question is only ever about the queue it was asked
 * for.
 */
export interface AskOnce {
  /**
   * A press of the button while it stands for this queue.
   *  - 'ask': it was not waiting for an answer about this queue (never
   *    asked, asked more than CLEAR_ASKS_FOR_MS ago, or asked about another
   *    queue or another city): it is now.
   *  - 'ignore': it asked less than QUEUE_ROW_GUARD_MS ago. The second
   *    click of a double-click comes too soon to count as an answer.
   *  - 'empty': the answer. The panel sends the empty queue, and calls
   *    reset() if the message went out (if not, the button goes on waiting).
   */
  press(queue: string): ClearPress;
  /**
   * Is the button waiting for its second press about this queue right now?
   * The panel asks this whenever it prints the button. A question that is
   * over (out of time, or the button now stands for another queue) is
   * forgotten for good by this look: a queue that changes and changes back
   * is not asked about any more.
   */
  asking(queue: string): boolean;
  /** Takes the question back: the queue was emptied, the panel is hidden, or no order can be given any more. */
  reset(): void;
}

/** @param now  the clock in milliseconds; only tests pass one */
export function createAskOnce(now: () => number = Date.now): AskOnce {
  let asked: { queue: string; at: number } | null = null;

  function asking(queue: string): boolean {
    if (asked !== null && (asked.queue !== queue || now() - asked.at >= CLEAR_ASKS_FOR_MS)) asked = null;
    return asked !== null;
  }

  return {
    press(queue) {
      const time = now();
      if (!asking(queue) || asked === null) {
        asked = { queue, at: time };
        return 'ask';
      }
      return time - asked.at < QUEUE_ROW_GUARD_MS ? 'ignore' : 'empty';
    },
    asking,
    reset() {
      asked = null;
    },
  };
}

// ---------------------------------------------------------------------------
// A quiet time: the add buttons after a removal
// ---------------------------------------------------------------------------

/**
 * A stretch of time that is started by hand and is over by itself. The
 * city panel starts one when a press REMOVED something from the queue (one
 * entry, or all of them): the row, or the whole queue, goes away, and an
 * add button or "Empty the queue" moves to where the pressed button was.
 * While the time runs, those ignore presses. Nothing else starts it, so two
 * quick taps on an add button stay two items.
 */
export interface QuietTime {
  /** Starts the time, or starts it again. */
  start(): void;
  /** Is it running? False before the first start. */
  running(): boolean;
}

/**
 * @param quietMs  how long the time runs after each start
 * @param now      the clock in milliseconds; only tests pass one
 */
export function createQuietTime(quietMs: number, now: () => number = Date.now): QuietTime {
  let startedAt: number | null = null;
  return {
    start() {
      startedAt = now();
    },
    running() {
      return startedAt !== null && now() - startedAt < quietMs;
    },
  };
}

// ---------------------------------------------------------------------------
// The rows keep their place after a removal
// ---------------------------------------------------------------------------

/**
 * After a removal the rows ABOVE the removed one must stay where they are
 * on the screen, so that the entry that followed comes under the pointer,
 * as in any list. The city panel is fixed at its bottom edge and would
 * shrink at its top (or, scrolled to its end, slide its content down); it
 * therefore keeps its height for a while. This object says for how long:
 *  - a MOUSE rests on the queue after its click: for as long as it stays
 *    there. Time alone never lets go, because letting go moves the rows
 *    under a pointer that may be about to click again;
 *  - a finger or the keyboard has no "leave": until nothing has been
 *    pressed in the panel for ROW_HOLD_MS.
 */
export interface RowHold {
  /**
   * A removal the player pressed has shown on the screen.
   *
   * @param byMouse  the press came from a mouse, which now rests on the queue
   */
  begin(byMouse: boolean): void;
  /** Something in the panel was pressed. While held, the time starts again, and `byMouse` says who holds from now on. */
  pressed(byMouse: boolean): void;
  /** The mouse has moved to a place outside the queue. Lets go if a mouse was holding. */
  mouseLeft(): void;
  /** Is the panel still held? */
  holds(): boolean;
  /**
   * For the page's timer: in how many milliseconds holds() can next turn
   * false by time alone. Null while it does not hold, and while a resting
   * mouse holds (no timer is needed then).
   */
  checkIn(): number | null;
  /** Lets go at once: the panel shows another city, or is hidden. */
  release(): void;
}

/** @param now  the clock in milliseconds; only tests pass one */
export function createRowHold(now: () => number = Date.now): RowHold {
  let held = false;
  let mouseRests = false;
  let lastPressAt = 0;

  function holds(): boolean {
    if (held && !mouseRests && now() - lastPressAt >= ROW_HOLD_MS) held = false;
    return held;
  }

  return {
    begin(byMouse) {
      held = true;
      mouseRests = byMouse;
      lastPressAt = now();
    },
    pressed(byMouse) {
      if (!holds()) return;
      mouseRests = byMouse;
      lastPressAt = now();
    },
    mouseLeft() {
      if (mouseRests) held = false;
    },
    holds,
    checkIn() {
      if (!holds() || mouseRests) return null;
      return ROW_HOLD_MS - (now() - lastPressAt);
    },
    release() {
      held = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Putting a part of the panel back in its place
// ---------------------------------------------------------------------------

/** The part of the city panel that must not move on the screen: the add list (the queue grew) or the rows (an entry was removed). */
export type KeptPart = 'addList' | 'rows';

/** What to do to the panel: scroll it by so many pixels, and make the spacer under the rows so many pixels taller. */
export interface PlaceCorrection {
  scrollBy: number;
  spacerBy: number;
}

/**
 * A part of the panel is `moved` pixels further down the screen than it was
 * (negative: further up). What puts it back?
 *  - The add list: scrolling the panel by as much.
 *  - The rows, further DOWN (the panel shrank at its top, or its content
 *    slid down because the panel was scrolled to its end): first the panel
 *    gets its height back, through a spacer under the rows; if the rows are
 *    still out of place after that (`spacerTried`), the rest is scrolled.
 *  - The rows, further UP: scrolling.
 * A move of less than half a pixel is the browser placing things on
 * fractions of a pixel, not a move.
 *
 * @param spacerTried  the spacer has been made taller for this move already
 */
export function placeCorrection(part: KeptPart, moved: number, spacerTried = false): PlaceCorrection {
  if (Math.abs(moved) < 0.5) return { scrollBy: 0, spacerBy: 0 };
  if (part === 'rows' && moved > 0 && !spacerTried) return { scrollBy: 0, spacerBy: moved };
  return { scrollBy: moved, spacerBy: 0 };
}
