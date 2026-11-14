import { describe, expect, it } from 'vitest';
import {
  UNITS,
  buildCost,
  buildPlayerView,
  checkInvariants,
  cityEconomy,
  foodToGrow,
  isTurnComplete,
  productionBlocked,
  resolveTurn,
} from '../src/index';
import type { AddressedEvent, BuildItem, City, GameState, PlayerId, UnitTypeId } from '../src/index';
import {
  EAST,
  MEADOW,
  WEST,
  act,
  actWithEvents,
  arrange,
  at,
  cityOn,
  deepFreeze,
  endTurnForAll,
  foundCityAt,
  newGame,
  placeUnit,
  refusal,
  stepFrom,
  unitOf,
  unitsOf,
} from './rulesKit';

/**
 * Tests for ending a turn and for what happens when it resolves
 * (rules/turn.ts and the endTurn / cancelEndTurn actions).
 */

/** Two players on the meadow: p1 at (3,5), p2 at (12,5). */
function meadowGame(): GameState {
  return newGame(MEADOW, [[3, 5], [12, 5]]);
}

function withCapital(state: GameState, playerId: PlayerId = 'p1'): GameState {
  return act(state, playerId, { type: 'foundCity', unitId: unitOf(state, playerId, 'settler').id });
}

/** p1 has founded Rome at (3,5); p2 has done nothing. */
function romeGame(): { state: GameState; rome: City } {
  const state = withCapital(meadowGame());
  return { state, rome: cityOn(state, at(state.map, 3, 5)) };
}

function unit(unitType: UnitTypeId): BuildItem {
  return { kind: 'unit', unitType };
}

/** A copy of the state with some fields of one city set by hand. */
function withCity(state: GameState, cityId: string, fields: Partial<City>): GameState {
  return arrange(state, (draft) => {
    Object.assign(draft.cities[cityId], fields);
  });
}

/** Only the events themselves, without their audiences. */
function eventTypes(events: AddressedEvent[]): string[] {
  return events.map((addressed) => addressed.event.type);
}

/**
 * One enterable tile, or two (the centre at (3,3) and, if `withNeighbor`,
 * the tile east of it), in a block of mountains.
 */
function peak(withNeighbor: boolean): string[] {
  return [
    'm m m m m m m',
    ' m m m m m m m',
    'm m m m m m m',
    ` m m m d ${withNeighbor ? 'g' : 'm'} m m`,
    'm m m m m m m',
    ' m m m m m m m',
    'm m m m m m m',
  ];
}

describe('turn resolution (WP2)', () => {
  it('resolves only when every player has ended the turn; a single-player game resolves on each endTurn', () => {
    const start = newGame(MEADOW, [[3, 5], [12, 5], [8, 2]]);
    expect(isTurnComplete(start)).toBe(false);

    // Two of three have ended: still turn 1, and nothing is announced.
    const one = actWithEvents(start, 'p2', { type: 'endTurn' });
    expect(one.state.turn).toBe(1);
    expect(one.events).toEqual([]);
    expect(one.state.players.map((player) => player.endedTurn)).toEqual([false, true, false]);
    const two = actWithEvents(one.state, 'p3', { type: 'endTurn' });
    expect(two.state.turn).toBe(1);
    expect(isTurnComplete(two.state)).toBe(false);

    // The last one resolves the turn in the same call.
    const three = actWithEvents(two.state, 'p1', { type: 'endTurn' });
    expect(three.state.turn).toBe(2);
    expect(eventTypes(three.events)).toEqual(['turnStarted']);
    expect(three.state.players.map((player) => player.endedTurn)).toEqual([false, false, false]);

    // Alone in a game, every End Turn is the last one.
    let solo = newGame(MEADOW, [[3, 5]]);
    for (let turn = 1; turn <= 3; turn++) {
      expect(solo.turn).toBe(turn);
      solo = act(solo, 'p1', { type: 'endTurn' });
    }
    expect(solo.turn).toBe(4);
  });

  it('isTurnComplete is true exactly when everybody has ended', () => {
    const start = meadowGame();
    const flags = (p1: boolean, p2: boolean): GameState =>
      arrange(start, (draft) => {
        draft.players[0].endedTurn = p1;
        draft.players[1].endedTurn = p2;
      });
    expect(isTurnComplete(flags(false, false))).toBe(false);
    expect(isTurnComplete(flags(true, false))).toBe(false);
    expect(isTurnComplete(flags(false, true))).toBe(false);
    expect(isTurnComplete(flags(true, true))).toBe(true);
  });

  it('cancelEndTurn before the last player ends keeps the turn open', () => {
    const start = meadowGame();
    const ended = act(start, 'p1', { type: 'endTurn' });
    const cancelled = actWithEvents(ended, 'p1', { type: 'cancelEndTurn' });
    expect(cancelled.changed).toBe(true);
    expect(cancelled.events).toEqual([]);
    expect(cancelled.state.players[0].endedTurn).toBe(false);

    // p2 ends: p1 is playing again, so the turn stays open.
    const p2Ended = act(cancelled.state, 'p2', { type: 'endTurn' });
    expect(p2Ended.turn).toBe(1);
    expect(p2Ended.players.map((player) => player.endedTurn)).toEqual([false, true]);
    // p1 can still act, and ending again resolves the turn.
    const warrior = unitOf(p2Ended, 'p1', 'warrior');
    const moved = act(p2Ended, 'p1', { type: 'moveUnit', unitId: warrior.id, path: [stepFrom(start.map, warrior.tile, EAST)] });
    expect(act(moved, 'p1', { type: 'endTurn' }).turn).toBe(2);
  });

  it('grows a city when stored food reaches foodToGrow, carrying the rest over', () => {
    const { state, rome } = romeGame();
    const surplus = cityEconomy(state, rome).foodSurplus;
    expect(surplus).toBeGreaterThan(0);
    const threshold = foodToGrow(1);

    // One short of growing after this turn: nothing happens yet.
    const almost = withCity(state, rome.id, { foodStored: threshold - surplus - 1 });
    const waited = endTurnForAll(almost);
    expect(waited.state.cities[rome.id]).toMatchObject({ population: 1, foodStored: threshold - 1 });
    expect(eventTypes(waited.events)).toEqual(['turnStarted']);

    // Reaching the threshold exactly: the city grows and starts again from 0.
    const exact = endTurnForAll(withCity(state, rome.id, { foodStored: threshold - surplus }));
    expect(exact.state.cities[rome.id]).toMatchObject({ population: 2, foodStored: 0 });

    // Going past it: what is left over is kept.
    const over = endTurnForAll(withCity(state, rome.id, { foodStored: threshold - 1 }));
    expect(over.state.cities[rome.id]).toMatchObject({ population: 2, foodStored: surplus - 1 });
    expect(over.events[0]).toEqual({
      to: ['p1'],
      event: { type: 'cityGrew', playerId: 'p1', cityId: rome.id, name: rome.name, population: 2 },
    });

    // At most one citizen per turn, however much food is stored.
    const feast = endTurnForAll(withCity(state, rome.id, { foodStored: 500 }));
    expect(feast.state.cities[rome.id]).toMatchObject({ population: 2, foodStored: 500 + surplus - threshold });
    const secondHelping = endTurnForAll(feast.state);
    expect(secondHelping.state.cities[rome.id].population).toBe(3);

    // From nothing, a new city on grass needs threshold / surplus turns.
    let slow = state;
    const turnsNeeded = Math.ceil(threshold / surplus);
    for (let i = 1; i < turnsNeeded; i++) slow = endTurnForAll(slow).state;
    expect(slow.cities[rome.id].population).toBe(1);
    expect(endTurnForAll(slow).state.cities[rome.id].population).toBe(2);
  });

  it('never lets stored food go below 0 and never shrinks a city', () => {
    // A desert city alone among mountains feeds one citizen and no more.
    const founded = withCapital(newGame(peak(false), [[3, 3]]));
    const city = Object.values(founded.cities)[0];
    const hungry = withCity(founded, city.id, { population: 3, foodStored: 3 });
    const shortage = cityEconomy(hungry, hungry.cities[city.id]).foodSurplus;
    expect(shortage).toBeLessThan(-3);

    const afterOne = endTurnForAll(hungry).state;
    expect(afterOne.cities[city.id]).toMatchObject({ population: 3, foodStored: 0 });
    const afterTwo = endTurnForAll(afterOne).state;
    expect(afterTwo.cities[city.id]).toMatchObject({ population: 3, foodStored: 0 });

    // A smaller shortage eats into the store without emptying it.
    const stocked = withCity(founded, city.id, { population: 3, foodStored: 20 });
    expect(endTurnForAll(stocked).state.cities[city.id]).toMatchObject({ population: 3, foodStored: 20 + shortage });
  });

  it('adds production only while an item is selected, completes the unit, carries the rest over and keeps the item selected', () => {
    const { state, rome } = romeGame();
    const perTurn = cityEconomy(state, rome).production;
    const cost = buildCost(unit('scout'));
    expect(perTurn).toBeGreaterThan(1);

    // Nothing chosen: the production of those turns is lost.
    let idle = state;
    for (let i = 0; i < 3; i++) idle = endTurnForAll(idle).state;
    expect(idle.cities[rome.id].productionStored).toBe(0);
    expect(unitsOf(idle, 'p1')).toHaveLength(1);

    // Chosen, and one short of the cost after this turn: stored, not built.
    const building = act(state, 'p1', { type: 'setProduction', cityId: rome.id, item: unit('scout') });
    const almost = endTurnForAll(withCity(building, rome.id, { productionStored: cost - perTurn - 1 }));
    expect(almost.state.cities[rome.id].productionStored).toBe(cost - 1);
    expect(unitsOf(almost.state, 'p1', 'scout')).toHaveLength(0);

    // The next turn completes it: a new scout with full moves, the rest
    // carried over, the same item still selected.
    const done = endTurnForAll(almost.state);
    const scouts = unitsOf(done.state, 'p1', 'scout');
    expect(scouts).toHaveLength(1);
    expect(scouts[0]).toMatchObject({ owner: 'p1', type: 'scout', movesLeft: UNITS.scout.moves });
    expect(scouts[0].id.startsWith('u1_')).toBe(true);
    expect(done.state.map.tiles[scouts[0].tile].cityId).toBe(rome.id);
    expect(done.state.cities[rome.id]).toMatchObject({ productionStored: perTurn - 1, production: unit('scout'), population: 1 });
    expect(done.events[0]).toEqual({
      to: ['p1'],
      event: { type: 'unitBuilt', playerId: 'p1', cityId: rome.id, cityName: rome.name, unitId: scouts[0].id, unitType: 'scout' },
    });

    // At most one unit per city per turn, however much is stored.
    const rich = endTurnForAll(withCity(building, rome.id, { productionStored: 10 * cost }));
    expect(unitsOf(rich.state, 'p1', 'scout')).toHaveLength(1);
    expect(rich.state.cities[rome.id].productionStored).toBe(10 * cost + perTurn - cost);
  });

  it('makes a Settler wait until the city has population 2, then removes one population', () => {
    const { state, rome } = romeGame();
    const perTurn = cityEconomy(state, rome).production;
    const surplus = cityEconomy(state, rome).foodSurplus;
    const cost = buildCost(unit('settler'));
    const paidFor = withCity(act(state, 'p1', { type: 'setProduction', cityId: rome.id, item: unit('settler') }), rome.id, {
      productionStored: cost,
    });

    // Population 1: the settler is paid for but does not appear; the production keeps piling up.
    const waiting = endTurnForAll(paidFor);
    expect(unitsOf(waiting.state, 'p1', 'settler')).toHaveLength(0);
    expect(waiting.state.cities[rome.id]).toMatchObject({ population: 1, productionStored: cost + perTurn });
    expect(eventTypes(waiting.events)).toEqual(['turnStarted']);

    // The city grows to 2 this turn (food first), and the settler leaves in
    // the same turn, taking one citizen along.
    const aboutToGrow = withCity(waiting.state, rome.id, { foodStored: foodToGrow(1) - surplus });
    const released = endTurnForAll(aboutToGrow);
    expect(eventTypes(released.events)).toEqual(['cityGrew', 'unitBuilt', 'turnStarted']);
    expect(unitsOf(released.state, 'p1', 'settler')).toHaveLength(1);
    expect(released.state.cities[rome.id]).toMatchObject({
      population: 1,
      productionStored: cost + 2 * perTurn - cost,
      production: unit('settler'),
    });

    // A city that already has 2 citizens releases the settler at once.
    const big = endTurnForAll(withCity(paidFor, rome.id, { population: 2 }));
    expect(unitsOf(big.state, 'p1', 'settler')).toHaveLength(1);
    expect(big.state.cities[rome.id].population).toBe(1);

    // A Warrior takes no citizen.
    const warriorCity = withCity(act(state, 'p1', { type: 'setProduction', cityId: rome.id, item: unit('warrior') }), rome.id, {
      productionStored: buildCost(unit('warrior')),
    });
    const built = endTurnForAll(warriorCity);
    expect(unitsOf(built.state, 'p1', 'warrior')).toHaveLength(2);
    expect(built.state.cities[rome.id].population).toBe(1);
  });

  it('makes a finished unit wait when there is no free tile', () => {
    // The city and one more tile to the east; everything else is mountains.
    const founded = withCapital(newGame(peak(true), [[3, 3]]));
    const map = founded.map;
    const city = Object.values(founded.cities)[0];
    const east = at(map, 4, 3);
    const perTurn = cityEconomy(founded, city).production;
    const cost = buildCost(unit('warrior'));

    // The starting warrior stands in the city, a scout on the only other tile.
    let scoutId = '';
    const full = arrange(act(founded, 'p1', { type: 'setProduction', cityId: city.id, item: unit('warrior') }), (draft) => {
      scoutId = placeUnit(draft, 'p1', 'scout', east).id;
      draft.cities[city.id].productionStored = cost;
    });

    const waiting = endTurnForAll(full);
    expect(unitsOf(waiting.state, 'p1', 'warrior')).toHaveLength(1);
    expect(waiting.state.cities[city.id].productionStored).toBe(cost + perTurn);
    expect(eventTypes(waiting.events)).toEqual(['turnStarted']);

    // The scout leaves the game (by the test's hand): next turn the warrior appears on the freed tile.
    const freed = arrange(waiting.state, (draft) => {
      delete draft.units[scoutId];
    });
    const built = endTurnForAll(freed);
    const warriors = unitsOf(built.state, 'p1', 'warrior');
    expect(warriors).toHaveLength(2);
    expect(warriors[1].tile).toBe(east);
    expect(built.state.cities[city.id].productionStored).toBe(cost + 2 * perTurn - cost);
    expect(eventTypes(built.events)).toEqual(['unitBuilt', 'turnStarted']);
  });

  it('productionBlocked says needsPopulation / noRoom exactly when resolveTurn would make the city wait, and null otherwise', () => {
    const founded = withCapital(newGame(peak(true), [[3, 3]]));
    const map = founded.map;
    const cityId = Object.keys(founded.cities)[0];
    const east = at(map, 4, 3);

    /** The city with the given item and population; `crowd` fills both tiles with military or civilian units. */
    function situation(item: BuildItem | null, population: number, crowd: 'none' | 'military' | 'civilian'): GameState {
      return arrange(founded, (draft) => {
        draft.cities[cityId].production = item;
        draft.cities[cityId].population = population;
        // The starting warrior already stands in the city.
        if (crowd === 'military') placeUnit(draft, 'p1', 'scout', east);
        if (crowd === 'civilian') {
          placeUnit(draft, 'p1', 'settler', draft.cities[cityId].tile);
          placeUnit(draft, 'p1', 'settler', east);
        }
      });
    }

    const cases: [string, GameState, 'needsPopulation' | 'noRoom' | null][] = [
      ['nothing chosen', situation(null, 1, 'military'), null],
      ['warrior, room next door', situation(unit('warrior'), 1, 'none'), null],
      ['warrior, both tiles hold military units', situation(unit('warrior'), 1, 'military'), 'noRoom'],
      ['warrior, both tiles hold civilians (no matter)', situation(unit('warrior'), 1, 'civilian'), null],
      ['settler, one citizen', situation(unit('settler'), 1, 'none'), 'needsPopulation'],
      ['settler, one citizen and no room: population is named first', situation(unit('settler'), 1, 'civilian'), 'needsPopulation'],
      ['settler, two citizens', situation(unit('settler'), 2, 'none'), null],
      ['settler, two citizens, both tiles hold civilians', situation(unit('settler'), 2, 'civilian'), 'noRoom'],
      ['settler, two citizens, both tiles hold military units (no matter)', situation(unit('settler'), 2, 'military'), null],
    ];

    for (const [what, state, expected] of cases) {
      const city = state.cities[cityId];
      expect(productionBlocked(state, city), what).toBe(expected);
      // The view tells the owner the same thing.
      expect(buildPlayerView(state, 'p1').cities[0].own?.productionBlocked, what).toBe(expected);

      // It does not look at what is stored: the answer is the same for a full store...
      const paidFor = arrange(state, (draft) => {
        draft.cities[cityId].productionStored = 1000;
      });
      expect(productionBlocked(paidFor, paidFor.cities[cityId]), what).toBe(expected);

      // ...and with a full store, the turn completes the item exactly when nothing blocks it.
      const before = unitsOf(paidFor, 'p1').length;
      const after = endTurnForAll(paidFor);
      const builtSomething = unitsOf(after.state, 'p1').length > before;
      expect(builtSomething, what).toBe(city.production !== null && expected === null);
      expect(eventTypes(after.events).includes('unitBuilt'), what).toBe(builtSomething);
    }
  });

  it('restores every unit\'s moves, clears endedTurn, adds 1 to the turn and ends with a turnStarted event addressed to all', () => {
    const start = meadowGame();
    const map = start.map;
    // Everybody walks until their moves are gone.
    let state = start;
    for (const playerId of ['p1', 'p2']) {
      for (const mover of unitsOf(state, playerId)) {
        const direction = playerId === 'p1' ? EAST : WEST;
        const one = stepFrom(map, mover.tile, direction);
        state = act(state, playerId, { type: 'moveUnit', unitId: mover.id, path: [one, stepFrom(map, one, direction)] });
      }
    }
    expect(Object.values(state.units).every((mover) => mover.movesLeft === 0)).toBe(true);

    const resolved = endTurnForAll(state);
    expect(resolved.state.turn).toBe(2);
    for (const mover of Object.values(resolved.state.units)) expect(mover.movesLeft).toBe(UNITS[mover.type].moves);
    expect(resolved.state.players.every((player) => !player.endedTurn)).toBe(true);
    expect(resolved.events[resolved.events.length - 1]).toEqual({ to: 'all', event: { type: 'turnStarted', turn: 2 } });
    // Units stay where they are; only their moves come back.
    for (const mover of Object.values(state.units)) expect(resolved.state.units[mover.id].tile).toBe(mover.tile);

    // After the turn has resolved everybody can act again.
    const warrior = unitOf(resolved.state, 'p1', 'warrior');
    expect(refusal(resolved.state, 'p1', { type: 'moveUnit', unitId: warrior.id, path: [stepFrom(map, warrior.tile, EAST)] })).toBeNull();
  });

  it('addresses cityGrew and unitBuilt to the city\'s owner only', () => {
    const start = meadowGame();
    const map = start.map;
    // p1 has two cities (Rome, then Ostia), p2 has one. All three grow and complete a scout this turn.
    let state = withCapital(withCapital(start), 'p2');
    state = foundCityAt(state, 'p1', at(map, 3, 1));
    const rome = cityOn(state, at(map, 3, 5));
    const ostia = cityOn(state, at(map, 3, 1));
    const thebes = cityOn(state, at(map, 12, 5));
    state = arrange(state, (draft) => {
      for (const city of Object.values(draft.cities)) {
        city.production = unit('scout');
        city.productionStored = UNITS.scout.cost;
        city.foodStored = foodToGrow(1);
      }
    });

    const resolved = endTurnForAll(state);
    // Players in seat order, each player's cities in founding order, food before production.
    expect(resolved.events.map((addressed) => [addressed.to, addressed.event.type, 'cityId' in addressed.event ? addressed.event.cityId : null])).toEqual([
      [['p1'], 'cityGrew', rome.id],
      [['p1'], 'unitBuilt', rome.id],
      [['p1'], 'cityGrew', ostia.id],
      [['p1'], 'unitBuilt', ostia.id],
      [['p2'], 'cityGrew', thebes.id],
      [['p2'], 'unitBuilt', thebes.id],
      ['all', 'turnStarted', null],
    ]);
    for (const addressed of resolved.events) {
      if (addressed.event.type === 'turnStarted') continue;
      expect(addressed.to).toEqual([addressed.event.playerId]);
    }
  });

  it('reads a city\'s economy once, before it grows', () => {
    // The production added in the turn a city grows is that of the smaller city.
    const { state, rome } = romeGame();
    const before = cityEconomy(state, rome);
    const growing = withCity(act(state, 'p1', { type: 'setProduction', cityId: rome.id, item: unit('settler') }), rome.id, {
      foodStored: foodToGrow(1),
    });
    const after = endTurnForAll(growing).state;
    expect(after.cities[rome.id].population).toBe(2);
    expect(after.cities[rome.id].productionStored).toBe(before.production);
    expect(cityEconomy(after, after.cities[rome.id]).production).toBeGreaterThan(before.production);
  });

  it('resolveTurn does not modify its input', () => {
    const { state, rome } = romeGame();
    const busy = deepFreeze(
      withCity(act(state, 'p1', { type: 'setProduction', cityId: rome.id, item: unit('scout') }), rome.id, {
        productionStored: UNITS.scout.cost,
        foodStored: foodToGrow(1),
      }),
    );
    const before = JSON.stringify(busy);

    // Called directly, it does not ask whether everybody has ended (a timer may force a turn one day).
    expect(isTurnComplete(busy)).toBe(false);
    const resolved = resolveTurn(busy);

    expect(JSON.stringify(busy)).toBe(before);
    expect(resolved.state).not.toBe(busy);
    expect(resolved.state.turn).toBe(busy.turn + 1);
    expect(eventTypes(resolved.events)).toEqual(['cityGrew', 'unitBuilt', 'turnStarted']);
    expect(checkInvariants(resolved.state)).toEqual([]);
    // The same input gives the same output, every time.
    expect(JSON.stringify(resolveTurn(busy))).toBe(JSON.stringify(resolved));
  });

  it('lets the new unit see: tiles in its sight are explored when the turn has resolved', () => {
    // The warrior holds the city, so the new scout appears next door and sees one tile further than the city did.
    const { state, rome } = romeGame();
    const ready = withCity(act(state, 'p1', { type: 'setProduction', cityId: rome.id, item: unit('scout') }), rome.id, {
      productionStored: UNITS.scout.cost,
    });
    const resolved = endTurnForAll(ready).state;
    const scout = unitOf(resolved, 'p1', 'scout');
    expect(scout.tile).not.toBe(rome.tile);
    const newlySeen = resolved.players[0].knowledge.explored.filter((flag, tile) => flag === 1 && ready.players[0].knowledge.explored[tile] === 0);
    expect(newlySeen.length).toBeGreaterThan(0);
  });
});
