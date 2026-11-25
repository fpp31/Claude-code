import { describe, expect, it } from 'vitest';
import {
  RULES,
  TERRAIN,
  UNITS,
  UNIT_TYPE_IDS,
  buildCost,
  buildItemError,
  buildPlan,
  buildPlayerView,
  checkInvariants,
  cityEconomy,
  cloneJson,
  createGame,
  diffViews,
  distance,
  findSpawnTile,
  foodToGrow,
  neighbors,
  runCityTurn,
  tileIsWater,
} from '../src/index';
import type { Action, BuildItem, BuildWait, City, GameState, PlayerId, RuleErrorCode, TileIndex, UnitTypeId } from '../src/index';
import {
  MEADOW,
  SIX_PLAYERS,
  act,
  actWithEvents,
  arrange,
  at,
  cityOn,
  codeOf,
  deepFreeze,
  endTurnForAll,
  newGame,
  placeUnit,
  playUntilBuilt,
  queueOf,
  refusal,
  send,
  setupFor,
  tamper,
  unitOf,
  unitsOf,
} from './rulesKit';
import { LONG_TEST, WILDS, WILDS_STARTS, playRandomGame } from './rulesRandomPlay';

/**
 * Tests for the build queue of a city: the setBuildQueue action
 * (rules/setBuildQueue.ts), what turn resolution does with a queue
 * (runCityTurn in rules/city.ts) and the forecast the owner is shown
 * (buildPlan in rules/city.ts).
 *
 * The capital of these tests stands on open grassland: one citizen, 2 food
 * and 2 production a turn to begin with, a second citizen when the fifth
 * turn resolves. It stands INLAND and owns no water, so it can build the
 * four land units and never a boat: its menu says so on the two boats
 * (BuildOption.addError 'noWaterForBoat'). What a city by the water does
 * with boats is the last block of this file.
 */

/** The unit types by where they move, each in the order of the build menu (the boats come last). */
const LAND_UNITS: readonly UnitTypeId[] = UNIT_TYPE_IDS.filter((type) => UNITS[type].domain === 'land');
const BOATS: readonly UnitTypeId[] = UNIT_TYPE_IDS.filter((type) => UNITS[type].domain === 'sea');

/** What the menu of a city without water says of the two boats, as [turns, wait] pairs: never a number, whatever the queue holds. */
const DRY_BOATS: [number | null, BuildWait | null][] = BOATS.map(() => [null, 'noRoom']);

/** Does the city own a water tile? Counted with tileIsWater, apart from the engine's own question. */
function ownsWater(state: GameState, city: City): boolean {
  return state.map.tiles.some((tile) => tile.cityId === city.id && tileIsWater(tile));
}

/** Two players on the meadow; p1 has founded Rome at (3,5), p2 has done nothing. */
function romeGame(): { state: GameState; rome: City } {
  const start = newGame(MEADOW, [[3, 5], [12, 5]]);
  const state = act(start, 'p1', { type: 'foundCity', unitId: unitOf(start, 'p1', 'settler').id });
  return { state, rome: cityOn(state, at(state.map, 3, 5)) };
}

/** A copy of the state with some fields of one city set by hand (the queue as unit types). */
function withCity(state: GameState, cityId: string, fields: Partial<Omit<City, 'buildQueue'>> & { queue?: UnitTypeId[] }): GameState {
  return arrange(state, (draft) => {
    const { queue, ...rest } = fields;
    Object.assign(draft.cities[cityId], rest);
    if (queue !== undefined) draft.cities[cityId].buildQueue = queueOf(...queue);
  });
}

/** The queue of a city as the list of its unit types. */
function queued(state: GameState, cityId: string): UnitTypeId[] {
  return state.cities[cityId].buildQueue.map((entry) => entry.unitType);
}

/** The rows of the city's forecast as [turns, wait] pairs. */
function rows(state: GameState, cityId: string): [number | null, BuildWait | null][] {
  return buildPlan(state, state.cities[cityId]).queue.map((row) => [row.turns, row.wait]);
}

/** The menu of the city's forecast as [turns, wait] pairs, in UNIT_TYPE_IDS order. */
function menu(state: GameState, cityId: string): [number | null, BuildWait | null][] {
  return buildPlan(state, state.cities[cityId]).options.map((option) => [option.turns, option.wait]);
}

/**
 * A city on a single enterable tile (`centre`, at (3,3)), or on two (with
 * `neighbor` east of it), in a block of mountains: it owns nothing else a
 * citizen could work or a unit could stand on. Its starting Warrior stands
 * in the city.
 */
function peakCity(centre: string, neighbor: string | null = null): { state: GameState; city: City } {
  const start = newGame(
    [
      'm m m m m m m',
      ' m m m m m m m',
      'm m m m m m m',
      ` m m m ${centre} ${neighbor ?? 'm'} m m`,
      'm m m m m m m',
      ' m m m m m m m',
      'm m m m m m m',
    ],
    [[3, 3]],
  );
  const state = act(start, 'p1', { type: 'foundCity', unitId: unitOf(start, 'p1', 'settler').id });
  return { state, city: Object.values(state.cities)[0] };
}

describe('applyAction: setBuildQueue', () => {
  it('setBuildQueue replaces the whole queue in the order given and keeps the stored production', () => {
    const { state, rome } = romeGame();
    const before = withCity(state, rome.id, { queue: ['warrior', 'scout'], productionStored: 7, foodStored: 3 });

    const step = actWithEvents(before, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf('settler', 'worker', 'warrior') });
    expect(step.changed).toBe(true);
    expect(step.events).toEqual([]);
    // The whole city, field by field: only the queue is new.
    expect(step.state.cities[rome.id]).toEqual({
      ...before.cities[rome.id],
      buildQueue: [
        { kind: 'unit', unitType: 'settler' },
        { kind: 'unit', unitType: 'worker' },
        { kind: 'unit', unitType: 'warrior' },
      ],
    });
    expect(step.state.cities[rome.id].productionStored).toBe(7);
    // Nothing else in the game moved.
    expect({ ...step.state, cities: null }).toEqual({ ...before, cities: null });

    // Every edit the city panel makes is one such list: add, remove, move up, move down, empty.
    const edits: UnitTypeId[][] = [
      ['settler', 'worker', 'warrior', 'scout'],
      ['settler', 'warrior', 'scout'],
      ['warrior', 'settler', 'scout'],
      ['warrior', 'scout', 'settler'],
      [],
    ];
    let current = step.state;
    for (const edit of edits) {
      current = act(current, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf(...edit) });
      expect(queued(current, rome.id)).toEqual(edit);
      expect(current.cities[rome.id].productionStored).toBe(7);
      expect(current.cities[rome.id].foodStored).toBe(3);
    }
  });

  it('the same item may be queued several times', () => {
    const { state, rome } = romeGame();
    const wanted: UnitTypeId[] = ['scout', 'scout', 'warrior', 'scout', 'scout'];
    const next = act(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf(...wanted) });
    expect(queued(next, rome.id)).toEqual(wanted);
    // Eight of one kind fill the queue.
    const eight = Array.from({ length: RULES.maxQueueLength }, (): UnitTypeId => 'settler');
    expect(queued(act(next, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf(...eight) }), rome.id)).toEqual(eight);
  });

  it('an empty list is accepted: the city builds nothing and keeps what it stored', () => {
    const { state, rome } = romeGame();
    const building = withCity(state, rome.id, { queue: ['warrior', 'scout'], productionStored: 7 });

    const step = actWithEvents(building, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: [] });
    expect(step.changed).toBe(true);
    expect(step.state.cities[rome.id]).toEqual({ ...building.cities[rome.id], buildQueue: [] });

    // Nothing is built and nothing is added; the 7 are still there for whatever is queued next.
    let idle = step.state;
    for (let turn = 0; turn < 3; turn++) idle = endTurnForAll(idle).state;
    expect(idle.cities[rome.id].productionStored).toBe(7);
    expect(unitsOf(idle, 'p1')).toHaveLength(1);
    const resumed = act(idle, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf('scout') });
    expect(resumed.cities[rome.id].productionStored).toBe(7);
  });

  it('rejects a missing city and another player\'s city with noSuchCity, whatever the list is', () => {
    const { state, rome } = romeGame();
    const lists: unknown[][] = [
      [],
      queueOf('warrior'),
      queueOf('scout', 'settler'),
      Array.from({ length: RULES.maxQueueLength + 1 }, () => queueOf('scout')[0]),
      [{ kind: 'unit', unitType: 'dragon' }],
      [null],
    ];
    for (const list of lists) {
      const queue = list as BuildItem[];
      // Somebody else's city.
      expect(refusal(state, 'p2', { type: 'setBuildQueue', cityId: rome.id, queue }), JSON.stringify(list)).toBe('noSuchCity');
      // No such city, also for names every JavaScript object inherits.
      for (const cityId of ['c1_nowhere', 'c2_nowhere', 'constructor', '__proto__', 'toString', '']) {
        expect(refusal(state, 'p1', { type: 'setBuildQueue', cityId, queue }), `${cityId} ${JSON.stringify(list)}`).toBe('noSuchCity');
      }
    }
    // A unit id is not a city id.
    const warrior = unitOf(state, 'p1', 'warrior');
    expect(refusal(state, 'p1', { type: 'setBuildQueue', cityId: warrior.id, queue: [] })).toBe('noSuchCity');
  });

  it('a list longer than RULES.maxQueueLength is refused with queueFull; exactly that many entries are accepted', () => {
    const { state, rome } = romeGame();
    const listOf = (length: number): BuildItem[] => Array.from({ length }, (_, index) => queueOf(LAND_UNITS[index % LAND_UNITS.length])[0]);

    const full = act(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: listOf(RULES.maxQueueLength) });
    expect(full.cities[rome.id].buildQueue).toEqual(listOf(RULES.maxQueueLength));

    for (const length of [RULES.maxQueueLength + 1, RULES.maxQueueLength + 2, 20, 64, 500]) {
      expect(refusal(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: listOf(length) }), `${length} entries`).toBe('queueFull');
      // A full queue cannot be made longer either, and stays as it is.
      expect(refusal(full, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: listOf(length) }), `${length} entries`).toBe('queueFull');
    }
    // One entry fewer than full, and then full again: adding to a queue of seven works.
    const seven = act(full, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: listOf(RULES.maxQueueLength - 1) });
    expect(seven.cities[rome.id].buildQueue).toHaveLength(RULES.maxQueueLength - 1);
    expect(refusal(seven, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: listOf(RULES.maxQueueLength) })).toBeNull();
  });

  it('one entry that is not a buildable item refuses the whole list with cannotBuild and stores nothing', () => {
    const { state, rome } = romeGame();
    const before = withCity(state, rome.id, { queue: ['scout'], productionStored: 4 });
    const notItems: unknown[] = [
      null,
      3,
      'warrior',
      {},
      { kind: 'unit' },
      { kind: 'building', unitType: 'warrior' },
      { kind: 'unit', unitType: 'dragon' },
      { kind: 'unit', unitType: 'constructor' },
      // And a few more of the same family.
      { kind: 'unit', unitType: 3 },
      { kind: 'unit', unitType: null },
      { kind: 'unit', unitType: '__proto__' },
      { unitType: 'warrior' },
      [{ kind: 'unit', unitType: 'warrior' }],
      true,
    ];
    const good = queueOf('warrior', 'settler');
    for (const bad of notItems) {
      const asFirst = [bad, ...good];
      const inTheMiddle = [good[0], bad, good[1]];
      const asLast = [...good, bad];
      const alone = [bad];
      for (const list of [asFirst, inTheMiddle, asLast, alone]) {
        const what = JSON.stringify(list);
        const result = send(before, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: list as BuildItem[] });
        expect(codeOf(result), what).toBe('cannotBuild');
        // Nothing was stored: not the bad entry, and not the good ones before it either.
        expect(before.cities[rome.id].buildQueue, what).toEqual(queueOf('scout'));
      }
    }
    // The good entries alone are fine.
    expect(refusal(before, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: good })).toBeNull();
  });

  it('the checks come in the order noSuchCity, queueFull, cannotBuild', () => {
    const { state, rome } = romeGame();
    const nonsense = { kind: 'unit', unitType: 'dragon' } as unknown as BuildItem;
    const tooLongNonsense = Array.from({ length: RULES.maxQueueLength + 1 }, () => nonsense);

    // Everything wrong at once: whose city is answered first.
    expect(refusal(state, 'p2', { type: 'setBuildQueue', cityId: rome.id, queue: tooLongNonsense })).toBe('noSuchCity');
    expect(refusal(state, 'p1', { type: 'setBuildQueue', cityId: 'c1_nowhere', queue: tooLongNonsense })).toBe('noSuchCity');
    // One's own city: the length is judged before any entry is looked at...
    expect(refusal(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: tooLongNonsense })).toBe('queueFull');
    // ...and only a list that is short enough is read.
    expect(refusal(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: tooLongNonsense.slice(0, RULES.maxQueueLength) })).toBe('cannotBuild');
    expect(refusal(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: [nonsense] })).toBe('cannotBuild');

    // The general checks of applyAction come before all three.
    const notAList = { type: 'setBuildQueue', cityId: 'c1_nowhere', queue: 'warrior' } as unknown as Action;
    expect(refusal(state, 'p1', notAList)).toBe('badAction');
    expect(codeOf(send(state, 'p2', { type: 'setBuildQueue', cityId: rome.id, queue: tooLongNonsense }, state.turn + 1))).toBe('staleTurn');
  });

  it('the queue the city already has is a no-op: changed false, the same state object, no event', () => {
    const { state, rome } = romeGame();
    const building = act(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf('scout', 'warrior', 'scout') });

    const cases: [GameState, UnitTypeId[]][] = [
      [building, ['scout', 'warrior', 'scout']],
      [state, []], // an empty queue for a city whose queue is empty
    ];
    for (const [situation, list] of cases) {
      const result = send(situation, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf(...list) });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.changed).toBe(false);
      expect(result.state).toBe(situation); // the very same object: nothing to save, nothing to send
      expect(result.events).toEqual([]);
    }

    // The same items in another order, one more and one fewer are all real changes.
    for (const list of [['warrior', 'scout', 'scout'], ['scout', 'warrior', 'scout', 'scout'], ['scout', 'warrior']] as UnitTypeId[][]) {
      const result = send(building, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf(...list) });
      expect(result.ok && result.changed, list.join()).toBe(true);
    }
  });

  it('only kind and unitType are ever stored, whatever else an entry carries', () => {
    const { state, rome } = romeGame();
    const note = 'x'.repeat(50);
    const padded = [
      { kind: 'unit', unitType: 'settler', note },
      { kind: 'unit', unitType: 'scout', cost: 0, turns: 1, wait: null, item: { kind: 'unit', unitType: 'warrior' } },
      { unitType: 'worker', kind: 'unit', __proto__: { note } },
    ] as unknown as BuildItem[];

    const stored = act(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: padded });
    expect(stored.cities[rome.id].buildQueue).toEqual([
      { kind: 'unit', unitType: 'settler' },
      { kind: 'unit', unitType: 'scout' },
      { kind: 'unit', unitType: 'worker' },
    ]);
    for (const entry of stored.cities[rome.id].buildQueue) expect(Object.keys(entry).sort()).toEqual(['kind', 'unitType']);
    // Not in the state, and so not in anybody's view.
    expect(JSON.stringify(stored)).not.toContain(note);
    expect(JSON.stringify(buildPlayerView(stored, 'p1'))).not.toContain(note);
    expect(JSON.stringify(buildPlayerView(stored, 'p1'))).not.toContain('"note"');
    // The scout's made-up cost did not get in either.
    expect(buildPlayerView(stored, 'p1').cities[0].own?.buildQueue[1].cost).toBe(UNITS.scout.cost);

    // The queues are compared after the entries were rebuilt: the padded list again is the queue the city has.
    const again = send(stored, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: padded });
    expect(again.ok && !again.changed).toBe(true);
    if (again.ok) expect(again.state).toBe(stored);
  });

  it('the stored entries are the engine\'s own objects: the same object given twice becomes two separate entries', () => {
    const { state, rome } = romeGame();
    const item: BuildItem = { kind: 'unit', unitType: 'scout' };
    const list = [item, item, item];

    const stored = act(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: list });
    const queue = stored.cities[rome.id].buildQueue;
    expect(queue).toEqual([item, item, item]);
    expect(queue).not.toBe(list);
    expect(queue[0]).not.toBe(queue[1]);
    expect(queue[1]).not.toBe(queue[2]);
    for (const entry of queue) expect(entry).not.toBe(item);

    // Whatever the sender does with its objects afterwards, the state does not follow.
    item.unitType = 'settler';
    list.pop();
    expect(queued(stored, rome.id)).toEqual(['scout', 'scout', 'scout']);
    // And when one entry is completed, the others are untouched: a turn with a full store builds one scout.
    const rich = withCity(stored, rome.id, { productionStored: 100 });
    const built = endTurnForAll(rich).state;
    expect(queued(built, rome.id)).toEqual(['scout', 'scout']);
  });

  it('after End Turn the answer is turnAlreadyEnded; with an old turn number staleTurn', () => {
    const { state, rome } = romeGame();
    const edit: Action = { type: 'setBuildQueue', cityId: rome.id, queue: queueOf('warrior') };

    const ended = act(state, 'p1', { type: 'endTurn' });
    expect(ended.turn).toBe(state.turn); // p2 is still playing
    expect(refusal(ended, 'p1', edit)).toBe('turnAlreadyEnded');
    // Whatever is wrong with the list or the city, the answer is the same after End Turn.
    expect(refusal(ended, 'p1', { type: 'setBuildQueue', cityId: 'c1_nowhere', queue: [] })).toBe('turnAlreadyEnded');
    // Taking End Turn back opens the queue again.
    const back = act(ended, 'p1', { type: 'cancelEndTurn' });
    expect(refusal(back, 'p1', edit)).toBeNull();

    expect(codeOf(send(state, 'p1', edit, state.turn - 1))).toBe('staleTurn');
    expect(codeOf(send(state, 'p1', edit, state.turn + 1))).toBe('staleTurn');
    // A list made in an old turn can never put a completed item back.
    const paid = withCity(act(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf('scout') }), rome.id, {
      productionStored: UNITS.scout.cost,
    });
    const next = endTurnForAll(paid).state;
    expect(queued(next, rome.id)).toEqual([]);
    expect(codeOf(send(next, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf('scout', 'warrior') }, paid.turn))).toBe('staleTurn');
    expect(queued(next, rome.id)).toEqual([]);
  });

  it('changing a queue is not news: no event, and no other player\'s view changes', () => {
    const { state, rome } = romeGame();
    // A scout of p2 stands next to Rome and has the city in full sight.
    const watched = arrange(state, (draft) => {
      placeUnit(draft, 'p2', 'scout', at(draft.map, 5, 5));
    });
    const theirViewBefore = buildPlayerView(watched, 'p2');
    expect(theirViewBefore.cities.find((city) => city.id === rome.id)).toMatchObject({ visible: true, own: null });
    const myViewBefore = buildPlayerView(watched, 'p1');

    let current = watched;
    for (const list of [['warrior'], ['warrior', 'settler'], ['settler', 'warrior'], ['settler'], []] as UnitTypeId[][]) {
      const step = actWithEvents(current, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf(...list) });
      expect(step.events).toEqual([]);
      // The other player is sent nothing at all: their view is the same, to the last character.
      const theirView = buildPlayerView(step.state, 'p2');
      expect(theirView).toEqual(theirViewBefore);
      expect(JSON.stringify(theirView)).toBe(JSON.stringify(theirViewBefore));
      expect(diffViews(theirViewBefore, theirView)).toBeNull();
      // The owner sees the new queue, and only the cities of the view changed.
      const myView = buildPlayerView(step.state, 'p1');
      expect(myView.cities[0].own?.buildQueue.map((row) => row.item.unitType)).toEqual(list);
      const patch = diffViews(buildPlayerView(current, 'p1'), myView);
      expect(Object.keys(patch ?? {})).toEqual(['cities']);
      current = step.state;
    }
    expect(buildPlayerView(current, 'p1')).toEqual(myViewBefore); // back to an empty queue: the first view again
  });
});

describe('turn resolution: the build queue', () => {
  it('an empty queue adds nothing: the production of those turns is lost and what was stored stays', () => {
    const { state, rome } = romeGame();
    expect(cityEconomy(state, rome).production).toBeGreaterThan(0);
    const saved = withCity(state, rome.id, { productionStored: 7 });

    let idle = saved;
    for (let turn = 0; turn < 4; turn++) {
      const step = endTurnForAll(idle);
      idle = step.state;
      expect(idle.cities[rome.id].productionStored).toBe(7);
      expect(step.events.some((addressed) => addressed.event.type === 'unitBuilt')).toBe(false);
    }
    expect(unitsOf(idle, 'p1')).toHaveLength(1);
    // The city itself went on living: it ate and grew as any city.
    expect(idle.cities[rome.id].foodStored).toBe(4 * cityEconomy(state, rome).foodSurplus);

    // An empty queue with a store that would pay for anything still builds nothing.
    const rich = endTurnForAll(withCity(state, rome.id, { productionStored: 500 }));
    expect(unitsOf(rich.state, 'p1')).toHaveLength(1);
    expect(rich.state.cities[rome.id].productionStored).toBe(500);
  });

  it('a completed entry leaves the queue; the next one is the current build and starts with what was left over', () => {
    const { state, rome } = romeGame();
    const perTurn = cityEconomy(state, rome).production;
    // One more than the Scout costs once this turn's production is in.
    const almost = withCity(state, rome.id, { queue: ['scout', 'warrior', 'settler'], productionStored: UNITS.scout.cost - perTurn + 1 });

    const done = endTurnForAll(almost);
    expect(unitsOf(done.state, 'p1', 'scout')).toHaveLength(1);
    expect(queued(done.state, rome.id)).toEqual(['warrior', 'settler']);
    expect(done.state.cities[rome.id].productionStored).toBe(1);
    // The owner's panel: the Warrior is the current build now, with the 1 that was left over.
    const own = buildPlayerView(done.state, 'p1').cities[0].own;
    expect(own?.buildQueue[0]).toMatchObject({ item: { kind: 'unit', unitType: 'warrior' }, cost: UNITS.warrior.cost });
    expect(own?.productionStored).toBe(1);

    // The next turn's production goes to the Warrior.
    const next = endTurnForAll(done.state).state;
    expect(next.cities[rome.id].productionStored).toBe(1 + perTurn);
    expect(queued(next, rome.id)).toEqual(['warrior', 'settler']);
  });

  it('the same item queued twice is built twice, in two turns', () => {
    const { state, rome } = romeGame();
    const perTurn = cityEconomy(state, rome).production;
    const twice = withCity(state, rome.id, { queue: ['scout', 'scout'], productionStored: 2 * UNITS.scout.cost });

    const first = endTurnForAll(twice);
    expect(unitsOf(first.state, 'p1', 'scout')).toHaveLength(1);
    expect(queued(first.state, rome.id)).toEqual(['scout']);
    const second = endTurnForAll(first.state);
    expect(unitsOf(second.state, 'p1', 'scout')).toHaveLength(2);
    expect(queued(second.state, rome.id)).toEqual([]);
    expect(second.state.cities[rome.id].productionStored).toBe(2 * perTurn);
    // Two units, two ids, two tiles (a tile holds one military unit; the Warrior holds the city).
    const [one, two] = unitsOf(second.state, 'p1', 'scout');
    expect(one.id).not.toBe(two.id);
    expect(one.tile).not.toBe(two.tile);
  });

  it('at most one completion per city per turn: a full store empties a queue of three in three turns', () => {
    const { state, rome } = romeGame();
    let current = withCity(state, rome.id, { queue: ['scout', 'warrior', 'worker'], productionStored: 1000 });
    const before = unitsOf(current, 'p1').length;

    for (let turn = 1; turn <= 3; turn++) {
      const step = endTurnForAll(current);
      current = step.state;
      expect(unitsOf(current, 'p1')).toHaveLength(before + turn);
      expect(current.cities[rome.id].buildQueue).toHaveLength(3 - turn);
      expect(step.events.filter((addressed) => addressed.event.type === 'unitBuilt')).toHaveLength(1);
    }
    expect(unitsOf(current, 'p1').map((unit) => unit.type)).toEqual(['warrior', 'scout', 'warrior', 'worker']);
  });

  it('completing the last entry leaves an empty queue, says so in the event (queueEmpty true), and the next turn\'s production is lost', () => {
    const { state, rome } = romeGame();
    const perTurn = cityEconomy(state, rome).production;
    const last = withCity(state, rome.id, { queue: ['scout'], productionStored: UNITS.scout.cost });

    const done = endTurnForAll(last);
    const scout = unitOf(done.state, 'p1', 'scout');
    expect(done.events).toEqual([
      {
        to: ['p1'],
        event: {
          type: 'unitBuilt', playerId: 'p1', cityId: rome.id, cityName: rome.name, unitId: scout.id, unitType: 'scout',
          queueEmpty: true,
        },
      },
      { to: 'all', event: { type: 'turnStarted', turn: last.turn + 1 } },
    ]);
    expect(done.state.cities[rome.id].buildQueue).toEqual([]);
    expect(done.state.cities[rome.id].productionStored).toBe(perTurn);
    // The owner's view calls the city idle now.
    expect(buildPlayerView(done.state, 'p1').cities[0].own?.buildQueue).toEqual([]);

    // The next turn adds nothing: what is stored stays, the rest is lost.
    const idle = endTurnForAll(done.state);
    expect(idle.state.cities[rome.id].productionStored).toBe(perTurn);
    expect(idle.events.map((addressed) => addressed.event.type)).toEqual(['turnStarted']);
  });

  it('queueEmpty is false while entries remain', () => {
    const { state, rome } = romeGame();
    let current = withCity(state, rome.id, { queue: ['scout', 'scout', 'warrior'], productionStored: 1000 });
    const seen: boolean[] = [];
    for (let turn = 0; turn < 3; turn++) {
      const step = endTurnForAll(current);
      current = step.state;
      for (const { event } of step.events) if (event.type === 'unitBuilt') seen.push(event.queueEmpty);
    }
    expect(seen).toEqual([false, false, true]);
  });

  it('a first entry that waits for population holds the queue: a paid-for Warrior behind it is not built, and the store keeps growing', () => {
    const { state, rome } = romeGame();
    const perTurn = cityEconomy(state, rome).production;
    const stored = UNITS.settler.cost + UNITS.warrior.cost;
    const held = withCity(state, rome.id, { queue: ['settler', 'warrior'], productionStored: stored });
    expect(held.cities[rome.id].population).toBe(1);

    let current = held;
    for (let turn = 1; turn <= 3; turn++) {
      const step = endTurnForAll(current);
      current = step.state;
      // Nothing is built, although the Warrior is paid for and nothing blocks it.
      expect(unitsOf(current, 'p1')).toHaveLength(1);
      expect(queued(current, rome.id)).toEqual(['settler', 'warrior']);
      expect(current.cities[rome.id].productionStored).toBe(stored + turn * perTurn);
      // A waiting city makes no event.
      expect(step.events.map((addressed) => addressed.event.type)).toEqual(['turnStarted']);
    }
    expect(buildPlan(current, current.cities[rome.id]).held).toBe('needsPopulation');
  });

  it('moving the waiting entry down lets the next one through when the turn resolves', () => {
    const { state, rome } = romeGame();
    const perTurn = cityEconomy(state, rome).production;
    const stored = UNITS.settler.cost + UNITS.warrior.cost;
    const held = withCity(state, rome.id, { queue: ['settler', 'warrior'], productionStored: stored });

    // One tap on the down arrow: the two entries change places.
    const reordered = act(held, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf('warrior', 'settler') });
    expect(reordered.cities[rome.id].productionStored).toBe(stored);
    expect(buildPlan(reordered, reordered.cities[rome.id]).held).toBeNull();

    const done = endTurnForAll(reordered);
    expect(unitsOf(done.state, 'p1', 'warrior')).toHaveLength(2);
    expect(queued(done.state, rome.id)).toEqual(['settler']);
    expect(done.state.cities[rome.id].productionStored).toBe(stored + perTurn - UNITS.warrior.cost);
    // The Settler is first again, still paid for, and waits for the second citizen.
    expect(buildPlan(done.state, done.state.cities[rome.id]).held).toBe('needsPopulation');
  });

  it('a first entry without a free tile holds the queue', () => {
    // The city and one more tile; the starting Warrior holds the city, a Scout the other tile.
    const { state, city } = peakCity('d', 'g');
    const east = at(state.map, 4, 3);
    const full = arrange(state, (draft) => {
      placeUnit(draft, 'p1', 'scout', east);
      Object.assign(draft.cities[city.id], { population: 2, productionStored: 1000 });
      draft.cities[city.id].buildQueue = queueOf('warrior', 'settler', 'worker');
    });
    expect(findSpawnTile(full, full.cities[city.id], 'warrior')).toBeNull();
    // The Settler behind it is paid for, the city could spare the citizen, and a civilian would fit into the city.
    expect(findSpawnTile(full, full.cities[city.id], 'settler')).toBe(city.tile);

    let current = full;
    for (let turn = 0; turn < 2; turn++) {
      const step = endTurnForAll(current);
      current = step.state;
      expect(unitsOf(current, 'p1')).toHaveLength(2);
      expect(queued(current, city.id)).toEqual(['warrior', 'settler', 'worker']);
      expect(current.cities[city.id].productionStored).toBeGreaterThanOrEqual(1000);
      expect(step.events.some((addressed) => addressed.event.type === 'unitBuilt')).toBe(false);
    }
    expect(buildPlan(current, current.cities[city.id]).held).toBe('noRoom');

    // Removing the first row lets the Settler out at once.
    const stopped = act(current, 'p1', { type: 'setBuildQueue', cityId: city.id, queue: queueOf('settler', 'worker') });
    const released = endTurnForAll(stopped).state;
    expect(unitsOf(released, 'p1', 'settler')).toHaveLength(1);
    expect(queued(released, city.id)).toEqual(['worker']);
  });

  it('a city that grows to 2 in this turn releases its Settler in the same turn, and the Settler leaves the queue', () => {
    const { state, rome } = romeGame();
    const economy = cityEconomy(state, rome);
    const aboutToGrow = withCity(state, rome.id, {
      queue: ['settler', 'scout'],
      productionStored: UNITS.settler.cost,
      foodStored: foodToGrow(1) - economy.foodSurplus,
    });

    const step = endTurnForAll(aboutToGrow);
    expect(step.events.map((addressed) => addressed.event.type)).toEqual(['cityGrew', 'unitBuilt', 'turnStarted']);
    expect(step.events[0].event).toMatchObject({ type: 'cityGrew', population: 2 });
    expect(step.events[1].event).toMatchObject({ type: 'unitBuilt', unitType: 'settler', queueEmpty: false });
    expect(unitsOf(step.state, 'p1', 'settler')).toHaveLength(1);
    // Grown to 2, and one citizen left with the Settler.
    expect(step.state.cities[rome.id]).toMatchObject({ population: 1, foodStored: 0, productionStored: economy.production });
    expect(queued(step.state, rome.id)).toEqual(['scout']);
  });

  it('held is about the first entry only: null for an empty queue and for an entry that is not paid for, the reason for one that is paid for and blocked', () => {
    const { state, rome } = romeGame();
    /** What the plan says of such a city; the owner's view must say the same. */
    const held = (queue: UnitTypeId[], productionStored: number, population = 1): unknown => {
      const situation = withCity(state, rome.id, { queue, productionStored, population });
      const answer = buildPlan(situation, situation.cities[rome.id]).held;
      expect(buildPlayerView(situation, 'p1').cities[0].own?.held).toBe(answer);
      return answer;
    };
    expect(held([], 0)).toBeNull();
    expect(held([], 1000)).toBeNull();
    expect(held(['settler'], UNITS.settler.cost - 1)).toBeNull();
    expect(held(['settler'], UNITS.settler.cost)).toBe('needsPopulation');
    expect(held(['settler'], 1000)).toBe('needsPopulation');
    expect(held(['settler'], UNITS.settler.cost, 2)).toBeNull();
    // Only the first entry counts: a blocked Settler further down holds nothing...
    expect(held(['warrior', 'settler'], 1000)).toBeNull();
    expect(held(['scout', 'settler', 'settler'], 1000)).toBeNull();
    // ...and a Settler in front holds the queue whatever stands behind it.
    expect(held(['settler', 'warrior'], 1000)).toBe('needsPopulation');
    expect(held(['warrior'], UNITS.warrior.cost)).toBeNull();
    expect(held(['worker'], UNITS.worker.cost)).toBeNull();
  });

  it('a Worker can be queued and built like any unit; it takes no citizen and has no job', () => {
    const { state, rome } = romeGame();
    const perTurn = cityEconomy(state, rome).production;
    const queuedUp = act(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf('worker') });
    const almost = withCity(queuedUp, rome.id, { productionStored: UNITS.worker.cost - perTurn });

    const done = endTurnForAll(almost);
    const worker = unitOf(done.state, 'p1', 'worker');
    expect(worker).toEqual({
      id: worker.id, type: 'worker', owner: 'p1', tile: rome.tile, movesLeft: UNITS.worker.moves, job: null,
    });
    expect(worker.id.startsWith('u1_')).toBe(true);
    expect(done.state.cities[rome.id]).toMatchObject({ population: 1, productionStored: 0, buildQueue: [] });
    expect(done.events[0].event).toMatchObject({ type: 'unitBuilt', unitType: 'worker', queueEmpty: true });
    // A civilian: it shares the city tile with the Warrior, and a second one has to stand next door.
    const second = endTurnForAll(withCity(done.state, rome.id, { queue: ['worker'], productionStored: UNITS.worker.cost })).state;
    const workers = unitsOf(second, 'p1', 'worker');
    expect(workers).toHaveLength(2);
    expect(workers[1].tile).not.toBe(rome.tile);
    expect(second.map.tiles[workers[1].tile].cityId).toBe(rome.id);
    // Its owner is offered the jobs; on the city tile none of them can be done.
    const own = buildPlayerView(done.state, 'p1').units.find((unit) => unit.id === worker.id)?.own;
    expect(own?.job).toBeNull();
    expect(own?.jobOptions.map((option) => option.error)).toEqual(['cityOnTile', 'cityOnTile']);
  });
});

/**
 * For the random games below: every hundredth attempt, every city finds 40
 * production in its store. Left to themselves, random players seldom have a
 * unit paid for long before the city can let it go; with a windfall now and
 * then, Settlers wait for citizens and queues are held, which is what these
 * tests want to look at. (Used as the `reload` of playRandomGame.)
 */
function windfall(state: GameState, index: number): GameState {
  if (index % 100 !== 99) return state;
  return arrange(state, (draft) => {
    for (const city of Object.values(draft.cities)) city.productionStored += 40;
  });
}

describe('the forecast: buildPlan', () => {
  it('every row\'s turns is the number of End Turns after which that unit really appears', LONG_TEST, () => {
    // A growing capital on open grassland, four mixed items with a Settler among them, some production stored.
    const { state, rome } = romeGame();
    for (const [queue, stored] of [
      [['warrior', 'settler', 'worker', 'scout'], 5],
      [['settler', 'settler', 'scout', 'warrior'], 0],
      [['worker', 'scout', 'scout', 'settler', 'warrior', 'worker'], 11],
      [['scout'], UNITS.scout.cost],
    ] as [UnitTypeId[], number][]) {
      const situation = withCity(state, rome.id, { queue, productionStored: stored });
      const forecast = rows(situation, rome.id);
      // Every row has a number here: the city grows, and the meadow has room.
      expect(forecast.every(([turns, wait]) => turns !== null && wait === null), queue.join()).toBe(true);

      const played = playUntilBuilt(situation, rome.id, queue.length);
      expect(played.completions, queue.join()).toEqual(queue.map((unitType, index) => ({ unitType, after: forecast[index][0] })));
      expect(queued(played.state, rome.id)).toEqual([]);
    }

    // And in the middle of random games: with nobody doing anything but End
    // Turn, every city completes its first entry exactly when its first row
    // says. (Later rows can be off by a turn where the land is crowded: a
    // unit completed earlier takes up room, and the forecast does not count
    // that. Jobs in progress are stopped for this check, for the same
    // reason: the forecast takes the land as it is.)
    let compared = 0;
    let waiting = 0;
    playRandomGame({
      start: newGame(WILDS, WILDS_STARTS, 'forecast'),
      seed: 'forecast-actions',
      turns: 24,
      wildShare: 0,
      onStep: (step) => {
        if (step.after.turn === step.before.turn || step.after.turn % 3 !== 0) return;
        const quiet = arrange(step.after, (draft) => {
          for (const unit of Object.values(draft.units)) unit.job = null;
        });
        const promised = new Map<string, number | null>();
        for (const city of Object.values(quiet.cities)) {
          const first = buildPlan(quiet, city).queue[0];
          if (first !== undefined) promised.set(city.id, first.turns);
        }
        const firstBuilt = new Map<string, number>();
        let current = quiet;
        for (let played = 1; played <= 12; played++) {
          const resolved = endTurnForAll(current);
          current = resolved.state;
          for (const { event } of resolved.events) {
            if (event.type === 'unitBuilt' && !firstBuilt.has(event.cityId)) firstBuilt.set(event.cityId, played);
          }
        }
        for (const [cityId, turns] of promised) {
          const what = `turn ${step.after.turn}, city ${cityId}`;
          if (turns !== null && turns <= 12) {
            expect(firstBuilt.get(cityId), what).toBe(turns);
            compared += 1;
          } else {
            // No number, or a later one: nothing appears in these twelve turns.
            expect(firstBuilt.has(cityId), what).toBe(false);
            waiting += 1;
          }
        }
      },
    });
    expect(compared).toBeGreaterThan(20);
    expect(compared + waiting).toBeGreaterThan(24);
  });

  it('growth is counted: in a new capital the queue Warrior, Scout, Settler says 8, 12, 20, and the queue Settler, Warrior, Scout says 12, 18, 21', () => {
    const { state, rome } = romeGame();
    // The capital of the example: one citizen, +2 food and +2 production a turn.
    expect(cityEconomy(state, rome)).toMatchObject({ foodSurplus: 2, production: 2 });

    const first = withCity(state, rome.id, { queue: ['warrior', 'scout', 'settler'] });
    expect(rows(first, rome.id)).toEqual([[8, null], [12, null], [20, null]]);
    // Eight turns, not nine: Rome has a second citizen after five. Dividing the cost by today's production would say 9.
    expect(Math.ceil(UNITS.warrior.cost / cityEconomy(state, rome).production)).toBe(9);

    const second = withCity(state, rome.id, { queue: ['settler', 'warrior', 'scout'] });
    expect(rows(second, rome.id)).toEqual([[12, null], [18, null], [21, null]]);
    // Nothing waits in either queue: the Settler is not paid for.
    expect(buildPlan(first, first.cities[rome.id]).held).toBeNull();
    expect(buildPlan(second, second.cities[rome.id]).held).toBeNull();

    // And that is what happens.
    expect(playUntilBuilt(first, rome.id, 3).completions.map((completion) => completion.after)).toEqual([8, 12, 20]);
    expect(playUntilBuilt(second, rome.id, 3).completions.map((completion) => completion.after)).toEqual([12, 18, 21]);
  });

  it('a city that cannot grow any more is forecast with the citizens\' first choice, and that is what happens', () => {
    // Plains by the sea: twelve plains, five coast and one ocean tile around
    // a city on plains. Seven citizens cannot find more food than they eat,
    // so they work seven plains tiles (cityEconomy, step 3): 16 production.
    const start = newGame(
      [
        'm m m m m m m',
        ' m m , , , m m',
        'm m p p , , m',
        ' m p p p p ~ m',
        'm m p p p p m',
        ' m m p p p m m',
        'm m m m m m m',
      ],
      [[3, 3]],
    );
    const founded = act(start, 'p1', { type: 'foundCity', unitId: unitOf(start, 'p1', 'settler').id });
    const cityId = Object.values(founded.cities)[0].id;
    const queue: UnitTypeId[] = ['warrior', 'worker', 'scout', 'warrior'];
    const state = withCity(founded, cityId, { population: 7, foodStored: 4, queue });

    const plan = buildPlan(state, state.cities[cityId]);
    expect(plan.economy).toEqual(cityEconomy(state, state.cities[cityId]));
    expect(plan.economy).toMatchObject({ production: 16, foodSurplus: -5 });
    const forecast = rows(state, cityId);
    expect(forecast.every(([turns, wait]) => turns !== null && wait === null)).toBe(true);
    // 16 a turn, as the first choice makes it; with the citizens at sea (6 a turn) the Warrior alone would take three turns.
    expect(forecast[0][0]).toBe(Math.ceil(UNITS.warrior.cost / 16));

    const played = playUntilBuilt(state, cityId, queue.length);
    expect(played.completions).toEqual(queue.map((unitType, index) => ({ unitType, after: forecast[index][0] })));
    // The city is as large as before, and its food store has run empty.
    expect(played.state.cities[cityId].population).toBe(7);
    expect(played.state.cities[cityId].foodStored).toBe(0);
  });

  it('a paid-for first entry says 1; the entries behind it follow, at least one turn apart', () => {
    const { state, rome } = romeGame();
    const paid = withCity(state, rome.id, { queue: ['scout', 'warrior', 'scout'], productionStored: UNITS.scout.cost });
    const forecast = rows(paid, rome.id);
    expect(forecast[0]).toEqual([1, null]);

    // However much is stored, a city completes one entry a turn: 1, 2, 3, ...
    const rich = withCity(state, rome.id, { queue: ['scout', 'warrior', 'scout', 'worker', 'scout'], productionStored: 5000 });
    expect(rows(rich, rome.id)).toEqual([[1, null], [2, null], [3, null], [4, null], [5, null]]);
    // The menu comes behind the queue: turn 6 for everything the city can release by then.
    const options = menu(rich, rome.id);
    expect(options[UNIT_TYPE_IDS.indexOf('warrior')]).toEqual([6, null]);
    expect(options[UNIT_TYPE_IDS.indexOf('worker')]).toEqual([6, null]);

    // In general the numbers of a queue rise strictly, whatever is stored.
    for (const stored of [0, 5, 17, 40, 200]) {
      const situation = withCity(state, rome.id, { queue: ['warrior', 'scout', 'scout', 'worker', 'warrior'], productionStored: stored });
      const numbers = rows(situation, rome.id).map(([turns]) => turns ?? 0);
      for (let index = 1; index < numbers.length; index++) expect(numbers[index], `${stored} stored`).toBeGreaterThan(numbers[index - 1]);
    }
  });

  it('a paid-for Settler in a city of 1 that will not grow has no number and says needsPopulation; every entry behind it says earlier; held is needsPopulation', () => {
    // Alone on a peak the city makes exactly what its one citizen eats.
    const { state, city } = peakCity('g');
    expect(cityEconomy(state, city).foodSurplus).toBe(0);
    const stuck = withCity(state, city.id, { queue: ['settler', 'warrior', 'scout'], productionStored: UNITS.settler.cost });

    const plan = buildPlan(stuck, stuck.cities[city.id]);
    expect(plan.queue.map((row) => [row.turns, row.wait])).toEqual([
      [null, 'needsPopulation'],
      [null, 'earlier'],
      [null, 'earlier'],
    ]);
    expect(plan.held).toBe('needsPopulation');
    // Nobody can say when anything added now would be done. (The boats have their own, lasting reason: the peak has no water.)
    expect(plan.options.map((option) => [option.turns, option.wait])).toEqual([...LAND_UNITS.map(() => [null, 'earlier']), ...DRY_BOATS]);
    // The costs are there all the same.
    expect(plan.queue.map((row) => row.cost)).toEqual([UNITS.settler.cost, UNITS.warrior.cost, UNITS.scout.cost]);

    // And it is true: fifty turns on, nothing has been built and the store has only grown.
    let current = stuck;
    for (let turn = 0; turn < RULES.forecastTurns; turn++) current = endTurnForAll(current).state;
    expect(unitsOf(current, 'p1')).toHaveLength(1);
    expect(queued(current, city.id)).toEqual(['settler', 'warrior', 'scout']);
    expect(current.cities[city.id].productionStored).toBeGreaterThan(UNITS.settler.cost);
  });

  it('held and a number together: a paid-for Settler in a city of 1 that grows when this turn resolves says 1, and held is needsPopulation', () => {
    const { state, rome } = romeGame();
    const surplus = cityEconomy(state, rome).foodSurplus;
    const aboutToGrow = withCity(state, rome.id, {
      queue: ['settler', 'warrior'],
      productionStored: UNITS.settler.cost,
      foodStored: foodToGrow(1) - surplus,
    });
    const plan = buildPlan(aboutToGrow, aboutToGrow.cities[rome.id]);
    // As the city is NOW it cannot release the Settler; the forecast sees it grow this very turn.
    expect(plan.held).toBe('needsPopulation');
    expect(plan.queue[0]).toMatchObject({ turns: 1, wait: null });
    expect(unitsOf(endTurnForAll(aboutToGrow).state, 'p1', 'settler')).toHaveLength(1);

    // Two turns of growing away: held all the same, and the number says when the wait is over.
    const later = withCity(aboutToGrow, rome.id, { foodStored: foodToGrow(1) - 2 * surplus });
    const laterPlan = buildPlan(later, later.cities[rome.id]);
    expect(laterPlan.held).toBe('needsPopulation');
    expect(laterPlan.queue[0]).toMatchObject({ turns: 2, wait: null });
    expect(playUntilBuilt(later, rome.id, 1).completions).toEqual([{ unitType: 'settler', after: 2 }]);
  });

  it('an entry that is not paid for is never held, whatever the population', () => {
    const { state, rome } = romeGame();
    for (const population of [1, 2, 5]) {
      for (const stored of [0, UNITS.settler.cost - 1]) {
        const situation = withCity(state, rome.id, { queue: ['settler', 'warrior'], productionStored: stored, population });
        expect(buildPlan(situation, situation.cities[rome.id]).held, `population ${population}, ${stored} stored`).toBeNull();
      }
    }
    // Also where the entry WILL be held as soon as it is paid for: on the
    // peak the forecast says needsPopulation, and held, which is about now, says nothing yet.
    const { state: peak, city } = peakCity('g');
    const unpaid = withCity(peak, city.id, { queue: ['settler'], productionStored: UNITS.settler.cost - 1 });
    const plan = buildPlan(unpaid, unpaid.cities[city.id]);
    expect(plan.held).toBeNull();
    expect(plan.queue[0]).toMatchObject({ turns: null, wait: 'needsPopulation' });
    // One turn later it is paid for, and held.
    const paid = endTurnForAll(unpaid).state;
    expect(buildPlan(paid, paid.cities[city.id]).held).toBe('needsPopulation');
  });

  it('an entry whose unit has no free tile on the map as it is says noRoom once the forecast has it paid for, and held says so when it is paid for now', () => {
    const { state, city } = peakCity('d', 'g');
    const crowded = arrange(state, (draft) => {
      placeUnit(draft, 'p1', 'scout', at(draft.map, 4, 3));
      draft.cities[city.id].buildQueue = queueOf('warrior', 'worker');
    });
    expect(findSpawnTile(crowded, crowded.cities[city.id], 'warrior')).toBeNull();

    // Not paid for: the forecast saves up, finds no tile, and says so. Nothing is held yet.
    const unpaid = buildPlan(crowded, crowded.cities[city.id]);
    expect(unpaid.queue.map((row) => [row.turns, row.wait])).toEqual([[null, 'noRoom'], [null, 'earlier']]);
    expect(unpaid.held).toBeNull();
    expect(unpaid.options.map((option) => option.wait)).toEqual([...LAND_UNITS.map(() => 'earlier'), ...BOATS.map(() => 'noRoom')]);

    // Paid for now: held.
    const paid = withCity(crowded, city.id, { productionStored: UNITS.warrior.cost });
    const paidPlan = buildPlan(paid, paid.cities[city.id]);
    expect(paidPlan.held).toBe('noRoom');
    expect(paidPlan.queue[0]).toMatchObject({ turns: null, wait: 'noRoom' });

    // The same city with the Worker first: a civilian fits into the city, so it has a number,
    // and the Warrior behind it is the entry without a tile.
    const workerFirst = withCity(paid, city.id, { queue: ['worker', 'warrior'], productionStored: UNITS.worker.cost });
    expect(rows(workerFirst, city.id)).toEqual([[1, null], [null, 'noRoom']]);
    expect(buildPlan(workerFirst, workerFirst.cities[city.id]).held).toBeNull();

    // A Settler that is paid for in a city of one with no room either: the citizen is named first.
    const both = arrange(crowded, (draft) => {
      placeUnit(draft, 'p1', 'worker', city.tile);
      placeUnit(draft, 'p1', 'worker', at(draft.map, 4, 3));
      draft.cities[city.id].buildQueue = queueOf('settler');
      draft.cities[city.id].productionStored = UNITS.settler.cost;
    });
    expect(buildPlan(both, both.cities[city.id]).held).toBe('needsPopulation');
    const twoCitizens = withCity(both, city.id, { population: 2 });
    expect(buildPlan(twoCitizens, twoCitizens.cities[city.id]).held).toBe('noRoom');
  });

  it('without production an unpaid entry says noProduction and a paid-for one says 1', () => {
    // No city makes 0 production with today's tables (the centre always
    // gives at least 1). Two table entries are set to 0 for a moment and put back.
    const desertBefore = TERRAIN.desert.yields.production;
    const minimumBefore = RULES.cityCenterMinYields.production;
    try {
      TERRAIN.desert.yields.production = 0;
      RULES.cityCenterMinYields.production = 0;
      const { state, city } = peakCity('d');
      expect(cityEconomy(state, city).production).toBe(0);

      const unpaid = withCity(state, city.id, { queue: ['warrior', 'scout'], productionStored: UNITS.warrior.cost - 1 });
      expect(rows(unpaid, city.id)).toEqual([[null, 'noProduction'], [null, 'earlier']]);
      expect(buildPlan(unpaid, unpaid.cities[city.id]).held).toBeNull();

      // What is stored still pays: the Scout is done when this turn resolves, and the Warrior behind it never.
      const paid = withCity(state, city.id, { queue: ['scout', 'warrior'], productionStored: UNITS.scout.cost });
      // (The city's own Warrior holds the only tile, so the paid-for unit must be a civilian to appear.)
      const paidCivilian = withCity(state, city.id, { queue: ['worker', 'warrior'], productionStored: UNITS.worker.cost });
      expect(rows(paidCivilian, city.id)).toEqual([[1, null], [null, 'noProduction']]);
      expect(rows(paid, city.id)).toEqual([[null, 'noRoom'], [null, 'earlier']]);
      // Behind a queue that runs out, the menu is forecast from an empty store: no production, no number.
      const onlyPaid = withCity(state, city.id, { queue: ['worker'], productionStored: UNITS.worker.cost });
      expect(menu(onlyPaid, city.id)).toEqual([...LAND_UNITS.map(() => [null, 'noProduction']), ...DRY_BOATS]);
      // With enough left over, an option is paid for too and says the turn
      // after the queue. (A second Worker would in fact find the first one
      // in its way: units completed in the forecast take up no room in it.)
      const leftOver = withCity(state, city.id, { queue: ['worker'], productionStored: UNITS.worker.cost + UNITS.worker.cost });
      expect(menu(leftOver, city.id)[UNIT_TYPE_IDS.indexOf('worker')]).toEqual([2, null]);
      expect(menu(leftOver, city.id)[UNIT_TYPE_IDS.indexOf('scout')]).toEqual([null, 'noRoom']); // the Warrior holds the only tile
    } finally {
      TERRAIN.desert.yields.production = desertBefore;
      RULES.cityCenterMinYields.production = minimumBefore;
    }
    expect(TERRAIN.desert.yields.production).toBe(desertBefore);
    expect(RULES.cityCenterMinYields.production).toBe(minimumBefore);
  });

  it('an entry that would take longer than RULES.forecastTurns says tooFar, and no number is ever larger than RULES.forecastTurns', () => {
    const { state, rome } = romeGame();
    const before = RULES.forecastTurns;
    try {
      // The table's number set to 5 for a moment: Rome makes 2 a turn (3 from the turn after it has grown).
      RULES.forecastTurns = 5;
      const far = withCity(state, rome.id, { queue: ['warrior', 'scout'] });
      expect(rows(far, rome.id)).toEqual([[null, 'tooFar'], [null, 'earlier']]);
      expect(menu(far, rome.id)).toEqual([...LAND_UNITS.map(() => [null, 'earlier']), ...DRY_BOATS]);
      expect(buildPlan(far, far.cities[rome.id]).held).toBeNull();

      // Exactly at the limit is still a number: 2 stored and five turns of 2 pay for the Scout's 12.
      const just = withCity(state, rome.id, { queue: ['scout'], productionStored: 2 });
      expect(rows(just, rome.id)).toEqual([[5, null]]);
      const justNot = withCity(state, rome.id, { queue: ['scout'], productionStored: 1 });
      expect(rows(justNot, rome.id)).toEqual([[null, 'tooFar']]);
      // The queue ran out at the limit: nothing can be said about the menu but "too far".
      expect(menu(just, rome.id)).toEqual([...LAND_UNITS.map(() => [null, 'tooFar']), ...DRY_BOATS]);

      // A rich city: one entry a turn, so the sixth row is beyond the limit although it is paid for.
      const rich = withCity(state, rome.id, { queue: ['scout', 'scout', 'scout', 'scout', 'scout', 'scout', 'scout'], productionStored: 5000 });
      expect(rows(rich, rome.id)).toEqual([[1, null], [2, null], [3, null], [4, null], [5, null], [null, 'tooFar'], [null, 'earlier']]);

      // With an empty queue the menu has the five turns to itself.
      const empty = withCity(state, rome.id, { productionStored: 4 });
      expect(menu(empty, rome.id)).toEqual([
        [null, 'tooFar'], // Warrior 18: 4 + 2 + 2 + 2 + 2 + 2 = 14
        [4, null], // Scout 12: 4 + 2 + 2 + 2 + 2
        [null, 'tooFar'], // Settler
        [null, 'tooFar'], // Worker 20
        ...DRY_BOATS, // not "too far": never, in a city without water
      ]);
    } finally {
      RULES.forecastTurns = before;
    }
    expect(RULES.forecastTurns).toBe(before);

    // With the real number: a full queue of Settlers in the new capital. Every number is at most the limit...
    const settlers = withCity(state, rome.id, { queue: ['settler', 'settler', 'settler', 'settler', 'settler', 'settler', 'settler', 'settler'] });
    const forecast = rows(settlers, rome.id);
    const numbers = forecast.filter(([turns]) => turns !== null).map(([turns]) => turns as number);
    expect(numbers.length).toBeGreaterThan(1);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(RULES.forecastTurns);
    // ...the first row without one says why, and the rows behind it say "earlier".
    const firstWithout = forecast.findIndex(([turns]) => turns === null);
    expect(firstWithout).toBeGreaterThan(0);
    expect(forecast[firstWithout][1]).toBe('tooFar');
    for (const [turns, wait] of forecast.slice(firstWithout + 1)) expect([turns, wait]).toEqual([null, 'earlier']);
  });

  it('turns is a number exactly when wait is null, for every row and every option, throughout a random game', LONG_TEST, () => {
    let rowsSeen = 0;
    let optionsSeen = 0;
    let heldSeen = 0;
    let appended = 0;
    let boatOptions = 0;
    let dryBoatOptions = 0;
    const waits = new Set<string>();
    const forecastTurnsOfTheTable = RULES.forecastTurns;

    const checkCity = (state: GameState, city: City): void => {
      const plan = buildPlan(state, city);
      const what = `turn ${state.turn}, city ${city.id}`;
      expect(plan.queue).toHaveLength(city.buildQueue.length);
      expect(plan.options.map((option) => option.item.unitType)).toEqual(UNIT_TYPE_IDS);
      let seenGap = false;
      plan.queue.forEach((row, index) => {
        expect(row.item, what).toEqual(city.buildQueue[index]);
        expect(row.cost, what).toBe(buildCost(city.buildQueue[index]));
        expect(row.turns !== null, what).toBe(row.wait === null);
        if (row.turns !== null) {
          expect(Number.isInteger(row.turns) && row.turns >= 1 && row.turns <= RULES.forecastTurns, what).toBe(true);
          expect(seenGap, `${what}: a number behind a row without one`).toBe(false);
        } else {
          // The first row without a number says why; the rows behind it say "earlier".
          expect(row.wait === 'earlier', what).toBe(seenGap);
          seenGap = true;
          waits.add(row.wait ?? '');
        }
        rowsSeen += 1;
      });
      const dry = !ownsWater(state, city);
      for (const option of plan.options) {
        expect(option.turns !== null, what).toBe(option.wait === null);
        if (option.turns !== null) expect(option.turns >= 1 && option.turns <= RULES.forecastTurns, what).toBe(true);
        if (dry && UNITS[option.item.unitType].domain === 'sea') {
          // A boat in a city without water: never, whatever the queue holds or how long it is.
          expect([option.turns, option.wait, option.addError], `${what}: ${option.item.unitType}`).toEqual([null, 'noRoom', 'noWaterForBoat']);
          dryBoatOptions += 1;
        } else {
          // Behind a queue that does not run out, nobody can say; otherwise "earlier" is never the reason.
          expect(option.wait === 'earlier', what).toBe(seenGap);
          expect(option.addError, what).toBe(city.buildQueue.length >= RULES.maxQueueLength ? 'queueFull' : null);
          if (UNITS[option.item.unitType].domain === 'sea') boatOptions += 1;
        }
        if (option.wait !== null) waits.add(option.wait);
        optionsSeen += 1;
      }
      // Held: exactly "the first entry is paid for and the city, as it is, cannot release it".
      const first = city.buildQueue[0];
      const paidFor = first !== undefined && city.productionStored >= buildCost(first);
      if (!paidFor) expect(plan.held, what).toBeNull();
      else if (city.population - UNITS[first.unitType].populationCost < 1) expect(plan.held, what).toBe('needsPopulation');
      else expect(plan.held, what).toBe(findSpawnTile(state, city, first.unitType) === null ? 'noRoom' : null);
      if (plan.held !== null) heldSeen += 1;
    };

    playRandomGame({
      start: newGame(WILDS, WILDS_STARTS, 'forecast-shape'),
      seed: 'forecast-shape-actions',
      turns: 30,
      wildShare: 10,
      reload: windfall,
      onStep: (step) => {
        if (!step.result.ok || !step.result.changed) return;
        for (const city of Object.values(step.after.cities)) checkCity(step.after, city);
        // The same with a forecast that looks only six turns ahead (the
        // table's number changed for a moment): now many rows are too far
        // away, and the rows behind them have to say "earlier".
        const usual = RULES.forecastTurns;
        try {
          RULES.forecastTurns = 6;
          for (const city of Object.values(step.after.cities)) checkCity(step.after, city);
        } finally {
          RULES.forecastTurns = usual;
        }

        // Now and then: an option is what the last row would say if the item were added.
        if (step.index % 40 !== 0) return;
        for (const city of Object.values(step.after.cities)) {
          if (city.buildQueue.length >= RULES.maxQueueLength) continue;
          const options = buildPlan(step.after, city).options;
          for (const option of options) {
            if (option.addError !== null) continue; // a boat in a city without water cannot be added: there is no such row
            const longer = arrange(step.after, (draft) => {
              draft.cities[city.id].buildQueue.push({ kind: 'unit', unitType: option.item.unitType });
            });
            const lastRow = buildPlan(longer, longer.cities[city.id]).queue[city.buildQueue.length];
            expect([lastRow.turns, lastRow.wait], `step ${step.index}, ${city.id}, ${option.item.unitType}`).toEqual([option.turns, option.wait]);
            appended += 1;
          }
        }
      },
    });

    expect(rowsSeen).toBeGreaterThan(2000);
    expect(optionsSeen).toBeGreaterThan(2000);
    expect(appended).toBeGreaterThan(100);
    // The game had cities by the water, whose boats are forecast like every unit, and cities without.
    expect(boatOptions).toBeGreaterThan(200);
    expect(dryBoatOptions).toBeGreaterThan(200);
    // The game met queues that wait right now, and rows of every kind that have no number.
    expect(heldSeen).toBeGreaterThan(0);
    expect([...waits].sort()).toEqual(expect.arrayContaining(['earlier', 'needsPopulation', 'tooFar']));
    expect(RULES.forecastTurns).toBe(forecastTurnsOfTheTable);
  });

  it('the options are forecast as if added to the end: with an empty queue they equal a queue of that one item; behind a queue they go on from the turn the queue runs out; behind a stuck queue they say earlier', () => {
    const { state, rome } = romeGame();
    const optionOf = (situation: GameState, unitType: UnitTypeId): [number | null, BuildWait | null] =>
      menu(situation, rome.id)[UNIT_TYPE_IDS.indexOf(unitType)];

    // An empty queue, with nothing and with something stored.
    for (const stored of [0, 9, 40]) {
      const empty = withCity(state, rome.id, { productionStored: stored });
      for (const unitType of LAND_UNITS) {
        const alone = withCity(empty, rome.id, { queue: [unitType] });
        expect(optionOf(empty, unitType), `${unitType}, ${stored} stored`).toEqual(rows(alone, rome.id)[0]);
      }
    }
    // The new capital's menu, in numbers: Warrior 8, Scout 6, Settler 12, Worker 9. No number for the boats: Rome owns no water.
    expect(menu(state, rome.id)).toEqual([[8, null], [6, null], [12, null], [9, null], ...DRY_BOATS]);

    // Behind a queue: each option is the row it would be.
    for (const queue of [['warrior'], ['warrior', 'scout'], ['settler', 'worker', 'scout'], ['scout', 'scout', 'scout', 'scout']] as UnitTypeId[][]) {
      const behind = withCity(state, rome.id, { queue, productionStored: 3 });
      const lastOfQueue = rows(behind, rome.id)[queue.length - 1][0] ?? 0;
      for (const unitType of LAND_UNITS) {
        const longer = withCity(behind, rome.id, { queue: [...queue, unitType] });
        const asRow = rows(longer, rome.id)[queue.length];
        expect(optionOf(behind, unitType), `${unitType} behind ${queue.join()}`).toEqual(asRow);
        // Later than everything queued, by at least a turn.
        expect(asRow[0]).toBeGreaterThan(lastOfQueue);
        // The rows in front of it are not moved by it.
        expect(rows(longer, rome.id).slice(0, queue.length)).toEqual(rows(behind, rome.id));
      }
    }
    // The example of the city panel: behind Warrior and Scout a Warrior is done in turn 18, not in 8.
    const example = withCity(state, rome.id, { queue: ['warrior', 'scout'] });
    expect(rows(example, rome.id)).toEqual([[8, null], [12, null]]);
    expect(optionOf(example, 'warrior')[0]).toBeGreaterThan(12);

    // Behind a queue that does not run out, nothing can be said.
    const { state: peak, city } = peakCity('g');
    const stuck = withCity(peak, city.id, { queue: ['settler'], productionStored: UNITS.settler.cost });
    expect(menu(stuck, city.id)).toEqual([...LAND_UNITS.map(() => [null, 'earlier']), ...DRY_BOATS]);
  });

  it('every option the city can build carries addError queueFull exactly when the queue holds RULES.maxQueueLength entries', () => {
    const { state, rome } = romeGame();
    for (let length = 0; length <= RULES.maxQueueLength; length++) {
      const queue = Array.from({ length }, (_, index): UnitTypeId => LAND_UNITS[index % LAND_UNITS.length]);
      const situation = withCity(state, rome.id, { queue });
      const options = buildPlan(situation, situation.cities[rome.id]).options;
      expect(options).toHaveLength(UNIT_TYPE_IDS.length);
      for (const option of options) {
        if (UNITS[option.item.unitType].domain === 'sea') continue; // Rome owns no water: the boats are the next block's
        expect(option.addError, `${length} entries`).toBe(length === RULES.maxQueueLength ? 'queueFull' : null);
      }
      // It is what the action answers: a list one longer is refused exactly when the menu says so.
      const longer = queueOf(...queue, 'scout');
      expect(refusal(situation, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: longer }), `${length} entries`).toBe(
        length === RULES.maxQueueLength ? 'queueFull' : null,
      );
    }
    // It is about the length only: a full queue that waits says the same.
    const waiting = withCity(state, rome.id, {
      queue: ['settler', 'settler', 'settler', 'settler', 'settler', 'settler', 'settler', 'settler'],
      productionStored: 1000,
    });
    expect(buildPlan(waiting, waiting.cities[rome.id]).options.map((option) => option.addError)).toEqual([
      ...LAND_UNITS.map(() => 'queueFull'),
      ...BOATS.map(() => 'noWaterForBoat'),
    ]);
  });

  it('buildPlan changes neither the state nor the city (deep-frozen input), gives the same answer twice, and its economy is cityEconomy', () => {
    const { state, rome } = romeGame();
    for (const situation of [
      state,
      withCity(state, rome.id, { queue: ['warrior', 'settler', 'scout', 'worker'], productionStored: 13, foodStored: 6 }),
      withCity(state, rome.id, { queue: ['settler'], productionStored: 500 }),
      withCity(state, rome.id, { queue: ['scout', 'scout', 'scout', 'scout', 'scout', 'scout', 'scout', 'scout'], population: 4 }),
    ]) {
      const frozen = deepFreeze(cloneJson(situation));
      const before = JSON.stringify(frozen);
      const city = frozen.cities[rome.id];

      const plan = buildPlan(frozen, city); // an edit of the frozen input would throw here
      expect(JSON.stringify(frozen)).toBe(before);
      const again = buildPlan(frozen, city);
      expect(again).toEqual(plan);
      expect(again).not.toBe(plan);
      expect(plan.economy).toEqual(cityEconomy(frozen, city));

      // Every item of the answer is a fresh object with exactly the two known fields.
      const items = [...plan.queue, ...plan.options].map((entry) => entry.item);
      expect(new Set(items).size).toBe(items.length);
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(['kind', 'unitType']);
        expect(city.buildQueue).not.toContain(item);
      }
      // So scribbling on the answer changes nothing in the game.
      for (const row of plan.queue) row.item.unitType = 'settler';
      plan.economy.worked.push(0);
      expect(JSON.stringify(frozen)).toBe(before);
      expect(buildPlan(frozen, city)).toEqual(again);
    }
  });

  it('runCityTurn on a copy of a city does to it exactly what resolveTurn does to the city, turn after turn, in a random game', LONG_TEST, () => {
    let citiesCompared = 0;
    let completions = 0;
    let growths = 0;
    let waits = 0;

    playRandomGame({
      start: newGame(WILDS, WILDS_STARTS, 'one-implementation'),
      seed: 'one-implementation-actions',
      turns: 30,
      wildShare: 10,
      reload: windfall,
      onStep: (step) => {
        if (step.after.turn === step.before.turn || !step.result.ok) return;
        // The turn resolved in this step. Do by hand, on a copy of the state
        // before it, what step 1 of resolveTurn does: every city in turn,
        // with the function the forecast uses, and each completed unit put
        // on its tile so that the next city finds the map as the engine did.
        const copy: GameState = cloneJson(step.before);
        const expectedEvents: unknown[] = [];
        const newUnits: { owner: PlayerId; type: UnitTypeId; tile: number }[] = [];
        for (const player of copy.players) {
          for (const city of Object.values(copy.cities).filter((candidate) => candidate.owner === player.id)) {
            const economy = cityEconomy(copy, city);
            const paidFor = city.buildQueue.length > 0 && city.productionStored + economy.production >= buildCost(city.buildQueue[0]);
            const turn = runCityTurn(city, economy, (unitType) => findSpawnTile(copy, city, unitType));
            if (turn.grew) {
              // The news names the size the city grew to, before a Settler of the same turn took a citizen along.
              const taken = turn.completed === null ? 0 : UNITS[turn.completed.unitType].populationCost;
              expectedEvents.push({ type: 'cityGrew', cityId: city.id, population: city.population + taken });
              growths += 1;
            }
            if (turn.completed !== null) {
              placeUnit(copy, city.owner, turn.completed.unitType, turn.completed.tile);
              newUnits.push({ owner: city.owner, type: turn.completed.unitType, tile: turn.completed.tile });
              expectedEvents.push({ type: 'unitBuilt', cityId: city.id, unitType: turn.completed.unitType, queueEmpty: city.buildQueue.length === 0 });
              completions += 1;
            } else if (paidFor) {
              waits += 1;
            }
          }
        }

        // The cities are exactly as the engine left them...
        expect(step.after.cities, `turn ${step.before.turn}`).toEqual(copy.cities);
        citiesCompared += Object.keys(copy.cities).length;
        // ...the new units are these, in this order, on these tiles...
        const created = Object.values(step.after.units).filter((unit) => !(unit.id in step.before.units));
        expect(created.map((unit) => ({ owner: unit.owner, type: unit.type, tile: unit.tile }))).toEqual(newUnits);
        for (const unit of created) expect(unit).toMatchObject({ movesLeft: UNITS[unit.type].moves, job: null });
        // ...and the news about cities is this, in this order.
        const cityEvents = step.result.events
          .map((addressed) => addressed.event)
          .filter((event) => event.type === 'cityGrew' || event.type === 'unitBuilt')
          .map((event) =>
            event.type === 'cityGrew'
              ? { type: event.type, cityId: event.cityId, population: event.population }
              : event.type === 'unitBuilt'
                ? { type: event.type, cityId: event.cityId, unitType: event.unitType, queueEmpty: event.queueEmpty }
                : null,
          );
        expect(cityEvents).toEqual(expectedEvents);
      },
    });

    expect(citiesCompared).toBeGreaterThan(100);
    expect(completions).toBeGreaterThan(10);
    expect(growths).toBeGreaterThan(5);
    expect(waits).toBeGreaterThan(0);
  });
});

describe('building boats (round 3)', () => {
  /**
   * Land in the north, the sea in the south, 12 x 9. Rome (p1) is founded
   * at (5,4), in the last row of land; p2's two units stand far away at
   * (10,1) and do nothing. Rome's water, seven tiles of one sea:
   *
   *   row 5   (3,5) (4,5) (5,5) (6,5)    coast; (4,5) and (5,5) touch the city
   *   row 6   (4,6) (5,6) (6,6)          coast
   *
   * Tile numbers are y * 12 + x: Rome 53; the water 63, 64, 65, 66 and 76,
   * 77, 78. In the order of rule B3 (nearer first, the HIGHER tile among
   * equals): 65, 64, then 78, 77, 76, 66, 63.
   */
  const SHORE: readonly string[] = [
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ' ~ g g g g g g g g g g ~',
    '~ g g g g g g g g g g ~',
    ' ~ g g g g g g g g g g ~',
    '~ g g g g g g g g g g ~',
    ' ~ , , , , , , , , , , ~',
    '~ , , , , , , , , , , ~',
    ' ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ];
  const SHORE_ORDER: readonly TileIndex[] = [65, 64, 78, 77, 76, 66, 63];

  function shoreGame(): { state: GameState; rome: City } {
    const start = newGame(SHORE, [[5, 4], [10, 1]]);
    const state = act(start, 'p1', { type: 'foundCity', unitId: unitOf(start, 'p1', 'settler').id });
    return { state, rome: cityOn(state, at(state.map, 5, 4)) };
  }

  /** A one-player game on a drawn map with the capital founded on the start tile. */
  function townOn(rows: readonly string[], x: number, y: number): { state: GameState; city: City } {
    const start = newGame(rows, [[x, y]]);
    const state = act(start, 'p1', { type: 'foundCity', unitId: unitOf(start, 'p1', 'settler').id });
    return { state, city: Object.values(state.cities)[0] };
  }

  /** The water tiles a city owns, ascending. */
  function waterOf(state: GameState, city: City): TileIndex[] {
    return state.map.tiles.map((_, tile) => tile).filter((tile) => state.map.tiles[tile].cityId === city.id && tileIsWater(state.map.tiles[tile]));
  }

  /**
   * Rule B3 for a boat, read a second time and plainly: the city's own
   * water tiles, the tile of the LARGER body of water first (a body: every
   * water tile that can be reached over water, on the whole map), then the
   * nearer tile, then the HIGHER tile. Every body is counted, always; the
   * engine counts only when it must, and has to give the same order.
   */
  function boatOrderByTheBook(state: GameState, city: City): TileIndex[] {
    const map = state.map;
    const bodySize = (from: TileIndex): number => {
      const seen = new Set<TileIndex>([from]);
      const waiting = [from];
      while (waiting.length > 0) {
        const tile = waiting.pop() as TileIndex;
        for (const next of neighbors(tile, map)) {
          if (seen.has(next) || !tileIsWater(map.tiles[next])) continue;
          seen.add(next);
          waiting.push(next);
        }
      }
      return seen.size;
    };
    return waterOf(state, city)
      .map((tile) => ({ tile, size: bodySize(tile), far: distance(city.tile, tile, map) }))
      .sort((a, b) => b.size - a.size || a.far - b.far || b.tile - a.tile)
      .map((entry) => entry.tile);
  }

  /**
   * The order in which the ENGINE hands a city's water tiles to boats of one
   * type: findSpawnTile is asked again and again, and each answer is taken
   * by a boat of that type, until it says "no room".
   */
  function boatOrderOfTheEngine(state: GameState, city: City, type: UnitTypeId): TileIndex[] {
    const order: TileIndex[] = [];
    let current = state;
    for (;;) {
      const tile = findSpawnTile(current, current.cities[city.id], type);
      if (tile === null) return order;
      // A tile that holds a boat of this type is never handed out again. If it is, the rule is
      // broken; say so instead of going round for ever (a test's time limit cannot stop a busy loop).
      if (order.includes(tile)) throw new Error(`findSpawnTile gave tile ${tile} to a second ${type} although one lies there`);
      order.push(tile);
      current = tamper(current, (draft) => {
        placeUnit(draft, city.owner, type, tile);
      });
    }
  }

  it('buildItemError: null for every land unit anywhere; null for a boat in a city that owns coast, or ocean only, also two tiles away across land; noWaterForBoat in a city without water', () => {
    const item = (unitType: UnitTypeId): BuildItem => ({ kind: 'unit', unitType });
    const peak = (row: string): { state: GameState; city: City } =>
      townOn(['m m m m m m m', ' m m m m m m m', 'm m m m m m m', row, 'm m m m m m m', ' m m m m m m m', 'm m m m m m m'], 3, 3);

    const towns: [string, { state: GameState; city: City }, number, RuleErrorCode | null][] = [
      ['on a shore, with seven coast tiles', (() => { const { state, rome } = shoreGame(); return { state, city: rome }; })(), 7, null],
      ['in the middle of a meadow', (() => { const { state, rome } = romeGame(); return { state, city: rome }; })(), 0, 'noWaterForBoat'],
      ['alone on a peak', peak(' m m m g m m m'), 0, 'noWaterForBoat'],
      ['with one coast tile next to it', peak(' m m m g , m m'), 1, null],
      ['with ocean only', peak(' m m m g ~ m m'), 1, null],
      ['with one water tile two tiles away, across its own land', peak(' m m m g g , m'), 1, null],
      ['with one ocean tile two tiles away', peak(' m m m g p ~ m'), 1, null],
    ];
    for (const [what, { state, city }, water, forBoats] of towns) {
      expect(waterOf(state, city), what).toHaveLength(water);
      // A land unit always: the city's own tile is land.
      for (const unitType of LAND_UNITS) expect(buildItemError(state, city, item(unitType)), `${unitType}, ${what}`).toBeNull();
      for (const unitType of BOATS) expect(buildItemError(state, city, item(unitType)), `${unitType}, ${what}`).toBe(forBoats);
      // The menu and the action ask the same function: they can never disagree.
      const options = buildPlan(state, city).options;
      for (const option of options) {
        const never = buildItemError(state, city, option.item);
        expect(option.addError, `${option.item.unitType}, ${what}`).toBe(never);
        expect(refusal(state, 'p1', { type: 'setBuildQueue', cityId: city.id, queue: [option.item] }), `${option.item.unitType}, ${what}`).toBe(never);
      }
    }

    // Units are not looked at: a harbour that is full is a wait, not a "never".
    const pond = peak(' m m m g , m m');
    const full = arrange(pond.state, (draft) => {
      placeUnit(draft, 'p1', 'fishingBoat', at(draft.map, 4, 3));
    });
    expect(findSpawnTile(full, full.cities[pond.city.id], 'fishingBoat')).toBeNull();
    expect(buildItemError(full, full.cities[pond.city.id], item('fishingBoat'))).toBeNull();
    expect(refusal(full, 'p1', { type: 'setBuildQueue', cityId: pond.city.id, queue: queueOf('fishingBoat') })).toBeNull();
    // Nor is the state changed by the question.
    const frozen = deepFreeze(cloneJson(full));
    const before = JSON.stringify(frozen);
    buildItemError(frozen, frozen.cities[pond.city.id], item('scoutBoat'));
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('setBuildQueue refuses a boat for a city without water (noWaterForBoat), after queueFull and cannotBuild, and stores nothing; the queue [a boat for a dry city, an entry that is no item] is answered cannotBuild in either order of the two; a stored queue that holds a boat in a dry city is refused noWaterForBoat when it is sent again unchanged', () => {
    const { state, rome } = romeGame();
    const before = withCity(state, rome.id, { queue: ['scout'], productionStored: 4 });
    const edit = (queue: unknown[], situation: GameState = before, playerId: PlayerId = 'p1'): RuleErrorCode | null =>
      refusal(situation, playerId, { type: 'setBuildQueue', cityId: rome.id, queue: queue as BuildItem[] });
    const boat = queueOf('fishingBoat')[0];
    const nonsense = { kind: 'unit', unitType: 'dragon' };

    // A boat alone, first, in the middle and last; either boat type.
    for (const list of [
      queueOf('fishingBoat'),
      queueOf('scoutBoat'),
      queueOf('fishingBoat', 'warrior'),
      queueOf('warrior', 'scoutBoat', 'scout'),
      queueOf('scout', 'settler', 'fishingBoat'),
      queueOf('scoutBoat', 'fishingBoat'),
    ]) {
      const result = send(before, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: list });
      expect(codeOf(result), JSON.stringify(list)).toBe('noWaterForBoat');
    }
    // Nothing was stored: not the boat, and not the good entries around it either.
    expect(queued(before, rome.id)).toEqual(['scout']);
    expect(before.cities[rome.id].productionStored).toBe(4);

    // The six steps of rule B2, each with everything wrong that comes after it.
    const tooLong = Array.from({ length: RULES.maxQueueLength + 1 }, () => boat);
    // 1. Whose city.
    expect(edit(tooLong, before, 'p2')).toBe('noSuchCity');
    expect(edit([nonsense, boat], before, 'p2')).toBe('noSuchCity');
    // 2. The length, before any entry is looked at.
    expect(edit(tooLong)).toBe('queueFull');
    expect(edit([...tooLong.slice(1), nonsense])).toBe('queueFull');
    // 3. Any entry that is no item, wherever the boat stands: ALL entries are looked at first.
    expect(edit([boat, nonsense])).toBe('cannotBuild');
    expect(edit([nonsense, boat])).toBe('cannotBuild');
    expect(edit([boat, boat, queueOf('warrior')[0], null])).toBe('cannotBuild');
    expect(edit(Array.from({ length: RULES.maxQueueLength }, (_, index) => (index === RULES.maxQueueLength - 1 ? nonsense : boat)))).toBe('cannotBuild');
    // 4. The boat this city can never build.
    expect(edit(Array.from({ length: RULES.maxQueueLength }, () => boat))).toBe('noWaterForBoat');
    // 5. The queue the city has: a no-op. 6. Another queue of things it can build: stored.
    const same = send(before, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf('scout') });
    expect(same.ok && !same.changed).toBe(true);
    expect(queued(act(before, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf('scout', 'worker') }), rome.id)).toEqual(['scout', 'worker']);

    // A queue that already HOLDS a boat in a dry city (a save edited by hand: the health check
    // lets it pass on purpose). Step 4 comes before step 5: sent again unchanged it is refused,
    // and so is every edit that keeps the boat. The player removes it.
    const parked = withCity(state, rome.id, { queue: ['warrior', 'fishingBoat', 'scout'] });
    expect(checkInvariants(parked)).toEqual([]);
    expect(edit(queueOf('warrior', 'fishingBoat', 'scout'), parked)).toBe('noWaterForBoat');
    expect(edit(queueOf('fishingBoat', 'warrior', 'scout'), parked)).toBe('noWaterForBoat');
    expect(edit(queueOf('warrior', 'fishingBoat'), parked)).toBe('noWaterForBoat');
    expect(queued(parked, rome.id)).toEqual(['warrior', 'fishingBoat', 'scout']);
    expect(edit(queueOf('warrior', 'scout'), parked)).toBeNull();
    // Left where it is, the boat waits for ever once it is first and paid for, and the view says so.
    const waiting = withCity(state, rome.id, { queue: ['fishingBoat', 'scout'], productionStored: UNITS.fishingBoat.cost });
    expect(buildPlan(waiting, waiting.cities[rome.id])).toMatchObject({ held: 'noRoom', queue: [{ turns: null, wait: 'noRoom' }, { turns: null, wait: 'earlier' }] });
    const later = endTurnForAll(endTurnForAll(waiting).state).state;
    expect(queued(later, rome.id)).toEqual(['fishingBoat', 'scout']);
    expect(unitsOf(later, 'p1', 'fishingBoat')).toEqual([]);

    // The general checks of applyAction come before all of it.
    const ended = act(before, 'p1', { type: 'endTurn' });
    expect(edit([boat], ended)).toBe('turnAlreadyEnded');
    expect(codeOf(send(before, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: [boat] }, before.turn + 1))).toBe('staleTurn');

    // And a city by the water takes every one of these lists (but the nonsense and the too long).
    const shore = shoreGame();
    for (const list of [queueOf('fishingBoat'), queueOf('warrior', 'scoutBoat', 'scout'), Array.from({ length: RULES.maxQueueLength }, () => boat)]) {
      const stored = act(shore.state, 'p1', { type: 'setBuildQueue', cityId: shore.rome.id, queue: list });
      expect(stored.cities[shore.rome.id].buildQueue).toEqual(list);
    }
    expect(refusal(shore.state, 'p1', { type: 'setBuildQueue', cityId: shore.rome.id, queue: tooLong })).toBe('queueFull');
    expect(refusal(shore.state, 'p1', { type: 'setBuildQueue', cityId: shore.rome.id, queue: [boat, nonsense] as BuildItem[] })).toBe('cannotBuild');
  });

  it('a finished boat appears on the nearest free water tile the city owns, the HIGHER tile among equals; never on the city tile, never on land', () => {
    const { state, rome } = shoreGame();
    const map = state.map;
    // The drawing is what the comment says: seven water tiles, two of them next to the city.
    expect(waterOf(state, rome)).toEqual([...SHORE_ORDER].sort((a, b) => a - b));
    expect(SHORE_ORDER.map((tile) => distance(rome.tile, tile, map))).toEqual([1, 1, 2, 2, 2, 2, 2]);
    expect([at(map, 5, 5), at(map, 4, 5)]).toEqual([65, 64]);
    expect(boatOrderByTheBook(state, rome)).toEqual(SHORE_ORDER);

    // Seven Fishing Boats, all paid for: one a turn, each on the next tile of the order.
    let current = withCity(state, rome.id, { queue: Array.from({ length: 8 }, (): UnitTypeId => 'fishingBoat'), productionStored: 8 * UNITS.fishingBoat.cost });
    const seen = new Set<string>();
    for (const [index, expected] of SHORE_ORDER.entries()) {
      expect(findSpawnTile(current, current.cities[rome.id], 'fishingBoat'), `boat ${index + 1}`).toBe(expected);
      // A Scout Boat is of the other class and would still take the first tile of all.
      expect(findSpawnTile(current, current.cities[rome.id], 'scoutBoat'), `boat ${index + 1}`).toBe(SHORE_ORDER[0]);
      const step = endTurnForAll(current);
      current = step.state;
      const built = unitsOf(current, 'p1', 'fishingBoat').filter((unit) => !seen.has(unit.id));
      expect(built, `boat ${index + 1}`).toHaveLength(1);
      seen.add(built[0].id);
      expect(built[0], `boat ${index + 1}`).toMatchObject({ tile: expected, movesLeft: UNITS.fishingBoat.moves, job: null });
      expect(step.events.filter((addressed) => addressed.event.type === 'unitBuilt')).toEqual([
        {
          to: ['p1'],
          event: { type: 'unitBuilt', playerId: 'p1', cityId: rome.id, cityName: rome.name, unitId: built[0].id, unitType: 'fishingBoat', queueEmpty: false },
        },
      ]);
    }

    // The eighth has no water left. It does not appear in the city (which has room for a
    // civilian: a Worker would stand there) and not on land: it waits.
    expect(findSpawnTile(current, current.cities[rome.id], 'fishingBoat')).toBeNull();
    expect(findSpawnTile(current, current.cities[rome.id], 'worker')).toBe(rome.tile);
    expect(buildPlan(current, current.cities[rome.id]).held).toBe('noRoom');
    const waited = endTurnForAll(current);
    expect(unitsOf(waited.state, 'p1', 'fishingBoat')).toHaveLength(7);
    expect(queued(waited.state, rome.id)).toEqual(['fishingBoat']);
    // It keeps its store: what was there (the eighth boat is paid for), and this turn's production on top.
    expect(current.cities[rome.id].productionStored).toBeGreaterThanOrEqual(UNITS.fishingBoat.cost);
    expect(waited.state.cities[rome.id].productionStored).toBe(
      current.cities[rome.id].productionStored + cityEconomy(current, current.cities[rome.id]).production,
    );
    // Every boat stands on water of the city's own, no two on one tile.
    const tiles = unitsOf(waited.state, 'p1', 'fishingBoat').map((unit) => unit.tile);
    expect(tiles).toEqual(SHORE_ORDER);
    for (const tile of tiles) expect(waited.state.map.tiles[tile]).toMatchObject({ terrain: 'coast', cityId: rome.id });

    // The Scout Boats take the same order among themselves.
    expect(boatOrderOfTheEngine(state, rome, 'scoutBoat')).toEqual(SHORE_ORDER);
    expect(boatOrderOfTheEngine(state, rome, 'fishingBoat')).toEqual(SHORE_ORDER);
  });

  it('a city that owns water of a large body and of a small one puts its boats on the large one, also when the small one is nearer; when every tile of the large one is taken, on the small one; a city whose water tiles lie in two pieces of ONE body orders them by distance alone; a city whose water tiles hang together gets the same order as a count of the bodies would give', LONG_TEST, () => {
    // A lake of one tile right next to the city, at (5,3); the sea two tiles away to the north, at (3,1), (4,1), (5,1).
    const lakeside = townOn(
      [
        '~ ~ ~ ~ ~ ~ ~ ~ ~',
        ' ~ ~ ~ ~ ~ ~ ~ ~ ~',
        '~ g g g g g g g ~',
        ' ~ g g g g , g g ~',
        '~ g g g g g g g ~',
        ' ~ g g g g g g g ~',
        '~ ~ ~ ~ ~ ~ ~ ~ ~',
      ],
      4,
      3,
    );
    const LAKE = at(lakeside.state.map, 5, 3);
    const SEA = [at(lakeside.state.map, 5, 1), at(lakeside.state.map, 4, 1), at(lakeside.state.map, 3, 1)];
    expect(waterOf(lakeside.state, lakeside.city)).toEqual([...SEA, LAKE].sort((a, b) => a - b));
    expect(distance(lakeside.city.tile, LAKE, lakeside.state.map)).toBe(1);
    for (const tile of SEA) expect(distance(lakeside.city.tile, tile, lakeside.state.map)).toBe(2);
    // Both boat types: the sea first, its higher tile first, and the lake only when the sea is full.
    for (const type of BOATS) {
      expect(findSpawnTile(lakeside.state, lakeside.city, type), type).toBe(SEA[0]);
      expect(boatOrderOfTheEngine(lakeside.state, lakeside.city, type), type).toEqual([...SEA, LAKE]);
    }
    expect(boatOrderByTheBook(lakeside.state, lakeside.city)).toEqual([...SEA, LAKE]);
    // Through the real turn: with three Fishing Boats on the sea tiles the fourth is born on the lake,
    // and a Scout Boat (the other class) still on the sea.
    const seaFull = arrange(lakeside.state, (draft) => {
      for (const tile of SEA) placeUnit(draft, 'p1', 'fishingBoat', tile);
      draft.cities[lakeside.city.id].buildQueue = queueOf('fishingBoat', 'scoutBoat');
      draft.cities[lakeside.city.id].productionStored = 1000;
    });
    const fourth = endTurnForAll(seaFull).state;
    expect(unitsOf(fourth, 'p1', 'fishingBoat').map((unit) => unit.tile).sort((a, b) => a - b)).toEqual([...SEA, LAKE].sort((a, b) => a - b));
    expect(unitOf(endTurnForAll(fourth).state, 'p1', 'scoutBoat').tile).toBe(SEA[0]);
    // A boat in a lake is a boat like any other: it nets the lake's coast inside its owner's borders.
    const onTheLake = unitsOf(fourth, 'p1', 'fishingBoat').find((unit) => unit.tile === LAKE);
    expect(refusal(fourth, 'p1', { type: 'startJob', unitId: onTheLake?.id ?? '', improvement: 'fishingNet' })).toBeNull();
    // The sea tiles of this city are open ocean: the boats born there can fish nothing where they lie.
    const atSea = unitsOf(fourth, 'p1', 'fishingBoat').find((unit) => unit.tile === SEA[0]);
    expect(refusal(fourth, 'p1', { type: 'startJob', unitId: atSea?.id ?? '', improvement: 'fishingNet' })).toBe('badImprovementTile');

    // A strip of land with the city on it: water to the west and to the east, joined only
    // round the ends of the strip, outside the city's land. One body in two pieces: the
    // nearer tile first whichever piece it is in, then the higher tile.
    const strip = townOn(
      [
        '~ ~ ~ ~ ~ ~ ~ ~ ~',
        ' ~ ~ ~ g g ~ ~ ~ ~',
        '~ ~ ~ g g g ~ ~ ~',
        ' ~ ~ ~ g g ~ ~ ~ ~',
        '~ ~ ~ g g ~ ~ ~ ~',
        ' ~ ~ ~ g g ~ ~ ~ ~',
        '~ ~ ~ g g g ~ ~ ~',
        ' ~ ~ ~ g g ~ ~ ~ ~',
        '~ ~ ~ ~ ~ ~ ~ ~ ~',
      ],
      4,
      4,
    );
    const stripMap = strip.state.map;
    const west = [at(stripMap, 2, 3), at(stripMap, 2, 4), at(stripMap, 2, 5)];
    const east = [at(stripMap, 5, 3), at(stripMap, 5, 4), at(stripMap, 6, 4), at(stripMap, 5, 5)];
    expect(waterOf(strip.state, strip.city)).toEqual([...west, ...east].sort((a, b) => a - b));
    // The two pieces do not touch inside the city's land...
    for (const tile of west) expect(neighbors(tile, stripMap).some((next) => east.includes(next))).toBe(false);
    // ...and the tile next to the city is in the east. Then: 50 (east), 47 (west), 42 (east), 38 (west), 32 (east), 29 (west).
    const expected = [at(stripMap, 5, 4), at(stripMap, 5, 5), at(stripMap, 2, 5), at(stripMap, 6, 4), at(stripMap, 2, 4), at(stripMap, 5, 3), at(stripMap, 2, 3)];
    expect(expected.map((tile) => distance(strip.city.tile, tile, stripMap))).toEqual([1, 2, 2, 2, 2, 2, 2]);
    expect(boatOrderOfTheEngine(strip.state, strip.city, 'fishingBoat')).toEqual(expected);
    expect(boatOrderOfTheEngine(strip.state, strip.city, 'scoutBoat')).toEqual(expected);
    expect(boatOrderByTheBook(strip.state, strip.city)).toEqual(expected);

    // 200 capitals of generated maps (fifty games of four): the engine, which counts the
    // bodies of water only where a city's water tiles do not hang together, gives every
    // capital the order the plain reading gives, for both boat types.
    let capitals = 0;
    let inTwoPieces = 0;
    let waterTiles = 0;
    for (let game = 0; game < 50; game++) {
      let state = createGame(setupFor(4, `boat-order-${game}`));
      for (const player of state.players) {
        state = act(state, player.id, { type: 'foundCity', unitId: unitOf(state, player.id, 'settler').id });
      }
      for (const city of Object.values(state.cities)) {
        const what = `boat-order-${game}, ${city.name}`;
        const byTheBook = boatOrderByTheBook(state, city);
        expect(byTheBook.length, what).toBeGreaterThanOrEqual(3); // rule H6 of the generator
        expect(boatOrderOfTheEngine(state, city, 'fishingBoat'), what).toEqual(byTheBook);
        expect(boatOrderOfTheEngine(state, city, 'scoutBoat'), what).toEqual(byTheBook);
        capitals += 1;
        waterTiles += byTheBook.length;
        // Do the city's water tiles hang together among themselves?
        const reached = new Set<TileIndex>([byTheBook[0]]);
        const waiting = [byTheBook[0]];
        while (waiting.length > 0) {
          for (const next of neighbors(waiting.pop() as TileIndex, state.map)) {
            if (reached.has(next) || !byTheBook.includes(next)) continue;
            reached.add(next);
            waiting.push(next);
          }
        }
        if (reached.size !== byTheBook.length) inTwoPieces += 1;
      }
    }
    expect(capitals).toBe(200);
    expect(waterTiles).toBeGreaterThan(800);
    // Both ways through the engine's code were taken: most capitals have their water in one piece, a few have not.
    expect(inTwoPieces).toBeGreaterThan(0);
    expect(inTwoPieces).toBeLessThan(40);

    // None of those 200 owns water of two bodies (about one capital in 360 does). So one that does,
    // from a generated map too: seat 2 of this game of six owns three tiles of the sea and one tile
    // of a lake of three. The lake's tile is as near as the nearest sea tile and has the higher
    // number: by "nearer, then higher" alone the first boat would be born on the lake. Its boats take the sea.
    // (If the map generator is changed and this capital is no longer such a one, the first lines
    // below say so: another seed has to be found then, with the scratch script of the round's notes.)
    let lakeGame = createGame({
      seed: 'r3-medium-6-18',
      settings: { mapSize: 'medium', turnMode: 'simultaneous' },
      players: SIX_PLAYERS.map((player) => ({ ...player })),
    });
    for (const player of lakeGame.players) {
      lakeGame = act(lakeGame, player.id, { type: 'foundCity', unitId: unitOf(lakeGame, player.id, 'settler').id });
    }
    const byTheLake = Object.values(lakeGame.cities).find((city) => city.owner === 'p2') as City;
    const itsOrder = boatOrderByTheBook(lakeGame, byTheLake);
    const far = (tile: TileIndex): number => distance(byTheLake.tile, tile, lakeGame.map);
    expect(itsOrder).toHaveLength(4);
    const lakeTile = itsOrder[3];
    for (const seaTile of itsOrder.slice(0, 3)) expect(neighbors(lakeTile, lakeGame.map)).not.toContain(seaTile);
    expect([...itsOrder].sort((a, b) => far(a) - far(b) || b - a)[0], 'nearer, then higher, alone').toBe(lakeTile);
    for (const type of BOATS) {
      expect(findSpawnTile(lakeGame, byTheLake, type), type).toBe(itsOrder[0]);
      expect(boatOrderOfTheEngine(lakeGame, byTheLake, type), type).toEqual(itsOrder);
    }
  });

  it('a boat may appear on water the city owns across a strip of land (no "joined" rule for boats); a land unit still may not appear across water, and still takes the LOWER tile among equals', () => {
    // A city behind its own beach: one water tile, two tiles away, land in between.
    const inland = townOn(['m m m m m m m', ' m m m m m m m', 'm m m m m m m', ' m m m g g , m', 'm m m m m m m', ' m m m m m m m', 'm m m m m m m'], 3, 3);
    const pond = at(inland.state.map, 5, 3);
    expect(distance(inland.city.tile, pond, inland.state.map)).toBe(2);
    expect(neighbors(inland.city.tile, inland.state.map).some((tile) => tileIsWater(inland.state.map.tiles[tile]))).toBe(false);
    for (const type of BOATS) expect(findSpawnTile(inland.state, inland.city, type), type).toBe(pond);
    const launched = endTurnForAll(withCity(inland.state, inland.city.id, { queue: ['fishingBoat'], productionStored: UNITS.fishingBoat.cost })).state;
    expect(unitOf(launched, 'p1', 'fishingBoat').tile).toBe(pond);

    // A city on a channel: its own land goes on beyond the water, at (2,1), (3,1) and (4,1).
    // The channel, (2,2) to (5,2), is its water. Mountains everywhere else.
    const channel = townOn(
      [
        '~ ~ ~ ~ ~ ~ ~',
        ' ~ g g g g ~ ~',
        '~ , , , , , ~',
        ' ~ m g g g m ~',
        '~ m m m m m ~',
        ' ~ ~ ~ ~ ~ ~ ~',
      ],
      3,
      3,
    );
    const map = channel.state.map;
    const city = channel.city;
    const farBank = [at(map, 2, 1), at(map, 3, 1), at(map, 4, 1)];
    for (const tile of farBank) expect(map.tiles[tile]).toMatchObject({ terrain: 'grassland', cityId: city.id });
    const westOfCity = at(map, 2, 3);
    const eastOfCity = at(map, 4, 3);
    expect(westOfCity).toBeLessThan(eastOfCity);

    // Land units: the city tile (the starting Warrior holds it for soldiers), then the two
    // neighbors on this side, the LOWER tile first; never the land across the water.
    const landOrder: TileIndex[] = [];
    let current = channel.state;
    for (;;) {
      const tile = findSpawnTile(current, current.cities[city.id], 'warrior');
      if (tile === null) break;
      if (landOrder.includes(tile)) throw new Error(`findSpawnTile gave tile ${tile} to a second Warrior although one stands there`);
      landOrder.push(tile);
      current = tamper(current, (draft) => {
        placeUnit(draft, 'p1', 'warrior', tile);
      });
    }
    expect(landOrder).toEqual([westOfCity, eastOfCity]);
    // Three Warriors paid for: two appear, the third waits although the far bank is the city's and empty.
    const crowded = withCity(channel.state, city.id, { queue: ['warrior', 'warrior', 'warrior'], productionStored: 3 * UNITS.warrior.cost });
    let played = crowded;
    for (let turn = 0; turn < 4; turn++) played = endTurnForAll(played).state;
    expect(unitsOf(played, 'p1', 'warrior').map((unit) => unit.tile)).toEqual([city.tile, westOfCity, eastOfCity]);
    expect(queued(played, city.id)).toEqual(['warrior']);
    expect(buildPlan(played, played.cities[city.id]).held).toBe('noRoom');
    for (const tile of farBank) expect(Object.values(played.units).some((unit) => unit.tile === tile)).toBe(false);

    // Boats, in the same crowded city: onto the channel, the nearer tiles first, the HIGHER of the two that touch the city.
    const touching = [at(map, 4, 2), at(map, 3, 2)];
    for (const tile of touching) expect(distance(city.tile, tile, map)).toBe(1);
    expect(boatOrderOfTheEngine(played, played.cities[city.id], 'fishingBoat').slice(0, 2)).toEqual(touching);
    expect(boatOrderOfTheEngine(played, played.cities[city.id], 'fishingBoat')).toEqual(boatOrderByTheBook(played, played.cities[city.id]));
  });

  /**
   * Rome at (3,3) behind one tile of its own land, with two water tiles in
   * its borders, (5,2) and (5,3), on a bay that goes on to the east outside
   * them. p2's units stand on the far shore at (9,3) and found nothing.
   */
  const BAY: readonly string[] = [
    'm m m m m m m m m m m',
    ' m m m m m m m m m m m',
    'm m m m m , , m m m m',
    ' m m m g g , , , g g m',
    'm m m m m m m m m m m',
    ' m m m m m m m m m m m',
  ];

  function bayGame(): { state: GameState; rome: City; berths: TileIndex[]; outside: TileIndex } {
    const start = newGame(BAY, [[3, 3], [9, 3]]);
    const state = act(start, 'p1', { type: 'foundCity', unitId: unitOf(start, 'p1', 'settler').id });
    const rome = cityOn(state, at(state.map, 3, 3));
    const berths = [at(state.map, 5, 2), at(state.map, 5, 3)];
    expect(waterOf(state, rome)).toEqual(berths);
    return { state, rome, berths, outside: at(state.map, 6, 3) };
  }

  it('with every water tile of the city taken by boats of that class, or by another player\'s boats, the entry is held (noRoom), keeps its store, and is completed the turn after one sails away; a boat of the other class does not hold it', () => {
    const { state, rome, berths, outside } = bayGame();
    const perTurn = cityEconomy(state, rome).production;
    const paid = withCity(state, rome.id, { queue: ['fishingBoat', 'warrior'], productionStored: UNITS.fishingBoat.cost + 5 });

    // The player's own Fishing Boats lie on both tiles.
    let firstId = '';
    const ownFull = arrange(paid, (draft) => {
      firstId = placeUnit(draft, 'p1', 'fishingBoat', berths[1]).id;
      placeUnit(draft, 'p1', 'fishingBoat', berths[0]);
    });
    expect(findSpawnTile(ownFull, ownFull.cities[rome.id], 'fishingBoat')).toBeNull();
    const own = buildPlayerView(ownFull, 'p1').cities[0].own;
    expect(own?.held).toBe('noRoom');
    expect(own?.buildQueue.map((row) => [row.turns, row.wait])).toEqual([[null, 'noRoom'], [null, 'earlier']]);

    // Two turns: nothing is completed, nothing is lost, the Warrior behind the boat is not looked at, and nobody is told anything.
    let held = ownFull;
    for (let turn = 1; turn <= 2; turn++) {
      const step = endTurnForAll(held);
      held = step.state;
      expect(unitsOf(held, 'p1', 'fishingBoat')).toHaveLength(2);
      expect(queued(held, rome.id)).toEqual(['fishingBoat', 'warrior']);
      expect(held.cities[rome.id].productionStored).toBe(UNITS.fishingBoat.cost + 5 + turn * perTurn);
      expect(step.events.map((addressed) => addressed.event.type)).toEqual(['turnStarted']);
    }

    // One boat sails out of the borders. The turn after, the new boat is there, on the tile that was left.
    const sailed = act(held, 'p1', { type: 'moveUnit', unitId: firstId, path: [outside] });
    expect(sailed.map.tiles[outside].cityId).toBeNull();
    expect(buildPlan(sailed, sailed.cities[rome.id]).held).toBeNull();
    expect(buildPlan(sailed, sailed.cities[rome.id]).queue[0]).toMatchObject({ turns: 1, wait: null });
    const done = endTurnForAll(sailed);
    expect(unitsOf(done.state, 'p1', 'fishingBoat').map((unit) => unit.tile).sort((a, b) => a - b)).toEqual([...berths, outside].sort((a, b) => a - b));
    expect(queued(done.state, rome.id)).toEqual(['warrior']);
    // The store paid for the boat once, and kept the rest.
    expect(done.state.cities[rome.id].productionStored).toBe(5 + 3 * perTurn);
    expect(done.events.map((addressed) => addressed.event.type)).toEqual(['unitBuilt', 'turnStarted']);

    // A boat of the OTHER class does not hold it: with two Scout Boats on the two tiles the Fishing Boat is completed at once...
    const scoutsThere = arrange(paid, (draft) => {
      for (const tile of berths) placeUnit(draft, 'p1', 'scoutBoat', tile);
    });
    expect(buildPlan(scoutsThere, scoutsThere.cities[rome.id]).held).toBeNull();
    expect(unitOf(endTurnForAll(scoutsThere).state, 'p1', 'fishingBoat').tile).toBe(berths[1]);
    // ...and a Scout Boat is held by them, not by Fishing Boats.
    const scoutQueued = withCity(scoutsThere, rome.id, { queue: ['scoutBoat'], productionStored: UNITS.scoutBoat.cost });
    expect(buildPlan(scoutQueued, scoutQueued.cities[rome.id]).held).toBe('noRoom');
    const scoutBehindFishers = withCity(ownFull, rome.id, { queue: ['scoutBoat'], productionStored: UNITS.scoutBoat.cost });
    expect(buildPlan(scoutBehindFishers, scoutBehindFishers.cities[rome.id]).held).toBeNull();

    // Another player's boats, whatever their class, hold both of the city's boat types (rule M8 lets them lie there).
    for (const foreignType of BOATS) {
      for (const wanted of BOATS) {
        const blockaded = arrange(withCity(state, rome.id, { queue: [wanted], productionStored: UNITS[wanted].cost }), (draft) => {
          for (const tile of berths) placeUnit(draft, 'p2', foreignType, tile);
        });
        const what = `a ${wanted} behind two foreign ${foreignType}s`;
        expect(findSpawnTile(blockaded, blockaded.cities[rome.id], wanted), what).toBeNull();
        expect(buildPlan(blockaded, blockaded.cities[rome.id]).held, what).toBe('noRoom');
        const after = endTurnForAll(blockaded).state;
        expect(unitsOf(after, 'p1', wanted), what).toEqual([]);
        expect(after.cities[rome.id].productionStored, what).toBe(UNITS[wanted].cost + perTurn);
        // It is a wait, not a "never": the menu still offers the boat, and the queue may hold it.
        expect(buildItemError(blockaded, blockaded.cities[rome.id], { kind: 'unit', unitType: wanted }), what).toBeNull();
      }
    }
    // One foreign boat on one of the two tiles holds nothing: the new boat takes the other.
    const oneGuest = arrange(paid, (draft) => {
      placeUnit(draft, 'p2', 'scoutBoat', berths[1]);
    });
    expect(unitOf(endTurnForAll(oneGuest).state, 'p1', 'fishingBoat').tile).toBe(berths[0]);
    // On land this cannot stop a city: the city tile itself takes the new unit.
    const landQueued = arrange(withCity(state, rome.id, { queue: ['worker'], productionStored: UNITS.worker.cost }), (draft) => {
      for (const tile of berths) placeUnit(draft, 'p2', 'scoutBoat', tile);
    });
    expect(unitOf(endTurnForAll(landQueued).state, 'p1', 'worker').tile).toBe(rome.tile);
  });

  it('the menu of a city without water: the boats carry noWaterForBoat, no turns and noRoom; the four land units are forecast as today', () => {
    const { state, rome } = romeGame();
    expect(ownsWater(state, rome)).toBe(false);
    const dryBoat = (unitType: UnitTypeId) => ({ item: { kind: 'unit', unitType }, cost: UNITS[unitType].cost, turns: null, wait: 'noRoom', addError: 'noWaterForBoat' });
    const landUnit = (unitType: UnitTypeId, turns: number) => ({ item: { kind: 'unit', unitType }, cost: UNITS[unitType].cost, turns, wait: null, addError: null });

    // The new capital: Warrior 8, Scout 6, Settler 12, Worker 9, the numbers of round 2.
    const options = buildPlan(state, rome).options;
    expect(options).toEqual([
      landUnit('warrior', 8),
      landUnit('scout', 6),
      landUnit('settler', 12),
      landUnit('worker', 9),
      dryBoat('fishingBoat'),
      dryBoat('scoutBoat'),
    ]);
    // The owner's view carries exactly that; one option per unit type, always.
    expect(buildPlayerView(state, 'p1').cities[0].own?.buildOptions).toEqual(options);

    // Whatever the queue holds and whatever is stored, the boats' entries do not change, and the land units are forecast behind the queue.
    for (const [queue, stored] of [[['warrior', 'scout'], 3], [['settler'], UNITS.settler.cost], [[], 500]] as [UnitTypeId[], number][]) {
      const situation = withCity(state, rome.id, { queue, productionStored: stored });
      const plan = buildPlan(situation, situation.cities[rome.id]);
      expect(plan.options.slice(LAND_UNITS.length), queue.join()).toEqual([dryBoat('fishingBoat'), dryBoat('scoutBoat')]);
      expect(plan.options.slice(0, LAND_UNITS.length).map((option) => option.item.unitType)).toEqual(LAND_UNITS);
      for (const option of plan.options.slice(0, LAND_UNITS.length)) {
        const longer = withCity(situation, rome.id, { queue: [...queue, option.item.unitType] });
        expect([option.turns, option.wait], `${option.item.unitType} behind ${queue.join()}`).toEqual(rows(longer, rome.id)[queue.length]);
        expect(option.addError).toBeNull();
      }
    }

    // The same city drawn one row lower, where its land reaches the sea: every option is offered, with a number.
    const shore = shoreGame();
    for (const option of buildPlan(shore.state, shore.rome).options) {
      expect(option.addError, option.item.unitType).toBeNull();
      expect(option.wait, option.item.unitType).toBeNull();
      expect(option.turns, option.item.unitType).toBeGreaterThanOrEqual(1);
    }
    // A boat is forecast like any unit: alone in the queue it is the row its option promised, and it comes when the row says.
    const boatFirst = withCity(shore.state, shore.rome.id, { queue: ['fishingBoat'] });
    const promised = rows(boatFirst, shore.rome.id)[0][0];
    expect(promised).toBe(buildPlan(shore.state, shore.rome).options[UNIT_TYPE_IDS.indexOf('fishingBoat')].turns);
    expect(playUntilBuilt(boatFirst, shore.rome.id, 1).completions).toEqual([{ unitType: 'fishingBoat', after: promised }]);
  });

  it('the menu with a full queue in a city with water: every option says queueFull; without water the boats still say noWaterForBoat', () => {
    const full: UnitTypeId[] = ['scout', 'fishingBoat', 'scout', 'scoutBoat', 'scout', 'scout', 'worker', 'scout'];
    expect(full).toHaveLength(RULES.maxQueueLength);

    // By the water: the queue holds boats, and nothing more can be added, boat or not.
    const shore = shoreGame();
    const wet = act(shore.state, 'p1', { type: 'setBuildQueue', cityId: shore.rome.id, queue: queueOf(...full) });
    const wetOptions = buildPlan(wet, wet.cities[shore.rome.id]).options;
    expect(wetOptions.map((option) => option.addError)).toEqual(UNIT_TYPE_IDS.map(() => 'queueFull'));
    // Greyed for a reason that will pass: the forecast is still there for every option.
    for (const option of wetOptions) expect(option.turns === null, option.item.unitType).toBe(option.wait !== null);
    expect(wetOptions.some((option) => option.wait === 'noRoom')).toBe(false);
    for (const unitType of UNIT_TYPE_IDS) {
      expect(refusal(wet, 'p1', { type: 'setBuildQueue', cityId: shore.rome.id, queue: queueOf(...full, unitType) }), unitType).toBe('queueFull');
    }

    // Inland: the land units say the queue is full, the boats that the city has no water. The
    // lasting reason is named in the menu, where the full queue will pass...
    const { state, rome } = romeGame();
    const dry = withCity(state, rome.id, { queue: Array.from({ length: RULES.maxQueueLength }, (): UnitTypeId => 'scout') });
    expect(buildPlan(dry, dry.cities[rome.id]).options.map((option) => [option.item.unitType, option.addError])).toEqual([
      ...LAND_UNITS.map((type) => [type, 'queueFull']),
      ...BOATS.map((type) => [type, 'noWaterForBoat']),
    ]);
    // ...while the action, asked for a list that is too long AND holds a boat, names the length first (rule B2).
    const eight = dry.cities[rome.id].buildQueue;
    expect(refusal(dry, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: [...eight, ...queueOf('fishingBoat')] })).toBe('queueFull');
    expect(refusal(dry, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: [...eight.slice(1), ...queueOf('fishingBoat')] })).toBe('noWaterForBoat');
    // Either way the option's addError is not null exactly when adding the item is refused.
    for (const situation of [dry, wet]) {
      const city = Object.values(situation.cities)[0];
      for (const option of buildPlan(situation, city).options) {
        const added = [...city.buildQueue, option.item];
        expect(refusal(situation, 'p1', { type: 'setBuildQueue', cityId: city.id, queue: added }) !== null, option.item.unitType).toBe(option.addError !== null);
      }
    }
  });
});
