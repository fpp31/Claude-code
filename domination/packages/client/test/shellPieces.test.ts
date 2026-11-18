import { describe, expect, it } from 'vitest';
import { CIVS, CIV_IDS } from '@domination/shared';
import { setCivColors } from '../src/ui/civColors';
import { PRESS_GUARD_MS, createKeyedPressGuard, createPressGuard } from '../src/ui/pressGuard';

/**
 * Two small pieces of the screens that hold a decision and need no browser:
 * the guards against a press arriving twice (ui/pressGuard.ts: one for a
 * single button, one with a key for the rows of the build queue) and the
 * colours a page element is handed for a civilization (ui/civColors.ts).
 */

describe('press guard (WP4)', () => {
  /** A guard on a clock the test sets, and a count of the presses that went out. */
  function guardAt(start = 5000) {
    const clock = { now: start };
    const sent: string[] = [];
    const guard = createPressGuard(PRESS_GUARD_MS, () => clock.now);
    const press = (label: string, accepted = true): void =>
      guard.press(() => {
        if (accepted) sent.push(label);
        return accepted;
      });
    return { clock, sent, press };
  }

  it('a double-click sends one message: the second press within the guard time is ignored', () => {
    const { clock, sent, press } = guardAt();
    press('first');
    clock.now += 120; // the second click of a double-click
    press('second');
    expect(sent).toEqual(['first']);
  });

  it('the guard is over after PRESS_GUARD_MS, counted from the press that went out: a button never stays dead', () => {
    const { clock, sent, press } = guardAt();
    press('first');
    clock.now += PRESS_GUARD_MS - 1;
    press('still guarded');
    clock.now += 1;
    press('second');
    expect(sent).toEqual(['first', 'second']);
    // An ignored press does not start the guard time again.
    expect(PRESS_GUARD_MS).toBeGreaterThanOrEqual(600);
    expect(PRESS_GUARD_MS).toBeLessThanOrEqual(2000);
  });

  it('a press the connection did not take does not start the guard: the player can press again at once', () => {
    const { clock, sent, press } = guardAt();
    press('lost', false);
    clock.now += 10;
    press('sent');
    clock.now += 10;
    press('double');
    expect(sent).toEqual(['sent']);
  });

  it('the very first press always goes out, whatever the clock says', () => {
    for (const start of [0, 1, PRESS_GUARD_MS - 1]) {
      const { sent, press } = guardAt(start);
      press('first');
      expect(sent).toEqual(['first']);
    }
  });
});

describe('keyed press guard: the row buttons of the build queue', () => {
  const GUARD_MS = 600;

  /** A keyed guard on a clock the test sets, and the keys of the presses that went out. */
  function guardAt(start = 5000) {
    const clock = { now: start };
    const sent: string[] = [];
    const guard = createKeyedPressGuard(GUARD_MS, () => clock.now);
    const press = (key: string, accepted = true): void =>
      guard.press(key, () => {
        if (accepted) sent.push(key);
        return accepted;
      });
    return { clock, sent, press, guard };
  }

  it('a double-click on one button counts once: the second press on the SAME key within the guard time is ignored', () => {
    const { clock, sent, press } = guardAt();
    press('up:2');
    clock.now += 120;
    press('up:2');
    clock.now += GUARD_MS - 121;
    press('up:2'); // still inside the guard, one millisecond before it runs out
    expect(sent).toEqual(['up:2']);
    clock.now += 1;
    press('up:2');
    expect(sent).toEqual(['up:2', 'up:2']);
  });

  it('a press on another row\'s button counts at once, at any pace: up on row 6, 5, 4, 3, 2 carries one entry to the top', () => {
    for (const gap of [0, 100, 300, 500, 700, 900]) {
      const { clock, sent, press } = guardAt();
      for (const row of [5, 4, 3, 2, 1]) {
        press(`up:${row}`);
        clock.now += gap;
      }
      expect(sent, `${gap} ms between the presses`).toEqual(['up:5', 'up:4', 'up:3', 'up:2', 'up:1']);
    }
  });

  it('the other button of the same row counts at once too', () => {
    const { clock, sent, press } = guardAt();
    press('up:3');
    clock.now += 50;
    press('down:3');
    clock.now += 50;
    press('remove:3');
    expect(sent).toEqual(['up:3', 'down:3', 'remove:3']);
  });

  it('each key has its own time: a press elsewhere in between does not end the guard of the first', () => {
    const { clock, sent, press } = guardAt();
    press('remove:2');
    clock.now += 200;
    press('up:4');
    clock.now += 200;
    press('remove:2'); // 400 ms after the accepted press on this very button
    expect(sent).toEqual(['remove:2', 'up:4']);
    clock.now += 200;
    press('remove:2');
    expect(sent).toEqual(['remove:2', 'up:4', 'remove:2']);
  });

  it('a press that did not go out starts no guard, and an ignored press does not start the time again', () => {
    const { clock, sent, press } = guardAt();
    press('remove:0', false); // the answer to another action was on its way
    clock.now += 10;
    press('remove:0');
    clock.now += GUARD_MS - 1;
    press('remove:0'); // ignored...
    clock.now += 1;
    press('remove:0'); // ...and the guard still ends 600 ms after the press that went out
    expect(sent).toEqual(['remove:0', 'remove:0']);
  });

  it('changeShown: the guard time of the last press starts again when its change shows on the screen (a slow link: the entry that followed comes under the finger only then)', () => {
    const { clock, sent, press, guard } = guardAt();
    guard.changeShown(); // nothing was pressed: nothing to start again
    press('remove:2'); // a tap on the x of row 3
    clock.now += 500;
    guard.changeShown(); // the answer took half a second: the row is gone and the next entry is under the finger NOW
    clock.now += 200;
    press('remove:2'); // a tap "to make sure", 0.7 s after the first and 0.2 s after the screen changed
    expect(sent).toEqual(['remove:2']);
    clock.now += GUARD_MS - 201;
    press('remove:2'); // one millisecond before the new time is over
    expect(sent).toEqual(['remove:2']);
    clock.now += 1;
    press('remove:2');
    expect(sent).toEqual(['remove:2', 'remove:2']);
  });

  it('changeShown starts the time again also when the first 0.6 s are long over, only for the button that was pressed last, and together with a button the focus was carried to', () => {
    const { clock, sent, press, guard } = guardAt();
    press('up:4');
    clock.now += 100;
    press('remove:2');
    clock.now += 1500; // a very slow link
    guard.changeShown();
    press('remove:2'); // the last press: guarded again
    press('up:4'); // an older press on another button: not
    expect(sent).toEqual(['up:4', 'remove:2', 'up:4']);

    // The keyboard: the row went away, the focus is moved to the x of the new last row, in the moment the change shows.
    const keys = guardAt();
    keys.press('remove:2');
    keys.clock.now += 900;
    keys.guard.changeShown();
    keys.guard.carryOver('remove:1');
    keys.clock.now += 300;
    keys.press('remove:1'); // the second Enter, 0.3 s after the row went
    expect(keys.sent).toEqual(['remove:2']);
    keys.clock.now += 300;
    keys.press('remove:1');
    expect(keys.sent).toEqual(['remove:2', 'remove:1']);
  });

  it('carryOver: the button the keyboard focus was moved to is guarded for the rest of the last press\'s time, and no longer', () => {
    const { clock, sent, press, guard } = guardAt();
    guard.carryOver('remove:1'); // nothing was pressed yet: nothing to carry
    press('remove:1');
    expect(sent).toEqual(['remove:1']);

    clock.now += 1000;
    press('remove:2'); // Enter on the x of the last row: the row goes away...
    clock.now += 20;
    guard.carryOver('remove:1'); // ...and the focus is moved to the x of the new last row
    clock.now += 280;
    press('remove:1'); // the second Enter, 300 ms after the first
    expect(sent).toEqual(['remove:1', 'remove:2']);
    clock.now += 299;
    press('remove:1'); // 599 ms after the press that removed the row
    expect(sent).toEqual(['remove:1', 'remove:2']);
    clock.now += 1;
    press('remove:1');
    expect(sent).toEqual(['remove:1', 'remove:2', 'remove:1']);
  });
});

describe('civilization colours on the page (WP4)', () => {
  /** A stand-in for an element's inline style that remembers what was set, and how often. */
  function fakeElement() {
    const values = new Map<string, string>();
    let writes = 0;
    return {
      values,
      writes: () => writes,
      style: {
        getPropertyValue: (name: string) => values.get(name) ?? '',
        setProperty(name: string, value: string | null) {
          writes += 1;
          values.set(name, value ?? '');
        },
      },
    };
  }

  it('hands an element the three colours of the table: main colour, accent, and the colour for words', () => {
    for (const civ of CIV_IDS) {
      const element = fakeElement();
      setCivColors(element, civ);
      expect(Object.fromEntries(element.values)).toEqual({
        '--civ': CIVS[civ].primary,
        '--civ-accent': CIVS[civ].secondary,
        '--civ-text': CIVS[civ].text,
      });
    }
  });

  it('writes nothing when the element already has those colours, and all of them when the civilization changes', () => {
    const element = fakeElement();
    setCivColors(element, 'rome');
    setCivColors(element, 'rome');
    expect(element.writes()).toBe(3);
    setCivColors(element, 'china');
    expect(element.writes()).toBe(6);
    expect(element.values.get('--civ-text')).toBe(CIVS.china.text);
  });
});
