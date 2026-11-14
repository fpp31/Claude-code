import { beforeEach, describe, expect, it } from 'vitest';
import {
  MOUSE_DRAG_THRESHOLD,
  PINCH_STEP_RATIO,
  TOUCH_DRAG_THRESHOLD,
  WHEEL_UNITS_PER_STEP,
  createPointerTracker,
  createWheelStepper,
} from '../src/input/gestures';
import type { PointerKind, PointerTracker } from '../src/input/gestures';
import { focusKind, keyCommand, panDirectionOfKey } from '../src/input/keys';
import type { KeyPress } from '../src/input/keys';

/**
 * The decisions behind map input: was that a tap or a drag, how far have
 * two fingers moved, how many zoom steps is this much scrolling, which key
 * does what. These live in files without any browser in them
 * (input/gestures.ts, input/keys.ts), so they can be tested here; the thin
 * layer that listens to real browser events (input/mapInput.ts) is tried
 * out in a real browser.
 */

describe('pointer gestures (WP4)', () => {
  /** What the tracker asked for, as short readable lines. */
  let calls: string[];
  let tracker: PointerTracker;

  beforeEach(() => {
    calls = [];
    tracker = createPointerTracker({
      pan: (dx, dy) => calls.push(`pan ${dx},${dy}`),
      tap: (point) => calls.push(`tap ${point.x},${point.y}`),
      zoom: (steps, anchor) => calls.push(`zoom ${steps} at ${anchor.x},${anchor.y}`),
      hover: (point) => calls.push(point === null ? 'hover none' : `hover ${point.x},${point.y}`),
    });
  });

  const at = (id: number, kind: PointerKind, x: number, y: number) => ({ id, kind, x, y });

  it('a press and release in one place is a tap, at the place of the press', () => {
    tracker.down(at(1, 'touch', 100, 200));
    tracker.up(at(1, 'touch', 100, 200));
    expect(calls).toEqual(['tap 100,200']);
  });

  it('a mouse click is a tap too, and leaves the mouse hovering where it is', () => {
    tracker.down(at(1, 'mouse', 100, 200));
    tracker.up(at(1, 'mouse', 100, 200));
    expect(calls).toEqual(['tap 100,200', 'hover 100,200']);
  });

  it('a wobble within the threshold is still a tap: 4 px for a mouse, 10 px for a finger', () => {
    tracker.down(at(1, 'mouse', 100, 100));
    tracker.move(at(1, 'mouse', 100 + MOUSE_DRAG_THRESHOLD, 100));
    tracker.up(at(1, 'mouse', 100 + MOUSE_DRAG_THRESHOLD, 100));
    expect(calls.filter((call) => !call.startsWith('hover'))).toEqual(['tap 100,100']);

    calls.length = 0;
    tracker.down(at(2, 'touch', 100, 100));
    tracker.move(at(2, 'touch', 106, 108)); // exactly 10 px away
    tracker.up(at(2, 'touch', 106, 108));
    expect(calls).toEqual(['tap 100,100']);
    expect(TOUCH_DRAG_THRESHOLD).toBe(10);
  });

  it('moving further than the threshold is a drag: the map follows the pointer and there is no tap', () => {
    tracker.down(at(1, 'mouse', 100, 100));
    tracker.move(at(1, 'mouse', 103, 100)); // still within 4 px: nothing yet
    expect(calls).toEqual([]);
    tracker.move(at(1, 'mouse', 110, 100)); // past it: the whole 10 px at once, so the map stays under the pointer
    tracker.move(at(1, 'mouse', 115, 108)); // then the movement since the last event
    tracker.up(at(1, 'mouse', 115, 108));

    expect(calls).toEqual(['pan 10,0', 'pan 5,8', 'hover 115,108']);
  });

  it('the same wobble that is a tap for a finger is a drag for a mouse', () => {
    tracker.down(at(1, 'mouse', 100, 100));
    tracker.move(at(1, 'mouse', 107, 100));
    tracker.up(at(1, 'mouse', 107, 100));
    expect(calls).toEqual(['pan 7,0', 'hover 107,100']);

    calls.length = 0;
    tracker.down(at(2, 'touch', 100, 100));
    tracker.move(at(2, 'touch', 107, 100));
    tracker.up(at(2, 'touch', 107, 100));
    expect(calls).toEqual(['tap 100,100']);
  });

  it('a drag that comes back to where it started is still a drag, not a tap', () => {
    tracker.down(at(1, 'touch', 100, 100));
    tracker.move(at(1, 'touch', 140, 100));
    tracker.move(at(1, 'touch', 100, 100));
    tracker.up(at(1, 'touch', 100, 100));
    expect(calls).toEqual(['pan 40,0', 'pan -40,0']);
  });

  it('two fingers pinch: one zoom step each time their distance has changed by about 30%, around the point between them', () => {
    tracker.down(at(1, 'touch', 100, 300));
    tracker.down(at(2, 'touch', 200, 300)); // 100 px apart

    tracker.move(at(2, 'touch', 220, 300)); // 120 px: not yet
    expect(calls).toEqual([]);
    tracker.move(at(2, 'touch', 230, 300)); // 130 px: one step in
    expect(calls).toEqual(['zoom 1 at 165,300']);

    // Measured again from 130 px: the next step needs 169 px.
    tracker.move(at(2, 'touch', 260, 300)); // 160 px: not yet
    expect(calls).toHaveLength(1);
    tracker.move(at(2, 'touch', 270, 300)); // 170 px
    expect(calls).toEqual(['zoom 1 at 165,300', 'zoom 1 at 185,300']);

    // And back together: 170 / 1.3 is about 131 px.
    tracker.move(at(2, 'touch', 230, 300)); // 130 px
    expect(calls[2]).toBe('zoom -1 at 165,300');
    expect(PINCH_STEP_RATIO).toBeCloseTo(1.3);
  });

  it('a pinch never produces a tap or a pan, also when the fingers hardly move', () => {
    tracker.down(at(1, 'touch', 100, 300));
    tracker.down(at(2, 'touch', 200, 300));
    tracker.move(at(1, 'touch', 102, 301));
    tracker.up(at(1, 'touch', 102, 301));
    tracker.up(at(2, 'touch', 200, 300));
    expect(calls).toEqual([]);
  });

  it('after a pinch the finger that stays down drags the map but cannot tap', () => {
    tracker.down(at(1, 'touch', 100, 300));
    tracker.down(at(2, 'touch', 200, 300));
    tracker.up(at(2, 'touch', 200, 300));

    tracker.move(at(1, 'touch', 103, 300)); // no threshold any more: it is already a drag
    tracker.up(at(1, 'touch', 103, 300));
    expect(calls).toEqual(['pan 3,0']);

    // The next single press starts from scratch and can tap again.
    calls.length = 0;
    tracker.down(at(3, 'touch', 50, 50));
    tracker.up(at(3, 'touch', 50, 50));
    expect(calls).toEqual(['tap 50,50']);
  });

  it('a cancelled pointer (the browser took the gesture over) never taps', () => {
    tracker.down(at(1, 'touch', 100, 100));
    tracker.cancel(1);
    tracker.up(at(1, 'touch', 100, 100)); // a stray "up" for a pointer that is no longer pressed
    expect(calls).toEqual([]);
  });

  it('a mouse moving with no button pressed hovers; leaving the map ends the hover', () => {
    tracker.move(at(1, 'mouse', 40, 50));
    tracker.move(at(1, 'mouse', 45, 50));
    tracker.leave('mouse');
    expect(calls).toEqual(['hover 40,50', 'hover 45,50', 'hover none']);
  });

  it('touch never hovers', () => {
    tracker.move(at(1, 'touch', 40, 50));
    tracker.leave('touch');
    tracker.down(at(1, 'touch', 40, 50));
    tracker.up(at(1, 'touch', 40, 50));
    tracker.leave('touch');
    expect(calls).toEqual(['tap 40,50']);
  });

  it('while a button is held, moving the mouse does not hover', () => {
    tracker.down(at(1, 'mouse', 100, 100));
    tracker.move(at(1, 'mouse', 102, 100));
    expect(calls).toEqual([]);
  });
});

describe('wheel steps (WP4)', () => {
  it('every 100 units of scrolling is one step; wheel up zooms in, wheel down zooms out', () => {
    const wheel = createWheelStepper();
    expect(WHEEL_UNITS_PER_STEP).toBe(100);
    expect(wheel.add(-100, 0, 0)).toBe(1);
    expect(wheel.add(100, 0, 10)).toBe(-1);
    expect(wheel.add(-300, 0, 20)).toBe(3);
  });

  // What one notch of a mouse wheel is worth depends on the computer: 100
  // units on most, but 80, 67, 50 or 33 where the display or the page is
  // enlarged, and as little as 4 on some. With "100 units is one step" and
  // nothing else, turning such a wheel one notch at a time did nothing at
  // all: every notch started counting from zero again.
  it.each([100, 80, 66.67, 50, 33.34, 4])(
    'one notch at a time is one step each time, whatever a notch is worth on this computer (%s units)',
    (notch) => {
      const wheel = createWheelStepper();
      const zoomIn = [0, 600, 1200, 1800, 2400, 3000].map((time) => wheel.add(-notch, 0, time));
      expect(zoomIn).toEqual([1, 1, 1, 1, 1, 1]);
      const zoomOut = [4000, 4600, 5200].map((time) => wheel.add(notch, 0, time));
      expect(zoomOut).toEqual([-1, -1, -1]);
    },
  );

  it('three notches of 50 units, a second apart: three steps', () => {
    const wheel = createWheelStepper();
    expect([wheel.add(-50, 0, 0), wheel.add(-50, 0, 1000), wheel.add(-50, 0, 2000)]).toEqual([1, 1, 1]);
  });

  it('turned quickly, the first notch is a step at once and after it every 100 units are one more', () => {
    const wheel = createWheelStepper();
    // Notches of 50 units in quick succession: a step at once, then one for every two notches.
    expect([0, 100, 200, 300, 400].map((time) => wheel.add(-50, 0, time))).toEqual([1, 0, 1, 0, 1]);
  });

  it('adds up the many small deltas of a trackpad instead of stepping on each one', () => {
    const wheel = createWheelStepper();
    const steps = [];
    for (let event = 0; event < 10; event++) steps.push(wheel.add(-25, 0, event * 16));
    // The first event starts the zoom; after it, 225 units: two more steps, on the 4th and the 8th event that follow.
    expect(steps).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('a first event that is worth several steps is those steps, and what is left over counts on', () => {
    const wheel = createWheelStepper();
    expect(wheel.add(-250, 0, 0)).toBe(2);
    expect(wheel.add(-50, 0, 10)).toBe(1); // the 50 left over and these 50
  });

  it('turning round forgets what was left over, so the first notch back counts at once', () => {
    const wheel = createWheelStepper();
    expect(wheel.add(-100, 0, 0)).toBe(1);
    expect(wheel.add(-60, 0, 10)).toBe(0);
    expect(wheel.add(100, 0, 20)).toBe(-1); // not "-60 + 100 = 40, no step"
  });

  it('turning round while the wheel keeps turning is not a step by itself (a wheel may spring back a little)', () => {
    const wheel = createWheelStepper();
    expect(wheel.add(-50, 0, 0)).toBe(1);
    expect(wheel.add(5, 0, 30)).toBe(0);
    expect(wheel.add(-5, 0, 60)).toBe(0);
  });

  it('a pause forgets what was left over', () => {
    const wheel = createWheelStepper();
    expect(wheel.add(-100, 0, 0)).toBe(1);
    expect(wheel.add(-60, 0, 10)).toBe(0);
    expect(wheel.add(-100, 0, 5_000)).toBe(1); // seconds later: counts from zero again
    expect(wheel.add(-60, 0, 5_010)).toBe(0); // the 60 from before the pause are gone (60 + 60 would have been a step)
    expect(wheel.add(-60, 0, 5_020)).toBe(1);
  });

  it('wheels that report lines or pages instead of pixels step just the same', () => {
    const lines = createWheelStepper();
    expect(lines.add(-3, 1, 0)).toBe(1); // three lines: one notch
    expect(lines.add(-3, 1, 10)).toBe(1);
    expect(lines.add(1, 1, 1000)).toBe(-1); // a wheel set to one line per notch, turned once
    const pages = createWheelStepper();
    expect(pages.add(1, 2, 0)).toBe(-1);
    expect(pages.add(1, 2, 10)).toBe(-1);
  });

  it('scrolling sideways never zooms, and a little up and down in a sideways swipe does not either', () => {
    const wheel = createWheelStepper();
    expect(wheel.add(0, 0, 0)).toBe(0);
    expect(wheel.add(-2, 0, 16)).toBe(0); // the swipe is under way: this is not "the wheel starts turning"
    expect(wheel.add(0, 0, 32)).toBe(0);
    expect(wheel.add(3, 0, 48)).toBe(0);
  });

  it('answers a plain 0 (never -0) when no step is complete', () => {
    const wheel = createWheelStepper();
    expect(wheel.add(100, 0, 0)).toBe(-1);
    expect(Object.is(wheel.add(10, 0, 10), 0)).toBe(true);
    expect(Object.is(wheel.add(-10, 0, 20), 0)).toBe(true);
    expect(Object.is(wheel.add(-0, 0, 30), 0)).toBe(true);
    expect(Object.is(wheel.add(0, 0, 5_000), 0)).toBe(true);
  });
});

describe('keyboard shortcuts (WP4)', () => {
  /** A plain key press with nothing special about it. */
  function press(key: string, changes: Partial<KeyPress> = {}): KeyPress {
    return { key, code: '', ctrlKey: false, altKey: false, metaKey: false, repeat: false, focus: 'none', ...changes };
  }

  it('maps the documented keys to their commands', () => {
    expect(keyCommand(press('Enter'))).toEqual({ kind: 'endTurn' });
    expect(keyCommand(press('Escape'))).toEqual({ kind: 'deselect' });
    expect(keyCommand(press('f'))).toEqual({ kind: 'foundCity' });
    expect(keyCommand(press('F'))).toEqual({ kind: 'foundCity' }); // with Shift or Caps Lock
    expect(keyCommand(press('n'))).toEqual({ kind: 'nextUnit' });
    expect(keyCommand(press('+'))).toEqual({ kind: 'zoom', steps: 1 });
    expect(keyCommand(press('='))).toEqual({ kind: 'zoom', steps: 1 });
    expect(keyCommand(press('-'))).toEqual({ kind: 'zoom', steps: -1 });
    expect(keyCommand(press('_'))).toEqual({ kind: 'zoom', steps: -1 });
    expect(keyCommand(press('x'))).toBeNull();
    expect(keyCommand(press(' '))).toBeNull();
  });

  it('arrow keys and W A S D pan, by the position of the key on the keyboard', () => {
    expect(keyCommand(press('ArrowLeft', { code: 'ArrowLeft' }))).toEqual({ kind: 'pan', direction: 'left' });
    expect(keyCommand(press('ArrowRight', { code: 'ArrowRight' }))).toEqual({ kind: 'pan', direction: 'right' });
    expect(keyCommand(press('ArrowUp', { code: 'ArrowUp' }))).toEqual({ kind: 'pan', direction: 'up' });
    expect(keyCommand(press('ArrowDown', { code: 'ArrowDown' }))).toEqual({ kind: 'pan', direction: 'down' });
    expect(keyCommand(press('w', { code: 'KeyW' }))).toEqual({ kind: 'pan', direction: 'up' });
    expect(keyCommand(press('a', { code: 'KeyA' }))).toEqual({ kind: 'pan', direction: 'left' });
    expect(keyCommand(press('s', { code: 'KeyS' }))).toEqual({ kind: 'pan', direction: 'down' });
    expect(keyCommand(press('d', { code: 'KeyD' }))).toEqual({ kind: 'pan', direction: 'right' });
    // On a French keyboard the key in the W position prints "z": it still pans up.
    expect(keyCommand(press('z', { code: 'KeyW' }))).toEqual({ kind: 'pan', direction: 'up' });

    expect(panDirectionOfKey('KeyD')).toBe('right');
    expect(panDirectionOfKey('KeyF')).toBeNull();
    expect(panDirectionOfKey('toString')).toBeNull(); // not fooled by names every object has
  });

  it('ignores keys pressed with Ctrl, Alt or Meta: those belong to the browser', () => {
    expect(keyCommand(press('f', { ctrlKey: true }))).toBeNull();
    expect(keyCommand(press('n', { metaKey: true }))).toBeNull();
    expect(keyCommand(press('ArrowLeft', { code: 'ArrowLeft', altKey: true }))).toBeNull();
    expect(keyCommand(press('+', { ctrlKey: true }))).toBeNull(); // the browser's own zoom
  });

  it('ignores every key while a text field has the focus', () => {
    for (const key of ['Enter', 'Escape', 'f', 'n', '+', '-']) {
      expect(keyCommand(press(key, { focus: 'text' }))).toBeNull();
    }
    expect(keyCommand(press('a', { code: 'KeyA', focus: 'text' }))).toBeNull();
  });

  it('a focused button keeps Enter and Space for itself; every other key still works', () => {
    expect(keyCommand(press('Enter', { focus: 'button' }))).toBeNull();
    expect(keyCommand(press(' ', { focus: 'button' }))).toBeNull();
    expect(keyCommand(press('Escape', { focus: 'button' }))).toEqual({ kind: 'deselect' });
    expect(keyCommand(press('n', { focus: 'button' }))).toEqual({ kind: 'nextUnit' });
    expect(keyCommand(press('ArrowUp', { code: 'ArrowUp', focus: 'button' }))).toEqual({ kind: 'pan', direction: 'up' });
    expect(keyCommand(press('+', { focus: 'button' }))).toEqual({ kind: 'zoom', steps: 1 });
  });

  it('ignores the repeats of a held key', () => {
    expect(keyCommand(press('Enter', { repeat: true }))).toBeNull();
    expect(keyCommand(press('n', { repeat: true }))).toBeNull();
    expect(keyCommand(press('ArrowLeft', { code: 'ArrowLeft', repeat: true }))).toBeNull();
  });

  it('focusKind tells places to type from buttons from everything else', () => {
    expect(focusKind(null)).toBe('none');
    expect(focusKind({ tagName: 'BODY' })).toBe('none');
    expect(focusKind({ tagName: 'CANVAS' })).toBe('none');
    expect(focusKind({ tagName: 'INPUT' })).toBe('text');
    expect(focusKind({ tagName: 'textarea' })).toBe('text');
    expect(focusKind({ tagName: 'SELECT' })).toBe('text');
    expect(focusKind({ tagName: 'DIV', isContentEditable: true })).toBe('text');
    expect(focusKind({ tagName: 'BUTTON' })).toBe('button');
  });
});
