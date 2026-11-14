import { describe, expect, it } from 'vitest';
import { CIVS, CIV_IDS } from '@domination/shared';
import { setCivColors } from '../src/ui/civColors';
import { PRESS_GUARD_MS, createPressGuard } from '../src/ui/pressGuard';

/**
 * Two small pieces of the screens that hold a decision and need no browser:
 * the guard against a press arriving twice (ui/pressGuard.ts) and the
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
