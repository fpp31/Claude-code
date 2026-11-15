import { describe, expect, it } from 'vitest';
import {
  CLEAR_ASKS_FOR_MS,
  QUEUE_ROW_GUARD_MS,
  ROW_HOLD_MS,
  createAskOnce,
  createQuietTime,
  createRowHold,
  placeCorrection,
} from '../src/ui/queuePresses';

/**
 * The timing rules of the city panel's build queue that are not a plain
 * press guard (ui/queuePresses.ts), each on a clock the test moves by hand:
 * "Empty the queue" asks once; the add buttons keep quiet after a removal;
 * the rows keep their place after a removal; and the arithmetic that puts
 * a part of the panel back where it was on the screen.
 */

/** A clock the test moves by hand. */
function clockAt(start = 20_000) {
  const clock = { now: start };
  return { clock, now: () => clock.now };
}

describe('"Empty the queue" asks once (createAskOnce)', () => {
  const ROME = 'c1_rome:warrior,scout';

  it('the first press only asks; a press after the double-click time empties', () => {
    const { clock, now } = clockAt();
    const ask = createAskOnce(now);
    expect(ask.asking(ROME)).toBe(false);

    expect(ask.press(ROME)).toBe('ask');
    expect(ask.asking(ROME)).toBe(true);

    clock.now += QUEUE_ROW_GUARD_MS;
    expect(ask.press(ROME)).toBe('empty');
    // "empty" is the panel's cue to send; the question stays open until the panel says the message went out.
    expect(ask.asking(ROME)).toBe(true);
    ask.reset();
    expect(ask.asking(ROME)).toBe(false);
    expect(ask.press(ROME)).toBe('ask');
  });

  it('a double-click does not empty: the second press comes too soon to be an answer, and so does a third', () => {
    const { clock, now } = clockAt();
    const ask = createAskOnce(now);
    expect(ask.press(ROME)).toBe('ask');
    clock.now += 120;
    expect(ask.press(ROME)).toBe('ignore');
    clock.now += QUEUE_ROW_GUARD_MS - 121;
    expect(ask.press(ROME)).toBe('ignore'); // one millisecond before the time is over
    expect(ask.asking(ROME)).toBe(true); // an ignored press neither answers nor takes the question back
    clock.now += 1;
    expect(ask.press(ROME)).toBe('empty');
  });

  it('it goes back to asking after four seconds', () => {
    const { clock, now } = clockAt();
    const ask = createAskOnce(now);
    expect(CLEAR_ASKS_FOR_MS).toBe(4000);
    ask.press(ROME);
    clock.now += CLEAR_ASKS_FOR_MS - 1;
    expect(ask.asking(ROME)).toBe(true);
    clock.now += 1;
    expect(ask.asking(ROME)).toBe(false);
    // The press after the time-out asks again; it does not empty.
    expect(ask.press(ROME)).toBe('ask');
    clock.now += CLEAR_ASKS_FOR_MS - 1;
    expect(ask.press(ROME)).toBe('empty');
  });

  it('it goes back to asking when the queue has changed, and for another city', () => {
    const { clock, now } = clockAt();
    const ask = createAskOnce(now);
    ask.press(ROME);
    clock.now += 1000;
    // The queue is another one now (an entry was completed, or moved): not the queue the player was asked about.
    expect(ask.asking('c1_rome:scout')).toBe(false);
    expect(ask.press('c1_rome:scout')).toBe('ask');
    clock.now += 1000;
    // Another city with the very same entries.
    expect(ask.asking('c1_ostia:scout')).toBe(false);
    expect(ask.press('c1_ostia:scout')).toBe('ask');
    clock.now += 1000;
    expect(ask.press('c1_ostia:scout')).toBe('empty');
  });

  it('looking at the button for the same queue is not pressing it', () => {
    const { clock, now } = clockAt();
    const ask = createAskOnce(now);
    for (let look = 0; look < 3; look++) expect(ask.asking(ROME)).toBe(false);
    expect(ask.press(ROME)).toBe('ask');
    clock.now += 700;
    for (let look = 0; look < 3; look++) expect(ask.asking(ROME)).toBe(true);
    expect(ask.press(ROME)).toBe('empty');
  });

  it('a queue that changes and changes back is not asked about any more: the question is gone for good', () => {
    const { clock, now } = clockAt();
    const ask = createAskOnce(now);
    ask.press(ROME);
    clock.now += 700;
    expect(ask.asking('c1_rome:scout,warrior')).toBe(false); // an arrow was pressed: the panel prints the button for another queue
    clock.now += 700;
    expect(ask.asking(ROME)).toBe(false); // and the arrow back: the same entries as when it asked
    expect(ask.press(ROME)).toBe('ask');
  });
});

describe('the add buttons keep quiet after a removal (createQuietTime)', () => {
  it('is quiet for 0.6 s from its start, and not before the first start', () => {
    const { clock, now } = clockAt();
    const quiet = createQuietTime(QUEUE_ROW_GUARD_MS, now);
    expect(quiet.running()).toBe(false); // two quick taps on an add button are two items: nothing has started it

    quiet.start(); // a press that removed something went out
    expect(quiet.running()).toBe(true);
    clock.now += QUEUE_ROW_GUARD_MS - 1;
    expect(quiet.running()).toBe(true);
    clock.now += 1;
    expect(quiet.running()).toBe(false);
  });

  it('starts again when the removal shows on the screen: on a slow link the add button comes under the finger only then', () => {
    const { clock, now } = clockAt();
    const quiet = createQuietTime(QUEUE_ROW_GUARD_MS, now);
    quiet.start(); // the press
    clock.now += 400; // the answer took 0.4 s
    quiet.start(); // the row is gone, the add list has moved up
    clock.now += 300; // 0.7 s after the press, 0.3 s after the screen changed
    expect(quiet.running()).toBe(true);
    clock.now += 300;
    expect(quiet.running()).toBe(false);
  });
});

describe('the rows keep their place after a removal (createRowHold)', () => {
  it('does not hold before a removal, and lets go at once when told to', () => {
    const { now } = clockAt();
    const hold = createRowHold(now);
    expect(hold.holds()).toBe(false);
    expect(hold.checkIn()).toBeNull();
    hold.pressed(false); // a press without a removal starts nothing
    hold.mouseLeft();
    expect(hold.holds()).toBe(false);

    hold.begin(true);
    expect(hold.holds()).toBe(true);
    hold.release(); // the panel shows another city, or is hidden
    expect(hold.holds()).toBe(false);
  });

  it('a finger: held until nothing was pressed in the panel for 1.5 s', () => {
    const { clock, now } = clockAt();
    const hold = createRowHold(now);
    expect(ROW_HOLD_MS).toBe(1500);

    hold.begin(false);
    expect(hold.checkIn()).toBe(ROW_HOLD_MS);
    clock.now += 900;
    expect(hold.holds()).toBe(true);
    expect(hold.checkIn()).toBe(600);
    hold.pressed(false); // the next tap, 0.9 s later: the time starts again
    clock.now += 900;
    hold.pressed(false);
    clock.now += ROW_HOLD_MS - 1;
    expect(hold.holds()).toBe(true);
    clock.now += 1;
    expect(hold.holds()).toBe(false);
    expect(hold.checkIn()).toBeNull();

    // Over is over: a press afterwards does not bring the hold back.
    hold.pressed(false);
    expect(hold.holds()).toBe(false);
  });

  it('a mouse that rests on the queue: held for as long as it stays there, and let go the moment it leaves', () => {
    const { clock, now } = clockAt();
    const hold = createRowHold(now);
    hold.begin(true);
    expect(hold.checkIn()).toBeNull(); // no timer: time alone never lets go under a resting mouse
    clock.now += 60_000;
    expect(hold.holds()).toBe(true);
    hold.mouseLeft();
    expect(hold.holds()).toBe(false);
  });

  it('a finger does not "leave", and a finger after a mouse turns the hold into one by time', () => {
    const { clock, now } = clockAt();
    const touch = createRowHold(now);
    touch.begin(false);
    touch.mouseLeft(); // (a mouse that happens to move elsewhere on a laptop with a touch screen)
    expect(touch.holds()).toBe(true);

    const both = createRowHold(now);
    both.begin(true);
    clock.now += 5000;
    both.pressed(false); // now a finger taps in the panel
    expect(both.checkIn()).toBe(ROW_HOLD_MS);
    clock.now += ROW_HOLD_MS;
    expect(both.holds()).toBe(false);
  });

  it('a second removal while held keeps holding, by the newer press', () => {
    const { clock, now } = clockAt();
    const hold = createRowHold(now);
    hold.begin(false);
    clock.now += 1000;
    hold.begin(false);
    clock.now += 1000;
    expect(hold.holds()).toBe(true);
    clock.now += 500;
    expect(hold.holds()).toBe(false);
  });
});

describe('putting a part of the panel back in its place (placeCorrection)', () => {
  it('nothing moved: nothing to do', () => {
    expect(placeCorrection('addList', 0)).toEqual({ scrollBy: 0, spacerBy: 0 });
    expect(placeCorrection('rows', 0)).toEqual({ scrollBy: 0, spacerBy: 0 });
    // Less than half a pixel is the browser placing things on fractions, not a move.
    expect(placeCorrection('addList', 0.3)).toEqual({ scrollBy: 0, spacerBy: 0 });
    expect(placeCorrection('rows', -0.4)).toEqual({ scrollBy: 0, spacerBy: 0 });
  });

  it('the add list is put back by scrolling the panel by as much as it moved, either way', () => {
    expect(placeCorrection('addList', 46)).toEqual({ scrollBy: 46, spacerBy: 0 });
    expect(placeCorrection('addList', -64)).toEqual({ scrollBy: -64, spacerBy: 0 });
  });

  it('rows that slid DOWN are put back by giving the panel its height back (a spacer), then by scrolling', () => {
    expect(placeCorrection('rows', 46)).toEqual({ scrollBy: 0, spacerBy: 46 });
    // With the spacer in, the browser may still have the panel scrolled short of where it was.
    expect(placeCorrection('rows', 46, true)).toEqual({ scrollBy: 46, spacerBy: 0 });
  });

  it('rows that slid UP are put back by scrolling alone', () => {
    expect(placeCorrection('rows', -14)).toEqual({ scrollBy: -14, spacerBy: 0 });
  });
});
