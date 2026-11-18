import { describe, expect, it } from 'vitest';
import { RULES, cloneJson } from '@domination/shared';
import type { BuildItem, PlayerView, ReachStep, TileIndex } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import { END_TURN_GUARD_MS, JOB_GUARD_MS, MAP_MOVE_GUARD_MS, SELECTION_GUARD_MS, createController } from '../src/game/controller';
import type { Controller } from '../src/game/controller';
import type { ReachFunction } from '../src/game/selectors';
import { handleServerMessage } from '../src/state/serverMessages';
import type { AppState, Store } from '../src/state/store';
import { SAMPLE, cityIn, fakeConnection, ownOf, romeOf, sentActions, setView, storeInGame, unitIn, viewOf } from './shellKit';
import type { FakeConnection } from './shellKit';

/**
 * The controller, with a hand-made "which tiles can this unit reach" (so
 * no rules engine is needed) and a clock the test moves by hand (for the
 * End Turn guard, the job guard and the selection guard).
 *
 * The selection guard: for SELECTION_GUARD_MS after the selection changed
 * to another unit or city, the panels' order buttons do nothing. A test
 * that selects through the store and then presses such a button lets that
 * time pass first (`wait(SELECTION_GUARD_MS)`), as a hand does. A selection
 * that is in the store when the controller is made starts no guard.
 */

/** The stub's answer for every unit: one tile east (`near`), and the one after it (`far`), reached through `near`. */
const stubReach: ReachFunction = (_view, unit) =>
  new Map<TileIndex, ReachStep>([
    [unit.tile + 1, { movesLeft: 1, previous: unit.tile }],
    [unit.tile + 2, { movesLeft: 0, previous: unit.tile + 1 }],
  ]);

interface Setup {
  store: Store;
  connection: FakeConnection;
  controller: Controller;
  /** Moves the test clock forward. */
  wait(ms: number): void;
}

/**
 * @param changes  what the store holds besides the sample game
 * @param view     the game's view (default: the sample view)
 * @param reach    'stub': the two tiles east of every unit; 'rules': the
 *                 real reachableFor, as the app uses it
 */
function setup(changes: Partial<AppState> = {}, view: PlayerView = sampleView(), reach: 'stub' | 'rules' = 'stub'): Setup {
  const store = storeInGame(changes, view);
  const connection = fakeConnection();
  let clock = 50_000;
  const controller = createController(store, connection, reach === 'stub' ? { reach: stubReach, now: () => clock } : { now: () => clock });
  return {
    store,
    connection,
    controller,
    wait(ms) {
      clock += ms;
    },
  };
}

const WARRIOR: BuildItem = { kind: 'unit', unitType: 'warrior' };
const SCOUT: BuildItem = { kind: 'unit', unitType: 'scout' };
const SETTLER: BuildItem = { kind: 'unit', unitType: 'settler' };
const WORKER: BuildItem = { kind: 'unit', unitType: 'worker' };

const SELECT_WARRIOR = { kind: 'unit', unitId: SAMPLE.warriorId } as const;
const SELECT_WORKER = { kind: 'unit', unitId: SAMPLE.workerId } as const;
const SELECT_ROME = { kind: 'city', cityId: SAMPLE.romeId } as const;

/** A tile nobody has ever seen (the top-left corner of the sample map). */
const UNSEEN_TILE = 0;

/** The sample view with a change applied. */
function viewWith(change: (view: PlayerView) => void): PlayerView {
  const view = sampleView();
  change(view);
  return view;
}

/** The sample view with the Worker idle on its plains tile: a farm can be started there, a mine cannot. */
function viewWithIdleWorker(): PlayerView {
  return viewWith((view) => takeJob(view, SAMPLE.workerId));
}

/** What the server's view says once a unit's job has started: the job, and every option busy. */
function giveJob(view: PlayerView, unitId: string): void {
  const own = ownOf(view, unitId);
  own.job = { improvement: 'farm', turnsWorked: 0, turnsTotal: 4, turnsLeft: 4 };
  for (const option of own.jobOptions) option.error = 'unitBusy';
}

/** What the server's view says once a unit's job is over or stopped: no job, a farm possible on its tile, a mine not. */
function takeJob(view: PlayerView, unitId: string): void {
  const own = ownOf(view, unitId);
  own.job = null;
  own.jobOptions = [
    { improvement: 'farm', turns: 4, error: null },
    { improvement: 'mine', turns: 5, error: 'badImprovementTile' },
  ];
}

/** Plays the server's part for an accepted action that changed the view: the new view, then the acknowledgement. */
function serverAnswers(store: Store, change: (view: PlayerView) => void): void {
  setView(store, change);
  store.set({ busy: false });
}

/** Counts the store's updates from now on. */
function countUpdates(store: Store): () => number {
  let updates = 0;
  store.subscribe(() => {
    updates += 1;
  });
  return () => updates;
}

/** Plays the server's part for an accepted End Turn / Cancel: the player's flag flips, then the action is acknowledged. */
function serverSetsEnded(store: Store, ended: boolean): void {
  setView(store, (view) => {
    view.players[0].endedTurn = ended;
  });
  store.set({ busy: false });
}

/** Plays the server resolving the turn: next turn number, nobody has ended. */
function serverStartsNextTurn(store: Store): void {
  setView(store, (view) => {
    view.turn += 1;
    for (const player of view.players) player.endedTurn = false;
  });
  store.set({ busy: false });
}

describe('controller (WP4)', () => {
  it('tapping an own unit selects it; tapping the same tile again cycles to the next own thing there', () => {
    const { store, controller, connection } = setup();

    controller.onTileTap(SAMPLE.warriorTile);
    expect(store.get().selection).toEqual({ kind: 'unit', unitId: SAMPLE.warriorId });

    // Put the Warrior and the Settler into Rome: three own things on one tile.
    setView(store, (view) => {
      unitIn(view, SAMPLE.warriorId).tile = SAMPLE.romeTile;
      unitIn(view, SAMPLE.settlerId).tile = SAMPLE.romeTile;
    });
    store.set({ selection: null });

    controller.onTileTap(SAMPLE.romeTile);
    expect(store.get().selection).toEqual({ kind: 'unit', unitId: SAMPLE.warriorId }); // military first
    controller.onTileTap(SAMPLE.romeTile);
    expect(store.get().selection).toEqual({ kind: 'unit', unitId: SAMPLE.settlerId }); // then the civilian
    controller.onTileTap(SAMPLE.romeTile);
    expect(store.get().selection).toEqual({ kind: 'city', cityId: SAMPLE.romeId }); // then the city
    controller.onTileTap(SAMPLE.romeTile);
    expect(store.get().selection).toEqual({ kind: 'unit', unitId: SAMPLE.warriorId }); // and round again

    // Selecting never talks to the server.
    expect(connection.sent).toEqual([]);
  });

  it('tapping a tile with a single own thing that is already selected keeps it selected', () => {
    const { store, controller } = setup({ selection: { kind: 'city', cityId: SAMPLE.romeId } });
    const before = store.get();
    controller.onTileTap(SAMPLE.romeTile);
    expect(store.get()).toBe(before); // not even a store update
  });

  it('tapping a reachable tile (stub reach) with a unit selected sends moveUnit with the path and the current turn, and sets busy', () => {
    const { store, controller, connection } = setup({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });

    controller.onTileTap(SAMPLE.warriorTile + 2);

    expect(connection.sent).toEqual([
      {
        type: 'action',
        requestId: expect.any(Number),
        turn: viewOf(store).turn,
        action: { type: 'moveUnit', unitId: SAMPLE.warriorId, path: [SAMPLE.warriorTile + 1, SAMPLE.warriorTile + 2] },
      },
    ]);
    expect(store.get().busy).toBe(true);
    // The unit stays selected, and the view is untouched: the client waits for the server.
    expect(store.get().selection).toEqual({ kind: 'unit', unitId: SAMPLE.warriorId });
    expect(viewOf(store).units.find((unit) => unit.id === SAMPLE.warriorId)?.tile).toBe(SAMPLE.warriorTile);
  });

  it('a reachable tile wins over selecting what stands on it', () => {
    // The Settler stands one step east of the Warrior: the tap is an order to go there.
    const { store, controller, connection } = setup({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    setView(store, (view) => {
      const settler = view.units.find((unit) => unit.id === SAMPLE.settlerId);
      if (settler !== undefined) settler.tile = SAMPLE.warriorTile + 1;
    });

    controller.onTileTap(SAMPLE.warriorTile + 1);

    expect(sentActions(connection)).toEqual([{ type: 'moveUnit', unitId: SAMPLE.warriorId, path: [SAMPLE.warriorTile + 1] }]);
    expect(store.get().selection).toEqual({ kind: 'unit', unitId: SAMPLE.warriorId });
  });

  it('a tap on a reachable tile with a unit selected is an order and inspects nothing; while busy it does nothing at all (nothing sent, nothing inspected, selection kept)', () => {
    const ordering = setup({ selection: SELECT_WARRIOR });
    ordering.controller.onTileTap(SAMPLE.warriorTile + 1);
    expect(sentActions(ordering.connection)).toEqual([{ type: 'moveUnit', unitId: SAMPLE.warriorId, path: [SAMPLE.warriorTile + 1] }]);
    expect(ordering.store.get().selection).toEqual(SELECT_WARRIOR);
    expect(ordering.store.get().inspectedTile).toBeNull();

    // The answer to that order is on its way, and the player taps again: the
    // same tile, the other reachable tile. Not even the store hears of it.
    expect(ordering.store.get().busy).toBe(true);
    const before = ordering.store.get();
    ordering.controller.onTileTap(SAMPLE.warriorTile + 1);
    ordering.controller.onTileTap(SAMPLE.warriorTile + 2);
    expect(ordering.store.get()).toBe(before);
    expect(ordering.connection.sent).toHaveLength(1);

    // While busy only the reachable tiles are dead: any other tap still selects or inspects.
    ordering.controller.onTileTap(SAMPLE.emptyTile);
    expect(ordering.store.get().selection).toBeNull();
    expect(ordering.store.get().inspectedTile).toBe(SAMPLE.emptyTile);
    expect(ordering.connection.sent).toHaveLength(1);
  });

  it('after End Turn and offline a tap on a tile the unit could reach is like any other tap: it opens the tile card, or selects what the player owns there, and sends nothing', () => {
    const ended = (): Setup => {
      const world = setup({ selection: SELECT_WARRIOR });
      setView(world.store, (view) => {
        view.players[0].endedTurn = true;
      });
      return world;
    };
    const worlds: [string, () => Setup][] = [
      ['turn ended', ended],
      ['reconnecting', () => setup({ selection: SELECT_WARRIOR, connection: 'reconnecting' })],
      ['connecting', () => setup({ selection: SELECT_WARRIOR, connection: 'connecting' })],
    ];

    for (const [name, make] of worlds) {
      // Nothing stands on the tile: its card opens, in one store update.
      const empty = make();
      const updates = countUpdates(empty.store);
      empty.controller.onTileTap(SAMPLE.warriorTile + 1);
      expect(empty.store.get().selection, name).toBeNull();
      expect(empty.store.get().inspectedTile, name).toBe(SAMPLE.warriorTile + 1);
      expect(updates(), name).toBe(1);
      expect(empty.connection.sent, name).toEqual([]);
      expect(empty.store.get().busy, name).toBe(false);

      // The player's Settler stands on the tile: it is selected.
      const owned = make();
      setView(owned.store, (view) => {
        unitIn(view, SAMPLE.settlerId).tile = SAMPLE.warriorTile + 1;
      });
      owned.controller.onTileTap(SAMPLE.warriorTile + 1);
      expect(owned.store.get().selection, name).toEqual({ kind: 'unit', unitId: SAMPLE.settlerId });
      expect(owned.store.get().inspectedTile, name).toBeNull();
      expect(owned.connection.sent, name).toEqual([]);
    }
  });

  it('tapping a tile with nothing of the player\'s clears the selection and opens the tile card (empty land, a foreign unit, a foreign city)', () => {
    const { store, controller, connection } = setup({ selection: SELECT_WARRIOR });
    const updates = countUpdates(store);

    controller.onTileTap(SAMPLE.emptyTile);
    expect(store.get().selection).toBeNull();
    expect(store.get().inspectedTile).toBe(SAMPLE.emptyTile);
    expect(updates()).toBe(1); // both in ONE store update: no screen in between with neither

    store.set({ selection: SELECT_ROME, inspectedTile: null });
    controller.onTileTap(SAMPLE.foreignWarriorTile);
    expect(store.get().selection).toBeNull();
    expect(store.get().inspectedTile).toBe(SAMPLE.foreignWarriorTile);

    store.set({ selection: SELECT_ROME, inspectedTile: null });
    controller.onTileTap(SAMPLE.thebesTile);
    expect(store.get().selection).toBeNull();
    expect(store.get().inspectedTile).toBe(SAMPLE.thebesTile);

    expect(connection.sent).toEqual([]);
  });

  it('a never-seen tile can be inspected', () => {
    const { store, controller, connection } = setup();
    expect(viewOf(store).tiles[UNSEEN_TILE]).toBeNull();

    controller.onTileTap(UNSEEN_TILE);

    expect(store.get().inspectedTile).toBe(UNSEEN_TILE);
    expect(store.get().selection).toBeNull();
    expect(connection.sent).toEqual([]);
  });

  it('tapping the inspected tile again changes nothing (the same state object)', () => {
    const { store, controller } = setup();
    controller.onTileTap(SAMPLE.emptyTile);
    const before = store.get();
    const updates = countUpdates(store);

    controller.onTileTap(SAMPLE.emptyTile);
    controller.onTileTap(SAMPLE.emptyTile);

    expect(store.get()).toBe(before);
    expect(updates()).toBe(0);
  });

  it('tapping another such tile moves the card', () => {
    const { store, controller } = setup();
    controller.onTileTap(SAMPLE.emptyTile);
    controller.onTileTap(SAMPLE.foreignWarriorTile);
    expect(store.get().inspectedTile).toBe(SAMPLE.foreignWarriorTile);
    controller.onTileTap(UNSEEN_TILE);
    expect(store.get().inspectedTile).toBe(UNSEEN_TILE);
    expect(store.get().selection).toBeNull();
  });

  it('selecting closes the card: a tap on an own unit, selectNextIdleUnit, selectNextTask', () => {
    const byTap = setup({ inspectedTile: SAMPLE.emptyTile });
    const updates = countUpdates(byTap.store);
    byTap.controller.onTileTap(SAMPLE.warriorTile);
    expect(byTap.store.get().selection).toEqual(SELECT_WARRIOR);
    expect(byTap.store.get().inspectedTile).toBeNull();
    expect(updates()).toBe(1); // one update: the card never shows next to a panel

    const byCity = setup({ inspectedTile: SAMPLE.emptyTile });
    byCity.controller.onTileTap(SAMPLE.romeTile);
    expect(byCity.store.get().selection).toEqual(SELECT_ROME);
    expect(byCity.store.get().inspectedTile).toBeNull();

    const byKey = setup({ inspectedTile: SAMPLE.emptyTile });
    expect(byKey.controller.selectNextIdleUnit()).toBe(SAMPLE.warriorTile);
    expect(byKey.store.get().selection).toEqual(SELECT_WARRIOR);
    expect(byKey.store.get().inspectedTile).toBeNull();

    const byButton = setup({ inspectedTile: SAMPLE.emptyTile });
    expect(byButton.controller.selectNextTask()).toBe(SAMPLE.warriorTile);
    expect(byButton.store.get().selection).toEqual(SELECT_WARRIOR);
    expect(byButton.store.get().inspectedTile).toBeNull();

    // With nothing left to select, N and "Show me" select nothing, and the card stays.
    const nothingToDo = setup({ inspectedTile: SAMPLE.emptyTile });
    setView(nothingToDo.store, (view) => {
      for (const unit of view.units) if (unit.own !== null) unit.own.movesLeft = 0;
    });
    expect(nothingToDo.controller.selectNextIdleUnit()).toBeNull();
    expect(nothingToDo.controller.selectNextTask()).toBeNull();
    expect(nothingToDo.store.get().inspectedTile).toBe(SAMPLE.emptyTile);
  });

  it('the tile card and a selection are never set together, whatever is tapped in whatever order', () => {
    const { store, controller } = setup();
    const taps = [
      SAMPLE.emptyTile, SAMPLE.warriorTile, SAMPLE.warriorTile + 5, SAMPLE.romeTile, SAMPLE.romeTile, UNSEEN_TILE,
      SAMPLE.settlerTile, SAMPLE.thebesTile, SAMPLE.workerTile, SAMPLE.foreignWarriorTile, SAMPLE.farmTile,
    ];
    let looked = 0;
    store.subscribe((state) => {
      looked += 1;
      expect(state.inspectedTile === null || state.selection === null).toBe(true);
    });
    for (const tile of taps) {
      controller.onTileTap(tile);
      store.set({ busy: false }); // (a tap on a reachable tile is an order)
      if (tile % 3 === 0) controller.selectNextTask();
      if (tile % 5 === 0) controller.deselect();
    }
    expect(looked).toBeGreaterThan(taps.length);
  });

  it('nothing is sent while busy or while not online', () => {
    for (const changes of [{ busy: true }, { connection: 'reconnecting' }, { connection: 'connecting' }] as Partial<AppState>[]) {
      const { store, controller, connection, wait } = setup(changes);

      store.set({ selection: { kind: 'unit', unitId: SAMPLE.settlerId } });
      wait(SELECTION_GUARD_MS);
      controller.foundCity();
      controller.onTileTap(SAMPLE.settlerTile + 1);
      store.set({ selection: SELECT_ROME });
      wait(SELECTION_GUARD_MS);
      controller.addToQueue(SCOUT);
      controller.removeFromQueue(0);
      controller.moveInQueue(0, 1);
      controller.clearQueue();
      store.set({ selection: SELECT_WORKER });
      wait(SELECTION_GUARD_MS);
      controller.stopJob();
      controller.toggleEndTurn();

      expect(connection.sent).toEqual([]);
    }
  });

  it('busy is set only when connection.send returned true (a dummy connection that returns false never leaves busy stuck)', () => {
    const { store, controller, connection } = setup({ selection: { kind: 'unit', unitId: SAMPLE.settlerId } });
    connection.accepts = false; // the socket has just dropped, or this is demo mode

    controller.foundCity();
    controller.onTileTap(SAMPLE.settlerTile + 1);
    controller.toggleEndTurn();
    expect(store.get().busy).toBe(false);
    expect(connection.sent).toEqual([]);

    // The moment the connection takes messages again, the next press goes through.
    connection.accepts = true;
    controller.foundCity();
    expect(store.get().busy).toBe(true);
    expect(sentActions(connection)).toEqual([{ type: 'foundCity', unitId: SAMPLE.settlerId }]);
  });

  it('foundCity sends foundCity only when own.foundCityError is null', () => {
    const { store, controller, connection, wait } = setup();

    controller.foundCity(); // nothing selected
    store.set({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    controller.foundCity(); // a Warrior cannot found cities
    store.set({ selection: { kind: 'city', cityId: SAMPLE.romeId } });
    controller.foundCity(); // a city is not a unit
    expect(connection.sent).toEqual([]);

    // A Settler on a spot where a city is not allowed.
    setView(store, (view) => {
      const settler = view.units.find((unit) => unit.id === SAMPLE.settlerId);
      if (settler?.own != null) settler.own.foundCityError = 'tooCloseToCity';
    });
    store.set({ selection: { kind: 'unit', unitId: SAMPLE.settlerId } });
    wait(SELECTION_GUARD_MS);
    controller.foundCity();
    expect(connection.sent).toEqual([]);

    // The same Settler on a good spot.
    setView(store, (view) => {
      const settler = view.units.find((unit) => unit.id === SAMPLE.settlerId);
      if (settler?.own != null) settler.own.foundCityError = null;
    });
    controller.foundCity();
    expect(sentActions(connection)).toEqual([{ type: 'foundCity', unitId: SAMPLE.settlerId }]);
    expect(store.get().busy).toBe(true);
  });

  it('addToQueue sends setBuildQueue with the shown queue plus the item, for the selected own city, and nothing without one', () => {
    const { store, controller, connection, wait } = setup();

    controller.addToQueue(SETTLER); // nothing selected
    store.set({ selection: SELECT_WARRIOR });
    controller.addToQueue(SETTLER); // a unit is not a city
    store.set({ selection: { kind: 'city', cityId: SAMPLE.thebesId } });
    controller.addToQueue(SETTLER); // somebody else's city (the controller never selects one; the view may hold one)
    store.set({ selection: { kind: 'city', cityId: 'c1_gone' } });
    controller.addToQueue(SETTLER); // a city that is no longer in the view
    expect(connection.sent).toEqual([]);
    expect(store.get().busy).toBe(false);

    // Rome's queue in the sample view: a Warrior, then a Scout.
    store.set({ selection: SELECT_ROME });
    wait(SELECTION_GUARD_MS);
    controller.addToQueue(SETTLER);
    expect(connection.sent).toEqual([
      {
        type: 'action',
        requestId: expect.any(Number),
        turn: viewOf(store).turn,
        action: { type: 'setBuildQueue', cityId: SAMPLE.romeId, queue: [WARRIOR, SCOUT, SETTLER] },
      },
    ]);
    expect(store.get().busy).toBe(true);
    // The view is untouched: the screen changes only when the server's view comes back.
    expect(romeOf(viewOf(store)).buildQueue.map((entry) => entry.item)).toEqual([WARRIOR, SCOUT]);

    // The same item again is a second entry, not a no-op.
    serverAnswers(store, (view) => {
      romeOf(view).buildQueue.push({ item: { ...SETTLER }, cost: 30, turns: 14, wait: null });
    });
    controller.addToQueue(SETTLER);
    expect(sentActions(connection)[1]).toEqual({ type: 'setBuildQueue', cityId: SAMPLE.romeId, queue: [WARRIOR, SCOUT, SETTLER, SETTLER] });
  });

  it('what is sent is made of fresh items with two fields each: nothing of the view\'s rows travels', () => {
    const { store, controller, connection } = setup({ selection: SELECT_ROME });
    const option = romeOf(viewOf(store)).buildOptions[3]; // the Worker, as the panel hands it over
    controller.addToQueue(option.item);

    const message = connection.sent[0];
    if (message.type !== 'action' || message.action.type !== 'setBuildQueue') throw new Error('expected a setBuildQueue');
    expect(message.action.queue).toEqual([WARRIOR, SCOUT, WORKER]);
    for (const item of message.action.queue) expect(Object.keys(item).sort()).toEqual(['kind', 'unitType']);
    expect(message.action.queue[2]).not.toBe(option.item);
    expect(message.action.queue[0]).not.toBe(romeOf(viewOf(store)).buildQueue[0].item);
  });

  it('removeFromQueue, moveInQueue and clearQueue send the list the panel shows after that one change', () => {
    const { store, controller, connection } = setup({ selection: SELECT_ROME });
    setView(store, (view) => {
      romeOf(view).buildQueue.push({ item: { ...SETTLER }, cost: 30, turns: 14, wait: null });
    });
    // The server does not answer with a new view in this test: every edit starts from Warrior, Scout, Settler.
    const edits: [() => boolean, BuildItem[]][] = [
      [() => controller.removeFromQueue(0), [SCOUT, SETTLER]], // "stop building this": the next entry moves up
      [() => controller.removeFromQueue(1), [WARRIOR, SETTLER]],
      [() => controller.removeFromQueue(2), [WARRIOR, SCOUT]],
      [() => controller.moveInQueue(1, -1), [SCOUT, WARRIOR, SETTLER]],
      [() => controller.moveInQueue(1, 1), [WARRIOR, SETTLER, SCOUT]],
      [() => controller.moveInQueue(0, 1), [SCOUT, WARRIOR, SETTLER]],
      [() => controller.moveInQueue(2, -1), [WARRIOR, SETTLER, SCOUT]],
      [() => controller.clearQueue(), []],
    ];
    for (const [edit, queue] of edits) {
      expect(edit()).toBe(true);
      expect(sentActions(connection).pop()).toEqual({ type: 'setBuildQueue', cityId: SAMPLE.romeId, queue });
      store.set({ busy: false });
    }
    expect(connection.sent).toHaveLength(edits.length); // ONE message per press

    // Each edit starts from the queue of the newest view.
    serverAnswers(store, (view) => {
      romeOf(view).buildQueue = [{ item: { ...SCOUT }, cost: 12, turns: 2, wait: null }];
    });
    controller.addToQueue(WORKER);
    expect(sentActions(connection).pop()).toEqual({ type: 'setBuildQueue', cityId: SAMPLE.romeId, queue: [SCOUT, WORKER] });
  });

  it('an edit that makes no sense sends nothing: no such row, up on the first row, down on the last, adding to a full queue, emptying an empty queue', () => {
    const { store, controller, connection } = setup({ selection: SELECT_ROME });
    const before = store.get();

    // Rome's queue has two rows, 0 and 1.
    expect(controller.removeFromQueue(2)).toBe(false);
    expect(controller.removeFromQueue(-1)).toBe(false);
    expect(controller.removeFromQueue(0.5)).toBe(false);
    expect(controller.moveInQueue(0, -1)).toBe(false);
    expect(controller.moveInQueue(1, 1)).toBe(false);
    expect(controller.moveInQueue(2, -1)).toBe(false);
    expect(controller.moveInQueue(7, 1)).toBe(false);
    expect(store.get()).toBe(before);

    setView(store, (view) => {
      const own = romeOf(view);
      own.buildQueue = Array.from({ length: RULES.maxQueueLength }, () => ({ item: { ...WARRIOR }, cost: 18, turns: null, wait: 'earlier' as const }));
    });
    expect(controller.addToQueue(SCOUT)).toBe(false);

    setView(store, (view) => {
      romeOf(view).buildQueue = [];
    });
    expect(controller.clearQueue()).toBe(false);
    expect(controller.removeFromQueue(0)).toBe(false);
    expect(controller.moveInQueue(0, 1)).toBe(false);

    expect(connection.sent).toEqual([]);
    expect(store.get().busy).toBe(false);

    // An empty queue does take an item.
    expect(controller.addToQueue(SCOUT)).toBe(true);
    expect(sentActions(connection)).toEqual([{ type: 'setBuildQueue', cityId: SAMPLE.romeId, queue: [SCOUT] }]);
  });

  it('no queue edit is sent while busy, offline or after ending the turn', () => {
    const ended = setup({ selection: SELECT_ROME });
    setView(ended.store, (view) => {
      view.players[0].endedTurn = true;
    });
    const worlds: [string, Setup][] = [
      ['busy', setup({ selection: SELECT_ROME, busy: true })],
      ['reconnecting', setup({ selection: SELECT_ROME, connection: 'reconnecting' })],
      ['connecting', setup({ selection: SELECT_ROME, connection: 'connecting' })],
      ['turn ended', ended],
    ];
    for (const [name, { store, controller, connection }] of worlds) {
      const before = store.get();
      expect(controller.addToQueue(SETTLER), name).toBe(false);
      expect(controller.removeFromQueue(0), name).toBe(false);
      expect(controller.moveInQueue(0, 1), name).toBe(false);
      expect(controller.clearQueue(), name).toBe(false);
      expect(connection.sent, name).toEqual([]);
      expect(store.get(), name).toBe(before);
    }
  });

  it('the queue methods return true exactly when a message went out (an add also when it is kept for the answer that is on its way)', () => {
    const { store, controller, connection } = setup({ selection: SELECT_ROME });

    expect(controller.addToQueue(SETTLER)).toBe(true);
    expect(connection.sent).toHaveLength(1);
    // The answer is on its way: a row press goes nowhere and says so. (An add would wait: see the tests of the waiting adds.)
    expect(controller.removeFromQueue(0)).toBe(false);
    expect(controller.moveInQueue(0, 1)).toBe(false);
    expect(controller.clearQueue()).toBe(false);
    expect(connection.sent).toHaveLength(1);

    store.set({ busy: false });
    expect(controller.removeFromQueue(0)).toBe(true);
    store.set({ busy: false });
    expect(controller.moveInQueue(0, 1)).toBe(true);
    store.set({ busy: false });
    expect(controller.clearQueue()).toBe(true);
    expect(connection.sent).toHaveLength(4);

    // The socket has just dropped (or this is demo mode): nothing went out, so false, and nothing is stuck.
    store.set({ busy: false });
    connection.accepts = false;
    expect(controller.addToQueue(SETTLER)).toBe(false);
    expect(controller.removeFromQueue(0)).toBe(false);
    expect(controller.moveInQueue(0, 1)).toBe(false);
    expect(controller.clearQueue()).toBe(false);
    expect(store.get().busy).toBe(false);
    expect(connection.sent).toHaveLength(4);

    // Nothing selected: false.
    connection.accepts = true;
    store.set({ selection: null });
    expect(controller.addToQueue(SETTLER)).toBe(false);
    expect(controller.clearQueue()).toBe(false);
    expect(connection.sent).toHaveLength(4);
  });

  it('startJob sends only when the option\'s error is null, not while busy and not offline', () => {
    const { store, controller, connection, wait } = setup({}, viewWithIdleWorker());

    controller.startJob('farm'); // nothing selected
    store.set({ selection: SELECT_WARRIOR });
    controller.startJob('farm'); // a Warrior has no job options
    store.set({ selection: SELECT_ROME });
    controller.startJob('farm'); // a city is not a unit
    store.set({ selection: SELECT_WORKER });
    wait(SELECTION_GUARD_MS);
    controller.startJob('mine'); // the option says why not: this tile has no hills
    expect(connection.sent).toEqual([]);

    controller.startJob('farm');
    expect(connection.sent).toEqual([
      {
        type: 'action',
        requestId: expect.any(Number),
        turn: viewOf(store).turn,
        action: { type: 'startJob', unitId: SAMPLE.workerId, improvement: 'farm' },
      },
    ]);
    expect(store.get().busy).toBe(true);
    // The view is untouched: the job appears when the server says so.
    expect(ownOf(viewOf(store), SAMPLE.workerId).job).toBeNull();

    // While busy, and without a connection: nothing.
    controller.startJob('farm');
    store.set({ busy: false, connection: 'reconnecting' });
    controller.startJob('farm');
    expect(connection.sent).toHaveLength(1);

    // A Worker that is at work: every option says unitBusy.
    const atWork = setup({ selection: SELECT_WORKER });
    atWork.controller.startJob('farm');
    atWork.controller.startJob('mine');
    expect(atWork.connection.sent).toEqual([]);

    // A Worker with no moves left: work may begin in the turn the unit arrives.
    const tired = setup({ selection: SELECT_WORKER }, viewWith((view) => {
      takeJob(view, SAMPLE.workerId);
      ownOf(view, SAMPLE.workerId).movesLeft = 0;
    }));
    tired.controller.startJob('farm');
    expect(sentActions(tired.connection)).toEqual([{ type: 'startJob', unitId: SAMPLE.workerId, improvement: 'farm' }]);
  });

  it('stopJob sends only for a unit with a job', () => {
    const { store, controller, connection, wait } = setup();

    controller.stopJob(); // nothing selected
    store.set({ selection: SELECT_WARRIOR });
    controller.stopJob(); // a unit without a job
    store.set({ selection: SELECT_ROME });
    controller.stopJob(); // a city
    expect(connection.sent).toEqual([]);

    store.set({ selection: SELECT_WORKER }); // the sample Worker is building a farm
    wait(SELECTION_GUARD_MS);
    controller.stopJob();
    expect(connection.sent).toEqual([
      { type: 'action', requestId: expect.any(Number), turn: viewOf(store).turn, action: { type: 'stopJob', unitId: SAMPLE.workerId } },
    ]);
    expect(store.get().busy).toBe(true);

    // While busy, and without a connection: nothing.
    controller.stopJob();
    store.set({ busy: false, connection: 'connecting' });
    controller.stopJob();
    expect(connection.sent).toHaveLength(1);

    // A Worker that has no job.
    const idle = setup({ selection: SELECT_WORKER }, viewWithIdleWorker());
    idle.controller.stopJob();
    expect(idle.connection.sent).toEqual([]);
  });

  it('the job guard: stopJob within 600 ms after the selected unit\'s job appeared does nothing, and so does startJob within 600 ms after it went away; later both send; selecting another unit does not start the guard (it starts the shorter selection guard)', () => {
    expect(JOB_GUARD_MS).toBe(600);
    const { store, controller, connection, wait } = setup({ selection: SELECT_WORKER }, viewWithIdleWorker());

    // A double-click on "Build Farm": the first click starts the job...
    controller.startJob('farm');
    serverAnswers(store, (view) => giveJob(view, SAMPLE.workerId)); // ...the server answers within milliseconds, "Stop work" is under the mouse...
    wait(100);
    controller.stopJob(); // ...and the second click lands on it.
    expect(sentActions(connection)).toEqual([{ type: 'startJob', unitId: SAMPLE.workerId, improvement: 'farm' }]);

    // Still inside the guard just before it runs out...
    wait(JOB_GUARD_MS - 101);
    controller.stopJob();
    expect(connection.sent).toHaveLength(1);
    // ...and a deliberate press once it has.
    wait(1);
    controller.stopJob();
    expect(sentActions(connection)[1]).toEqual({ type: 'stopJob', unitId: SAMPLE.workerId });

    // The other way round: the job went away, and "Build Farm" is back under the mouse.
    serverAnswers(store, (view) => takeJob(view, SAMPLE.workerId));
    wait(100);
    controller.startJob('farm');
    wait(JOB_GUARD_MS - 101);
    controller.startJob('farm');
    expect(connection.sent).toHaveLength(2);
    wait(1);
    controller.startJob('farm');
    expect(sentActions(connection)[2]).toEqual({ type: 'startJob', unitId: SAMPLE.workerId, improvement: 'farm' });

    // A job that ends because the improvement is finished starts the guard like any other change.
    serverAnswers(store, (view) => giveJob(view, SAMPLE.workerId));
    wait(JOB_GUARD_MS);
    serverAnswers(store, (view) => takeJob(view, SAMPLE.workerId));
    wait(JOB_GUARD_MS - 1);
    controller.startJob('farm');
    expect(connection.sent).toHaveLength(3);

    // Selecting another unit does not start it. Two Workers: the sample one at work, a second one idle.
    const twoWorkers = viewWith((view) => {
      const second = cloneJson(unitIn(view, SAMPLE.workerId));
      second.id = 'u1_second';
      second.tile = SAMPLE.emptyTile;
      view.units.push(second);
      takeJob(view, 'u1_second');
    });
    // From the idle Worker to the one at work: "has a job" is new on screen, yet nothing changed for either unit.
    // (The selection guard is the shorter of the two: once it is over, the press counts, 100 ms before the job guard would let it.)
    expect(SELECTION_GUARD_MS).toBeLessThan(JOB_GUARD_MS);
    const toBusy = setup({ selection: { kind: 'unit', unitId: 'u1_second' } }, twoWorkers);
    toBusy.store.set({ selection: SELECT_WORKER });
    toBusy.wait(SELECTION_GUARD_MS);
    toBusy.controller.stopJob();
    expect(sentActions(toBusy.connection)).toEqual([{ type: 'stopJob', unitId: SAMPLE.workerId }]);
    // And from the one at work to the idle one.
    const toIdle = setup({ selection: SELECT_WORKER }, twoWorkers);
    toIdle.store.set({ selection: { kind: 'unit', unitId: 'u1_second' } });
    toIdle.wait(SELECTION_GUARD_MS);
    toIdle.controller.startJob('farm');
    expect(sentActions(toIdle.connection)).toEqual([{ type: 'startJob', unitId: 'u1_second', improvement: 'farm' }]);
  });

  it('the job guard is not started by a job that changed while its unit was not selected', () => {
    const later = setup({ selection: SELECT_WARRIOR }, viewWithIdleWorker());
    setView(later.store, (view) => giveJob(view, SAMPLE.workerId)); // (as if another tab had started it)
    later.store.set({ selection: SELECT_WORKER });
    later.wait(SELECTION_GUARD_MS); // the selection guard, which is over 100 ms before the job guard would be
    later.controller.stopJob();
    expect(sentActions(later.connection)).toEqual([{ type: 'stopJob', unitId: SAMPLE.workerId }]);

    // Deselecting and selecting the same unit while its job changed in between: no guard either.
    const again = setup({ selection: SELECT_WORKER }, viewWithIdleWorker());
    again.controller.deselect();
    setView(again.store, (view) => giveJob(view, SAMPLE.workerId));
    again.store.set({ selection: SELECT_WORKER });
    again.wait(SELECTION_GUARD_MS);
    again.controller.stopJob();
    expect(sentActions(again.connection)).toEqual([{ type: 'stopJob', unitId: SAMPLE.workerId }]);

    // After destroy the controller no longer watches: a job that appears starts no guard.
    const gone = setup({ selection: SELECT_WORKER }, viewWithIdleWorker());
    gone.controller.destroy();
    serverAnswers(gone.store, (view) => giveJob(view, SAMPLE.workerId));
    gone.controller.stopJob();
    expect(sentActions(gone.connection)).toEqual([{ type: 'stopJob', unitId: SAMPLE.workerId }]);
  });

  it('a tap on a neighboring tile while a unit at work is selected gives no order', () => {
    // With the real movement rules, as the app runs: a unit at work reaches nothing.
    const { store, controller, connection } = setup({ selection: SELECT_WORKER }, sampleView(), 'rules');
    expect(ownOf(viewOf(store), SAMPLE.workerId).job).not.toBeNull();
    expect(ownOf(viewOf(store), SAMPLE.workerId).movesLeft).toBeGreaterThan(0);

    // Open land of the player's next to the Worker: the tap opens the tile's card.
    controller.onTileTap(SAMPLE.workerTile + 1);
    expect(store.get().selection).toBeNull();
    expect(store.get().inspectedTile).toBe(SAMPLE.workerTile + 1);

    // Rome lies next to the Worker too: the tap selects the city.
    store.set({ selection: SELECT_WORKER, inspectedTile: null });
    controller.onTileTap(SAMPLE.romeTile);
    expect(store.get().selection).toEqual(SELECT_ROME);
    expect(connection.sent).toEqual([]);

    // The same tap for the same Worker without a job is an order to walk there.
    const idle = setup({ selection: SELECT_WORKER }, viewWithIdleWorker(), 'rules');
    idle.controller.onTileTap(SAMPLE.workerTile + 1);
    expect(sentActions(idle.connection)).toEqual([{ type: 'moveUnit', unitId: SAMPLE.workerId, path: [SAMPLE.workerTile + 1] }]);
    expect(idle.store.get().selection).toEqual(SELECT_WORKER);
    expect(idle.store.get().inspectedTile).toBeNull();
  });

  it('the selection guard: for 500 ms after the selection changed to another unit or city, Found City, the job buttons, "Stop work" and every queue button do nothing, and nobody is told; after that they work', () => {
    expect(SELECTION_GUARD_MS).toBe(500);

    // A double tap on a lone Settler: the first tap selects it, the panel comes up under the finger, the second tap lands on Found City.
    const settler = setup();
    settler.controller.onTileTap(SAMPLE.settlerTile); // from nothing to something
    expect(settler.store.get().selection).toEqual({ kind: 'unit', unitId: SAMPLE.settlerId });
    settler.wait(250);
    settler.controller.foundCity();
    settler.wait(SELECTION_GUARD_MS - 251);
    settler.controller.foundCity(); // one millisecond before the guard is over
    expect(settler.connection.sent).toEqual([]);
    expect(settler.store.get().toasts).toEqual([]); // an ignored press gives no order and no message
    expect(settler.store.get().busy).toBe(false);
    settler.wait(1);
    settler.controller.foundCity();
    expect(sentActions(settler.connection)).toEqual([{ type: 'foundCity', unitId: SAMPLE.settlerId }]);

    // A Worker at work: "Stop work" comes up where it stood.
    const atWork = setup();
    atWork.controller.onTileTap(SAMPLE.workerTile);
    atWork.wait(300);
    atWork.controller.stopJob();
    expect(atWork.connection.sent).toEqual([]);
    atWork.wait(300); // 600 ms after the selection
    atWork.controller.stopJob();
    expect(sentActions(atWork.connection)).toEqual([{ type: 'stopJob', unitId: SAMPLE.workerId }]);

    // A free Worker: "Build Farm" comes up where it stood.
    const free = setup({}, viewWithIdleWorker());
    free.controller.onTileTap(SAMPLE.workerTile);
    free.wait(300);
    free.controller.startJob('farm');
    expect(free.connection.sent).toEqual([]);
    free.wait(200);
    free.controller.startJob('farm');
    expect(sentActions(free.connection)).toEqual([{ type: 'startJob', unitId: SAMPLE.workerId, improvement: 'farm' }]);

    // A city: every queue button, the add buttons too.
    const city = setup();
    city.controller.onTileTap(SAMPLE.romeTile);
    expect(city.store.get().selection).toEqual(SELECT_ROME);
    city.wait(300);
    expect(city.controller.addToQueue(SETTLER)).toBe(false);
    expect(city.controller.removeFromQueue(0)).toBe(false);
    expect(city.controller.moveInQueue(0, 1)).toBe(false);
    expect(city.controller.clearQueue()).toBe(false);
    expect(city.connection.sent).toEqual([]);
    expect(city.store.get().toasts).toEqual([]);
    city.wait(200);
    expect(city.controller.addToQueue(SETTLER)).toBe(true);
    expect(sentActions(city.connection)).toEqual([{ type: 'setBuildQueue', cityId: SAMPLE.romeId, queue: [WARRIOR, SCOUT, SETTLER] }]);
  });

  it('the selection guard starts when the selection goes to ANOTHER thing, however it got there, and not otherwise', () => {
    // From one unit to another (the N key), from a unit to the city on its tile (a second tap), "Show me".
    const next = setup({ selection: SELECT_WARRIOR });
    next.wait(5000);
    expect(next.controller.selectNextIdleUnit()).toBe(SAMPLE.settlerTile);
    next.controller.foundCity();
    expect(next.connection.sent).toEqual([]);

    const cycle = setup({ selection: SELECT_WARRIOR });
    setView(cycle.store, (view) => {
      unitIn(view, SAMPLE.warriorId).tile = SAMPLE.romeTile;
    });
    cycle.wait(5000);
    cycle.controller.onTileTap(SAMPLE.romeTile); // the Warrior is selected: the tap goes on to the city
    expect(cycle.store.get().selection).toEqual(SELECT_ROME);
    expect(cycle.controller.addToQueue(SETTLER)).toBe(false);

    const shown = setup();
    setView(shown.store, (view) => {
      romeOf(view).buildQueue = [];
    });
    expect(shown.controller.selectNextTask()).toBe(SAMPLE.romeTile);
    expect(shown.controller.addToQueue(SETTLER)).toBe(false);
    shown.wait(SELECTION_GUARD_MS);
    expect(shown.controller.addToQueue(SETTLER)).toBe(true);

    // NOT started: a tap on the thing that is selected already, a new view, deselecting, a tile card.
    const same = setup({ selection: SELECT_ROME });
    same.wait(5000);
    same.controller.onTileTap(SAMPLE.romeTile);
    setView(same.store, (view) => {
      view.players[1].endedTurn = true;
    });
    expect(same.controller.addToQueue(SETTLER)).toBe(true);

    const away = setup({ selection: { kind: 'unit', unitId: SAMPLE.settlerId } });
    away.wait(5000);
    away.controller.deselect(); // to nothing: no panel comes up
    away.controller.onTileTap(SAMPLE.emptyTile); // a tile card: no order button on it
    away.store.set({ selection: { kind: 'unit', unitId: SAMPLE.settlerId }, inspectedTile: null }); // ...and from nothing to something
    away.controller.foundCity();
    expect(away.connection.sent).toEqual([]);
    away.wait(SELECTION_GUARD_MS);
    away.controller.foundCity();
    expect(sentActions(away.connection)).toEqual([{ type: 'foundCity', unitId: SAMPLE.settlerId }]);
  });

  it('the selection guard does not hold back a map tap, End Turn, or the F key: none of them is a button that came up under the pointer', () => {
    const { store, controller, connection, wait } = setup();
    controller.onTileTap(SAMPLE.settlerTile);
    wait(100);
    controller.foundCity('key'); // N, then F: a key cannot land on a button
    expect(sentActions(connection)).toEqual([{ type: 'foundCity', unitId: SAMPLE.settlerId }]);

    store.set({ busy: false });
    controller.onTileTap(SAMPLE.warriorTile); // select the Warrior...
    wait(100);
    controller.onTileTap(SAMPLE.warriorTile + 1); // ...and send it off at once
    expect(sentActions(connection)[1]).toEqual({ type: 'moveUnit', unitId: SAMPLE.warriorId, path: [SAMPLE.warriorTile + 1] });

    store.set({ busy: false });
    controller.onTileTap(SAMPLE.romeTile);
    wait(100);
    controller.toggleEndTurn();
    expect(sentActions(connection)[2]).toEqual({ type: 'endTurn' });
  });

  // ---- The map moved by itself ----

  it('the map-move guard: for 500 ms after the map moved by itself, a tap on a tile the selected unit could be sent to gives no order and does nothing at all; after that it is an order', () => {
    const { store, controller, connection, wait } = setup();
    controller.onTileTap(SAMPLE.warriorTile); // the first tap of a double tap selects the Warrior...
    controller.mapMovedByItself(); // ...the map steps aside for it (it stood at the edge)...
    wait(130);
    const before = store.get();
    controller.onTileTap(SAMPLE.warriorTile + 1); // ...and the second tap lands on the tile beside it
    expect(connection.sent).toEqual([]);
    expect(store.get()).toBe(before); // not an order, and nothing else either: the Warrior stays selected, no card opens

    wait(MAP_MOVE_GUARD_MS - 131);
    controller.onTileTap(SAMPLE.warriorTile + 1);
    expect(connection.sent).toEqual([]);

    // A press after that works.
    wait(1);
    controller.onTileTap(SAMPLE.warriorTile + 1);
    expect(sentActions(connection)).toEqual([{ type: 'moveUnit', unitId: SAMPLE.warriorId, path: [SAMPLE.warriorTile + 1] }]);
    expect(MAP_MOVE_GUARD_MS).toBe(500);
  });

  it('the map-move guard holds back orders to units only: a tap that selects or opens a tile card counts at once, and so do the keys and End Turn', () => {
    const { store, controller, connection, wait } = setup({ selection: SELECT_WARRIOR });
    controller.mapMovedByItself();
    wait(100);
    // A tile the Warrior cannot be sent to (the stub reaches only the two tiles east of it): the card opens, as always.
    controller.onTileTap(SAMPLE.emptyTile);
    expect(store.get().inspectedTile).toBe(SAMPLE.emptyTile);
    // Selecting works.
    controller.onTileTap(SAMPLE.settlerTile);
    expect(store.get().selection).toEqual({ kind: 'unit', unitId: SAMPLE.settlerId });
    // The F key and End Turn are no taps on the map.
    controller.foundCity('key');
    expect(sentActions(connection)).toEqual([{ type: 'foundCity', unitId: SAMPLE.settlerId }]);
    store.set({ busy: false });
    controller.toggleEndTurn();
    expect(sentActions(connection)).toHaveLength(2);
  });

  it('the map-move guard is started only by the map moving by itself: selecting, a new view and a hover start nothing', () => {
    const { store, controller, connection, wait } = setup();
    controller.onTileTap(SAMPLE.warriorTile);
    setView(store, (view) => {
      view.players[1].endedTurn = true;
    });
    controller.onTileHover(SAMPLE.warriorTile + 1);
    wait(100);
    controller.onTileTap(SAMPLE.warriorTile + 1);
    expect(sentActions(connection)).toEqual([{ type: 'moveUnit', unitId: SAMPLE.warriorId, path: [SAMPLE.warriorTile + 1] }]);

    // Each move starts the time again.
    store.set({ busy: false });
    controller.mapMovedByItself();
    wait(400);
    controller.mapMovedByItself();
    wait(400);
    controller.onTileTap(SAMPLE.warriorTile + 2);
    expect(sentActions(connection)).toHaveLength(1);
    wait(100);
    controller.onTileTap(SAMPLE.warriorTile + 2);
    expect(sentActions(connection)).toHaveLength(2);
  });

  // ---- Adds wait for the answer that is on its way ----

  /** Plays the server accepting the newest setBuildQueue: the view shows the list that was sent, then the acknowledgement. */
  function serverTakesQueue(store: Store, connection: FakeConnection): void {
    const sent = sentActions(connection).pop() as { type: string; queue: BuildItem[] };
    if (sent.type !== 'setBuildQueue') throw new Error('expected the newest action to be a setBuildQueue');
    setView(store, (view) => {
      romeOf(view).buildQueue = sent.queue.map((item) => ({ item: { ...item }, cost: 18, turns: 5, wait: null }));
    });
    store.set({ busy: false });
  }

  /** The queues of every setBuildQueue that went out, as lists of unit types. */
  function sentQueues(connection: FakeConnection): string[][] {
    return (sentActions(connection) as { type: string; queue?: BuildItem[] }[]).flatMap((action) =>
      action.type === 'setBuildQueue' && action.queue !== undefined ? [action.queue.map((item) => item.unitType)] : [],
    );
  }

  it('adds wait: two and three presses on add buttons before the first answer give two and three entries', () => {
    const two = setup({ selection: SELECT_ROME });
    expect(two.controller.addToQueue(SETTLER)).toBe(true); // goes out
    expect(two.controller.addToQueue(SETTLER)).toBe(true); // the answer is on its way: kept
    expect(two.connection.sent).toHaveLength(1);
    serverTakesQueue(two.store, two.connection);
    // The answer has come: the kept item goes out on top of the list that was sent, and nothing more.
    expect(sentQueues(two.connection)).toEqual([
      ['warrior', 'scout', 'settler'],
      ['warrior', 'scout', 'settler', 'settler'],
    ]);
    expect(two.store.get().busy).toBe(true);
    serverTakesQueue(two.store, two.connection);
    expect(two.connection.sent).toHaveLength(2);
    expect(two.store.get().busy).toBe(false);
    expect(romeOf(viewOf(two.store)).buildQueue.map((entry) => entry.item.unitType)).toEqual(['warrior', 'scout', 'settler', 'settler']);

    // Three presses, on three different buttons: all three arrive, in the order they were pressed. The two that
    // waited go out together.
    const three = setup({ selection: SELECT_ROME });
    three.controller.addToQueue(WORKER);
    three.controller.addToQueue(WARRIOR);
    three.controller.addToQueue(SETTLER);
    serverTakesQueue(three.store, three.connection);
    expect(sentQueues(three.connection)).toEqual([
      ['warrior', 'scout', 'worker'],
      ['warrior', 'scout', 'worker', 'warrior', 'settler'],
    ]);
    // What is sent is made of fresh items, as always.
    const last = sentActions(three.connection).pop() as { queue: BuildItem[] };
    for (const item of last.queue) expect(Object.keys(item).sort()).toEqual(['kind', 'unitType']);

    // A press while the SECOND message is on its way waits for that one.
    three.controller.addToQueue(SCOUT);
    expect(three.connection.sent).toHaveLength(2);
    serverTakesQueue(three.store, three.connection);
    expect(sentQueues(three.connection)[2]).toEqual(['warrior', 'scout', 'worker', 'warrior', 'settler', 'scout']);
    serverTakesQueue(three.store, three.connection);
    expect(three.connection.sent).toHaveLength(3);
  });

  it('adds wait: a refusal of the first drops the rest', () => {
    const { store, controller, connection } = setup({ selection: SELECT_ROME });
    controller.addToQueue(SETTLER);
    controller.addToQueue(WORKER);
    controller.addToQueue(WORKER);
    // actionRejected: the view is as it was, `busy` is cleared (and a message is shown).
    store.set({ busy: false, toasts: [{ id: 1, text: 'The server said no.', kind: 'error' }] });
    expect(connection.sent).toHaveLength(1);
    expect(store.get().busy).toBe(false);
    // Nothing is left over for later: the next press starts from the queue on the screen.
    expect(controller.addToQueue(WORKER)).toBe(true);
    expect(sentQueues(connection)[1]).toEqual(['warrior', 'scout', 'worker']);
    serverTakesQueue(store, connection);
    expect(connection.sent).toHaveLength(2);
  });

  it('adds wait: the limit of eight holds, counting what is on its way and what waits', () => {
    const { store, controller, connection } = setup({ selection: SELECT_ROME });
    setView(store, (view) => {
      romeOf(view).buildQueue = Array.from({ length: RULES.maxQueueLength - 3 }, () => ({ item: { ...WARRIOR }, cost: 18, turns: null, wait: 'earlier' as const }));
    });
    expect(controller.addToQueue(SCOUT)).toBe(true); // 6, on its way
    expect(controller.addToQueue(SCOUT)).toBe(true); // 7, waits
    expect(controller.addToQueue(SCOUT)).toBe(true); // 8, waits
    expect(controller.addToQueue(SCOUT)).toBe(false); // a ninth is ignored
    expect(controller.addToQueue(WORKER)).toBe(false);
    serverTakesQueue(store, connection);
    const queues = sentQueues(connection);
    expect(queues).toHaveLength(2);
    expect(queues[1]).toHaveLength(RULES.maxQueueLength);
    expect(queues[1].slice(-3)).toEqual(['scout', 'scout', 'scout']);
    serverTakesQueue(store, connection);
    expect(connection.sent).toHaveLength(2);
    expect(controller.addToQueue(SCOUT)).toBe(false); // the queue is full
  });

  it('adds wait: a press on a ROW button meanwhile does nothing (the rows on the screen are one answer behind)', () => {
    const { store, controller, connection } = setup({ selection: SELECT_ROME });
    controller.addToQueue(SETTLER);
    controller.addToQueue(WORKER);
    expect(controller.removeFromQueue(0)).toBe(false);
    expect(controller.moveInQueue(1, -1)).toBe(false);
    expect(controller.clearQueue()).toBe(false);
    serverTakesQueue(store, connection);
    // The second message is on its way now: still nothing for a row press.
    expect(controller.removeFromQueue(0)).toBe(false);
    serverTakesQueue(store, connection);
    expect(sentQueues(connection)).toEqual([
      ['warrior', 'scout', 'settler'],
      ['warrior', 'scout', 'settler', 'worker'],
    ]);
    // Every answer is here: a row press counts again.
    expect(controller.removeFromQueue(0)).toBe(true);
  });

  it('adds wait: they are dropped when the selection moves to another city or goes away, when the connection is lost, and when the turn is ended', () => {
    // Another city of the player's (the sample view has one; a copy of Rome stands in for a second).
    const twoCities = viewWith((view) => {
      const ostia = { ...cloneJson(cityIn(view, SAMPLE.romeId)), id: 'c1_ostia', name: 'Ostia', tile: SAMPLE.romeTile - 2 };
      view.cities.push(ostia);
    });
    const moved = setup({ selection: SELECT_ROME }, twoCities);
    moved.controller.addToQueue(SETTLER);
    moved.controller.addToQueue(WORKER);
    moved.store.set({ selection: { kind: 'city', cityId: 'c1_ostia' } });
    moved.wait(SELECTION_GUARD_MS);
    // The answer for Rome is still on its way: an add for Ostia does not ride on it.
    expect(moved.controller.addToQueue(SCOUT)).toBe(false);
    serverTakesQueue(moved.store, moved.connection);
    expect(moved.connection.sent).toHaveLength(1);
    // Back in Rome nothing is left of the Worker that waited.
    moved.store.set({ selection: SELECT_ROME });
    moved.wait(SELECTION_GUARD_MS);
    moved.controller.addToQueue(SCOUT);
    expect(sentQueues(moved.connection)[1]).toEqual(['warrior', 'scout', 'settler', 'scout']);

    const closed = setup({ selection: SELECT_ROME });
    closed.controller.addToQueue(SETTLER);
    closed.controller.addToQueue(WORKER);
    closed.controller.deselect();
    serverTakesQueue(closed.store, closed.connection);
    expect(closed.connection.sent).toHaveLength(1);

    const lost = setup({ selection: SELECT_ROME });
    lost.controller.addToQueue(SETTLER);
    lost.controller.addToQueue(WORKER);
    lost.store.set({ connection: 'reconnecting' });
    expect(lost.controller.addToQueue(WORKER)).toBe(false); // and no press is kept while there is no connection
    lost.store.set({ connection: 'online', busy: false }); // back, with a full view (gameSync)
    expect(lost.connection.sent).toHaveLength(1);
    expect(lost.store.get().busy).toBe(false);

    // Another tab of the same player ended the turn while the answer was on its way.
    const ended = setup({ selection: SELECT_ROME });
    ended.controller.addToQueue(SETTLER);
    ended.controller.addToQueue(WORKER);
    setView(ended.store, (view) => {
      view.players[0].endedTurn = true;
    });
    expect(ended.controller.addToQueue(WORKER)).toBe(false);
    serverTakesQueue(ended.store, ended.connection);
    expect(ended.connection.sent).toHaveLength(1);
  });

  it('adds wait: an add is kept only for an answer about the SAME city\'s queue; behind any other action it is ignored, as every press is', () => {
    const { store, controller, connection, wait } = setup({ selection: SELECT_WARRIOR });
    controller.onTileTap(SAMPLE.warriorTile + 1); // a move is on its way
    store.set({ selection: SELECT_ROME });
    wait(SELECTION_GUARD_MS);
    expect(controller.addToQueue(SETTLER)).toBe(false);
    store.set({ busy: false });
    expect(sentActions(connection)).toHaveLength(1);
  });

  /** The kinds of the actions that went out, oldest first. */
  function sentKinds(connection: FakeConnection): string[] {
    return sentActions(connection).map((action) => (action as { type: string }).type);
  }

  /** Plays the server refusing the action that is on its way, through the page's own handling of that message. */
  function serverRefuses(store: Store): void {
    handleServerMessage(store, { type: 'actionRejected', requestId: 1, error: { code: 'staleTurn', message: 'The server said no.' } }, () => {});
  }

  it('End Turn waits and cannot overtake adds that wait: pressed during an add\'s round trip it ends the turn after the add, and after every add that waited', () => {
    const { store, controller, connection } = setup({ selection: SELECT_ROME });
    controller.addToQueue(SETTLER);
    controller.addToQueue(WORKER);
    controller.toggleEndTurn(); // the first add is on its way: the press is kept, nothing goes out
    expect(sentKinds(connection)).toEqual(['setBuildQueue']);
    serverTakesQueue(store, connection);
    // In the very moment the answer is taken in, the kept add has gone out, and End Turn waits behind it.
    expect(store.get().busy).toBe(true);
    expect(sentKinds(connection)).toEqual(['setBuildQueue', 'setBuildQueue']);
    expect(sentQueues(connection)[1]).toEqual(['warrior', 'scout', 'settler', 'worker']);
    serverTakesQueue(store, connection);
    // Every answer is in: now the turn is ended, by the one press made at the start.
    expect(sentKinds(connection)).toEqual(['setBuildQueue', 'setBuildQueue', 'endTurn']);
    expect(store.get().busy).toBe(true);
    // Nothing is left over: when the turn has ended and the guard is over, a press takes it back as always.
    serverSetsEnded(store, true);
    expect(sentKinds(connection)).toHaveLength(3);
  });

  it('End Turn waits behind any action whose answer is on its way (a move, a job, one add), and "tap to cancel" waits the same way', () => {
    const move = setup({ selection: SELECT_WARRIOR });
    move.controller.onTileTap(SAMPLE.warriorTile + 1);
    move.controller.toggleEndTurn();
    expect(sentKinds(move.connection)).toEqual(['moveUnit']);
    // The view with the unit moved comes first and changes nothing yet; the acknowledgement lets End Turn go.
    setView(move.store, (view) => {
      unitIn(view, SAMPLE.warriorId).tile = SAMPLE.warriorTile + 1;
    });
    expect(sentKinds(move.connection)).toEqual(['moveUnit']);
    move.store.set({ busy: false });
    expect(sentKinds(move.connection)).toEqual(['moveUnit', 'endTurn']);
    expect(move.connection.sent.map((message) => (message.type === 'action' ? message.requestId : null))).toEqual([1, 2]);

    const add = setup({ selection: SELECT_ROME });
    add.controller.addToQueue(SETTLER);
    add.controller.toggleEndTurn();
    serverTakesQueue(add.store, add.connection);
    expect(sentKinds(add.connection)).toEqual(['setBuildQueue', 'endTurn']);

    // The player had ended the turn; an order from the F key is on its way (the server will refuse or take it), and "tap to cancel" is pressed.
    const cancel = setup({ selection: { kind: 'unit', unitId: SAMPLE.settlerId } }, viewWith((view) => {
      view.players[0].endedTurn = true;
    }));
    cancel.controller.foundCity('key');
    cancel.controller.toggleEndTurn();
    expect(sentKinds(cancel.connection)).toEqual(['foundCity']);
    cancel.store.set({ busy: false });
    expect(sentKinds(cancel.connection)).toEqual(['foundCity', 'cancelEndTurn']);
  });

  it('End Turn waits: after a refusal it does not end the turn, whatever was refused', () => {
    // The add itself is refused.
    const refused = setup({ selection: SELECT_ROME });
    refused.controller.addToQueue(SETTLER);
    refused.controller.toggleEndTurn();
    serverRefuses(refused.store);
    expect(refused.store.get().busy).toBe(false);
    expect(sentKinds(refused.connection)).toEqual(['setBuildQueue']);
    // The press is gone for good: a later answer of something else does not bring it back.
    refused.controller.addToQueue(SCOUT);
    serverTakesQueue(refused.store, refused.connection);
    expect(sentKinds(refused.connection)).toEqual(['setBuildQueue', 'setBuildQueue']);

    // The first add is taken, the add that waited behind it is refused: End Turn, last in line, is dropped.
    const later = setup({ selection: SELECT_ROME });
    later.controller.addToQueue(SETTLER);
    later.controller.addToQueue(WORKER);
    later.controller.toggleEndTurn();
    serverTakesQueue(later.store, later.connection);
    expect(sentKinds(later.connection)).toEqual(['setBuildQueue', 'setBuildQueue']);
    serverRefuses(later.store);
    expect(sentKinds(later.connection)).toEqual(['setBuildQueue', 'setBuildQueue']);
    expect(later.store.get().busy).toBe(false);

    // A move that is refused.
    const move = setup({ selection: SELECT_WARRIOR });
    move.controller.onTileTap(SAMPLE.warriorTile + 1);
    move.controller.toggleEndTurn();
    serverRefuses(move.store);
    expect(sentKinds(move.connection)).toEqual(['moveUnit']);

    // A plain error instead of an answer (the action never reached the game).
    const error = setup({ selection: SELECT_WARRIOR });
    error.controller.onTileTap(SAMPLE.warriorTile + 1);
    error.controller.toggleEndTurn();
    handleServerMessage(error.store, { type: 'error', code: 'rateLimited', message: 'Slow down.' }, () => {});
    expect(error.store.get().busy).toBe(false);
    expect(sentKinds(error.connection)).toEqual(['moveUnit']);
  });

  it('End Turn waits: a second press while one waits takes it back, so two presses leave the turn open; a third waits again', () => {
    const { store, controller, connection, wait } = setup({ selection: SELECT_ROME });
    controller.addToQueue(SETTLER);
    controller.toggleEndTurn();
    wait(150);
    controller.toggleEndTurn(); // the second click of a double-click, or a change of mind
    serverTakesQueue(store, connection);
    expect(sentKinds(connection)).toEqual(['setBuildQueue']);
    expect(store.get().busy).toBe(false);

    controller.addToQueue(SCOUT);
    controller.toggleEndTurn();
    controller.toggleEndTurn();
    controller.toggleEndTurn();
    serverTakesQueue(store, connection);
    expect(sentKinds(connection)).toEqual(['setBuildQueue', 'setBuildQueue', 'endTurn']);
  });

  it('End Turn waits: a lost connection drops it', () => {
    const { store, controller, connection } = setup({ selection: SELECT_ROME });
    controller.addToQueue(SETTLER);
    controller.toggleEndTurn();
    // What the app does when the socket drops (ui/app.ts): the answer will never come, then the status changes.
    connection.accepts = false;
    store.set({ busy: false });
    store.set({ connection: 'reconnecting' });
    expect(sentKinds(connection)).toEqual(['setBuildQueue']);
    // Back, with a full view: nothing is ended behind the player's back.
    connection.accepts = true;
    store.set({ connection: 'online', busy: false });
    expect(sentKinds(connection)).toEqual(['setBuildQueue']);

    // The same when the status changes first.
    const other = setup({ selection: SELECT_WARRIOR });
    other.controller.onTileTap(SAMPLE.warriorTile + 1);
    other.controller.toggleEndTurn();
    other.store.set({ connection: 'reconnecting' });
    other.store.set({ connection: 'online', busy: false });
    expect(sentKinds(other.connection)).toEqual(['moveUnit']);
  });

  it('End Turn waits: it is dropped with the adds that waited in front of it (the selection moved away), and when the button has changed its meaning meanwhile', () => {
    // Two adds and End Turn; then the player closes the panel: the add that waited is dropped, and the turn must not end without it.
    const closed = setup({ selection: SELECT_ROME });
    closed.controller.addToQueue(SETTLER);
    closed.controller.addToQueue(WORKER);
    closed.controller.toggleEndTurn();
    closed.controller.deselect();
    serverTakesQueue(closed.store, closed.connection);
    expect(sentKinds(closed.connection)).toEqual(['setBuildQueue']);

    // With no add waiting, End Turn is not about the selection: closing the panel leaves it waiting.
    const kept = setup({ selection: SELECT_ROME });
    kept.controller.addToQueue(SETTLER);
    kept.controller.toggleEndTurn();
    kept.controller.deselect();
    serverTakesQueue(kept.store, kept.connection);
    expect(sentKinds(kept.connection)).toEqual(['setBuildQueue', 'endTurn']);

    // Another tab of the same player ended the turn while the press waited: the button means "cancel" now, the press meant "end".
    const ended = setup({ selection: SELECT_WARRIOR });
    ended.controller.onTileTap(SAMPLE.warriorTile + 1);
    ended.controller.toggleEndTurn();
    setView(ended.store, (view) => {
      view.players[0].endedTurn = true;
    });
    ended.store.set({ busy: false });
    expect(sentKinds(ended.connection)).toEqual(['moveUnit']);

    // The turn went on meanwhile.
    const next = setup({ selection: SELECT_WARRIOR });
    next.controller.onTileTap(SAMPLE.warriorTile + 1);
    next.controller.toggleEndTurn();
    serverStartsNextTurn(next.store);
    expect(sentKinds(next.connection)).toEqual(['moveUnit']);
  });

  it('End Turn waits only for OTHER actions: the second click of a double-click, while the first click\'s own endTurn is on its way, is still ignored', () => {
    const { store, controller, connection, wait } = setup();
    controller.toggleEndTurn();
    wait(100);
    controller.toggleEndTurn(); // the answer to the first is on its way
    expect(sentKinds(connection)).toEqual(['endTurn']);
    serverSetsEnded(store, true);
    // Nothing waited: the turn stays ended, also when the guard is over.
    wait(END_TURN_GUARD_MS);
    store.set({ hoverTile: 3 });
    expect(sentKinds(connection)).toEqual(['endTurn']);

    // And the last player to end: the next turn is not ended by the second click.
    const last = setup();
    last.controller.toggleEndTurn();
    last.controller.toggleEndTurn();
    serverStartsNextTurn(last.store);
    last.wait(END_TURN_GUARD_MS);
    last.store.set({ hoverTile: 3 });
    expect(sentKinds(last.connection)).toEqual(['endTurn']);
  });

  it('toggleEndTurn sends endTurn, or cancelEndTurn when the player has already ended the turn', () => {
    const { store, controller, connection, wait } = setup();

    controller.toggleEndTurn();
    expect(sentActions(connection)).toEqual([{ type: 'endTurn' }]);
    expect(store.get().busy).toBe(true);

    serverSetsEnded(store, true);
    wait(END_TURN_GUARD_MS);
    controller.toggleEndTurn();
    expect(sentActions(connection)).toEqual([{ type: 'endTurn' }, { type: 'cancelEndTurn' }]);
  });

  it('End Turn guard: two toggleEndTurn calls 100 ms apart across the player\'s endedTurn flipping send ONE action; a call after END_TURN_GUARD_MS sends the second', () => {
    const { store, controller, connection, wait } = setup();

    controller.toggleEndTurn(); // the first click of a double-click
    serverSetsEnded(store, true); // the server answers within milliseconds: the button now means "cancel"
    wait(100);
    controller.toggleEndTurn(); // the second click
    expect(sentActions(connection)).toEqual([{ type: 'endTurn' }]);

    // Still inside the guard just before it runs out...
    wait(END_TURN_GUARD_MS - 101);
    controller.toggleEndTurn();
    expect(sentActions(connection)).toEqual([{ type: 'endTurn' }]);

    // ...and a deliberate press once it has.
    wait(1);
    controller.toggleEndTurn();
    expect(sentActions(connection)).toEqual([{ type: 'endTurn' }, { type: 'cancelEndTurn' }]);
  });

  it('End Turn guard: two toggleEndTurn calls 100 ms apart across a turn change send ONE action (the next turn is not ended by the second press)', () => {
    const { store, controller, connection, wait } = setup();

    controller.toggleEndTurn(); // this player is the last to end: the turn resolves at once
    serverStartsNextTurn(store);
    wait(100);
    controller.toggleEndTurn(); // the second click of the double-click must not end the new turn
    expect(sentActions(connection)).toEqual([{ type: 'endTurn' }]);

    wait(END_TURN_GUARD_MS);
    controller.toggleEndTurn();
    expect(connection.sent.map((message) => (message.type === 'action' ? [message.turn, message.action.type] : null))).toEqual([
      [7, 'endTurn'],
      [8, 'endTurn'],
    ]);
  });

  it('End Turn guard: changes that do not touch the button\'s meaning do not start it', () => {
    const { store, controller, connection, wait } = setup();

    // Another player ends their turn, a unit moves, a tile is hovered: none of that is about this button.
    setView(store, (view) => {
      view.players[1].endedTurn = !view.players[1].endedTurn;
      view.units[0].tile += 1;
    });
    store.set({ hoverTile: 3 });
    wait(10);
    controller.toggleEndTurn();
    expect(sentActions(connection)).toEqual([{ type: 'endTurn' }]);
  });

  it('request ids increase with every action', () => {
    const { store, controller, connection, wait } = setup({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });

    controller.onTileTap(SAMPLE.warriorTile + 1);
    store.set({ busy: false, selection: { kind: 'unit', unitId: SAMPLE.settlerId } });
    wait(SELECTION_GUARD_MS);
    controller.foundCity();
    store.set({ busy: false, selection: SELECT_ROME });
    wait(SELECTION_GUARD_MS);
    controller.addToQueue(SETTLER);
    store.set({ busy: false, selection: SELECT_WORKER });
    wait(SELECTION_GUARD_MS);
    controller.stopJob();
    store.set({ busy: false });
    controller.toggleEndTurn();

    const ids = connection.sent.map((message) => (message.type === 'action' ? message.requestId : Number.NaN));
    expect(ids).toHaveLength(5);
    for (let index = 1; index < ids.length; index++) expect(ids[index]).toBeGreaterThan(ids[index - 1]);
  });

  it('onTileHover updates hoverTile only when it changed', () => {
    const { store, controller } = setup();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    controller.onTileHover(12);
    controller.onTileHover(12);
    expect(store.get().hoverTile).toBe(12);
    expect(notified).toBe(1);

    controller.onTileHover(null);
    controller.onTileHover(null);
    expect(store.get().hoverTile).toBeNull();
    expect(notified).toBe(2);
  });

  it('onHoverInfo updates hoverInfoTile only when it changed', () => {
    const { store, controller } = setup();
    const updates = countUpdates(store);

    controller.onHoverInfo(12);
    controller.onHoverInfo(12);
    expect(store.get().hoverInfoTile).toBe(12);
    expect(updates()).toBe(1);

    controller.onHoverInfo(13);
    expect(store.get().hoverInfoTile).toBe(13);
    expect(updates()).toBe(2);

    controller.onHoverInfo(null);
    controller.onHoverInfo(null);
    expect(store.get().hoverInfoTile).toBeNull();
    expect(updates()).toBe(3);

    // The hover box is its own thing: it touches neither the outline's tile, nor the selection, nor the card.
    store.set({ selection: SELECT_WARRIOR, hoverTile: 5 });
    controller.onHoverInfo(UNSEEN_TILE);
    expect(store.get().selection).toEqual(SELECT_WARRIOR);
    expect(store.get().hoverTile).toBe(5);
    expect(store.get().inspectedTile).toBeNull();
  });

  it('isAiming is true exactly while a unit is selected that can be sent somewhere now (canActNow, and its reach is not empty)', () => {
    const { store, controller } = setup();
    expect(controller.isAiming()).toBe(false); // nothing selected

    store.set({ selection: SELECT_WARRIOR });
    expect(controller.isAiming()).toBe(true);

    store.set({ busy: true });
    expect(controller.isAiming()).toBe(false);
    store.set({ busy: false, connection: 'reconnecting' });
    expect(controller.isAiming()).toBe(false);
    store.set({ connection: 'online' });
    expect(controller.isAiming()).toBe(true);

    setView(store, (view) => {
      view.players[0].endedTurn = true;
    });
    expect(controller.isAiming()).toBe(false);
    setView(store, (view) => {
      view.players[0].endedTurn = false;
    });
    expect(controller.isAiming()).toBe(true);

    store.set({ selection: SELECT_ROME }); // a city is sent nowhere
    expect(controller.isAiming()).toBe(false);
    store.set({ selection: { kind: 'unit', unitId: 'u1_gone' } }); // the unit is no longer in the view
    expect(controller.isAiming()).toBe(false);
    store.set({ selection: null, inspectedTile: SAMPLE.emptyTile }); // a tile card
    expect(controller.isAiming()).toBe(false);

    expect(setup({ game: null, selection: SELECT_WARRIOR }).controller.isAiming()).toBe(false); // no game
  });

  it('isAiming is false for a unit that can go nowhere: one without moves, and a Worker at work', () => {
    // With the real movement rules, as the app runs.
    const spent = setup({ selection: SELECT_WARRIOR }, viewWith((view) => {
      ownOf(view, SAMPLE.warriorId).movesLeft = 0;
    }), 'rules');
    expect(spent.controller.isAiming()).toBe(false);
    // The same Warrior with its moves: it can be sent somewhere.
    expect(setup({ selection: SELECT_WARRIOR }, sampleView(), 'rules').controller.isAiming()).toBe(true);

    // The sample Worker is building a farm and has moves left: nothing is lit for it, and no tap sends it anywhere.
    const atWork = setup({ selection: SELECT_WORKER }, sampleView(), 'rules');
    expect(ownOf(viewOf(atWork.store), SAMPLE.workerId).movesLeft).toBeGreaterThan(0);
    expect(atWork.controller.isAiming()).toBe(false);
    // Its job over, it is aimed again.
    setView(atWork.store, (view) => takeJob(view, SAMPLE.workerId));
    expect(atWork.controller.isAiming()).toBe(true);

    // A hand-made reach: an empty map gives false, one tile gives true.
    const store = storeInGame({ selection: SELECT_WARRIOR });
    let reachable = new Map<TileIndex, ReachStep>();
    const controller = createController(store, fakeConnection(), { reach: () => reachable });
    expect(controller.isAiming()).toBe(false);
    reachable = new Map<TileIndex, ReachStep>([[SAMPLE.warriorTile + 1, { movesLeft: 1, previous: SAMPLE.warriorTile }]]);
    expect(controller.isAiming()).toBe(true);
  });

  it('inspecting and hovering never send anything', () => {
    const { store, controller, connection } = setup();
    controller.onTileTap(SAMPLE.emptyTile);
    controller.onTileTap(SAMPLE.foreignWarriorTile);
    controller.onTileTap(UNSEEN_TILE);
    controller.onTileTap(UNSEEN_TILE);
    controller.onTileHover(SAMPLE.emptyTile);
    controller.onTileHover(null);
    controller.onHoverInfo(SAMPLE.thebesTile);
    controller.onHoverInfo(null);
    controller.isAiming();
    controller.deselect();
    expect(connection.sent).toEqual([]);
    expect(store.get().busy).toBe(false);
  });

  it('deselect clears the selection', () => {
    const { store, controller } = setup({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    controller.deselect();
    expect(store.get().selection).toBeNull();
  });

  it('deselect closes the card', () => {
    const { store, controller, connection } = setup();
    controller.onTileTap(SAMPLE.emptyTile);
    expect(store.get().inspectedTile).toBe(SAMPLE.emptyTile);

    controller.deselect();
    expect(store.get().inspectedTile).toBeNull();
    expect(store.get().selection).toBeNull();

    // With nothing selected and no card there is nothing to do: not even a store update.
    const before = store.get();
    controller.deselect();
    expect(store.get()).toBe(before);
    expect(connection.sent).toEqual([]);
  });

  it('selectNextIdleUnit walks through own units with moves left and wraps around', () => {
    const { store, controller } = setup();

    // By id: the Warrior (u1_k...) comes before the Settler (u1_x...). The
    // Worker (u1_m...) lies between them and is at work: it is not offered.
    expect(controller.selectNextIdleUnit()).toBe(SAMPLE.warriorTile);
    expect(store.get().selection).toEqual({ kind: 'unit', unitId: SAMPLE.warriorId });
    expect(controller.selectNextIdleUnit()).toBe(SAMPLE.settlerTile);
    expect(store.get().selection).toEqual({ kind: 'unit', unitId: SAMPLE.settlerId });
    expect(controller.selectNextIdleUnit()).toBe(SAMPLE.warriorTile); // wrapped around

    // A unit without moves left is skipped; the foreign Warrior never comes up.
    setView(store, (view) => {
      const warrior = view.units.find((unit) => unit.id === SAMPLE.warriorId);
      if (warrior?.own != null) warrior.own.movesLeft = 0;
    });
    expect(controller.selectNextIdleUnit()).toBe(SAMPLE.settlerTile);
    expect(controller.selectNextIdleUnit()).toBe(SAMPLE.settlerTile);

    // Nobody left to move: null, and the selection stays as it is.
    setView(store, (view) => {
      for (const unit of view.units) if (unit.own !== null) unit.own.movesLeft = 0;
    });
    expect(controller.selectNextIdleUnit()).toBeNull();
    expect(store.get().selection).toEqual({ kind: 'unit', unitId: SAMPLE.settlerId });
  });

  it('selectNextTask goes to cities with nothing to build first, then to units with moves left, and wraps around', () => {
    const { store, controller } = setup();
    setView(store, (view) => {
      romeOf(view).buildQueue = [];
    });

    expect(controller.selectNextTask()).toBe(SAMPLE.romeTile);
    expect(store.get().selection).toEqual({ kind: 'city', cityId: SAMPLE.romeId });
    expect(controller.selectNextTask()).toBe(SAMPLE.warriorTile);
    expect(controller.selectNextTask()).toBe(SAMPLE.settlerTile);
    expect(controller.selectNextTask()).toBe(SAMPLE.romeTile);

    // Nothing left that needs the player.
    const done = setup();
    setView(done.store, (view) => {
      for (const unit of view.units) if (unit.own !== null) unit.own.movesLeft = 0;
    });
    expect(done.controller.selectNextTask()).toBeNull();
    expect(done.store.get().selection).toBeNull();
  });

  it('selectNextIdleUnit passes a unit at work by; selectNextTask walks idle cities, then waiting cities, then idle units', () => {
    // N: the Worker has moves left and a job, so it is not "a unit that can still move".
    const keys = setup();
    expect(ownOf(viewOf(keys.store), SAMPLE.workerId).movesLeft).toBeGreaterThan(0);
    const visited: (number | null)[] = [];
    for (let press = 0; press < 4; press++) visited.push(keys.controller.selectNextIdleUnit());
    expect(visited).toEqual([SAMPLE.warriorTile, SAMPLE.settlerTile, SAMPLE.warriorTile, SAMPLE.settlerTile]);
    // With the Worker selected, N goes on to the unit after it by id.
    keys.store.set({ selection: SELECT_WORKER });
    expect(keys.controller.selectNextIdleUnit()).toBe(SAMPLE.settlerTile);
    // Once its job is over it is offered again, in its place between the two.
    setView(keys.store, (view) => takeJob(view, SAMPLE.workerId));
    keys.store.set({ selection: SELECT_WARRIOR });
    expect(keys.controller.selectNextIdleUnit()).toBe(SAMPLE.workerTile);

    // "Show me". Three cities: Rome is building; Ostia (the lowest id) waits
    // with no end in sight; Capua (the highest id) builds nothing.
    const ostiaTile = SAMPLE.romeTile - 2;
    const capuaTile = SAMPLE.romeTile + 14;
    const view = viewWith((changed) => {
      const rome = cityIn(changed, SAMPLE.romeId);
      const ostia = { ...cloneJson(rome), id: 'c1_aaaaaa', name: 'Ostia', tile: ostiaTile };
      if (ostia.own === null) throw new Error('unexpected sample view');
      ostia.own.buildQueue = [{ item: { ...SETTLER }, cost: 30, turns: null, wait: 'needsPopulation' }];
      ostia.own.productionStored = 30;
      ostia.own.held = 'needsPopulation';
      const capua = { ...cloneJson(rome), id: 'c1_zzzzzz', name: 'Capua', tile: capuaTile };
      if (capua.own === null) throw new Error('unexpected sample view');
      capua.own.buildQueue = [];
      changed.cities.push(ostia, capua);
    });
    const show = setup({}, view);
    const tour: (number | null)[] = [];
    for (let press = 0; press < 6; press++) tour.push(show.controller.selectNextTask());
    expect(tour).toEqual([
      capuaTile, // the idle city first, although its id is the highest
      ostiaTile, // then the waiting one
      SAMPLE.warriorTile, // then the units that can still move; the Worker at work is passed by
      SAMPLE.settlerTile,
      capuaTile, // and round again
      ostiaTile,
    ]);
    expect(show.store.get().selection).toEqual({ kind: 'city', cityId: 'c1_aaaaaa' });

    // A city that is held but sees the end of its wait (its first row has a number) is not visited.
    setView(show.store, (changed) => {
      const own = cityIn(changed, 'c1_aaaaaa').own;
      if (own === null) throw new Error('unexpected view');
      own.buildQueue[0].turns = 3;
      own.buildQueue[0].wait = null;
    });
    show.store.set({ selection: null });
    expect([show.controller.selectNextTask(), show.controller.selectNextTask()]).toEqual([capuaTile, SAMPLE.warriorTile]);
  });

  it('does nothing at all without a game', () => {
    const { store, controller, connection } = setup({ game: null });
    const before = store.get();

    controller.onTileTap(SAMPLE.warriorTile);
    controller.onTileTap(SAMPLE.emptyTile);
    controller.foundCity();
    expect(controller.addToQueue(WARRIOR)).toBe(false);
    expect(controller.removeFromQueue(0)).toBe(false);
    expect(controller.moveInQueue(0, 1)).toBe(false);
    expect(controller.clearQueue()).toBe(false);
    controller.startJob('farm');
    controller.stopJob();
    controller.toggleEndTurn();
    controller.deselect();
    expect(controller.isAiming()).toBe(false);
    expect(controller.selectNextIdleUnit()).toBeNull();
    expect(controller.selectNextTask()).toBeNull();

    expect(store.get()).toBe(before);
    expect(connection.sent).toEqual([]);
  });

  it('destroy stops the controller from watching the store', () => {
    const { store, controller, connection, wait } = setup();
    controller.toggleEndTurn();

    controller.destroy();
    serverSetsEnded(store, true); // no longer seen: the guard is not started by it
    wait(100);
    controller.toggleEndTurn();

    // Had the controller still been watching, the second press would have been swallowed.
    expect(sentActions(connection)).toEqual([{ type: 'endTurn' }, { type: 'cancelEndTurn' }]);
  });

  it('the sample view used here has the Warrior, the Settler and the Worker where the tests expect them', () => {
    // A guard for the tests above: if the fixture changes, this fails first and says why.
    const view = sampleView();
    expect(view.units.find((unit) => unit.id === SAMPLE.warriorId)?.tile).toBe(SAMPLE.warriorTile);
    expect(view.units.find((unit) => unit.id === SAMPLE.settlerId)?.tile).toBe(SAMPLE.settlerTile);
    expect(view.units.find((unit) => unit.id === SAMPLE.workerId)?.tile).toBe(SAMPLE.workerTile);
    expect(ownOf(view, SAMPLE.workerId).job?.improvement).toBe('farm');
    expect(romeOf(view).buildQueue.map((entry) => entry.item)).toEqual([WARRIOR, SCOUT]);
    expect(view.cities.find((city) => city.id === SAMPLE.romeId)?.tile).toBe(SAMPLE.romeTile);
    expect(view.turn).toBe(7);
    expect(view.players[0].id).toBe(SAMPLE.me);
  });
});
