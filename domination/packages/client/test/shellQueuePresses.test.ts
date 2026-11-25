import { describe, expect, it } from 'vitest';
import {
  ASKS_FOR_MS,
  QUEUE_ROW_GUARD_MS,
  ROW_HOLD_MS,
  createAskOnce,
  createChangeWatch,
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

describe('a button that asks once (createAskOnce): "Empty the queue"', () => {
  const ROME = 'c1_rome:warrior,scout';

  it('the first press only asks; a press after the double-click time empties', () => {
    const { clock, now } = clockAt();
    const ask = createAskOnce(now);
    expect(ask.asking(ROME)).toBe(false);

    expect(ask.press(ROME)).toBe('ask');
    expect(ask.asking(ROME)).toBe(true);

    clock.now += QUEUE_ROW_GUARD_MS;
    expect(ask.press(ROME)).toBe('go');
    // "go" is the panel's cue to send; the question stays open until the panel says the message went out.
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
    expect(ask.press(ROME)).toBe('go');
  });

  it('it goes back to asking after four seconds', () => {
    const { clock, now } = clockAt();
    const ask = createAskOnce(now);
    expect(ASKS_FOR_MS).toBe(4000);
    ask.press(ROME);
    clock.now += ASKS_FOR_MS - 1;
    expect(ask.asking(ROME)).toBe(true);
    clock.now += 1;
    expect(ask.asking(ROME)).toBe(false);
    // The press after the time-out asks again; it does not empty.
    expect(ask.press(ROME)).toBe('ask');
    clock.now += ASKS_FOR_MS - 1;
    expect(ask.press(ROME)).toBe('go');
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
    expect(ask.press('c1_ostia:scout')).toBe('go');
  });

  it('looking at the button for the same queue is not pressing it', () => {
    const { clock, now } = clockAt();
    const ask = createAskOnce(now);
    for (let look = 0; look < 3; look++) expect(ask.asking(ROME)).toBe(false);
    expect(ask.press(ROME)).toBe('ask');
    clock.now += 700;
    for (let look = 0; look < 3; look++) expect(ask.asking(ROME)).toBe(true);
    expect(ask.press(ROME)).toBe('go');
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

describe('a button that asks once (createAskOnce): "Stop work", whose subject is the unit, its job and the turns worked', () => {
  /** The subject the controller hands over: `<unit id>:<improvement>:<turnsWorked>`. */
  const stop = (unitId: string, improvement: string, turnsWorked: number): string => `${unitId}:${improvement}:${turnsWorked}`;
  const WORKER = stop('u1_m4wq7e', 'farm', 1);

  it('ask, ignore, go: the first press asks, a second within 0.6 s is the end of a double-click, a later one goes ahead', () => {
    const { clock, now } = clockAt();
    const ask = createAskOnce(now);
    expect(ask.asking(WORKER)).toBe(false);
    expect(ask.press(WORKER)).toBe('ask');
    expect(ask.asking(WORKER)).toBe(true);
    clock.now += QUEUE_ROW_GUARD_MS - 1;
    expect(ask.press(WORKER)).toBe('ignore');
    clock.now += 1;
    expect(ask.press(WORKER)).toBe('go');
    // A 'go' whose message could not go out leaves the question standing: the next press is 'go' again.
    expect(ask.asking(WORKER)).toBe(true);
    expect(ask.press(WORKER)).toBe('go');
    ask.reset(); // the message went out
    expect(ask.asking(WORKER)).toBe(false);
  });

  it('back to asking after ASKS_FOR_MS: a press four seconds after the question asks again, it does not stop the work', () => {
    const { clock, now } = clockAt();
    const ask = createAskOnce(now);
    expect(ASKS_FOR_MS).toBe(4000);
    expect(ask.press(WORKER)).toBe('ask');
    clock.now += ASKS_FOR_MS - 1;
    expect(ask.asking(WORKER)).toBe(true);
    clock.now += 1;
    expect(ask.asking(WORKER)).toBe(false);
    expect(ask.press(WORKER)).toBe('ask');
    clock.now += QUEUE_ROW_GUARD_MS;
    expect(ask.press(WORKER)).toBe('go');
  });

  it('another count of turns is another question, and so are another job and another unit', () => {
    const { clock, now } = clockAt();
    const ask = createAskOnce(now);
    expect(ask.press(WORKER)).toBe('ask');
    clock.now += 1000;
    // The turn resolved meanwhile: two turns would be lost now, which nobody has agreed to.
    const aTurnLater = stop('u1_m4wq7e', 'farm', 2);
    expect(ask.asking(aTurnLater)).toBe(false);
    expect(ask.press(aTurnLater)).toBe('ask');
    clock.now += 1000;
    expect(ask.press(aTurnLater)).toBe('go');
    ask.reset();

    // The same unit on another job with the same count, and another unit on the same job.
    expect(ask.press(stop('u1_m4wq7e', 'mine', 2))).toBe('ask');
    clock.now += 1000;
    expect(ask.press(stop('u1_f1sher', 'fishingNet', 2))).toBe('ask');
    clock.now += 1000;
    expect(ask.asking(stop('u1_m4wq7e', 'mine', 2))).toBe(false);
    expect(ask.asking(stop('u1_f1sher', 'fishingNet', 2))).toBe(false); // that look at another subject ended the question for good
  });

  it('the two buttons do not share a question: each user makes its own', () => {
    const { clock, now } = clockAt();
    const emptyTheQueue = createAskOnce(now);
    const stopWork = createAskOnce(now);
    expect(emptyTheQueue.press('c1_rome:warrior,scout')).toBe('ask');
    expect(stopWork.asking(WORKER)).toBe(false);
    expect(stopWork.press(WORKER)).toBe('ask');
    clock.now += 1000;
    expect(emptyTheQueue.press('c1_rome:warrior,scout')).toBe('go');
    expect(stopWork.press(WORKER)).toBe('go');
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
    hold.pressed(false, true); // a press without a removal starts nothing
    hold.pressHandled();
    hold.mouseLeft();
    expect(hold.holds()).toBe(false);

    hold.begin(true);
    expect(hold.holds()).toBe(true);
    hold.release(); // the panel shows another city, or is hidden
    expect(hold.holds()).toBe(false);
  });

  it('a finger: taps on the rows keep the hold, however far apart; it is not let go by time between taps of a thoughtful finger', () => {
    const { clock, now } = clockAt();
    const hold = createRowHold(now);
    hold.begin(false);
    // Taps on one x, 1.8 s and 2.5 s apart (1.5 s used to be the limit): each removal shows and begins again.
    for (const gap of [1800, 2500, 1800, 5000]) {
      clock.now += gap;
      expect(hold.holds(), `${gap} ms after the last tap`).toBe(true);
      hold.pressed(false, true);
      hold.pressHandled(); // a press on the rows that has been handled lets nothing go
      expect(hold.holds()).toBe(true);
      hold.begin(false);
    }
  });

  it('a finger: a press that lands outside the rows lets go, but only when that press has been handled', () => {
    const { clock, now } = clockAt();
    const hold = createRowHold(now);
    hold.begin(false);
    clock.now += 900;
    hold.pressed(false, false); // the finger goes down on an add button
    // Between its down and its up nothing may move: still held.
    expect(hold.holds()).toBe(true);
    clock.now += 80;
    expect(hold.holds()).toBe(true);
    hold.pressHandled(); // the add button has taken its click
    expect(hold.holds()).toBe(false);
    expect(hold.checkIn()).toBeNull();

    // Over is over: a press afterwards does not bring the hold back.
    hold.pressed(false, true);
    expect(hold.holds()).toBe(false);
  });

  it('a press outside the rows that turns out to be no press (the browser took it for scrolling) lets nothing go: the next press decides', () => {
    const { now } = clockAt();
    const hold = createRowHold(now);
    hold.begin(false);
    hold.pressed(false, false); // a finger goes down beside the rows...
    hold.pressed(false, true); // ...nothing was handled; the next press is on a row's x
    hold.pressHandled();
    expect(hold.holds()).toBe(true);
  });

  it('a finger: 8 s after the last press the rows are let go by time alone', () => {
    const { clock, now } = clockAt();
    const hold = createRowHold(now);
    expect(ROW_HOLD_MS).toBe(8000);

    hold.begin(false);
    expect(hold.checkIn()).toBe(ROW_HOLD_MS);
    clock.now += 3000;
    expect(hold.holds()).toBe(true);
    expect(hold.checkIn()).toBe(ROW_HOLD_MS - 3000);
    hold.pressed(false, true); // a tap on the rows: the time starts again
    expect(hold.checkIn()).toBe(ROW_HOLD_MS);
    clock.now += ROW_HOLD_MS - 1;
    expect(hold.holds()).toBe(true);
    clock.now += 1;
    expect(hold.holds()).toBe(false);
    expect(hold.checkIn()).toBeNull();
  });

  it('the keyboard is held like a finger: Enter on a row\'s button keeps the hold, Enter on a button outside the rows ends it once it is handled', () => {
    const { clock, now } = clockAt();
    const hold = createRowHold(now);
    hold.begin(false);
    clock.now += 2000;
    hold.pressed(false, true);
    hold.pressHandled();
    expect(hold.holds()).toBe(true);
    clock.now += 2000;
    hold.pressed(false, false);
    hold.pressHandled();
    expect(hold.holds()).toBe(false);
  });

  it('a mouse that rests on the queue: held for as long as it stays there, and let go the moment it leaves', () => {
    const { clock, now } = clockAt();
    const hold = createRowHold(now);
    hold.begin(true);
    expect(hold.checkIn()).toBeNull(); // no timer: time alone never lets go under a resting mouse
    clock.now += 60_000;
    expect(hold.holds()).toBe(true);
    // Clicks on the rows change nothing about that.
    hold.pressed(true, true);
    hold.pressHandled();
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
    both.pressed(false, true); // now a finger taps on the rows
    expect(both.checkIn()).toBe(ROW_HOLD_MS);
    clock.now += ROW_HOLD_MS;
    expect(both.holds()).toBe(false);
  });

  it('a second removal while held keeps holding, by the newer press', () => {
    const { clock, now } = clockAt();
    const hold = createRowHold(now);
    hold.begin(false);
    clock.now += 5000;
    hold.begin(false);
    clock.now += 5000;
    expect(hold.holds()).toBe(true); // 10 s after the first removal, 5 s after the second
    clock.now += ROW_HOLD_MS - 5000;
    expect(hold.holds()).toBe(false);
  });
});

describe('the change a press asked for has shown on the screen (createChangeWatch)', () => {
  const BEFORE = 'c1_rome:warrior,scout,settler';
  const AFTER = 'c1_rome:warrior,scout';

  it('says so exactly once: when the queue on the screen is no longer the one the press was made on', () => {
    const watch = createChangeWatch();
    expect(watch.shown(BEFORE, false)).toBe(false); // nothing was pressed
    watch.sent(BEFORE);
    expect(watch.shown(BEFORE, true)).toBe(false); // the answer is on its way; the panel is printed for other reasons meanwhile
    expect(watch.shown(BEFORE, true)).toBe(false);
    expect(watch.shown(AFTER, true)).toBe(true); // the view with the changed queue (it comes before the acknowledgement)
    expect(watch.shown(AFTER, false)).toBe(false);
    expect(watch.shown(BEFORE, false)).toBe(false);
  });

  it('a press that was refused, or changed nothing, is forgotten when its answer is in: a later change is not its change', () => {
    const watch = createChangeWatch();
    watch.sent(BEFORE);
    expect(watch.shown(BEFORE, false)).toBe(false); // the answer has come, the queue is as it was
    expect(watch.shown(AFTER, false)).toBe(false); // the turn went on and the queue changed by itself
  });

  it('is forgotten with its city: the panel shows another one, or is hidden', () => {
    const watch = createChangeWatch();
    watch.sent(BEFORE);
    watch.forget();
    expect(watch.shown(AFTER, true)).toBe(false);
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
