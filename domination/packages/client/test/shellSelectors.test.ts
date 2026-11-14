import { describe, expect, it } from 'vitest';
import { boardFromView, reachableTiles } from '@domination/shared';
import type { PlayerView, ReachStep, TileIndex, UnitView } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import {
  canActNow,
  citiesWithoutProduction,
  idleUnits,
  myPlayer,
  overlayFor,
  ownThingsAt,
  reachableFor,
  sameOverlay,
  selectedCity,
  selectedUnit,
} from '../src/game/selectors';
import type { ReachFunction } from '../src/game/selectors';
import { EMPTY_OVERLAY } from '../src/render/api';
import { createStore, initialState } from '../src/state/store';
import { SAMPLE, setView, storeInGame, viewOf } from './shellKit';

/**
 * A hand-made answer to "where can this unit go": two tiles east of the
 * unit in a row. `near` is one step away, `far` two steps (through `near`).
 */
function reachEastOf(unit: UnitView): { near: TileIndex; far: TileIndex; map: Map<TileIndex, ReachStep> } {
  const near = unit.tile + 1;
  const far = unit.tile + 2;
  const map = new Map<TileIndex, ReachStep>([
    [far, { movesLeft: 0, previous: near }],
    [near, { movesLeft: 1, previous: unit.tile }],
  ]);
  return { near, far, map };
}

/** A reach function for tests: always the two tiles east of the unit. */
const stubReach: ReachFunction = (_view, unit) => reachEastOf(unit).map;

function unitOf(view: PlayerView, id: string): UnitView {
  const unit = view.units.find((candidate) => candidate.id === id);
  if (unit === undefined) throw new Error(`the view has no unit ${id}`);
  return unit;
}

describe('selectors (WP4)', () => {
  it('myPlayer is the viewer\'s own entry in the player list', () => {
    expect(myPlayer(sampleView()).id).toBe(SAMPLE.me);
    const broken = sampleView();
    broken.players = broken.players.filter((player) => player.id !== SAMPLE.me);
    expect(() => myPlayer(broken)).toThrow();
  });

  it('selectedUnit / selectedCity return the selected thing or null when it is gone', () => {
    const store = storeInGame();
    expect(selectedUnit(store.get())).toBeNull();
    expect(selectedCity(store.get())).toBeNull();

    store.set({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    expect(selectedUnit(store.get())?.id).toBe(SAMPLE.warriorId);
    expect(selectedCity(store.get())).toBeNull();

    store.set({ selection: { kind: 'city', cityId: SAMPLE.romeId } });
    expect(selectedCity(store.get())?.id).toBe(SAMPLE.romeId);
    expect(selectedUnit(store.get())).toBeNull();

    // The selected thing is no longer in the view.
    store.set({ selection: { kind: 'unit', unitId: 'u1_gone' } });
    expect(selectedUnit(store.get())).toBeNull();
    store.set({ selection: { kind: 'city', cityId: 'c1_gone' } });
    expect(selectedCity(store.get())).toBeNull();

    // No game at all.
    const home = createStore(initialState(''));
    home.set({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    expect(selectedUnit(home.get())).toBeNull();
    expect(selectedCity(home.get())).toBeNull();
  });

  it('ownThingsAt lists military unit, civilian unit, city, in that order, own things only', () => {
    // Put everything on Rome's tile: the own Settler first in the list, then
    // the own Warrior, and a foreign Warrior too (which cannot really share
    // a tile, but the selector must not care).
    const view = sampleView();
    for (const unit of view.units) unit.tile = SAMPLE.romeTile;
    view.units.reverse();

    const things = ownThingsAt(view, SAMPLE.romeTile);
    expect(things.map((thing) => (thing.kind === 'unit' ? thing.unit.id : thing.city.id))).toEqual([
      SAMPLE.warriorId,
      SAMPLE.settlerId,
      SAMPLE.romeId,
    ]);

    // Somebody else's unit and city are not ours to select.
    expect(ownThingsAt(sampleView(), SAMPLE.foreignWarriorTile)).toEqual([]);
    expect(ownThingsAt(sampleView(), SAMPLE.thebesTile)).toEqual([]);
    expect(ownThingsAt(sampleView(), SAMPLE.emptyTile)).toEqual([]);
  });

  it('canActNow is true only with a game, online, not busy and the turn not ended', () => {
    expect(canActNow(storeInGame().get())).toBe(true);

    expect(canActNow(createStore(initialState('')).get())).toBe(false); // no game
    expect(canActNow(storeInGame({ connection: 'reconnecting' }).get())).toBe(false);
    expect(canActNow(storeInGame({ connection: 'connecting' }).get())).toBe(false);
    expect(canActNow(storeInGame({ busy: true }).get())).toBe(false);

    const ended = storeInGame();
    setView(ended, (view) => {
      view.players[0].endedTurn = true;
    });
    expect(canActNow(ended.get())).toBe(false);

    // Another player having ended does not stop this one.
    const otherEnded = storeInGame();
    setView(otherEnded, (view) => {
      view.players[0].endedTurn = false;
      view.players[1].endedTurn = true;
    });
    expect(canActNow(otherEnded.get())).toBe(true);
  });

  it('overlayFor returns EMPTY_OVERLAY without a game and no reachable tiles when canActNow is false (busy, offline, turn ended)', () => {
    expect(overlayFor(createStore(initialState('')).get(), stubReach)).toBe(EMPTY_OVERLAY);

    const selection = { kind: 'unit', unitId: SAMPLE.warriorId } as const;
    const hoverTile = SAMPLE.warriorTile + 1; // a tile the stub calls reachable

    const busy = storeInGame({ selection, hoverTile, busy: true });
    const offline = storeInGame({ selection, hoverTile, connection: 'reconnecting' });
    const ended = storeInGame({ selection, hoverTile });
    setView(ended, (view) => {
      view.players[0].endedTurn = true;
    });

    for (const store of [busy, offline, ended]) {
      const overlay = overlayFor(store.get(), stubReach);
      expect(overlay.reachable).toEqual([]);
      expect(overlay.path).toEqual([]);
      // The selection itself is still shown.
      expect(overlay.selectedTile).toBe(SAMPLE.warriorTile);
      expect(overlay.selectedUnitId).toBe(SAMPLE.warriorId);
    }
  });

  it('overlayFor (stub reach) lists the reachable tiles of the selected unit and the path to a hovered reachable tile', () => {
    const store = storeInGame({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    const { near, far } = reachEastOf(unitOf(viewOf(store), SAMPLE.warriorId));

    // Nothing hovered: the highlight, ascending, and no path.
    expect(overlayFor(store.get(), stubReach)).toEqual({
      selectedTile: SAMPLE.warriorTile,
      selectedUnitId: SAMPLE.warriorId,
      reachable: [near, far],
      path: [],
      workedTiles: [],
      hoverTile: null,
    });

    // Hovering a reachable tile: the route to it, start excluded, target last.
    store.set({ hoverTile: far });
    expect(overlayFor(store.get(), stubReach).path).toEqual([near, far]);
    expect(overlayFor(store.get(), stubReach).hoverTile).toBe(far);

    // Hovering a tile that cannot be reached: no path.
    store.set({ hoverTile: SAMPLE.emptyTile });
    expect(overlayFor(store.get(), stubReach).path).toEqual([]);
    expect(overlayFor(store.get(), stubReach).hoverTile).toBe(SAMPLE.emptyTile);
  });

  it('overlayFor lists the worked tiles of a selected own city and none otherwise', () => {
    const store = storeInGame({ selection: { kind: 'city', cityId: SAMPLE.romeId } });
    const rome = viewOf(store).cities.find((city) => city.id === SAMPLE.romeId);
    const overlay = overlayFor(store.get(), stubReach);
    expect(rome?.own?.worked.length).toBeGreaterThan(0);
    expect(overlay.workedTiles).toEqual(rome?.own?.worked);
    expect(overlay.selectedTile).toBe(SAMPLE.romeTile);
    expect(overlay.selectedUnitId).toBeNull();
    expect(overlay.reachable).toEqual([]);

    // A unit selected, or nothing: no worked tiles.
    store.set({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    expect(overlayFor(store.get(), stubReach).workedTiles).toEqual([]);
    store.set({ selection: null });
    expect(overlayFor(store.get(), stubReach).workedTiles).toEqual([]);

    // A foreign city (the controller never selects one, but the view may hold one): nothing of its is known.
    store.set({ selection: { kind: 'city', cityId: SAMPLE.thebesId } });
    expect(overlayFor(store.get(), stubReach).workedTiles).toEqual([]);
  });

  it('sameOverlay compares what would be drawn, not which object it is', () => {
    const store = storeInGame({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    const first = overlayFor(store.get(), stubReach);
    const second = overlayFor(store.get(), stubReach);
    expect(second).not.toBe(first);
    expect(sameOverlay(first, second)).toBe(true);

    store.set({ hoverTile: SAMPLE.warriorTile + 2 });
    expect(sameOverlay(first, overlayFor(store.get(), stubReach))).toBe(false);
    expect(sameOverlay(EMPTY_OVERLAY, { ...EMPTY_OVERLAY, workedTiles: [4] })).toBe(false);
  });

  it('idleUnits and citiesWithoutProduction count only the player\'s own', () => {
    const view = sampleView();
    // Both own units have moves left; the foreign Warrior is not counted.
    expect(idleUnits(view).map((unit) => unit.id)).toEqual([SAMPLE.warriorId, SAMPLE.settlerId]);
    // Rome is building a Warrior; Thebes is foreign (and tells us nothing about its production).
    expect(citiesWithoutProduction(view)).toEqual([]);

    const later = sampleView();
    const warrior = unitOf(later, SAMPLE.warriorId);
    if (warrior.own !== null) warrior.own.movesLeft = 0;
    const rome = later.cities.find((city) => city.id === SAMPLE.romeId);
    if (rome?.own != null) rome.own.production = null;
    expect(idleUnits(later).map((unit) => unit.id)).toEqual([SAMPLE.settlerId]);
    expect(citiesWithoutProduction(later).map((city) => city.id)).toEqual([SAMPLE.romeId]);
  });

  it('idleUnits come sorted by id, whatever order the view lists them in', () => {
    const view = sampleView();
    view.units.reverse();
    expect(idleUnits(view).map((unit) => unit.id)).toEqual([SAMPLE.warriorId, SAMPLE.settlerId]);
  });
});

describe('reachableFor with the real movement rules (WP4 with WP2)', () => {
  it('returns the same Map for the same view and unit (memoised) and an empty Map for foreign units', () => {
    const view = sampleView();
    const warrior = unitOf(view, SAMPLE.warriorId);

    const first = reachableFor(view, warrior);
    expect(first.size).toBeGreaterThan(0);
    expect(reachableFor(view, warrior)).toBe(first);

    // Exactly what the shared rules say for this view.
    const expected = reachableTiles(boardFromView(view), { owner: warrior.owner, type: warrior.type, tile: warrior.tile, movesLeft: 2 });
    expect([...first.entries()].sort((a, b) => a[0] - b[0])).toEqual([...expected.entries()].sort((a, b) => a[0] - b[0]));

    // Another unit, or another view object, is worked out afresh.
    const settler = unitOf(view, SAMPLE.settlerId);
    expect(reachableFor(view, settler)).not.toBe(first);
    const sameLookingView = sampleView();
    expect(reachableFor(sameLookingView, unitOf(sameLookingView, SAMPLE.warriorId))).not.toBe(first);

    // Somebody else's unit: nothing, their moves are not ours to know.
    expect(reachableFor(view, unitOf(view, SAMPLE.foreignWarriorId)).size).toBe(0);
  });

  it('is empty for an own unit without moves left', () => {
    const view = sampleView();
    const warrior = unitOf(view, SAMPLE.warriorId);
    if (warrior.own !== null) warrior.own.movesLeft = 0;
    expect(reachableFor(view, warrior).size).toBe(0);
  });

  it('overlayFor uses it by default: the selected Warrior\'s reachable tiles are highlighted', () => {
    const store = storeInGame({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    const view = viewOf(store);
    const expected = [...reachableFor(view, unitOf(view, SAMPLE.warriorId)).keys()].sort((a, b) => a - b);
    expect(overlayFor(store.get()).reachable).toEqual(expected);
  });
});
