import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  IMPROVEMENT_IDS,
  RULES,
  STATE_SCHEMA,
  UNITS,
  buildPlayerView,
  checkInvariants,
  cityEconomy,
  cloneJson,
  migrateGameState,
  tileIsWater,
} from '../src/index';
import type { GameState, PlayerId } from '../src/index';
import { MEADOW, act, actWithEvents, deepFreeze, endTurnForAll, newGame, queueOf, refusal, unitOf } from './rulesKit';
import { LONG_TEST, nextStepOfThePlan, playRandomGame } from './rulesRandomPlay';

/**
 * Tests for migrateGameState (src/stateMigrations.ts), on REAL saves that
 * older code wrote before a round changed it (they lie in test/fixtures/
 * and are never edited or made again).
 *
 * Two that the phase 1 code wrote (layout 1). They walk through both steps:
 *
 *  - "the short save", state-layout-1.json: a game state. Turn 4, two
 *    players; Rome is building a Warrior with production stored, the other
 *    city has nothing chosen;
 *  - "the long save", the `game` of room-layout-1.json, a whole room file as
 *    the phase 1 server wrote it. Turn 29, four players, 28 turns of random
 *    play, saved in mid-turn.
 *
 * And one that the round 2 code wrote (layout 2), twice over:
 *
 *  - "the round 2 save", state-layout-2.json, and the same game inside the
 *    room file room-layout-2.json: turn 41, four players, six cities with
 *    queues, Workers at work, farms and a mine, saved in mid-turn;
 *  - expected-layout-2.json: what the round 2 ENGINE said about that save
 *    (what every city's citizens gather, every "in N turns" of its panel).
 *    A save does not hold these, and the engine that wrote them is no
 *    longer in the project, so they were written down before it changed.
 *
 * What a save should look like afterwards is read from the saves themselves
 * (for every city: its queue is what it was building, or empty; it is on
 * Grow). Only a few coarse facts are stated by number, so that the tests
 * tell at once if a fixture is not the file they think it is.
 */

/** A saved state of layout 1, as far as these tests look at it. Everything else is compared as plain JSON. */
interface Layout1State {
  schema: number;
  turn: number;
  map: { tiles: Record<string, unknown>[] };
  players: { id: PlayerId; endedTurn: boolean; knowledge: { remembered: Record<string, Record<string, unknown>> } }[];
  units: Record<string, Record<string, unknown>>;
  cities: Record<string, Record<string, unknown> & { production: { kind: string; unitType: string } | null; productionStored: number }>;
}

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

/** The short save, parsed afresh for every caller. */
function shortSave(): Layout1State {
  return readFixture('state-layout-1.json') as Layout1State;
}

/** The long save: the game inside the room file. */
function longSave(): Layout1State {
  return (readFixture('room-layout-1.json') as { game: Layout1State }).game;
}

/** The save brought up to date; fails the test if the migration knows no way. */
function migrated(save: Layout1State): GameState {
  const state = migrateGameState(save);
  if (state === null) throw new Error('migrateGameState gave null for a layout 1 save');
  return state;
}

/** Every key of every object inside a JSON value. */
function allKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value !== 'object' || value === null) return into;
  if (!Array.isArray(value)) for (const key of Object.keys(value)) into.add(key);
  for (const inner of Object.values(value)) allKeys(inner, into);
  return into;
}

/**
 * A copy of a state of any layout with every field the migration is
 * about taken out: the layout number, each city's `production` or
 * `buildQueue` and its `focus`, each tile's `improvement`, each unit's
 * `job`, each remembered tile's `improvement`. What is left must be the same before and
 * after, down to the order of the keys (which is the order units and cities
 * were created in).
 */
function withoutMigratedFields(state: unknown): string {
  const copy = cloneJson(state) as Omit<Layout1State, 'schema'> & { schema?: number };
  delete copy.schema;
  for (const city of Object.values(copy.cities)) {
    delete (city as Record<string, unknown>).production;
    delete (city as Record<string, unknown>).buildQueue;
    delete (city as Record<string, unknown>).focus;
  }
  for (const tile of copy.map.tiles) delete tile.improvement;
  for (const unit of Object.values(copy.units)) delete unit.job;
  for (const player of copy.players) {
    for (const remembered of Object.values(player.knowledge.remembered)) delete remembered.improvement;
  }
  return JSON.stringify(copy);
}

/** The checks that hold for every layout 1 save brought up to date (through both steps, to layout 3). */
function expectMigrated(save: Layout1State, state: GameState): void {
  expect(state.schema).toBe(STATE_SCHEMA);
  expect(checkInvariants(state)).toEqual([]);

  // Every city: a queue with the one item it was building, or an empty one; the store as it was;
  // and on Grow, the one way cities placed their citizens when the save was made. Nine fields, the ninth is the focus.
  expect(Object.keys(state.cities)).toEqual(Object.keys(save.cities));
  for (const [id, before] of Object.entries(save.cities)) {
    const city = state.cities[id];
    expect(city.buildQueue, id).toEqual(before.production === null ? [] : [before.production]);
    expect(city.productionStored, id).toBe(before.productionStored);
    expect(Object.keys(city)).toEqual(['id', 'owner', 'name', 'tile', 'population', 'foodStored', 'buildQueue', 'productionStored', 'focus']);
    expect(city.focus, id).toBe('grow');
    for (const entry of city.buildQueue) expect(Object.keys(entry).sort()).toEqual(['kind', 'unitType']);
  }
  // No object anywhere has a key "production" any more.
  expect(allKeys(state).has('production')).toBe(false);
  expect(allKeys(save).has('production')).toBe(true);

  // Every tile, every unit and every memory has the new field, set to "nothing".
  expect(state.map.tiles).toHaveLength(save.map.tiles.length);
  for (const tile of state.map.tiles) {
    expect(tile.improvement).toBeNull();
    expect(Object.keys(tile)).toEqual(['terrain', 'feature', 'improvement', 'cityId']);
  }
  expect(Object.keys(state.units)).toEqual(Object.keys(save.units));
  for (const unit of Object.values(state.units)) {
    expect(unit.job).toBeNull();
    expect(Object.keys(unit)).toEqual(['id', 'type', 'owner', 'tile', 'movesLeft', 'job']);
  }
  let memories = 0;
  for (const player of state.players) {
    for (const remembered of Object.values(player.knowledge.remembered)) {
      expect(remembered.improvement).toBeNull();
      expect(Object.keys(remembered)).toEqual(['owner', 'city', 'improvement']);
      memories += 1;
    }
  }
  expect(memories).toBeGreaterThan(0);

  // Nothing else changed.
  expect(withoutMigratedFields(state)).toBe(withoutMigratedFields(save));
}

describe('migrateGameState: the short save (layout 1, turn 4, two players)', () => {
  it('the short save walks through both steps to layout 3: it passes checkInvariants, every city has a queue instead of production and is on grow', () => {
    const save = shortSave();
    // The coarse facts about the fixture.
    expect(save.schema).toBe(1);
    expect(save.turn).toBe(4);
    expect(save.players.map((player) => [player.id, player.endedTurn])).toEqual([['p1', true], ['p2', false]]);
    // The health check of this version has no patience with the old layout.
    expect(checkInvariants(save as unknown as GameState).length).toBeGreaterThan(0);

    const state = migrated(save);
    expect(state.schema).toBe(3);
    expect(checkInvariants(state)).toEqual([]);
    for (const city of Object.values(state.cities)) expect(city.focus, city.name).toBe('grow');

    const cities = Object.values(save.cities);
    const building = cities.filter((city) => city.production !== null);
    const idle = cities.filter((city) => city.production === null);
    expect([building.length, idle.length]).toEqual([1, 1]);
    // Rome goes on with its Warrior and keeps what it had saved for it.
    const rome = state.cities[String(building[0].id)];
    expect(rome.buildQueue).toEqual([building[0].production]);
    expect(rome.buildQueue).toEqual([{ kind: 'unit', unitType: 'warrior' }]);
    expect(rome.productionStored).toBe(building[0].productionStored);
    expect(rome.productionStored).toBeGreaterThan(0);
    // The city with nothing chosen has an empty queue.
    expect(state.cities[String(idle[0].id)].buildQueue).toEqual([]);

    expect(allKeys(state).has('production')).toBe(false);
    expectMigrated(save, state);
  });

  it('every tile gets improvement: null, every unit job: null, every remembered tile improvement: null', () => {
    const save = shortSave();
    const state = migrated(save);

    expect(state.map.tiles.length).toBeGreaterThan(100);
    expect(state.map.tiles.every((tile) => tile.improvement === null)).toBe(true);
    expect(Object.values(state.units).length).toBeGreaterThan(0);
    expect(Object.values(state.units).every((unit) => unit.job === null)).toBe(true);
    const memories = state.players.flatMap((player) => Object.values(player.knowledge.remembered));
    expect(memories.length).toBeGreaterThan(10);
    expect(memories.every((remembered) => remembered.improvement === null)).toBe(true);
    // The save had none of the four fields: they are new (three of round 2, and round 3's focus).
    const before = allKeys(save);
    expect(before.has('improvement') || before.has('job') || before.has('buildQueue') || before.has('focus')).toBe(false);
    const after = allKeys(state);
    expect(after.has('improvement') && after.has('job') && after.has('buildQueue') && after.has('focus')).toBe(true);
  });

  it('nothing else changed: with the migrated fields taken out, the state is deep-equal to the save', () => {
    const save = shortSave();
    const state = migrated(save);
    expect(JSON.parse(withoutMigratedFields(state))).toEqual(JSON.parse(withoutMigratedFields(save)));
    // To the last character, and so in the same order: units and cities are kept in the order they were created in.
    expect(withoutMigratedFields(state)).toBe(withoutMigratedFields(save));
    // The turn, who has ended it, and the random streams go on where they were.
    const game = state as unknown as Layout1State & { seed: string; rng: unknown };
    const saved = save as Layout1State & { seed: string; rng: unknown };
    expect(game.turn).toBe(saved.turn);
    expect(game.seed).toBe(saved.seed);
    expect(game.rng).toEqual(saved.rng);
    expect(state.players.map((player) => player.endedTurn)).toEqual(save.players.map((player) => player.endedTurn));
    expect(state.players.map((player) => player.idRng)).toEqual((save.players as unknown as { idRng: unknown }[]).map((player) => player.idRng));
  });

  it('the migration does not modify what it is given and gives the same result twice', () => {
    const save = deepFreeze(shortSave());
    const before = JSON.stringify(save);

    const first = migrateGameState(save); // an edit of the frozen input would throw here
    expect(JSON.stringify(save)).toBe(before);
    const second = migrateGameState(save);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // Two results, and neither shares an object with the save or with the other.
    expect(second).not.toBe(first);
    expect(first?.map.tiles[0]).not.toBe(second?.map.tiles[0]);
    expect(first?.players[0]).not.toBe(save.players[0]);
    expect(first?.players[0].knowledge.explored).not.toBe((save.players[0].knowledge as unknown as { explored: unknown }).explored);
    // The result can be edited freely (it is not frozen), as the engine's working copies are.
    expect(Object.isFrozen(first)).toBe(false);
    expect(Object.isFrozen(first?.cities)).toBe(false);
  });

  it('the game goes on: Ben ends the turn and it resolves; played on (at most 20 turns) Rome completes its Warrior once and its queue is then empty; both players\' views can be built after every step', () => {
    const save = shortSave();
    let state = migrated(save);
    const romeId = Object.values(save.cities).filter((city) => city.production !== null).map((city) => String(city.id))[0];
    const warriorsBefore = Object.values(state.units).filter((unit) => unit.owner === 'p1' && unit.type === 'warrior').length;

    const viewsCanBeBuilt = (): void => {
      for (const player of state.players) {
        const view = buildPlayerView(state, player.id);
        expect(view.turn).toBe(state.turn);
        expect(JSON.stringify(view)).not.toContain('undefined');
      }
    };
    viewsCanBeBuilt();
    // The owner's panel right after loading: one row, the Warrior, with a number.
    const panel = buildPlayerView(state, 'p1').cities.find((city) => city.id === romeId)?.own;
    expect(panel?.buildQueue).toHaveLength(1);
    expect(panel?.buildQueue[0]).toMatchObject({ item: { kind: 'unit', unitType: 'warrior' }, cost: UNITS.warrior.cost, wait: null });
    const promised = panel?.buildQueue[0].turns ?? 0;
    expect(promised).toBeGreaterThan(0);

    // The turn the save was made in: Ada had ended it, Ben ends it now, and it resolves.
    const resolved = actWithEvents(state, 'p2', { type: 'endTurn' });
    state = resolved.state;
    expect(state.turn).toBe(save.turn + 1);
    expect(state.players.every((player) => !player.endedTurn)).toBe(true);
    viewsCanBeBuilt();

    const completions: { after: number; queueEmpty: boolean }[] = [];
    for (const { event } of resolved.events) {
      if (event.type === 'unitBuilt' && event.cityId === romeId) completions.push({ after: 1, queueEmpty: event.queueEmpty });
    }
    for (let played = 2; played <= 20; played++) {
      const step = endTurnForAll(state); // every state that comes back has passed the health check
      state = step.state;
      viewsCanBeBuilt();
      for (const { event } of step.events) {
        if (event.type === 'unitBuilt' && event.cityId === romeId) completions.push({ after: played, queueEmpty: event.queueEmpty });
      }
    }
    // Once, when the panel said, and that was the last entry: the city asks for a new one.
    expect(completions).toEqual([{ after: promised, queueEmpty: true }]);
    expect(state.cities[romeId].buildQueue).toEqual([]);
    expect(Object.values(state.units).filter((unit) => unit.owner === 'p1' && unit.type === 'warrior')).toHaveLength(warriorsBefore + 1);
    expect(buildPlayerView(state, 'p1').cities.find((city) => city.id === romeId)?.own?.buildQueue).toEqual([]);
    // The other city never had anything chosen and built nothing.
    expect(Object.values(state.units).filter((unit) => unit.owner === 'p2')).toHaveLength(
      Object.values(save.units).filter((unit) => unit.owner === 'p2').length,
    );
  });

  it('the migrated game can queue a Worker, build it and put it to work', () => {
    let state = migrated(shortSave());
    state = act(state, 'p2', { type: 'endTurn' }); // the turn of the save resolves
    const romeId = Object.values(state.cities).filter((city) => city.owner === 'p1').map((city) => city.id)[0];

    // Ada queues a Worker in front of the Warrior, and from then on follows the plan every turn.
    state = act(state, 'p1', { type: 'setBuildQueue', cityId: romeId, queue: queueOf('worker', 'warrior') });
    const seen: string[] = [];
    let improved: { improvement: string; tile: number } | null = null;
    for (let turn = 0; turn < 40 && improved === null; turn++) {
      for (let step = 0; step < 3; step++) {
        const planned = nextStepOfThePlan(buildPlayerView(state, 'p1'));
        if (planned === null) break;
        state = act(state, 'p1', planned);
        seen.push(planned.type);
      }
      const resolved = endTurnForAll(state);
      state = resolved.state;
      for (const { event } of resolved.events) {
        if (event.type === 'unitBuilt' && event.unitType === 'worker') seen.push('worker built');
        if (event.type === 'improvementBuilt') improved = { improvement: event.improvement, tile: event.tile };
      }
    }

    // The Worker was built, walked onto the land, was set to work, and finished.
    expect(seen).toContain('worker built');
    expect(seen).toContain('startJob');
    expect(seen.indexOf('worker built')).toBeLessThan(seen.indexOf('startJob'));
    expect(improved).not.toBeNull();
    if (improved === null) return;
    expect(IMPROVEMENT_IDS).toContain(improved.improvement);
    expect(state.map.tiles[improved.tile]).toMatchObject({ improvement: improved.improvement, cityId: romeId });
    expect(unitOf(state, 'p1', 'worker')).toMatchObject({ tile: improved.tile, job: null });
    expect(buildPlayerView(state, 'p1').tiles[improved.tile]).toMatchObject({ improvement: improved.improvement, visible: true });
    expect(checkInvariants(state)).toEqual([]);
  });
});

describe('migrateGameState: the long save (layout 1, turn 29, four players, in mid-turn)', () => {
  it('the long save (four players, turn 29, in mid-turn) walks through both steps to layout 3 and passes checkInvariants; every city\'s queue is what it was building, or empty, and the city is on grow; every stored number, every unit and every memory is otherwise as it was', () => {
    const save = longSave();
    // The coarse facts about the fixture.
    expect(save.schema).toBe(1);
    expect(save.turn).toBe(29);
    expect(save.players.map((player) => [player.id, player.endedTurn])).toEqual([
      ['p1', true], ['p2', false], ['p3', true], ['p4', false],
    ]);

    const state = migrated(save);
    expect(state.schema).toBe(3);
    expectMigrated(save, state);

    // A game that has been played: several kinds of items in the queues, units all over, memories of foreign things.
    expect(Object.keys(state.cities).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(state.units).length).toBeGreaterThan(10);
    for (const player of state.players) {
      const remembered = Object.values(player.knowledge.remembered);
      expect(remembered.some((entry) => entry.city !== null && entry.city.owner !== player.id), player.id).toBe(true);
      expect(remembered.some((entry) => entry.owner !== null && entry.owner !== player.id), player.id).toBe(true);
    }
    // Every player's view can be built, and shows the queue the city came with.
    for (const player of state.players) {
      const view = buildPlayerView(state, player.id);
      for (const city of view.cities) {
        if (city.own === null) continue;
        const before = save.cities[city.id].production;
        expect(city.own.buildQueue.map((row) => row.item)).toEqual(before === null ? [] : [before]);
        expect(city.own.productionStored).toBe(save.cities[city.id].productionStored);
        expect(city.own.focus).toBe('grow');
      }
    }
  });

  it('the long save plays on: the two players who had not ended the turn do, the turn resolves, and twenty more turns of random play keep checkInvariants empty', LONG_TEST, () => {
    const save = longSave();
    let state = migrated(save);
    // The game continues in the middle of the turn it was saved in.
    for (const player of save.players) {
      if (player.endedTurn) continue;
      expect(state.turn).toBe(save.turn);
      state = act(state, player.id, { type: 'endTurn' });
    }
    expect(state.turn).toBe(save.turn + 1);

    let steps = 0;
    const kinds = new Set<string>();
    const end = playRandomGame({
      start: state,
      seed: 'after-the-update',
      turns: 20,
      wildShare: 20,
      onStep: (step) => {
        if (!step.result.ok || !step.result.changed) return;
        expect(checkInvariants(step.after), `step ${step.index}`).toEqual([]);
        kinds.add(step.action.type);
        for (const addressed of step.result.events) kinds.add(addressed.event.type);
        steps += 1;
      },
    });
    expect(end.turn).toBe(save.turn + 21);
    expect(steps).toBeGreaterThan(300);
    expect(checkInvariants(end)).toEqual([]);
    for (const player of end.players) expect(() => buildPlayerView(end, player.id)).not.toThrow();
    // The old game takes to the new things: queues are edited, units completed, Workers set to work, cities told how to place their citizens.
    for (const kind of ['setBuildQueue', 'unitBuilt', 'startJob', 'moveUnit', 'setCityFocus']) expect(kinds, kind).toContain(kind);
  });
});

describe('migrateGameState: what it does with other things', () => {
  it('a layout 3 state (already at STATE_SCHEMA) comes back deep-equal, as a new object, with every city\'s focus as it was', () => {
    const started = newGame(MEADOW, [[3, 5], [12, 5]]);
    expect(started.schema).toBe(STATE_SCHEMA);
    expect(STATE_SCHEMA).toBe(3);
    // Two cities, one on each way: a state of today's layout is not converted, so a city on Build stays on Build.
    let current = act(started, 'p1', { type: 'foundCity', unitId: unitOf(started, 'p1', 'settler').id });
    current = act(current, 'p2', { type: 'foundCity', unitId: unitOf(current, 'p2', 'settler').id });
    const builder = Object.values(current.cities)[0];
    current = act(current, builder.owner, { type: 'setCityFocus', cityId: builder.id, focus: 'build' });
    expect(Object.values(current.cities).map((city) => city.focus)).toEqual(['build', 'grow']);
    const frozen = deepFreeze(cloneJson(current));

    const result = migrateGameState(frozen);
    expect(result).toEqual(frozen);
    expect(JSON.stringify(result)).toBe(JSON.stringify(frozen));
    expect(result).not.toBe(frozen);
    expect(result?.map).not.toBe(frozen.map);
    expect(result?.players[0]).not.toBe(frozen.players[0]);
    // A save brought up to date is "already there" too: migrating it again changes nothing.
    const once = migrated(shortSave());
    expect(migrateGameState(once)).toEqual(once);
  });

  it('layouts nobody can convert give null: 0, STATE_SCHEMA + 1 (layout 4 is not ours), a missing or fractional schema, something that is not an object', () => {
    const save = shortSave();
    const withSchema = (schema: unknown): unknown => ({ ...save, schema });
    expect(migrateGameState(withSchema(4))).toBeNull();
    expect(migrateGameState({ ...newGame(MEADOW, [[3, 5], [12, 5]]), schema: 4 })).toBeNull();

    for (const schema of [0, -1, STATE_SCHEMA + 1, STATE_SCHEMA + 40, 1.5, 0.5, Number.NaN, '1', '2', null, true, [1], { is: 1 }]) {
      expect(migrateGameState(withSchema(schema)), `schema ${JSON.stringify(schema)}`).toBeNull();
    }
    const missing = { ...save } as Record<string, unknown>;
    delete missing.schema;
    expect(migrateGameState(missing)).toBeNull();

    for (const notAnObject of [null, undefined, 42, 'a game', true, [], [save], [1, 2, 3]]) {
      expect(migrateGameState(notAnObject), JSON.stringify(notAnObject)).toBeNull();
    }
    // Names every object inherits are not layouts either.
    expect(migrateGameState({ schema: 'constructor' })).toBeNull();
    // It is the layout number that decides: the smallest thing that claims the current layout comes back as it is.
    expect(migrateGameState({ schema: STATE_SCHEMA })).toEqual({ schema: STATE_SCHEMA });
  });

  it('a layout 1 city whose field "production" is missing is tolerated: it builds nothing, keeps what it had stored, and the game is healthy and plays on', () => {
    const save = shortSave();
    // Rome was building a Warrior and had production stored for it; the line is lost (a slip while the save was edited by hand).
    const [romeId, rome] = Object.entries(save.cities).find(([, city]) => city.production !== null && city.productionStored > 0) ?? [];
    if (romeId === undefined || rome === undefined) throw new Error('the short save has no city that is building something');
    const stored = rome.productionStored;
    delete (rome as { production?: unknown }).production;
    expect(Object.hasOwn(save.cities[romeId], 'production')).toBe(false);

    const state = migrated(save);
    expect(state.schema).toBe(STATE_SCHEMA);
    expect(state.cities[romeId].buildQueue).toEqual([]);
    expect(state.cities[romeId].productionStored).toBe(stored);
    expect(state.cities[romeId]).not.toHaveProperty('production');
    expect(checkInvariants(state)).toEqual([]);
    // Every other city is converted as usual.
    for (const [id, city] of Object.entries(save.cities)) {
      if (id !== romeId) expect(state.cities[id].buildQueue, id).toEqual(city.production === null ? [] : [city.production]);
    }

    // The game goes on, and the city is idle like any city with an empty
    // queue: what it had saved stays, and a queue can be given to it.
    let played = state;
    for (const player of played.players) {
      if (!player.endedTurn) played = act(played, player.id, { type: 'endTurn' });
    }
    expect(played.turn).toBe(state.turn + 1);
    expect(played.cities[romeId].productionStored).toBe(stored);
    const owner = played.cities[romeId].owner;
    played = act(played, owner, { type: 'setBuildQueue', cityId: romeId, queue: queueOf('warrior') });
    expect(played.cities[romeId].buildQueue).toEqual(queueOf('warrior'));
    expect(checkInvariants(played)).toEqual([]);
  });

  it('a layout 1 state without its cities, with a production that is not an item, or whose tiles are not a list throws, and the input is untouched', () => {
    const firstCity = Object.keys(shortSave().cities)[0];
    const firstUnit = Object.keys(shortSave().units)[0];
    const damage: [string, (save: Layout1State) => void][] = [
      ['no cities', (save) => { delete (save as { cities?: unknown }).cities; }],
      ['cities that are a list', (save) => { (save as { cities: unknown }).cities = []; }],
      ['cities that are null', (save) => { (save as { cities: unknown }).cities = null; }],
      ['a city that is not an object', (save) => { (save.cities as Record<string, unknown>)[firstCity] = 'Rome'; }],
      ['a production that is a name', (save) => { (save.cities[firstCity] as { production: unknown }).production = 'warrior'; }],
      ['a production that is a number', (save) => { (save.cities[firstCity] as { production: unknown }).production = 7; }],
      ['a production that is a list', (save) => {
        (save.cities[firstCity] as { production: unknown }).production = [{ kind: 'unit', unitType: 'warrior' }];
      }],
      ['no map', (save) => { delete (save as { map?: unknown }).map; }],
      ['tiles that are not a list', (save) => { (save.map as { tiles: unknown }).tiles = { 0: save.map.tiles[0] }; }],
      ['tiles that are missing', (save) => { delete (save.map as { tiles?: unknown }).tiles; }],
      ['a tile that is null', (save) => { (save.map.tiles as unknown[])[5] = null; }],
      ['no units', (save) => { delete (save as { units?: unknown }).units; }],
      ['a unit that is not an object', (save) => { (save.units as Record<string, unknown>)[firstUnit] = 3; }],
      ['players that are not a list', (save) => { (save as { players: unknown }).players = { p1: save.players[0] }; }],
      ['a player that is null', (save) => { (save.players as unknown[])[1] = null; }],
      ['a player without knowledge', (save) => { delete (save.players[0] as { knowledge?: unknown }).knowledge; }],
      ['a memory that is a list', (save) => { (save.players[0].knowledge as { remembered: unknown }).remembered = []; }],
      ['a remembered tile that is null', (save) => {
        const remembered: Record<string, unknown> = save.players[0].knowledge.remembered;
        remembered[Object.keys(remembered)[0]] = null;
      }],
    ];

    for (const [what, change] of damage) {
      const save = shortSave();
      change(save);
      const frozen = deepFreeze(save);
      const before = JSON.stringify(frozen);
      // The text is for the server log: it says which function gave up, and on what.
      expect(() => migrateGameState(frozen), what).toThrow(/^migrateGameState: .+ is not (an object|a list)$/);
      expect(JSON.stringify(frozen), what).toBe(before);
    }

    // A save that names a unit nobody knows is not this function's business:
    // the item is carried over as it is, and the health check says so when
    // the game is loaded, as it would have in phase 1.
    const dragon = shortSave();
    (dragon.cities[firstCity] as { production: unknown }).production = { kind: 'unit', unitType: 'dragon', note: 'left behind' };
    const carried = migrateGameState(dragon);
    expect(carried?.cities[firstCity].buildQueue).toEqual([{ kind: 'unit', unitType: 'dragon' }]);
    const problems = checkInvariants(carried as GameState);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('does not exist');
    // Anything else a city or a unit carried is not carried over.
    const padded = shortSave();
    padded.cities[firstCity].mood = 'restless';
    padded.units[firstUnit].hitPoints = 10;
    padded.map.tiles[3].road = true;
    const clean = migrateGameState(padded);
    const keys = allKeys(clean);
    expect(keys.has('mood') || keys.has('hitPoints') || keys.has('road')).toBe(false);
    expect(clean).toEqual(migrated(shortSave()));
  });
});

/** The round 2 save, as far as these tests look at it. Everything else is compared as plain JSON. */
interface Layout2State {
  schema: number;
  turn: number;
  map: { tiles: { terrain: string; improvement: string | null; cityId: string | null }[] };
  players: { id: PlayerId; endedTurn: boolean; knowledge: { remembered: Record<string, { improvement: string | null }> } }[];
  units: Record<string, { owner: PlayerId; type: string; job: { improvement: string; turnsWorked: number } | null }>;
  cities: Record<string, Record<string, unknown> & { id: string; owner: PlayerId; name: string; buildQueue: { kind: string; unitType: string }[] }>;
}

/** What the round 2 engine said about one city of the round 2 save (fixtures/expected-layout-2.json). */
interface ExpectedCity {
  name: string;
  worked: number[];
  food: number;
  production: number;
  foodSurplus: number;
  queueTurns: (number | null)[];
  held: string | null;
  /** "warrior:14": the unit type and its "in N turns" in the menu. */
  optionTurns: string[];
}

/** The round 2 save, parsed afresh for every caller. */
function roundTwoSave(): Layout2State {
  return readFixture('state-layout-2.json') as Layout2State;
}

/** The round 2 save brought up to date; fails the test if the migration knows no way. */
function roundTwoMigrated(): GameState {
  const state = migrateGameState(roundTwoSave());
  if (state === null) throw new Error('migrateGameState gave null for the round 2 save');
  return state;
}

/** The id of the city of that name in the round 2 save. */
function cityNamed(state: GameState, name: string): string {
  const city = Object.values(state.cities).find((candidate) => candidate.name === name);
  if (city === undefined) throw new Error(`the round 2 save has no city called ${name}`);
  return city.id;
}

describe('migrateGameState: the round 2 save (layout 2, turn 41, four players, in mid-turn)', () => {
  it('the round 2 save is brought to layout 3 and passes checkInvariants; every city equals its saved self plus focus grow; nothing else changed; the input is not edited', () => {
    const save = deepFreeze(roundTwoSave());
    const before = JSON.stringify(save);
    // The coarse facts about the fixture: a game that has been played, with everything round 2 had.
    expect([save.schema, save.turn]).toEqual([2, 41]);
    expect(save.players.map((player) => [player.id, player.endedTurn])).toEqual([['p1', true], ['p2', false], ['p3', true], ['p4', false]]);
    expect(Object.values(save.cities).map((city) => [city.name, city.buildQueue.length])).toEqual([
      ['Niani', 7], ['Thebes', 7], ['Rome', 8], ['Changan', 8], ['Timbuktu', 5], ['Luoyang', 8],
    ]);
    expect(Object.keys(save.units)).toHaveLength(45);
    expect(Object.values(save.units).filter((unit) => unit.job !== null).map((unit) => unit.job?.turnsWorked).sort()).toEqual([1, 1, 2, 2]);
    expect(save.map.tiles.filter((tile) => tile.improvement === 'farm')).toHaveLength(47);
    expect(save.map.tiles.filter((tile) => tile.improvement === 'mine')).toHaveLength(1);
    expect(save.players.map((player) => Object.values(player.knowledge.remembered).filter((seen) => seen.improvement !== null).length)).toEqual([10, 24, 25, 10]);
    // The room file the round 2 server wrote holds the very same game.
    const room = readFixture('room-layout-2.json') as { code: string; game: unknown };
    expect(room.code).toBe('SECND');
    expect(room.game).toEqual(save);
    // No city has chosen a way of placing its citizens: there was none to choose. And the health check of this version wants one.
    expect(allKeys(save).has('focus')).toBe(false);
    expect(checkInvariants(save as unknown as GameState).length).toBeGreaterThan(0);

    const state = migrateGameState(save); // an edit of the frozen input would throw here
    expect(JSON.stringify(save)).toBe(before);
    if (state === null) throw new Error('the round 2 save was not converted');
    expect(state.schema).toBe(3);
    expect(STATE_SCHEMA).toBe(3);
    expect(checkInvariants(state)).toEqual([]);

    // Every city: its saved self, field for field and in the saved order, plus the focus as the ninth field.
    expect(Object.keys(state.cities)).toEqual(Object.keys(save.cities));
    for (const [id, saved] of Object.entries(save.cities)) {
      expect(state.cities[id], saved.name).toEqual({ ...saved, focus: 'grow' });
      expect(Object.keys(state.cities[id]), saved.name).toEqual([...Object.keys(saved), 'focus']);
      expect(Object.keys(state.cities[id])).toEqual(['id', 'owner', 'name', 'tile', 'population', 'foodStored', 'buildQueue', 'productionStored', 'focus']);
      // The queue is carried over as it was, entry for entry.
      expect(state.cities[id].buildQueue, saved.name).toEqual(saved.buildQueue);
    }
    // Nothing else changed: with the layout number and the cities' focus put back, the state IS the save, to the last character.
    expect({ ...state, schema: 2, cities: save.cities }).toEqual(save);
    expect(withoutMigratedFields(state)).toBe(withoutMigratedFields(save));
    // The fields round 2 added are not touched by this step: jobs, improvements and their memories are as saved.
    expect(state.units).toEqual(save.units);
    expect(state.map).toEqual(save.map);
    expect(state.players).toEqual(save.players);
    // 'focus' is a field of cities and of nothing else.
    const withoutCities = { ...state, cities: {} };
    expect(allKeys(withoutCities).has('focus')).toBe(false);
    // The game inside the room file converts to the same state.
    expect(migrateGameState(room.game)).toEqual(state);
    // The result shares nothing with the save and can be edited freely.
    expect(Object.isFrozen(state)).toBe(false);
    expect(Object.isFrozen(state.cities[Object.keys(state.cities)[0]].buildQueue)).toBe(false);
  });

  it('after converting, every city\'s worked tiles, food, production and surplus, its held, and every "in N turns" of its queue and of the four land units of its menu are what the committed engine said', () => {
    const expected = readFixture('expected-layout-2.json') as Record<string, ExpectedCity>;
    const state = roundTwoMigrated();
    // The file speaks of the six cities of the save, by id and by name.
    expect(Object.keys(expected)).toEqual(Object.keys(state.cities));
    for (const [id, city] of Object.entries(state.cities)) expect(expected[id].name).toBe(city.name);
    // One number the specification quotes, so that the file is known to be the one it means.
    expect(expected[cityNamed(state, 'Niani')]).toMatchObject({ worked: [165, 166, 167, 168, 200, 201], food: 20, production: 8 });

    for (const [id, city] of Object.entries(state.cities)) {
      const said = expected[id];
      // The citizens stand exactly where they stood: growing first was the only way, and 'grow' is that way unchanged.
      expect(cityEconomy(state, city), city.name).toEqual({
        worked: said.worked, food: said.food, production: said.production, foodSurplus: said.foodSurplus,
      });
      const own = buildPlayerView(state, city.owner).cities.find((candidate) => candidate.id === id)?.own;
      if (own === null || own === undefined) throw new Error(`${city.name} is not in its owner's view`);
      expect(own.focus, city.name).toBe('grow');
      expect(own.worked, city.name).toEqual(said.worked);
      expect(own.foodPerTurn, city.name).toBe(said.foodSurplus);
      expect(own.productionPerTurn, city.name).toBe(said.production);
      expect(own.held, city.name).toBe(said.held);
      // Every row of the queue, and the four units the round 2 menu had, promise the turn they promised before the update.
      expect(own.buildQueue.map((row) => row.turns), city.name).toEqual(said.queueTurns);
      expect(said.optionTurns.map((entry) => entry.split(':')[0]), city.name).toEqual(['warrior', 'scout', 'settler', 'worker']);
      expect(own.buildOptions.slice(0, 4).map((option) => `${option.item.unitType}:${option.turns}`), city.name).toEqual(said.optionTurns);
    }

    // What is new in the menu: the two boats, last. A city that owns water is offered them
    // (unless its queue is full); a city that owns none never is. In this save: three cities can
    // add a Fishing Boat at once, one owns no water, two have full queues.
    const boats: Record<string, (string | null)[]> = {};
    for (const city of Object.values(state.cities)) {
      const options = buildPlayerView(state, city.owner).cities.find((candidate) => candidate.id === city.id)?.own?.buildOptions ?? [];
      expect(options.map((option) => option.item.unitType), city.name).toEqual(['warrior', 'scout', 'settler', 'worker', 'fishingBoat', 'scoutBoat']);
      boats[city.name] = options.slice(4).map((option) => option.addError);
      const water = state.map.tiles.some((tile) => tile.cityId === city.id && tileIsWater(tile));
      const full = city.buildQueue.length >= RULES.maxQueueLength;
      for (const option of options.slice(4)) {
        expect(option.addError, `${city.name}: ${option.item.unitType}`).toBe(!water ? 'noWaterForBoat' : full ? 'queueFull' : null);
        if (option.addError === null) expect(option.turns, `${city.name}: ${option.item.unitType}`).toBeGreaterThan(0);
      }
    }
    expect(boats).toEqual({
      Niani: [null, null],
      Thebes: [null, null],
      Rome: ['queueFull', 'queueFull'],
      Changan: ['noWaterForBoat', 'noWaterForBoat'],
      Timbuktu: [null, null],
      Luoyang: ['queueFull', 'queueFull'],
    });
  });

  it('a layout 2 city with extra fields (a focus too) loses them and gets \'grow\'; a layout 2 state whose cities are no object throws', () => {
    const plain = roundTwoMigrated();
    const [firstCity, secondCity] = Object.keys(roundTwoSave().cities);

    // A save edited by hand: one city carries a focus already (an older layout cannot have chosen), others carry anything.
    const padded = roundTwoSave();
    padded.cities[firstCity].focus = 'build';
    padded.cities[firstCity].mood = 'restless';
    padded.cities[secondCity].focus = 'nonsense';
    padded.cities[secondCity].production = null;
    const clean = migrateGameState(padded);
    expect(clean?.cities[firstCity].focus).toBe('grow');
    expect(clean?.cities[secondCity].focus).toBe('grow');
    const keys = allKeys(clean);
    expect(keys.has('mood') || keys.has('production')).toBe(false);
    expect(clean).toEqual(plain);
    expect(checkInvariants(clean as GameState)).toEqual([]);

    // Damage to the cities themselves throws, and the input is untouched.
    const damage: [string, (save: Layout2State) => void][] = [
      ['no cities', (save) => { delete (save as { cities?: unknown }).cities; }],
      ['cities that are a list', (save) => { (save as { cities: unknown }).cities = []; }],
      ['cities that are null', (save) => { (save as { cities: unknown }).cities = null; }],
      ['cities that are a text', (save) => { (save as { cities: unknown }).cities = 'Rome'; }],
      ['a city that is not an object', (save) => { (save.cities as Record<string, unknown>)[firstCity] = 'Rome'; }],
      ['a city that is null', (save) => { (save.cities as Record<string, unknown>)[secondCity] = null; }],
      ['a city that is a list', (save) => { (save.cities as Record<string, unknown>)[secondCity] = []; }],
    ];
    for (const [what, change] of damage) {
      const save = roundTwoSave();
      change(save);
      const frozen = deepFreeze(save);
      const before = JSON.stringify(frozen);
      expect(() => migrateGameState(frozen), what).toThrow(/^migrateGameState: .+ is not (an object|a list)$/);
      expect(JSON.stringify(frozen), what).toBe(before);
    }

    // A layout 2 city WITHOUT its build queue is not tolerated, and not repaired either: the step carries
    // over what is there, and the health check, which every converted save must pass, names the city.
    // (Round 2 tolerated a missing `production` because the next press repaired it; a missing queue is damage of another kind.)
    const queueless = roundTwoSave();
    delete (queueless.cities[firstCity] as { buildQueue?: unknown }).buildQueue;
    const carried = migrateGameState(queueless);
    expect(carried?.schema).toBe(3);
    const problems = checkInvariants(carried as GameState);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not a list');
  });

  it('converting the round 2 save twice gives the same state, and converting the result again returns an equal copy; the frozen input is not edited', () => {
    const save = deepFreeze(roundTwoSave());
    const before = JSON.stringify(save);

    const first = migrateGameState(save);
    const second = migrateGameState(save);
    expect(JSON.stringify(save)).toBe(before);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // Two results that share no object with each other or with the save.
    expect(second).not.toBe(first);
    expect(first?.cities).not.toBe(second?.cities);
    expect(first?.map.tiles[0]).not.toBe(second?.map.tiles[0]);
    expect(first?.players[0]).not.toBe(save.players[0]);

    // A converted save is at today's layout: converting it again changes nothing, and hands out a copy.
    const frozenResult = deepFreeze(cloneJson(first));
    const again = migrateGameState(frozenResult);
    expect(again).toEqual(first);
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    expect(again).not.toBe(frozenResult);
    expect(again?.cities).not.toBe(frozenResult?.cities);
    // Also when a city has made its choice meanwhile: the step is not run a second time over a layout 3 state.
    const chosen = cloneJson(first) as GameState;
    Object.values(chosen.cities)[0].focus = 'build';
    expect(migrateGameState(chosen)).toEqual(chosen);
  });

  it('the converted round 2 save plays on: seats 2 and 4 end the turn (seats 1 and 3 had), the turn resolves, and twenty turns of random play with boats and focus flips keep checkInvariants empty with every player\'s view built at each step; Thebes queues a Fishing Boat, completes it, and the boat starts a net', LONG_TEST, () => {
    const save = roundTwoSave();
    const loaded = roundTwoMigrated();
    const thebesId = cityNamed(loaded, 'Thebes');
    const romeId = cityNamed(loaded, 'Rome');
    expect([loaded.cities[thebesId].owner, loaded.cities[romeId].owner]).toEqual(['p2', 'p1']);
    const viewsCanBeBuilt = (state: GameState, what: string): void => {
      for (const player of state.players) {
        const view = buildPlayerView(state, player.id);
        expect(view.turn, what).toBe(state.turn);
        expect(JSON.stringify(view), what).not.toContain('undefined');
      }
    };
    viewsCanBeBuilt(loaded, 'right after loading');

    // The game continues in the middle of the turn it was saved in. The two seats that had ended
    // it stay ended (an order of theirs is refused until the turn is over, or taken back)...
    expect(refusal(loaded, 'p1', { type: 'setCityFocus', cityId: romeId, focus: 'build' })).toBe('turnAlreadyEnded');
    expect(refusal(loaded, 'p3', { type: 'endTurn' })).toBeNull();
    // ...and the two that had not can use the round's new things at once: Thebes, which owns water, queues a Fishing Boat first.
    const thebesQueue = loaded.cities[thebesId].buildQueue;
    let state = act(loaded, 'p2', { type: 'setBuildQueue', cityId: thebesId, queue: [...queueOf('fishingBoat'), ...thebesQueue] });
    expect(state.cities[thebesId].buildQueue).toHaveLength(thebesQueue.length + 1);
    for (const player of save.players) {
      if (player.endedTurn) continue;
      expect(state.turn).toBe(save.turn);
      state = act(state, player.id, { type: 'endTurn' });
    }
    expect(state.turn).toBe(save.turn + 1);
    expect(state.players.every((player) => !player.endedTurn)).toBe(true);
    viewsCanBeBuilt(state, 'after the saved turn');
    const afterTheSavedTurn = state;

    // Thebes's owner follows the plan: the boat is completed, sails to a coast tile of its
    // owner's land, starts a net and finishes it. Everybody else only ends the turn.
    const seen: string[] = [];
    let net: number | null = null;
    for (let turn = 0; turn < 20 && net === null; turn++) {
      for (let step = 0; step < 3; step++) {
        const planned = nextStepOfThePlan(buildPlayerView(state, 'p2'), 'fishingBoat');
        if (planned === null) break;
        state = act(state, 'p2', planned);
        seen.push(planned.type);
      }
      const resolved = endTurnForAll(state); // every state that comes back has passed the health check
      state = resolved.state;
      for (const { event } of resolved.events) {
        if (event.type === 'unitBuilt' && event.unitType === 'fishingBoat' && event.cityId === thebesId) seen.push('boat built');
        if (event.type === 'improvementBuilt' && event.improvement === 'fishingNet') net = event.tile;
      }
    }
    expect(seen).toContain('boat built');
    expect(seen).toContain('startJob');
    expect(seen.indexOf('boat built')).toBeLessThan(seen.indexOf('startJob'));
    expect(net).not.toBeNull();
    if (net === null) return;
    expect(state.map.tiles[net]).toMatchObject({ terrain: 'coast', improvement: 'fishingNet' });
    expect(state.cities[String(state.map.tiles[net].cityId)].owner).toBe('p2');
    expect(unitOf(state, 'p2', 'fishingBoat')).toMatchObject({ tile: net, job: null });
    expect(checkInvariants(state)).toEqual([]);

    // And the whole table plays on at random, with the wild attempts among it.
    let steps = 0;
    let boatsBuilt = 0;
    const kinds = new Set<string>();
    const end = playRandomGame({
      start: afterTheSavedTurn,
      seed: 'after the second update',
      turns: 20,
      wildShare: 20,
      onStep: (step) => {
        if (!step.result.ok || !step.result.changed) return;
        expect(checkInvariants(step.after), `step ${step.index}`).toEqual([]);
        viewsCanBeBuilt(step.after, `step ${step.index}`);
        kinds.add(step.action.type);
        for (const addressed of step.result.events) {
          kinds.add(addressed.event.type);
          if (addressed.event.type === 'unitBuilt' && UNITS[addressed.event.unitType].domain === 'sea') boatsBuilt += 1;
        }
        steps += 1;
      },
    });
    expect(end.turn).toBe(save.turn + 21);
    expect(steps).toBeGreaterThan(300);
    expect(checkInvariants(end)).toEqual([]);
    // The old game takes to the new things: boats are built, cities are set to Build and back, and round 2's Workers work on.
    for (const kind of ['setBuildQueue', 'unitBuilt', 'startJob', 'moveUnit', 'setCityFocus', 'improvementBuilt']) expect(kinds, kind).toContain(kind);
    expect(boatsBuilt).toBeGreaterThan(0);
    expect(Object.values(end.units).some((unit) => UNITS[unit.type].domain === 'sea')).toBe(true);
    // The round 2 Workers that were at work when the game was saved finished their farms meanwhile, or were stopped.
    expect(end.map.tiles.filter((tile) => tile.improvement === 'farm').length).toBeGreaterThanOrEqual(47);
  });
});
