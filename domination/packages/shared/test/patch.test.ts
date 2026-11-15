import { describe, expect, it } from 'vitest';
import { cloneJson } from '../src/json';
import { applyViewPatch, diffViews } from '../src/view/patch';
import { sampleView } from '../src/testing';
import type { PlayerView } from '../src/viewTypes';

/** Checks the promise in patch.ts: applying the diff of a and b to a gives b. */
function expectRoundTrip(a: PlayerView, b: PlayerView): void {
  const patch = diffViews(a, b);
  expect(patch).not.toBeNull();
  // A patch travels as JSON, so test it the way it arrives.
  const received = cloneJson(patch!);
  expect(applyViewPatch(a, received)).toEqual(b);
}

describe('diffViews', () => {
  it('returns null for equal views (nothing is sent)', () => {
    expect(diffViews(sampleView(), sampleView())).toBeNull();
  });

  it('includes only the sections that changed', () => {
    const a = sampleView();

    const b = sampleView();
    b.turn = a.turn + 1;
    expect(diffViews(a, b)).toEqual({ turn: a.turn + 1 });

    const c = sampleView();
    c.players[0].endedTurn = true;
    expect(diffViews(a, c)).toEqual({ players: c.players });

    const d = sampleView();
    d.units[0].tile += 1;
    expect(diffViews(a, d)).toEqual({ units: d.units });

    const e = sampleView();
    e.cities[0].population += 1;
    expect(diffViews(a, e)).toEqual({ cities: e.cities });
  });

  it('lists only the tiles that changed, in ascending order', () => {
    const a = sampleView();
    const b = sampleView();
    const hidden = a.tiles.findIndex((tile) => tile === null);
    const fogged = a.tiles.findIndex((tile) => tile !== null && !tile.visible);
    const seen = a.tiles.findIndex((tile) => tile !== null && tile.visible);
    expect(hidden).toBeGreaterThanOrEqual(0);
    expect(fogged).toBeGreaterThanOrEqual(0);
    expect(seen).toBeGreaterThanOrEqual(0);

    b.tiles[hidden] = { terrain: 'ocean', feature: null, improvement: null, owner: null, visible: true }; // newly explored
    b.tiles[fogged] = { ...a.tiles[fogged]!, visible: true };                          // back in sight
    b.tiles[seen] = { ...a.tiles[seen]!, owner: 'p2' };                                // changed hands

    const patch = diffViews(a, b);
    const expected = [hidden, fogged, seen].sort((x, y) => x - y).map((i) => [i, b.tiles[i]]);
    expect(patch).toEqual({ tiles: expected });
  });

  it('notices a change in every field of a tile, including fields added in later phases', () => {
    const a = sampleView();
    const index = a.tiles.findIndex((tile) => tile !== null && tile.visible && tile.feature === null);
    expect(index).toBeGreaterThanOrEqual(0);
    const original = a.tiles[index]!;

    // Every field TileView has today, each changed on its own.
    const variants: Record<string, unknown>[] = [
      { ...original, terrain: original.terrain === 'desert' ? 'plains' : 'desert' },
      { ...original, feature: 'hills' },
      { ...original, owner: original.owner === 'p2' ? null : 'p2' },
      { ...original, visible: !original.visible },
      { ...original, improvement: original.improvement === 'farm' ? null : 'farm' },
      // A field that does not exist yet (a later phase: roads, resources...).
      { ...original, road: true },
    ];
    // If TileView gains a field, add a variant for it above.
    expect(Object.keys(original).sort()).toEqual(['feature', 'improvement', 'owner', 'terrain', 'visible']);

    for (const variant of variants) {
      const b = sampleView();
      b.tiles[index] = variant as unknown as typeof original;
      expect(diffViews(a, b)).toEqual({ tiles: [[index, variant]] });
      expectRoundTrip(a, b);
    }
  });

  it('notices a change in every section of a view', () => {
    const a = sampleView();
    const changes: ((view: PlayerView) => void)[] = [
      (view) => { view.turn += 1; },
      (view) => { view.players[1].name = 'Benedict'; },
      (view) => { view.units[0].own!.movesLeft = 0; },
      (view) => { view.units.find((unit) => unit.own !== null && unit.own.job !== null)!.own!.job!.turnsLeft -= 1; },
      (view) => { view.units.find((unit) => unit.own !== null && unit.own.job !== null)!.own!.job = null; },
      (view) => { view.units[0].own!.jobOptions = [{ improvement: 'farm', turns: 4, error: 'cannotImprove' }]; },
      (view) => { view.cities[0].own!.buildQueue[0].wait = 'noRoom'; },
      (view) => { view.cities[0].own!.buildQueue.pop(); },
      (view) => { view.cities[0].own!.held = 'needsPopulation'; },
      (view) => { view.cities[0].own!.buildOptions[0].addError = 'queueFull'; },
      (view) => { view.tiles[0] = { terrain: 'ocean', feature: null, improvement: null, owner: null, visible: false }; },
      (view) => {
        const farm = view.tiles.findIndex((tile) => tile !== null && tile.improvement !== null);
        view.tiles[farm] = { ...view.tiles[farm]!, improvement: null };
      },
    ];
    // If PlayerView gains a section, diffViews, applyViewPatch and this list must learn about it.
    expect(Object.keys(a).sort()).toEqual(['cities', 'height', 'players', 'tiles', 'turn', 'units', 'width', 'you']);

    for (const change of changes) {
      const b = sampleView();
      change(b);
      expectRoundTrip(a, b);
    }
  });

  it('refuses to compare views of different players or maps', () => {
    const a = sampleView();
    const other = sampleView();
    other.you = 'p2';
    expect(() => diffViews(a, other)).toThrow();
    const wider = sampleView();
    wider.width += 1;
    expect(() => diffViews(a, wider)).toThrow();
  });
});

describe('applyViewPatch', () => {
  it('rebuilds the new view from the old view and the patch', () => {
    const a = sampleView();
    const b = sampleView();
    b.turn += 1;
    b.players[1].endedTurn = false;
    b.units = b.units.filter((unit) => unit.owner === 'p1');
    b.units[0].tile += 1;
    b.units[0].own!.movesLeft = 0;
    b.cities[0].own!.foodStored += 2;
    const hidden = b.tiles.findIndex((tile) => tile === null);
    b.tiles[hidden] = { terrain: 'coast', feature: null, improvement: null, owner: null, visible: true };
    const seen = b.tiles.findIndex((tile) => tile !== null && tile.visible);
    b.tiles[seen] = { ...b.tiles[seen]!, visible: false };
    expectRoundTrip(a, b);
  });

  it('does not modify the view it is given', () => {
    const a = sampleView();
    const untouched = cloneJson(a);
    const b = sampleView();
    b.turn += 1;
    b.units = [];
    b.tiles[0] = { terrain: 'ocean', feature: null, improvement: null, owner: null, visible: true };
    const result = applyViewPatch(a, diffViews(a, b)!);
    expect(a).toEqual(untouched);
    expect(result).not.toBe(a);
    expect(result.tiles).not.toBe(a.tiles);
  });

  it('keeps everything when the patch is empty', () => {
    const a = sampleView();
    expect(applyViewPatch(a, {})).toEqual(a);
  });

  it('survives many random edits (round trip)', () => {
    // A tiny deterministic scrambler: no rules involved, just shapes.
    let n = 12345;
    const next = (bound: number) => {
      n = (n * 1103515245 + 12345) % 2147483648;
      return n % bound;
    };
    let current = sampleView();
    for (let round = 0; round < 50; round++) {
      const changed = cloneJson(current);
      for (let edit = 0; edit < 5; edit++) {
        const tile = next(changed.tiles.length);
        const old = changed.tiles[tile];
        changed.tiles[tile] =
          old === null
            ? { terrain: 'plains', feature: null, improvement: next(3) === 0 ? 'farm' : null, owner: null, visible: true }
            : { ...old, visible: !old.visible, owner: next(2) === 0 ? null : 'p1', improvement: next(4) === 0 ? 'farm' : old.improvement };
      }
      if (next(3) === 0) changed.turn += 1;
      if (next(3) === 0 && changed.units.length > 0) changed.units[next(changed.units.length)].tile = next(100);
      if (next(4) === 0) changed.players[next(changed.players.length)].endedTurn = next(2) === 0;
      if (diffViews(current, changed) !== null) expectRoundTrip(current, changed);
      current = changed;
    }
  });
});
