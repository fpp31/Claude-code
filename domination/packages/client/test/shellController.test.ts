import { describe, expect, it } from 'vitest';
import type { ReachStep, TileIndex } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import { END_TURN_GUARD_MS, createController } from '../src/game/controller';
import type { Controller } from '../src/game/controller';
import type { ReachFunction } from '../src/game/selectors';
import type { AppState, Store } from '../src/state/store';
import { SAMPLE, fakeConnection, sentActions, setView, storeInGame, viewOf } from './shellKit';
import type { FakeConnection } from './shellKit';

/**
 * The controller, with a hand-made "which tiles can this unit reach" (so
 * no rules engine is needed) and a clock the test moves by hand (for the
 * End Turn guard).
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

function setup(changes: Partial<AppState> = {}): Setup {
  const store = storeInGame(changes);
  const connection = fakeConnection();
  let clock = 50_000;
  const controller = createController(store, connection, { reach: stubReach, now: () => clock });
  return {
    store,
    connection,
    controller,
    wait(ms) {
      clock += ms;
    },
  };
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
      for (const unit of view.units) if (unit.owner === view.you) unit.tile = SAMPLE.romeTile;
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

  it('tapping a reachable tile while busy, offline or after ending the turn sends nothing and KEEPS the selection', () => {
    const selection = { kind: 'unit', unitId: SAMPLE.warriorId } as const;
    const busy = setup({ selection, busy: true });
    const offline = setup({ selection, connection: 'reconnecting' });
    const ended = setup({ selection });
    setView(ended.store, (view) => {
      view.players[0].endedTurn = true;
    });

    for (const { store, controller, connection } of [busy, offline, ended]) {
      const before = store.get();
      controller.onTileTap(SAMPLE.warriorTile + 1);
      expect(connection.sent).toEqual([]);
      expect(store.get().selection).toEqual(selection);
      expect(store.get().busy).toBe(before.busy);
    }
  });

  it('tapping an empty or foreign tile clears the selection', () => {
    const { store, controller, connection } = setup({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });

    controller.onTileTap(SAMPLE.emptyTile);
    expect(store.get().selection).toBeNull();

    store.set({ selection: { kind: 'city', cityId: SAMPLE.romeId } });
    controller.onTileTap(SAMPLE.foreignWarriorTile);
    expect(store.get().selection).toBeNull();

    store.set({ selection: { kind: 'city', cityId: SAMPLE.romeId } });
    controller.onTileTap(SAMPLE.thebesTile);
    expect(store.get().selection).toBeNull();

    expect(connection.sent).toEqual([]);
  });

  it('nothing is sent while busy or while not online', () => {
    for (const changes of [{ busy: true }, { connection: 'reconnecting' }, { connection: 'connecting' }] as Partial<AppState>[]) {
      const { store, controller, connection } = setup(changes);

      store.set({ selection: { kind: 'unit', unitId: SAMPLE.settlerId } });
      controller.foundCity();
      controller.onTileTap(SAMPLE.settlerTile + 1);
      store.set({ selection: { kind: 'city', cityId: SAMPLE.romeId } });
      controller.setProduction({ kind: 'unit', unitType: 'scout' });
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
    const { store, controller, connection } = setup();

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

  it('setProduction sends setProduction for the selected own city, and nothing without one', () => {
    const { store, controller, connection } = setup();

    controller.setProduction({ kind: 'unit', unitType: 'scout' }); // nothing selected
    store.set({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    controller.setProduction({ kind: 'unit', unitType: 'scout' }); // a unit is not a city
    expect(connection.sent).toEqual([]);

    store.set({ selection: { kind: 'city', cityId: SAMPLE.romeId } });
    controller.setProduction({ kind: 'unit', unitType: 'scout' });
    expect(sentActions(connection)).toEqual([
      { type: 'setProduction', cityId: SAMPLE.romeId, item: { kind: 'unit', unitType: 'scout' } },
    ]);
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
    const { store, controller, connection } = setup({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });

    controller.onTileTap(SAMPLE.warriorTile + 1);
    store.set({ busy: false, selection: { kind: 'unit', unitId: SAMPLE.settlerId } });
    controller.foundCity();
    store.set({ busy: false, selection: { kind: 'city', cityId: SAMPLE.romeId } });
    controller.setProduction({ kind: 'unit', unitType: 'settler' });
    store.set({ busy: false });
    controller.toggleEndTurn();

    const ids = connection.sent.map((message) => (message.type === 'action' ? message.requestId : Number.NaN));
    expect(ids).toHaveLength(4);
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

  it('deselect clears the selection', () => {
    const { store, controller } = setup({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    controller.deselect();
    expect(store.get().selection).toBeNull();
  });

  it('selectNextIdleUnit walks through own units with moves left and wraps around', () => {
    const { store, controller } = setup();

    // By id: the Warrior (u1_k...) comes before the Settler (u1_x...).
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
      const rome = view.cities.find((city) => city.id === SAMPLE.romeId);
      if (rome?.own != null) rome.own.production = null;
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

  it('does nothing at all without a game', () => {
    const { store, controller, connection } = setup({ game: null });
    const before = store.get();

    controller.onTileTap(SAMPLE.warriorTile);
    controller.foundCity();
    controller.setProduction({ kind: 'unit', unitType: 'warrior' });
    controller.toggleEndTurn();
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

  it('the sample view used here has the Warrior and the Settler where the tests expect them', () => {
    // A guard for the tests above: if the fixture changes, this fails first and says why.
    const view = sampleView();
    expect(view.units.find((unit) => unit.id === SAMPLE.warriorId)?.tile).toBe(SAMPLE.warriorTile);
    expect(view.units.find((unit) => unit.id === SAMPLE.settlerId)?.tile).toBe(SAMPLE.settlerTile);
    expect(view.cities.find((city) => city.id === SAMPLE.romeId)?.tile).toBe(SAMPLE.romeTile);
    expect(view.turn).toBe(7);
    expect(view.players[0].id).toBe(SAMPLE.me);
  });
});
