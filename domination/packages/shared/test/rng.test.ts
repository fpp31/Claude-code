import { describe, expect, it } from 'vitest';
import { nextFloat, nextInt, nextUint32, pick, seedRng, shuffle } from '../src/rng';
import type { RngState } from '../src/rng';

// Recorded once from this implementation and cross-checked against the
// published reference code of the two algorithms (see the "never changes" test).
const GOLDEN_STATE: RngState = [2909720469, 897192885, 261904181, 2812545261];
const GOLDEN_VALUES: number[] = [2324491319, 1770244231, 780342797, 297662857, 3898898765];

/** The next `count` raw values of a generator. */
function take(rng: RngState, count: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < count; i++) values.push(nextUint32(rng));
  return values;
}

describe('seedRng', () => {
  it('gives the same sequence for the same seed and stream', () => {
    expect(take(seedRng('hello', 'map'), 20)).toEqual(take(seedRng('hello', 'map'), 20));
  });

  it('gives unrelated sequences for different seeds or streams', () => {
    const base = take(seedRng('hello', 'map'), 8);
    expect(take(seedRng('hello', 'dice'), 8)).not.toEqual(base);
    expect(take(seedRng('hellp', 'map'), 8)).not.toEqual(base);
    expect(take(seedRng('hello', 'ids:p1'), 8)).not.toEqual(take(seedRng('hello', 'ids:p2'), 8));
    // Moving a character between seed and stream must not collide.
    expect(take(seedRng('ab', 'c'), 8)).not.toEqual(take(seedRng('a', 'bc'), 8));
  });

  it('makes a state of four whole numbers that fit in 32 bits', () => {
    const rng = seedRng('any seed at all', 'map');
    expect(rng).toHaveLength(4);
    for (const part of rng) {
      expect(Number.isInteger(part)).toBe(true);
      expect(part).toBeGreaterThanOrEqual(0);
      expect(part).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('never changes: these exact values are what saved games and map seeds rely on', () => {
    // If this test fails, the generator was changed. That alters every map
    // and breaks saved games; do not "fix" the numbers, undo the change.
    expect(seedRng('domination', 'map')).toEqual(GOLDEN_STATE);
    expect(take(seedRng('domination', 'map'), 5)).toEqual(GOLDEN_VALUES);
  });
});

describe('nextUint32', () => {
  it('advances the state in place and keeps it JSON-safe', () => {
    const rng = seedRng('seed', 'dice');
    const before = JSON.stringify(rng);
    const value = nextUint32(rng);
    expect(JSON.stringify(rng)).not.toBe(before);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
    for (const part of rng) {
      expect(Number.isInteger(part)).toBe(true);
      expect(part).toBeGreaterThanOrEqual(0);
    }
  });

  it('carries on exactly where it stopped after a save and load', () => {
    const live = seedRng('seed', 'dice');
    take(live, 37);
    const loaded = JSON.parse(JSON.stringify(live)) as RngState;
    expect(take(loaded, 50)).toEqual(take(live, 50));
  });

  it('does not repeat itself quickly', () => {
    const values = take(seedRng('seed', 'dice'), 5000);
    expect(new Set(values).size).toBeGreaterThan(4990);
  });
});

describe('nextFloat', () => {
  it('stays in [0, 1) and averages near one half', () => {
    const rng = seedRng('floats', 'dice');
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const value = nextFloat(rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      sum += value;
    }
    expect(sum / 20000).toBeGreaterThan(0.48);
    expect(sum / 20000).toBeLessThan(0.52);
  });
});

describe('nextInt', () => {
  it('stays in 0 .. bound - 1 and hits every value about equally often', () => {
    const rng = seedRng('ints', 'dice');
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60000; i++) {
      const value = nextInt(rng, 6);
      expect(Number.isInteger(value)).toBe(true);
      counts[value] += 1;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThan(9500);
      expect(count).toBeLessThan(10500);
    }
  });

  it('always returns 0 for bound 1', () => {
    const rng = seedRng('ints', 'dice');
    for (let i = 0; i < 10; i++) expect(nextInt(rng, 1)).toBe(0);
  });

  it('rejects bounds that make no sense', () => {
    const rng = seedRng('ints', 'dice');
    expect(() => nextInt(rng, 0)).toThrow();
    expect(() => nextInt(rng, -3)).toThrow();
    expect(() => nextInt(rng, 2.5)).toThrow();
    expect(() => nextInt(rng, Number.NaN)).toThrow();
  });
});

describe('pick and shuffle', () => {
  it('pick returns an item of the list and refuses an empty list', () => {
    const rng = seedRng('pick', 'dice');
    const items = ['a', 'b', 'c'];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pick(rng, items));
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
    expect(() => pick(rng, [])).toThrow();
  });

  it('shuffle keeps every item, works in place, and is repeatable', () => {
    const original = Array.from({ length: 30 }, (_, i) => i);

    const first = original.slice();
    expect(shuffle(seedRng('shuffle', 'map'), first)).toBe(first);
    expect(first.slice().sort((a, b) => a - b)).toEqual(original);
    expect(first).not.toEqual(original);

    const second = original.slice();
    shuffle(seedRng('shuffle', 'map'), second);
    expect(second).toEqual(first);

    expect(shuffle(seedRng('shuffle', 'map'), [])).toEqual([]);
    expect(shuffle(seedRng('shuffle', 'map'), [7])).toEqual([7]);
  });
});
