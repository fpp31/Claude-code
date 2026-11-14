/**
 * Telling taps, drags, pinches and hovers apart (work package WP4).
 *
 * This file knows nothing about the browser, the map or the game: it is fed
 * plain pointer positions and answers with pan / tap / zoom / hover calls.
 * That keeps the tricky part of input (was that a tap or a drag?) testable
 * in plain Node; input/mapInput.ts connects it to real browser events.
 */

import type { ScreenPoint } from '../render/api';

/** A press that moves further than this (in CSS pixels) is a drag, not a tap. A finger is less steady than a mouse. */
export const MOUSE_DRAG_THRESHOLD = 4;
export const TOUCH_DRAG_THRESHOLD = 10;

/** Two fingers must move apart (or together) by this factor for one zoom step: about 30%. */
export const PINCH_STEP_RATIO = 1.3;

/** One wheel "notch" on most mice; while the wheel keeps turning, this much scrolling is one zoom step. */
export const WHEEL_UNITS_PER_STEP = 100;
/** Some browsers report the wheel in text lines or pages instead of pixels; this is what one of those is worth. */
const WHEEL_UNITS_PER_LINE = WHEEL_UNITS_PER_STEP / 3;
const WHEEL_UNITS_PER_PAGE = WHEEL_UNITS_PER_STEP;
/** After a pause longer than this the wheel "starts turning" anew: one step at once, and counting from zero. */
const WHEEL_PAUSE_MS = 400;

/** 'touch' also stands for a pen: neither can hover, and both wobble more than a mouse. */
export type PointerKind = 'mouse' | 'touch';

/** One pointer event, reduced to what matters here. `x` / `y` are clientX / clientY. */
export interface PointerSample {
  id: number;
  kind: PointerKind;
  x: number;
  y: number;
}

/** What the tracker asks for. */
export interface GestureCommands {
  /** Scroll the map by this much (the content follows the finger). */
  pan(dx: number, dy: number): void;
  /** A press and release without dragging, at the point where the press began. */
  tap(point: ScreenPoint): void;
  /** Zoom in (+1) or out (-1) around this point. */
  zoom(steps: number, anchor: ScreenPoint): void;
  /** The mouse rests on this point with no button pressed; null: it left the map. */
  hover(point: ScreenPoint | null): void;
}

export interface PointerTracker {
  /** A button or finger went down. */
  down(sample: PointerSample): void;
  /** A pointer moved (pressed or not). */
  move(sample: PointerSample): void;
  /** A button or finger was lifted. */
  up(sample: PointerSample): void;
  /** The browser took a pointer away (for example for a system gesture). Never a tap. */
  cancel(id: number): void;
  /** A pointer left the map without being pressed. */
  leave(kind: PointerKind): void;
}

interface PressedPointer {
  kind: PointerKind;
  /** Where the press began: the tap position, and what the drag threshold is measured from. */
  startX: number;
  startY: number;
  /** Where the pointer was at the last event that was acted on. */
  x: number;
  y: number;
}

/**
 * Creates the tracker. The rules (see also input/mapInput.ts):
 *  - one pointer, pressed and released without moving past the threshold: a TAP;
 *  - one pointer moving past the threshold: a DRAG, panned by the movement
 *    since the last event (the first pan includes the distance that was
 *    needed to cross the threshold, so the map stays under the finger);
 *  - two pointers: a PINCH, one zoom step whenever their distance has
 *    changed by PINCH_STEP_RATIO since it was last measured;
 *  - once a second pointer has touched down, nothing in that gesture is a
 *    tap any more, also not the finger that stays down longest;
 *  - a mouse moving with no button pressed HOVERS; touch never does.
 */
export function createPointerTracker(commands: GestureCommands): PointerTracker {
  const pressed = new Map<number, PressedPointer>();
  /** The single pressed pointer has moved past its threshold. */
  let dragging = false;
  /** The current press could still turn out to be a tap. */
  let tapPossible = false;
  /** Distance between the two pinching pointers when it was last measured. */
  let pinchDistance = 0;

  /** The first two pressed pointers (the ones a pinch is measured between). */
  function pinchPair(): [PressedPointer, PressedPointer] | null {
    const [first, second] = [...pressed.values()];
    return first !== undefined && second !== undefined ? [first, second] : null;
  }

  function measurePinch(): void {
    const pair = pinchPair();
    pinchDistance = pair === null ? 0 : distanceBetween(pair[0], pair[1]);
  }

  /** After a pointer has gone: decide how the ones still down carry on. */
  function afterPointerGone(): void {
    if (pressed.size === 0) {
      dragging = false;
      tapPossible = false;
    } else if (pressed.size === 1) {
      // One finger of a pinch stays down: it goes on as a drag, never as a tap.
      dragging = true;
      tapPossible = false;
    } else {
      measurePinch();
    }
  }

  return {
    down(sample) {
      pressed.set(sample.id, { kind: sample.kind, startX: sample.x, startY: sample.y, x: sample.x, y: sample.y });
      if (pressed.size === 1) {
        dragging = false;
        tapPossible = true;
      } else {
        dragging = false;
        tapPossible = false;
        measurePinch();
      }
    },

    move(sample) {
      const pointer = pressed.get(sample.id);
      if (pointer === undefined) {
        // Not pressed: a hover, but only for a mouse and only while nothing else is pressed.
        if (sample.kind === 'mouse' && pressed.size === 0) commands.hover({ x: sample.x, y: sample.y });
        return;
      }

      if (pressed.size === 1) {
        if (!dragging) {
          const threshold = pointer.kind === 'mouse' ? MOUSE_DRAG_THRESHOLD : TOUCH_DRAG_THRESHOLD;
          const moved = Math.hypot(sample.x - pointer.startX, sample.y - pointer.startY);
          if (moved <= threshold) return;
          dragging = true;
          tapPossible = false;
        }
        commands.pan(sample.x - pointer.x, sample.y - pointer.y);
        pointer.x = sample.x;
        pointer.y = sample.y;
        return;
      }

      // Two (or more) pointers: a pinch between the first two.
      pointer.x = sample.x;
      pointer.y = sample.y;
      const pair = pinchPair();
      if (pair === null) return;
      const distance = distanceBetween(pair[0], pair[1]);
      const anchor = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };
      if (distance >= pinchDistance * PINCH_STEP_RATIO) {
        commands.zoom(1, anchor);
        pinchDistance = distance;
      } else if (distance <= pinchDistance / PINCH_STEP_RATIO) {
        commands.zoom(-1, anchor);
        pinchDistance = distance;
      }
    },

    up(sample) {
      const pointer = pressed.get(sample.id);
      if (pointer === undefined) return;
      pressed.delete(sample.id);
      const wasTap = pressed.size === 0 && tapPossible && !dragging;
      afterPointerGone();
      if (wasTap) commands.tap({ x: pointer.startX, y: pointer.startY });
      // After a mouse drag the pointer rests somewhere new: hover there.
      if (pressed.size === 0 && pointer.kind === 'mouse') commands.hover({ x: sample.x, y: sample.y });
    },

    cancel(id) {
      if (!pressed.delete(id)) return;
      afterPointerGone();
    },

    leave(kind) {
      if (kind === 'mouse' && pressed.size === 0) commands.hover(null);
    },
  };
}

/** Distance between two pointers, never less than one pixel (so ratios stay finite). */
function distanceBetween(a: PressedPointer, b: PressedPointer): number {
  return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
}

export interface WheelStepper {
  /**
   * Adds one wheel event and returns how many whole zoom steps it makes:
   * positive = zoom in (wheel up), negative = zoom out, often 0.
   *
   * @param deltaY     the event's deltaY
   * @param deltaMode  the event's deltaMode: 0 = pixels, 1 = lines, 2 = pages
   * @param timeMs     when the event happened (its timeStamp)
   */
  add(deltaY: number, deltaMode: number, timeMs: number): number;
}

/**
 * Turns wheel events into whole zoom steps. Two rules:
 *
 *  1. WHEN THE WHEEL STARTS TURNING (the first event after a pause), that is
 *     one step at once, however small the event. A notch of a mouse wheel is
 *     worth 100 units on most computers, but less where the display or the
 *     page is enlarged, and very little on some: counted against a fixed
 *     100, turning such a wheel one notch at a time did nothing at all.
 *  2. WHILE IT KEEPS TURNING, every WHEEL_UNITS_PER_STEP of scrolling is one
 *     more step. Adding up, instead of one step per event, keeps trackpads
 *     (which send many small events) from shooting through all zoom levels
 *     at once.
 *
 * What is left over is forgotten when the direction turns round or the
 * scrolling pauses, so a new gesture always starts cleanly. Turning round
 * without a pause is not a step by itself (some wheels spring back a
 * little after a notch). An event that does not scroll up or down at all (a
 * sideways swipe) never zooms.
 */
export function createWheelStepper(): WheelStepper {
  /** Scrolling that has not made a step yet, in wheel units; its sign is the direction. */
  let sum = 0;
  let lastTime = Number.NEGATIVE_INFINITY;

  return {
    add(deltaY, deltaMode, timeMs) {
      const perUnit = deltaMode === 1 ? WHEEL_UNITS_PER_LINE : deltaMode === 2 ? WHEEL_UNITS_PER_PAGE : 1;
      const units = deltaY * perUnit;

      const startsTurning = timeMs - lastTime > WHEEL_PAUSE_MS;
      lastTime = timeMs;
      if (startsTurning) sum = 0;
      // A sideways swipe. It still counts as scrolling going on (lastTime), so a
      // little up and down later in the same swipe is not "the wheel starts turning".
      if (units === 0) return 0;

      const turnedRound = sum !== 0 && Math.sign(units) !== Math.sign(sum);
      if (turnedRound) sum = 0;

      sum += units;
      let whole = Math.trunc(sum / WHEEL_UNITS_PER_STEP);
      if (startsTurning && whole === 0) {
        // Rule 1: less than a full step, but the wheel has just started turning. The event is used up by the step.
        whole = Math.sign(units);
        sum = 0;
      } else {
        sum -= whole * WHEEL_UNITS_PER_STEP;
      }
      // Wheel up (negative deltaY) zooms in (positive steps). "0 - whole" avoids a "-0".
      return whole === 0 ? 0 : 0 - whole;
    },
  };
}
