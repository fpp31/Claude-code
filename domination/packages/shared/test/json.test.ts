import { describe, expect, it } from 'vitest';
import { cloneJson, jsonEqual } from '../src/json';

describe('cloneJson', () => {
  it('makes a deep copy', () => {
    const original = { a: 1, list: [1, { b: 'x' }], nothing: null, flag: true };
    const copy = cloneJson(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.list).not.toBe(original.list);
    (copy.list[1] as { b: string }).b = 'changed';
    expect((original.list[1] as { b: string }).b).toBe('x');
  });
});

describe('jsonEqual', () => {
  it('compares primitives', () => {
    expect(jsonEqual(1, 1)).toBe(true);
    expect(jsonEqual('a', 'a')).toBe(true);
    expect(jsonEqual(null, null)).toBe(true);
    expect(jsonEqual(1, 2)).toBe(false);
    expect(jsonEqual(1, '1')).toBe(false);
    expect(jsonEqual(null, 0)).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
    expect(jsonEqual(false, null)).toBe(false);
  });

  it('compares arrays item by item', () => {
    expect(jsonEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(jsonEqual([1, 2, 3], [1, 2])).toBe(false);
    expect(jsonEqual([1, 2, 3], [1, 3, 2])).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
  });

  it('compares objects key by key, ignoring key order', () => {
    expect(jsonEqual({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
    expect(jsonEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it('agrees with a copy', () => {
    const value = { units: [{ id: 'u1_abc234', tile: 5, own: null }], tiles: [null, { terrain: 'coast' }] };
    expect(jsonEqual(value, cloneJson(value))).toBe(true);
  });
});
