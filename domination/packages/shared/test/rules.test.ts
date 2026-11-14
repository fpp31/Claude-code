import { describe, expect, it } from 'vitest';
import {
  RULES,
  STATE_SCHEMA,
  UNITS,
  checkInvariants,
  cloneJson,
  createGame,
  distance,
  newUnitId,
  seedRng,
} from '../src/index';
import type { Action, GameSetup, GameState, MapGenerator } from '../src/index';
import { mapFromAscii } from '../src/testing';
import {
  MEADOW,
  act,
  actWithEvents,
  at,
  codeOf,
  deepFreeze,
  fixedMapGenerator,
  foundCityAt,
  newGame,
  refusal,
  send,
  setupFor,
  unitOf,
  unitsOf,
} from './rulesKit';

/**
 * Tests for the rules engine (packages/shared/src/rules/), part 1: creating
 * a game and the checks every action goes through.
 *
 * The other parts live next to this file, one per subject:
 *   rulesMove.test.ts        moving units, reachable tiles, the two boards
 *   rulesCity.test.ts        founding cities, the city economy, production
 *   rulesTurn.test.ts        ending and resolving a turn
 *   rulesInvariants.test.ts  the health check for game states
 *   rulesWholeGame.test.ts   long random games (robustness and determinism)
 * Helpers (not test files): rulesKit.ts builds worlds and sends actions,
 * rulesRandomPlay.ts plays random games.
 *
 * All of them use hand-drawn maps (rulesKit.ts), so they do not depend on
 * the map generator, and compare error CODES, never message texts.
 */

/** Two players far apart on the meadow: p1 in the west, p2 in the east. */
function twoPlayerGame(): GameState {
  return newGame(MEADOW, [[3, 5], [12, 5]]);
}

describe('createGame (WP2)', () => {
  it('creates players in seat order with a Settler and a Warrior on their start tile', () => {
    const state = newGame(MEADOW, [[3, 5], [12, 5], [8, 2]]);
    const starts = [at(state.map, 3, 5), at(state.map, 12, 5), at(state.map, 8, 2)];

    expect(state.players.map((player) => player.id)).toEqual(['p1', 'p2', 'p3']);
    expect(state.players.map((player) => player.name)).toEqual(['Ada', 'Ben', 'Cleo']);
    expect(state.players.map((player) => player.civ)).toEqual(['rome', 'egypt', 'china']);

    state.players.forEach((player, seatIndex) => {
      const units = unitsOf(state, player.id);
      expect(units.map((unit) => unit.type)).toEqual(RULES.startingUnits);
      for (const unit of units) {
        expect(unit.tile).toBe(starts[seatIndex]);
        expect(unit.movesLeft).toBe(UNITS[unit.type].moves);
        expect(unit.id.startsWith(`u${seatIndex + 1}_`)).toBe(true);
        expect(state.units[unit.id]).toBe(unit);
      }
    });

    // Creation order: players in seat order, each player's units in list order.
    expect(Object.values(state.units).map((unit) => `${unit.owner} ${unit.type}`)).toEqual([
      'p1 settler', 'p1 warrior', 'p2 settler', 'p2 warrior', 'p3 settler', 'p3 warrior',
    ]);
  });

  it('is deterministic: the same setup gives a deep-equal state', () => {
    const first = newGame(MEADOW, [[3, 5], [12, 5]], 'seed-a');
    const second = newGame(MEADOW, [[3, 5], [12, 5]], 'seed-a');
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    // Another seed gives other unit ids (the hand-drawn map stays the same).
    const other = newGame(MEADOW, [[3, 5], [12, 5]], 'seed-b');
    expect(Object.keys(other.units)).not.toEqual(Object.keys(first.units));
  });

  it('starts at turn 1 with nobody having ended the turn and no cities', () => {
    const state = twoPlayerGame();
    expect(state.schema).toBe(STATE_SCHEMA);
    expect(state.turn).toBe(1);
    expect(state.cities).toEqual({});
    expect(state.settings).toEqual({ mapSize: 'small', turnMode: 'simultaneous' });
    expect(state.seed).toBe('test-seed');
    expect(state.rng).toEqual(seedRng('test-seed', 'dice'));
    for (const player of state.players) {
      expect(player.endedTurn).toBe(false);
      expect(player.citiesFounded).toBe(0);
      expect(player.knowledge.remembered).toEqual({});
    }
    expect(state.map.tiles.every((tile) => tile.cityId === null)).toBe(true);
  });

  it('gives every player a private id stream named after their seat', () => {
    const state = createGame(
      { ...setupFor(1), players: [{ id: 'p1', name: 'Ada', civ: 'rome' }, { id: 'p3', name: 'Cleo', civ: 'china' }] },
      fixedMapGenerator(MEADOW, [[3, 5], [12, 5]]),
    );
    // Step 2 of the doc comment: idRng = seedRng(seed, 'ids:' + id). Drawing
    // the first id from a stream seeded that way must give the id of the
    // player's first unit.
    for (const player of state.players) {
      const probe = cloneJson(state);
      probe.units = {};
      probe.players.forEach((entry) => {
        if (entry.id === player.id) entry.idRng = seedRng('test-seed', 'ids:' + player.id);
      });
      expect(newUnitId(probe, player.id)).toBe(unitsOf(state, player.id)[0].id);
    }
    expect(state.players[0].idRng).not.toEqual(state.players[1].idRng);
    // The seat number is part of every id, also for a seat after a gap.
    expect(unitsOf(state, 'p3').every((unit) => unit.id.startsWith('u3_'))).toBe(true);
  });

  it('has explored exactly what the starting units can see', () => {
    const state = twoPlayerGame();
    const farthestSight = Math.max(...RULES.startingUnits.map((type) => UNITS[type].sight));
    const starts = [at(state.map, 3, 5), at(state.map, 12, 5)];

    state.players.forEach((player, seatIndex) => {
      const expected = state.map.tiles.map((_, tile) =>
        distance(starts[seatIndex], tile, state.map) <= farthestSight ? 1 : 0,
      );
      expect(player.knowledge.explored).toEqual(expected);
    });
  });

  it('returns a state that is plain JSON (survives cloneJson unchanged) and passes checkInvariants', () => {
    const state = twoPlayerGame();
    expect(cloneJson(state)).toEqual(state);
    expect(JSON.stringify(cloneJson(state))).toBe(JSON.stringify(state));
    expect(checkInvariants(state)).toEqual([]);
  });

  it('asks the generator with the seed, the map size and the number of players, and keeps its own copy of the map', () => {
    const sharedMap = mapFromAscii(MEADOW);
    const calls: unknown[][] = [];
    const generator: MapGenerator = (...args) => {
      calls.push(args);
      return { map: sharedMap, starts: [at(sharedMap, 3, 5), at(sharedMap, 12, 5)] };
    };
    const state = createGame({ ...setupFor(2, 'my-seed'), settings: { mapSize: 'medium', turnMode: 'simultaneous' } }, generator);

    expect(calls).toEqual([['my-seed', 'medium', 2]]);
    expect(state.map).toEqual(sharedMap);
    expect(state.map).not.toBe(sharedMap);
    expect(state.map.tiles[0]).not.toBe(sharedMap.tiles[0]);
  });

  it('throws for no players, too many players, duplicate ids or an empty seed', () => {
    const generator = fixedMapGenerator(MEADOW, [[3, 5], [12, 5]]);
    const good = setupFor(2);
    expect(() => createGame(good, generator)).not.toThrow();

    expect(() => createGame({ ...good, players: [] }, generator)).toThrow();
    expect(() => createGame({ ...good, seed: '' }, generator)).toThrow();
    expect(() =>
      createGame({ ...good, players: [{ id: 'p1', name: 'Ada', civ: 'rome' }, { id: 'p1', name: 'Ben', civ: 'egypt' }] }, generator),
    ).toThrow();

    // One more than the table allows (the ninth would be 'p9').
    const tooMany: GameSetup['players'] = [];
    for (let seat = 1; seat <= RULES.maxSeats + 1; seat++) tooMany.push({ id: `p${seat}`, name: `N${seat}`, civ: 'rome' });
    const nineStarts = fixedMapGenerator(MEADOW, tooMany.map((_, i) => [1 + i, 1] as [number, number]));
    expect(() => createGame({ ...good, players: tooMany }, nineStarts)).toThrow();
  });

  it('throws for an id that is not a seat name ("alice", "p0", "p9") and for ids out of seat order; accepts gaps (p1, p3)', () => {
    const generator = fixedMapGenerator(MEADOW, [[3, 5], [12, 5]]);
    const withIds = (first: string, second: string): GameSetup => ({
      ...setupFor(2),
      players: [{ id: first, name: 'Ada', civ: 'rome' }, { id: second, name: 'Ben', civ: 'egypt' }],
    });

    for (const bad of ['alice', 'p0', 'p9', 'p01', 'P1', '1', '']) {
      expect(() => createGame(withIds('p1', bad), generator), `second id '${bad}'`).toThrow();
    }
    expect(() => createGame(withIds('p2', 'p1'), generator)).toThrow();

    const gap = createGame(withIds('p1', 'p3'), generator);
    expect(gap.players.map((player) => player.id)).toEqual(['p1', 'p3']);
    expect(checkInvariants(gap)).toEqual([]);

    // Two players of the same civilization are the lobby's business, not the engine's.
    const twins = createGame(
      { ...setupFor(2), players: [{ id: 'p1', name: 'Ada', civ: 'rome' }, { id: 'p2', name: 'Ben', civ: 'rome' }] },
      generator,
    );
    expect(twins.players.map((player) => player.civ)).toEqual(['rome', 'rome']);
  });

  it('throws if the generator does not return one start tile on the map per player', () => {
    const tooFew = fixedMapGenerator(MEADOW, [[3, 5]]);
    expect(() => createGame(setupFor(2), tooFew)).toThrow();

    const offMap: MapGenerator = () => ({ map: mapFromAscii(MEADOW), starts: [5000, 20] });
    expect(() => createGame(setupFor(2), offMap)).toThrow();
  });
});

describe('applyAction: common checks (WP2)', () => {
  /** p1 has a city (Rome) on the start tile and a warrior next to it; p2 is far away and untouched. */
  function gameWithCity(): GameState {
    const start = twoPlayerGame();
    return act(start, 'p1', { type: 'foundCity', unitId: unitOf(start, 'p1', 'settler').id });
  }

  it('never modifies the state it is given (accepted, rejected and no-op actions)', () => {
    const state = deepFreeze(gameWithCity());
    const before = JSON.stringify(state);
    const warrior = unitOf(state, 'p1', 'warrior');
    const foreignWarrior = unitOf(state, 'p2', 'warrior');
    const city = Object.values(state.cities)[0];
    const east = at(state.map, 4, 5);

    const accepted: [string, Action][] = [
      ['p1', { type: 'moveUnit', unitId: warrior.id, path: [east] }],
      ['p2', { type: 'foundCity', unitId: unitOf(state, 'p2', 'settler').id }],
      ['p1', { type: 'setProduction', cityId: city.id, item: { kind: 'unit', unitType: 'warrior' } }],
      ['p1', { type: 'endTurn' }],
    ];
    for (const [playerId, action] of accepted) {
      const result = send(state, playerId, action);
      expect(result.ok && result.changed, action.type).toBe(true);
      if (!result.ok) continue;
      // A new state that shares nothing with the old one.
      expect(result.state).not.toBe(state);
      expect(result.state.map.tiles[0]).not.toBe(state.map.tiles[0]);
      expect(result.state.players[0]).not.toBe(state.players[0]);
      expect(result.state.units[foreignWarrior.id]).not.toBe(state.units[foreignWarrior.id]);
      expect(result.state.cities[city.id]).not.toBe(state.cities[city.id]);
      expect(JSON.stringify(state)).toBe(before);
    }

    const rejected: [string, Action][] = [
      ['p1', { type: 'moveUnit', unitId: foreignWarrior.id, path: [east] }],
      ['p1', { type: 'moveUnit', unitId: warrior.id, path: [] }],
      ['p1', { type: 'foundCity', unitId: warrior.id }],
      ['p2', { type: 'setProduction', cityId: city.id, item: { kind: 'unit', unitType: 'warrior' } }],
    ];
    for (const [playerId, action] of rejected) {
      expect(send(state, playerId, action).ok, action.type).toBe(false);
      expect(JSON.stringify(state)).toBe(before);
    }

    const noOp = send(state, 'p1', { type: 'cancelEndTurn' });
    expect(noOp.ok && !noOp.changed).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rejects an unknown player or an unknown action type with badAction', () => {
    const state = gameWithCity();
    const warrior = unitOf(state, 'p1', 'warrior');

    for (const stranger of ['p3', 'nobody', '', 'constructor']) {
      expect(refusal(state, stranger, { type: 'endTurn' }), `player '${stranger}'`).toBe('badAction');
    }

    const nonsense: unknown[] = [
      { type: 'dance' },
      { type: 'constructor' },
      {},
      null,
      'endTurn',
      42,
      // Known types whose fields are not even of the right kind.
      { type: 'moveUnit', unitId: warrior.id },
      { type: 'moveUnit', unitId: warrior.id, path: 'east' },
      { type: 'moveUnit', unitId: 7, path: [] },
      { type: 'foundCity' },
      { type: 'setProduction', cityId: 'c1_x', item: null },
      { type: 'setProduction', cityId: 'c1_x', item: 'warrior' },
    ];
    for (const action of nonsense) {
      expect(refusal(state, 'p1', action as Action), JSON.stringify(action)).toBe('badAction');
    }

    // First failure wins: a stranger is told badAction even with a stale turn number.
    expect(codeOf(send(state, 'p3', { type: 'endTurn' }, state.turn - 1))).toBe('badAction');
  });

  it('rejects an action carrying an old or future turn number with staleTurn', () => {
    const state = gameWithCity();
    const warrior = unitOf(state, 'p1', 'warrior');
    const move: Action = { type: 'moveUnit', unitId: warrior.id, path: [at(state.map, 4, 5)] };

    expect(codeOf(send(state, 'p1', move, state.turn - 1))).toBe('staleTurn');
    expect(codeOf(send(state, 'p1', move, state.turn + 1))).toBe('staleTurn');
    expect(codeOf(send(state, 'p1', move, state.turn))).toBeNull();

    // The turn number is judged before the action itself: even a move with
    // somebody else's unit is answered with staleTurn.
    const foreign: Action = { type: 'moveUnit', unitId: unitOf(state, 'p2', 'warrior').id, path: [] };
    expect(codeOf(send(state, 'p1', foreign, state.turn + 1))).toBe('staleTurn');

    // A late End Turn must never end the following turn.
    let next = act(state, 'p1', { type: 'endTurn' });
    next = act(next, 'p2', { type: 'endTurn' });
    expect(next.turn).toBe(2);
    expect(codeOf(send(next, 'p1', { type: 'endTurn' }, 1))).toBe('staleTurn');
    expect(codeOf(send(next, 'p1', { type: 'cancelEndTurn' }, 1))).toBe('staleTurn');
  });

  it('rejects everything except cancelEndTurn after the player ended the turn (turnAlreadyEnded)', () => {
    const start = gameWithCity();
    const warrior = unitOf(start, 'p1', 'warrior');
    const city = Object.values(start.cities)[0];
    const ended = act(start, 'p1', { type: 'endTurn' });
    expect(ended.turn).toBe(1); // p2 is still playing

    const actions: Action[] = [
      { type: 'moveUnit', unitId: warrior.id, path: [at(start.map, 4, 5)] },
      { type: 'foundCity', unitId: warrior.id },
      { type: 'setProduction', cityId: city.id, item: { kind: 'unit', unitType: 'scout' } },
      // The turn check comes before the action's own checks, whatever is wrong with the action.
      { type: 'moveUnit', unitId: 'u9_nobody', path: [] },
      { type: 'setProduction', cityId: 'c9_nowhere', item: { kind: 'unit', unitType: 'scout' } },
    ];
    for (const action of actions) expect(refusal(ended, 'p1', action), action.type).toBe('turnAlreadyEnded');

    // The other player is not affected.
    expect(refusal(ended, 'p2', { type: 'moveUnit', unitId: unitOf(ended, 'p2', 'warrior').id, path: [at(start.map, 11, 5)] })).toBeNull();

    // Taking it back works, and then the player can act again.
    const back = act(ended, 'p1', { type: 'cancelEndTurn' });
    expect(back.players[0].endedTurn).toBe(false);
    expect(refusal(back, 'p1', actions[0])).toBeNull();
  });

  it('treats a second endTurn, a needless cancelEndTurn and an unchanged setProduction as no-ops (changed false, same state object)', () => {
    const start = gameWithCity();
    const city = Object.values(start.cities)[0];
    const building = act(start, 'p1', { type: 'setProduction', cityId: city.id, item: { kind: 'unit', unitType: 'scout' } });
    const ended = act(building, 'p1', { type: 'endTurn' });

    const cases: [GameState, Action][] = [
      [ended, { type: 'endTurn' }],
      [building, { type: 'cancelEndTurn' }],
      [building, { type: 'setProduction', cityId: city.id, item: { kind: 'unit', unitType: 'scout' } }],
    ];
    for (const [state, action] of cases) {
      const result = send(state, 'p1', action);
      expect(result.ok, action.type).toBe(true);
      if (!result.ok) continue;
      expect(result.changed).toBe(false);
      expect(result.state).toBe(state); // the very same object: nothing to save, nothing to send
      expect(result.events).toEqual([]);
    }
  });

  it('answers a real change with changed true and a new state object', () => {
    const start = gameWithCity();
    const city = Object.values(start.cities)[0];
    const step = actWithEvents(start, 'p1', { type: 'setProduction', cityId: city.id, item: { kind: 'unit', unitType: 'scout' } });
    expect(step.changed).toBe(true);
    expect(step.state).not.toBe(start);
    expect(step.events).toEqual([]); // choosing production is not news
    expect(step.state.cities[city.id].production).toEqual({ kind: 'unit', unitType: 'scout' });
  });

  it('keeps cities founded by the back-door helper honest (they go through the real action)', () => {
    // Guards the helper the other test files lean on.
    const start = twoPlayerGame();
    const withCity = foundCityAt(start, 'p2', at(start.map, 12, 2));
    expect(Object.values(withCity.cities).map((c) => c.name)).toEqual(['Thebes']);
    expect(withCity.players[1].citiesFounded).toBe(1);
  });
});
