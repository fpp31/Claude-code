import { describe, expect, it } from 'vitest';
import { pathTo } from '../src/rules/movement';
import type { ReachStep } from '../src/rules/movement';

/**
 * Scaffold test for pathTo, the one function of rules/movement.ts that is
 * finished in the scaffold (so the client can test its move path with a
 * hand-made reach map before the rest of the movement rules exist).
 */

describe('pathTo', () => {
  // A unit on tile 10 that can go 10 -> 11 -> 12 or 10 -> 20.
  const reach = new Map<number, ReachStep>([
    [11, { movesLeft: 1, previous: 10 }],
    [12, { movesLeft: 0, previous: 11 }],
    [20, { movesLeft: 0, previous: 10 }],
  ]);

  it('lists the tiles to enter, start excluded, target last', () => {
    expect(pathTo(reach, 12)).toEqual([11, 12]);
    expect(pathTo(reach, 11)).toEqual([11]);
    expect(pathTo(reach, 20)).toEqual([20]);
  });

  it('returns null for a tile that is not reachable, including the unit\'s own tile', () => {
    expect(pathTo(reach, 99)).toBeNull();
    expect(pathTo(reach, 10)).toBeNull();
    expect(pathTo(new Map(), 11)).toBeNull();
  });

  it('does not change the reach map', () => {
    const before = JSON.stringify([...reach]);
    pathTo(reach, 12);
    expect(JSON.stringify([...reach])).toBe(before);
  });

  it('throws instead of looping forever on a reach map that points back at itself', () => {
    const broken = new Map<number, ReachStep>([
      [1, { movesLeft: 1, previous: 2 }],
      [2, { movesLeft: 1, previous: 1 }],
    ]);
    expect(() => pathTo(broken, 1)).toThrow();
  });
});
