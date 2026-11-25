/**
 * The lists the city panel's buttons ask for. Pure: they take the queue as
 * the view shows it and return the queue the player wants, as fresh objects,
 * or null if the edit makes no sense (the controller then sends nothing).
 * Nothing here is shown to the player: the screen changes only when the
 * server's view comes back.
 */

import { RULES } from '@domination/shared';
import type { BuildItem } from '@domination/shared';

/**
 * `queue` as it is: the same items in the same order, as fresh objects. For
 * the controller's note of the queue that a "Grow first" / "Build first"
 * press leaves standing: the adds that wait behind such a press are sent on
 * top of this list.
 */
export function queueUnchanged(queue: readonly BuildItem[]): BuildItem[] {
  return queue.map(copyOf);
}

/** `queue` with `item` at the end; null if it already holds RULES.maxQueueLength entries. */
export function queueWithAdded(queue: readonly BuildItem[], item: BuildItem): BuildItem[] | null {
  if (queue.length >= RULES.maxQueueLength) return null;
  return [...queue.map(copyOf), copyOf(item)];
}

/** `queue` without entry `index`; null if there is no such entry. */
export function queueWithout(queue: readonly BuildItem[], index: number): BuildItem[] | null {
  if (!isRow(queue, index)) return null;
  return queue.filter((_item, row) => row !== index).map(copyOf);
}

/** `queue` with entry `index` swapped with the entry before it (-1) or after it (1); null if either does not exist. */
export function queueWithMoved(queue: readonly BuildItem[], index: number, direction: -1 | 1): BuildItem[] | null {
  const other = index + direction;
  if (!isRow(queue, index) || !isRow(queue, other)) return null;
  const moved = queue.map(copyOf);
  [moved[index], moved[other]] = [moved[other], moved[index]];
  return moved;
}

/** Is `index` the number of a row of this queue? (Whole, and from 0 to the last entry.) */
function isRow(queue: readonly BuildItem[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < queue.length;
}

/** A fresh item with the two fields an item has and nothing else, whatever object the view handed over. */
function copyOf(item: BuildItem): BuildItem {
  return { kind: item.kind, unitType: item.unitType };
}
