/**
 * When the hover box appears and goes away: the timer behind it. Like
 * gestures.ts it knows nothing about the browser or the game; the clock is
 * passed in, the way net/connection.ts does it, so the rules are tested in
 * plain Node.
 */

import type { TileIndex } from '@domination/shared';

/** How long the mouse must rest on a tile before its hover box appears. */
export const HOVER_INFO_DELAY_MS = 400;
/** The shorter rest that is enough right after another tile's box was showing. */
export const HOVER_INFO_WARM_DELAY_MS = 150;

/** What the timer tells the app to do. The app passes controller.onHoverInfo. */
export interface HoverInfoCommands {
  /** Show the hover box for this tile; null: take it away. Called only when that changes. */
  show(tile: TileIndex | null): void;
}

/** The clock. The app passes nothing (real timers); tests pass their own. */
export interface HoverInfoEnvironment {
  /** Like setTimeout. Returns something to pass to clearTimer. */
  setTimer(run: () => void, delayMs: number): unknown;
  clearTimer(timer: unknown): void;
}

/** What the app tells the timer: every way the mouse and the map can move. The timer answers through HoverInfoCommands. */
export interface HoverInfoTimer {
  /**
   * The mouse itself moved: it is over this tile now (null: over no tile,
   * or off the map).
   * @param patient  true = wait the full delay even if a box was just
   *                 showing (the app passes controller.isAiming())
   */
  pointerOver(tile: TileIndex | null, patient: boolean): void;
  /**
   * The camera moved: the box is wrong where it is.
   * @param tile       the tile under the resting mouse now (null: none)
   * @param byPointer  true if the pointer caused the move (the wheel, a
   *                   drag); false for the keyboard, centring, the map
   *                   stepping aside and a new window size
   */
  mapMoved(tile: TileIndex | null, byPointer: boolean): void;
  /**
   * A press on the map, the Escape key, the window lost the focus: away with
   * the box, and quiet until the mouse is on another tile. Returns true if
   * a box was showing (Escape then does nothing else).
   */
  dismiss(): boolean;
  /** A mouse drag of the map has ended: the quiet ends, and the tile under the mouse gets its box after the full delay. */
  dragEnded(): void;
  /** Stops a waiting timer. Called when the game screen is taken down. */
  destroy(): void;
}

/** The real clock: setTimeout and clearTimeout. */
function realTimers(): HoverInfoEnvironment {
  return {
    setTimer: (run, delayMs) => setTimeout(run, delayMs),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  };
}

/**
 * Makes the timer of one game screen. It shows nothing by itself: it calls
 * `commands.show` when the box of a tile is due and when it must go.
 *
 * The rules (A-H2 to A-H7 of the round 2 spec), in the words of the five
 * things it remembers:
 *  - a box comes when the mouse has rested on a tile for the full delay;
 *  - it goes the moment the mouse is on another tile, and the next one comes
 *    after the short delay ("warm"), unless the caller asks for patience;
 *  - after a dismiss nothing is shown until the mouse is on another tile
 *    ("quiet"); the end of a drag ends the quiet;
 *  - after the map moved by itself nothing is shown until the mouse itself
 *    moves ("still"); after the pointer moved the map, the tile under the
 *    mouse gets its box a full delay after the last move.
 *
 * @param environment  the clock; left out, the real timers are used
 */
export function createHoverInfoTimer(commands: HoverInfoCommands, environment: HoverInfoEnvironment = realTimers()): HoverInfoTimer {
  let tile: TileIndex | null = null; // under the mouse
  let shown: TileIndex | null = null; // what the box describes
  let quiet = false; // dismissed: nothing until the mouse is on another tile
  let still = false; // the map moved by itself: nothing until the mouse itself moves
  let warm = false; // a box was showing a moment ago: the next one comes sooner
  let timer: unknown = null;

  function cancel(): void {
    if (timer !== null) {
      environment.clearTimer(timer);
      timer = null;
    }
  }

  function setShown(next: TileIndex | null): void {
    if (next !== shown) {
      shown = next;
      commands.show(next);
    }
  }

  function wait(delayMs: number): void {
    cancel();
    timer = environment.setTimer(() => {
      timer = null;
      if (tile !== null && !quiet && !still) {
        warm = true;
        setShown(tile);
      }
    }, delayMs);
  }

  return {
    pointerOver(next, patient) {
      const moved = next !== tile;
      if (!moved && !still) return; // the same tile, and nothing to wake up (also while quiet)
      tile = next;
      still = false;
      if (moved) quiet = false;
      cancel();
      setShown(null); // a box never follows the mouse: it goes away at once
      if (next === null) {
        warm = false;
        return;
      }
      if (quiet) return;
      wait(warm && !patient ? HOVER_INFO_WARM_DELAY_MS : HOVER_INFO_DELAY_MS);
    },

    mapMoved(next, byPointer) {
      tile = next;
      warm = false;
      cancel();
      setShown(null);
      if (!byPointer) {
        still = true;
        return;
      }
      still = false;
      if (next !== null && !quiet) wait(HOVER_INFO_DELAY_MS);
    },

    dismiss() {
      const was = shown !== null;
      quiet = true;
      warm = false;
      cancel();
      setShown(null);
      return was;
    },

    dragEnded() {
      quiet = false;
      still = false;
      warm = false;
      if (tile !== null) wait(HOVER_INFO_DELAY_MS);
    },

    destroy() {
      cancel();
    },
  };
}
