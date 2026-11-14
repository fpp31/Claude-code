/**
 * Two small helpers for plain JSON data (game states and views).
 */

/**
 * A deep copy of plain JSON data. The rules engine copies the state once,
 * edits the copy with ordinary code, and returns the copy, so the caller's
 * state is never changed by a rejected or failed action.
 */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Deep equality for plain JSON data: same primitives, arrays equal item by
 * item, objects equal key by key (key order does not matter).
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;

  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!jsonEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bRecord, key)) return false;
    if (!jsonEqual(aRecord[key], bRecord[key])) return false;
  }
  return true;
}
