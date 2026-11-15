import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  IMPROVEMENT_IDS,
  STATE_SCHEMA,
  UNITS,
  buildPlayerView,
  checkInvariants,
  cloneJson,
  migrateGameState,
} from '../src/index';
import type { GameState, PlayerId } from '../src/index';
import { MEADOW, act, actWithEvents, deepFreeze, endTurnForAll, newGame, queueOf, unitOf } from './rulesKit';
import { LONG_TEST, nextStepOfThePlan, playRandomGame } from './rulesRandomPlay';

/**
 * Tests for migrateGameState (src/stateMigrations.ts), on two REAL saves
 * that the phase 1 code wrote before this round changed it (they lie in
 * test/fixtures/ and are never edited or made again):
 *
 *  - "the short save", state-layout-1.json: a game state. Turn 4, two
 *    players; Rome is building a Warrior with production stored, the other
 *    city has nothing chosen;
 *  - "the long save", the `game` of room-layout-1.json, a whole room file as
 *    the phase 1 server wrote it. Turn 29, four players, 28 turns of random
 *    play, saved in mid-turn.
 *
 * What a save should look like afterwards is read from the saves themselves
 * (for every city: its queue is what it was building, or empty). Only a few
 * coarse facts are stated by number, so that the tests tell at once if a
 * fixture is not the file they think it is.
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
 * A copy of a state of either layout with every field the migration is
 * about taken out: the layout number, each city's `production` or
 * `buildQueue`, each tile's `improvement`, each unit's `job`, each
 * remembered tile's `improvement`. What is left must be the same before and
 * after, down to the order of the keys (which is the order units and cities
 * were created in).
 */
function withoutMigratedFields(state: unknown): string {
  const copy = cloneJson(state) as Omit<Layout1State, 'schema'> & { schema?: number };
  delete copy.schema;
  for (const city of Object.values(copy.cities)) {
    delete (city as Record<string, unknown>).production;
    delete (city as Record<string, unknown>).buildQueue;
  }
  for (const tile of copy.map.tiles) delete tile.improvement;
  for (const unit of Object.values(copy.units)) delete unit.job;
  for (const player of copy.players) {
    for (const remembered of Object.values(player.knowledge.remembered)) delete remembered.improvement;
  }
  return JSON.stringify(copy);
}

/** The checks that hold for every layout 1 save brought to layout 2. */
function expectMigrated(save: Layout1State, state: GameState): void {
  expect(state.schema).toBe(STATE_SCHEMA);
  expect(checkInvariants(state)).toEqual([]);

  // Every city: a queue with the one item it was building, or an empty one; the store as it was.
  expect(Object.keys(state.cities)).toEqual(Object.keys(save.cities));
  for (const [id, before] of Object.entries(save.cities)) {
    const city = state.cities[id];
    expect(city.buildQueue, id).toEqual(before.production === null ? [] : [before.production]);
    expect(city.productionStored, id).toBe(before.productionStored);
    expect(Object.keys(city)).toEqual(['id', 'owner', 'name', 'tile', 'population', 'foodStored', 'buildQueue', 'productionStored']);
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
  it('the short save is brought to layout 2: it passes checkInvariants, every city has a queue instead of production', () => {
    const save = shortSave();
    // The coarse facts about the fixture.
    expect(save.schema).toBe(1);
    expect(save.turn).toBe(4);
    expect(save.players.map((player) => [player.id, player.endedTurn])).toEqual([['p1', true], ['p2', false]]);
    // The health check of this version has no patience with the old layout.
    expect(checkInvariants(save as unknown as GameState).length).toBeGreaterThan(0);

    const state = migrated(save);
    expect(state.schema).toBe(2);
    expect(checkInvariants(state)).toEqual([]);

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
    // The save had none of the three fields: they are new.
    const before = allKeys(save);
    expect(before.has('improvement') || before.has('job') || before.has('buildQueue')).toBe(false);
    const after = allKeys(state);
    expect(after.has('improvement') && after.has('job') && after.has('buildQueue')).toBe(true);
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
  it('the long save (four players, turn 29, in mid-turn) is brought to layout 2 and passes checkInvariants; every city\'s queue is what it was building, or empty; every stored number, every unit and every memory is otherwise as it was', () => {
    const save = longSave();
    // The coarse facts about the fixture.
    expect(save.schema).toBe(1);
    expect(save.turn).toBe(29);
    expect(save.players.map((player) => [player.id, player.endedTurn])).toEqual([
      ['p1', true], ['p2', false], ['p3', true], ['p4', false],
    ]);

    const state = migrated(save);
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
    // The old game takes to the new things: queues are edited, units completed, Workers set to work.
    for (const kind of ['setBuildQueue', 'unitBuilt', 'startJob', 'moveUnit']) expect(kinds, kind).toContain(kind);
  });
});

describe('migrateGameState: what it does with other things', () => {
  it('a state that is already at STATE_SCHEMA comes back deep-equal, as a new object', () => {
    const current = newGame(MEADOW, [[3, 5], [12, 5]]);
    expect(current.schema).toBe(STATE_SCHEMA);
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

  it('layouts nobody can convert give null: 0, STATE_SCHEMA + 1, a missing or fractional schema, something that is not an object', () => {
    const save = shortSave();
    const withSchema = (schema: unknown): unknown => ({ ...save, schema });

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
