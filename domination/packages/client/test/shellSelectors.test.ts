import { describe, expect, it } from 'vitest';
import { boardFromView, cloneJson, reachableTiles } from '@domination/shared';
import type { CityView, PlayerView, ReachStep, TileIndex, UnitView } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import {
  canActNow,
  citiesWaiting,
  citiesWithoutProduction,
  idleUnits,
  markedTile,
  myPlayer,
  ordersClosed,
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
import { SAMPLE, cityIn, ownOf, romeOf, setView, storeInGame, viewOf } from './shellKit';

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

/** Adds a second city of the player's to a view: a copy of Rome under another id, with a change applied. */
function addOwnCity(view: PlayerView, id: string, name: string, change: (own: NonNullable<CityView['own']>) => void): void {
  const city = { ...cloneJson(cityIn(view, SAMPLE.romeId)), id, name, tile: SAMPLE.romeTile + 28 };
  if (city.own === null) throw new Error('unexpected sample view');
  change(city.own);
  view.cities.push(city);
}

/** What a view says about a first entry that is paid for and cannot be completed, with no end in sight. */
function holdFirstEntry(own: NonNullable<CityView['own']>): void {
  own.buildQueue = [
    { item: { kind: 'unit', unitType: 'settler' }, cost: 30, turns: null, wait: 'needsPopulation' },
    { item: { kind: 'unit', unitType: 'warrior' }, cost: 18, turns: null, wait: 'earlier' },
  ];
  own.productionStored = 30;
  own.held = 'needsPopulation';
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
    // Put the Settler, the Warrior and the foreign Warrior on Rome's tile, the
    // own Settler first in the list, then the own Warrior. (A foreign unit
    // cannot really share a tile, but the selector must not care.)
    const view = sampleView();
    for (const unit of view.units) if (unit.id !== SAMPLE.workerId) unit.tile = SAMPLE.romeTile;
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

  it('ordersClosed: \'offline\' without a connection (also after End Turn), \'turnEnded\' after End Turn, null otherwise and while busy; canActNow is false in all three cases and while busy', () => {
    const open = storeInGame();
    expect(ordersClosed(open.get())).toBeNull();
    expect(canActNow(open.get())).toBe(true);

    // A round trip is over in a blink: it closes nothing, but nothing can be sent in it.
    const busy = storeInGame({ busy: true });
    expect(ordersClosed(busy.get())).toBeNull();
    expect(canActNow(busy.get())).toBe(false);

    for (const connection of ['reconnecting', 'connecting'] as const) {
      const offline = storeInGame({ connection });
      expect(ordersClosed(offline.get()), connection).toBe('offline');
      expect(canActNow(offline.get()), connection).toBe(false);
    }

    const ended = storeInGame();
    setView(ended, (view) => {
      view.players[0].endedTurn = true;
    });
    expect(ordersClosed(ended.get())).toBe('turnEnded');
    expect(canActNow(ended.get())).toBe(false);

    // Both at once: the connection is named, it is the first thing to be cured.
    ended.set({ connection: 'reconnecting' });
    expect(ordersClosed(ended.get())).toBe('offline');
    expect(canActNow(ended.get())).toBe(false);

    // Another player having ended closes nothing for this one.
    const otherEnded = storeInGame();
    setView(otherEnded, (view) => {
      view.players[0].endedTurn = false;
      view.players[1].endedTurn = true;
    });
    expect(ordersClosed(otherEnded.get())).toBeNull();

    // Without a game: nothing lasting stands in the way once the page is online, yet there is nothing to act on.
    const home = createStore(initialState(''));
    expect(ordersClosed(home.get())).toBe('offline'); // a fresh page is still connecting
    home.set({ connection: 'online' });
    expect(ordersClosed(home.get())).toBeNull();
    expect(canActNow(home.get())).toBe(false);
  });

  it('markedTile is the selected unit\'s tile, the selected city\'s tile, or the inspected tile when nothing is selected', () => {
    const store = storeInGame();
    expect(markedTile(store.get())).toBeNull();

    store.set({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    expect(markedTile(store.get())).toBe(SAMPLE.warriorTile);
    store.set({ selection: { kind: 'city', cityId: SAMPLE.romeId } });
    expect(markedTile(store.get())).toBe(SAMPLE.romeTile);

    store.set({ selection: null, inspectedTile: SAMPLE.emptyTile });
    expect(markedTile(store.get())).toBe(SAMPLE.emptyTile);
    // A tile the player has never seen can be inspected, and marked, too.
    store.set({ inspectedTile: 0 });
    expect(markedTile(store.get())).toBe(0);

    // The controller never sets both. Should a state hold both all the same, the selection counts,
    // also when the selected thing is no longer in the view (then nothing is marked).
    store.set({ selection: { kind: 'unit', unitId: SAMPLE.settlerId }, inspectedTile: SAMPLE.emptyTile });
    expect(markedTile(store.get())).toBe(SAMPLE.settlerTile);
    store.set({ selection: { kind: 'unit', unitId: 'u1_gone' } });
    expect(markedTile(store.get())).toBeNull();

    // No game, no map, nothing to mark.
    const home = createStore(initialState(''));
    home.set({ inspectedTile: 5 });
    expect(markedTile(home.get())).toBeNull();
  });

  it('overlayFor puts the ring on the inspected tile and lists no reachable or worked tiles for it', () => {
    // The inspected tile is one the Warrior could reach (by the stub) and one Rome works: neither is drawn for a card.
    const store = storeInGame({ inspectedTile: SAMPLE.warriorTile + 1 });
    expect(overlayFor(store.get(), stubReach)).toEqual({
      selectedTile: SAMPLE.warriorTile + 1,
      selectedUnitId: null,
      reachable: [],
      path: [],
      workedTiles: [],
      hoverTile: null,
    });

    const worked = romeOf(viewOf(store)).worked[0];
    store.set({ inspectedTile: worked, hoverTile: SAMPLE.warriorTile + 2 });
    expect(overlayFor(store.get(), stubReach)).toEqual({
      selectedTile: worked,
      selectedUnitId: null,
      reachable: [],
      path: [],
      workedTiles: [],
      hoverTile: SAMPLE.warriorTile + 2,
    });

    // The tile of one of the player's own units, inspected by a state the controller never makes: still only the ring.
    store.set({ inspectedTile: SAMPLE.warriorTile, hoverTile: null });
    expect(overlayFor(store.get(), stubReach).selectedUnitId).toBeNull();
    expect(overlayFor(store.get(), stubReach).reachable).toEqual([]);

    // The card closed: no ring.
    store.set({ inspectedTile: null });
    expect(overlayFor(store.get(), stubReach).selectedTile).toBeNull();
    // The ring moving from one inspected tile to another is a change the renderer must hear of.
    const first = overlayFor(storeInGame({ inspectedTile: 3 }).get(), stubReach);
    const second = overlayFor(storeInGame({ inspectedTile: 4 }).get(), stubReach);
    expect(sameOverlay(first, second)).toBe(false);
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
    // The Warrior and the Settler have moves left; the foreign Warrior is not counted (nor the Worker, which is at work).
    expect(idleUnits(view).map((unit) => unit.id)).toEqual([SAMPLE.warriorId, SAMPLE.settlerId]);
    // Rome is building a Warrior; Thebes is foreign (and tells us nothing about its queue).
    expect(citiesWithoutProduction(view)).toEqual([]);

    const later = sampleView();
    ownOf(later, SAMPLE.warriorId).movesLeft = 0;
    romeOf(later).buildQueue = [];
    expect(idleUnits(later).map((unit) => unit.id)).toEqual([SAMPLE.settlerId]);
    expect(citiesWithoutProduction(later).map((city) => city.id)).toEqual([SAMPLE.romeId]);
  });

  it('idleUnits leaves out a unit at work, and has it again when the job is over', () => {
    const view = sampleView();
    const worker = ownOf(view, SAMPLE.workerId);
    // The sample Worker has all its moves and a job: it is not waiting for an order.
    expect(worker.movesLeft).toBeGreaterThan(0);
    expect(worker.job).not.toBeNull();
    expect(idleUnits(view).map((unit) => unit.id)).not.toContain(SAMPLE.workerId);

    worker.job = null; // finished, or stopped
    expect(idleUnits(view).map((unit) => unit.id)).toEqual([SAMPLE.warriorId, SAMPLE.workerId, SAMPLE.settlerId]);

    // Without moves it is not idle either way.
    worker.movesLeft = 0;
    expect(idleUnits(view).map((unit) => unit.id)).toEqual([SAMPLE.warriorId, SAMPLE.settlerId]);
  });

  it('citiesWithoutProduction lists own cities with an empty queue, by id', () => {
    const view = sampleView();
    addOwnCity(view, 'c1_zzzzzz', 'Capua', (own) => {
      own.buildQueue = [];
    });
    addOwnCity(view, 'c1_aaaaaa', 'Ostia', (own) => {
      own.buildQueue = [];
      own.productionStored = 7; // savings do not make a city less idle
    });
    addOwnCity(view, 'c1_mmmmmm', 'Antium', () => {}); // building, like Rome
    // A foreign city never says anything about its queue, and would not be ours to mind if it did.
    view.cities.push({ ...cloneJson(cityIn(view, 'c1_zzzzzz')), id: 'c2_liar', owner: SAMPLE.other, name: 'Memphis' });

    expect(citiesWithoutProduction(view).map((city) => city.id)).toEqual(['c1_aaaaaa', 'c1_zzzzzz']);

    romeOf(view).buildQueue = [];
    view.cities.reverse();
    expect(citiesWithoutProduction(view).map((city) => city.id)).toEqual(['c1_aaaaaa', SAMPLE.romeId, 'c1_zzzzzz']);
  });

  it('citiesWaiting lists own cities whose first entry is held and has no number; a held entry with a number is not listed', () => {
    const view = sampleView();
    expect(citiesWaiting(view)).toEqual([]);

    // Held, and the forecast sees no end: listed.
    addOwnCity(view, 'c1_zzzzzz', 'Capua', holdFirstEntry);
    addOwnCity(view, 'c1_aaaaaa', 'Ostia', (own) => {
      holdFirstEntry(own);
      own.held = 'noRoom';
      own.buildQueue[0].wait = 'noRoom';
    });
    // Held, but the city will have grown in three turns: the panel says so, nobody has to be told.
    addOwnCity(view, 'c1_bbbbbb', 'Antium', (own) => {
      holdFirstEntry(own);
      own.buildQueue[0].turns = 3;
      own.buildQueue[0].wait = null;
    });
    // No number, but not paid for yet (the city makes no production): slow, not waiting.
    addOwnCity(view, 'c1_cccccc', 'Cumae', (own) => {
      own.buildQueue[0].turns = null;
      own.buildQueue[0].wait = 'noProduction';
    });
    // An empty queue is idle, not waiting.
    addOwnCity(view, 'c1_dddddd', 'Veii', (own) => {
      own.buildQueue = [];
    });
    // A foreign city with the same fields (the server never sends them) is not ours to mind.
    view.cities.push({ ...cloneJson(cityIn(view, 'c1_zzzzzz')), id: 'c2_liar', owner: SAMPLE.other, name: 'Memphis' });

    expect(citiesWaiting(view).map((city) => city.id)).toEqual(['c1_aaaaaa', 'c1_zzzzzz']);
    // The two lists never share a city.
    expect(citiesWithoutProduction(view).map((city) => city.id)).toEqual(['c1_dddddd']);
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

  it('reachableFor is empty for a unit at work, so overlayFor highlights nothing for it', () => {
    const view = sampleView();
    const worker = unitOf(view, SAMPLE.workerId);
    expect(worker.own?.movesLeft).toBeGreaterThan(0);
    expect(worker.own?.job).not.toBeNull();
    expect(reachableFor(view, worker).size).toBe(0);

    // The player may act and the Worker is selected: the ring, and nothing to go to.
    const store = storeInGame({ selection: { kind: 'unit', unitId: SAMPLE.workerId }, hoverTile: SAMPLE.workerTile + 1 }, view);
    expect(canActNow(store.get())).toBe(true);
    expect(overlayFor(store.get())).toEqual({
      selectedTile: SAMPLE.workerTile,
      selectedUnitId: SAMPLE.workerId,
      reachable: [],
      path: [],
      workedTiles: [],
      hoverTile: SAMPLE.workerTile + 1,
    });

    // The job is over (a new view from the server): the same Worker can walk again.
    setView(store, (changed) => {
      ownOf(changed, SAMPLE.workerId).job = null;
    });
    const after = viewOf(store);
    const reach = reachableFor(after, unitOf(after, SAMPLE.workerId));
    expect(reach.has(SAMPLE.workerTile + 1)).toBe(true);
    expect(overlayFor(store.get()).reachable).toEqual([...reach.keys()].sort((a, b) => a - b));
    expect(overlayFor(store.get()).path).toEqual([SAMPLE.workerTile + 1]);
  });

  it('overlayFor uses it by default: the selected Warrior\'s reachable tiles are highlighted', () => {
    const store = storeInGame({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    const view = viewOf(store);
    const expected = [...reachableFor(view, unitOf(view, SAMPLE.warriorId)).keys()].sort((a, b) => a - b);
    expect(overlayFor(store.get()).reachable).toEqual(expected);
  });
});
