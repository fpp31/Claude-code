import { describe, expect, it } from 'vitest';
import { RULES, cloneJson } from '@domination/shared';
import type { BuildItem } from '@domination/shared';
import { queueUnchanged, queueWithAdded, queueWithMoved, queueWithout } from '../src/game/queueEdits';

/**
 * The lists the city panel's buttons ask for (game/queueEdits.ts): what is
 * sent when the player adds an item, removes a row or moves one.
 */

const WARRIOR: BuildItem = { kind: 'unit', unitType: 'warrior' };
const SCOUT: BuildItem = { kind: 'unit', unitType: 'scout' };
const SETTLER: BuildItem = { kind: 'unit', unitType: 'settler' };
const WORKER: BuildItem = { kind: 'unit', unitType: 'worker' };

/** The unit types of a queue, in order. */
function names(queue: BuildItem[] | null): string[] | null {
  return queue === null ? null : queue.map((item) => item.unitType);
}

/** A queue of `length` Warriors, each its own object. */
function warriors(length: number): BuildItem[] {
  return Array.from({ length }, () => ({ ...WARRIOR }));
}

/** Freezes a list and its entries, so that an edit throws. */
function frozen(queue: BuildItem[]): readonly BuildItem[] {
  for (const item of queue) Object.freeze(item);
  return Object.freeze(queue);
}

describe('queue edits (game/queueEdits.ts)', () => {
  it('queueWithAdded puts the item last, as a fresh object, and gives null for a full queue', () => {
    expect(queueWithAdded([], WARRIOR)).toEqual([WARRIOR]);
    expect(names(queueWithAdded([WARRIOR, SCOUT], SETTLER))).toEqual(['warrior', 'scout', 'settler']);
    // The same item may be queued any number of times.
    expect(names(queueWithAdded([WARRIOR, WARRIOR], WARRIOR))).toEqual(['warrior', 'warrior', 'warrior']);

    // Fresh objects all through: nothing of the view travels, not even by reference.
    const queue = [WARRIOR, SCOUT];
    const added = queueWithAdded(queue, WORKER);
    if (added === null) throw new Error('a queue of two is not full');
    expect(added).not.toBe(queue);
    expect(added[0]).not.toBe(WARRIOR);
    expect(added[1]).not.toBe(SCOUT);
    expect(added[2]).not.toBe(WORKER);
    expect(added[2]).toEqual(WORKER);

    // Up to the limit of the rules, and not beyond.
    expect(queueWithAdded(warriors(RULES.maxQueueLength - 1), SCOUT)).toHaveLength(RULES.maxQueueLength);
    expect(queueWithAdded(warriors(RULES.maxQueueLength), SCOUT)).toBeNull();
    expect(queueWithAdded(warriors(RULES.maxQueueLength + 3), SCOUT)).toBeNull();
  });

  it('an item is copied with its two fields and nothing else, whatever the object handed over carries', () => {
    const dressedUp = { kind: 'unit', unitType: 'scout', cost: 12, turns: 3 } as BuildItem;
    const added = queueWithAdded([dressedUp], dressedUp);
    expect(added).toEqual([SCOUT, SCOUT]);
    expect(added?.map((item) => Object.keys(item).sort())).toEqual([['kind', 'unitType'], ['kind', 'unitType']]);
    expect(queueWithout([dressedUp, WARRIOR], 1)?.map((item) => Object.keys(item).sort())).toEqual([['kind', 'unitType']]);
    expect(queueWithMoved([dressedUp, WARRIOR], 0, 1)?.map((item) => Object.keys(item).sort())).toEqual([['kind', 'unitType'], ['kind', 'unitType']]);
  });

  it('queueUnchanged is the same list as fresh objects: the same items in the same order, each with its two fields and nothing else', () => {
    // What the controller notes when "Grow first" / "Build first" is pressed: the queue as it stands.
    const dressedUp = { kind: 'unit', unitType: 'scout', cost: 12, turns: 3 } as BuildItem;
    const queue = [WARRIOR, dressedUp, SETTLER, WARRIOR];
    const same = queueUnchanged(queue);
    expect(names(same)).toEqual(['warrior', 'scout', 'settler', 'warrior']);
    expect(same).toEqual([WARRIOR, SCOUT, SETTLER, WARRIOR]);
    expect(same).not.toBe(queue);
    same.forEach((item, index) => {
      expect(item).not.toBe(queue[index]); // nothing of the view travels, not even by reference
      expect(Object.keys(item).sort()).toEqual(['kind', 'unitType']);
    });
    // An empty queue stays empty; a full one stays full (this is no edit, so no limit applies).
    expect(queueUnchanged([])).toEqual([]);
    expect(queueUnchanged(warriors(RULES.maxQueueLength))).toHaveLength(RULES.maxQueueLength);
    // The list it is given is not touched.
    const fixed = frozen([{ ...WARRIOR }, { ...SCOUT }]);
    expect(names(queueUnchanged(fixed))).toEqual(['warrior', 'scout']);
    expect(fixed).toEqual([WARRIOR, SCOUT]);
  });

  it('queueWithout leaves out one entry and gives null for a row that does not exist', () => {
    const queue = [WARRIOR, SCOUT, SETTLER];
    expect(names(queueWithout(queue, 0))).toEqual(['scout', 'settler']);
    expect(names(queueWithout(queue, 1))).toEqual(['warrior', 'settler']);
    expect(names(queueWithout(queue, 2))).toEqual(['warrior', 'scout']);
    expect(queueWithout([WARRIOR], 0)).toEqual([]);
    // Only the row named goes, also when the same item is queued twice.
    expect(names(queueWithout([WARRIOR, SCOUT, WARRIOR], 2))).toEqual(['warrior', 'scout']);

    for (const row of [-1, 3, 99, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(queueWithout(queue, row), String(row)).toBeNull();
    expect(queueWithout([], 0)).toBeNull();

    const without = queueWithout(queue, 0);
    expect(without?.[0]).not.toBe(SCOUT); // fresh objects
  });

  it('queueWithMoved swaps two neighbors and gives null at either end of the list', () => {
    const queue = [WARRIOR, SCOUT, SETTLER];
    expect(names(queueWithMoved(queue, 1, -1))).toEqual(['scout', 'warrior', 'settler']);
    expect(names(queueWithMoved(queue, 1, 1))).toEqual(['warrior', 'settler', 'scout']);
    expect(names(queueWithMoved(queue, 0, 1))).toEqual(['scout', 'warrior', 'settler']);
    expect(names(queueWithMoved(queue, 2, -1))).toEqual(['warrior', 'settler', 'scout']);

    // Up on the first row, down on the last, and rows that do not exist.
    expect(queueWithMoved(queue, 0, -1)).toBeNull();
    expect(queueWithMoved(queue, 2, 1)).toBeNull();
    expect(queueWithMoved(queue, 3, -1)).toBeNull();
    expect(queueWithMoved(queue, -1, 1)).toBeNull();
    expect(queueWithMoved(queue, 0.5, 1)).toBeNull();
    expect(queueWithMoved([WARRIOR], 0, 1)).toBeNull();
    expect(queueWithMoved([WARRIOR], 0, -1)).toBeNull();
    expect(queueWithMoved([], 0, 1)).toBeNull();

    const moved = queueWithMoved(queue, 0, 1);
    expect(moved?.[1]).not.toBe(WARRIOR); // fresh objects
    expect(moved).toHaveLength(3);
  });

  it('none of them changes the list it is given', () => {
    const queue = frozen([{ ...WARRIOR }, { ...SCOUT }, { ...SETTLER }]);
    const before = cloneJson(queue);

    // A frozen list throws on any edit: none of these does.
    expect(names(queueWithAdded(queue, WORKER))).toEqual(['warrior', 'scout', 'settler', 'worker']);
    expect(names(queueWithout(queue, 1))).toEqual(['warrior', 'settler']);
    expect(names(queueWithMoved(queue, 0, 1))).toEqual(['scout', 'warrior', 'settler']);
    expect(queueWithout(queue, 7)).toBeNull();
    expect(queueWithMoved(queue, 0, -1)).toBeNull();
    expect(queueWithAdded(frozen(warriors(RULES.maxQueueLength)), WORKER)).toBeNull();

    expect(queue).toEqual(before);
  });
});
