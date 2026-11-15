import { describe, expect, it } from 'vitest';
import {
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  RULES,
  STATE_SCHEMA,
  UNITS,
  UNIT_TYPE_IDS,
  applyAction,
  buildPlan,
  buildPlayerView,
  cityCenterYields,
  cityEconomy,
  cloneJson,
  createGame,
  improvementFits,
  improvementSiteError,
  jobOptions,
  jobView,
  runCityTurn,
  siteInView,
  siteOfTile,
  startJobError,
  tileIndex,
  tileYields,
  updateKnowledge,
} from '../src/index';
import type {
  Action,
  BuildItem,
  City,
  CityEconomy,
  GameState,
  ImprovementSite,
  PlayerId,
  TileIndex,
  Unit,
  UnitTypeId,
} from '../src/index';
import { mapFromAscii } from '../src/testing';

/**
 * The functions the queue and the Worker stand on, each called directly: the
 * city economy, one turn of a city (runCityTurn), the forecast (buildPlan),
 * the improvement rules (improvementSiteError and its two ways of reading a
 * site) and the new fields of a view. These were the first tests of that
 * code, written together with it and before any action could reach it.
 *
 * The file stands on its own on purpose (it does not use rulesKit.ts): it
 * arranges its situations by hand and never sends an action for a queue or
 * a job. The same rules are tested through the real actions, and at length,
 * in rulesCity, rulesQueue, rulesJobs and the visibility test files.
 */

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const PLAYERS: readonly { id: PlayerId; name: string; civ: 'rome' | 'egypt' | 'china' | 'mali' }[] = [
  { id: 'p1', name: 'Ada', civ: 'rome' },
  { id: 'p2', name: 'Ben', civ: 'egypt' },
  { id: 'p3', name: 'Cleo', civ: 'china' },
  { id: 'p4', name: 'Dana', civ: 'mali' },
];

/** A game on a drawn map: one player per start position, each with the usual Settler and Warrior there. */
function gameOn(rows: readonly string[], starts: readonly [x: number, y: number][]): GameState {
  return createGame(
    {
      seed: 'contracts',
      settings: { mapSize: 'small', turnMode: 'simultaneous' },
      players: PLAYERS.slice(0, starts.length).map((player) => ({ ...player })),
    },
    () => {
      const map = mapFromAscii(rows);
      return { map, starts: starts.map(([x, y]) => tileIndex({ x, y }, map)) };
    },
  );
}

/** Sends an action that must be accepted, and returns the new state. */
function act(state: GameState, playerId: PlayerId, action: Action): GameState {
  const result = applyAction(state, playerId, state.turn, action);
  if (!result.ok) throw new Error(`${action.type} of ${playerId} was refused: ${result.error.code}`);
  return result.state;
}

/** The player's Settler founds a city where it stands (the real action). */
function foundCapital(state: GameState, playerId: PlayerId): GameState {
  const settler = Object.values(state.units).find((unit) => unit.owner === playerId && unit.type === 'settler');
  if (settler === undefined) throw new Error(`${playerId} has no Settler`);
  return act(state, playerId, { type: 'foundCity', unitId: settler.id });
}

/** A changed copy of a state, with the fog-of-war memory brought up to date. */
function arranged(state: GameState, change: (draft: GameState) => void): GameState {
  const draft = cloneJson(state);
  change(draft);
  updateKnowledge(draft);
  return draft;
}

/** The player's only city. */
function cityOf(state: GameState, playerId: PlayerId): City {
  const cities = Object.values(state.cities).filter((city) => city.owner === playerId);
  if (cities.length !== 1) throw new Error(`expected one city of ${playerId}, found ${cities.length}`);
  return cities[0];
}

function item(unitType: UnitTypeId): BuildItem {
  return { kind: 'unit', unitType };
}

/** A meadow of open grassland, 16 x 11, with water all around. */
const MEADOW: readonly string[] = [
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ' ~ g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g ~',
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
];

// ---------------------------------------------------------------------------
// 1. Citizens
// ---------------------------------------------------------------------------

describe('contracts: the city economy', () => {
  /**
   * Rome in the middle (x 2, y 2). Its land that a citizen can work: two
   * open grassland tiles above it, coast to its left, forest to its right
   * and hills below it. Everything else is mountains, which nobody works.
   */
  const ROWS: readonly string[] = [
    'm m m m m',
    ' m g g m m',
    'm , g f m',
    ' m h m m m',
    'm m m m m',
  ];
  const size = { width: 5, height: 5 };
  const GRASS_A = tileIndex({ x: 1, y: 1 }, size);
  const GRASS_B = tileIndex({ x: 2, y: 1 }, size);
  const COAST = tileIndex({ x: 1, y: 2 }, size);
  const FOREST = tileIndex({ x: 3, y: 2 }, size);
  const HILLS = tileIndex({ x: 1, y: 3 }, size);

  /** Rome with three citizens and a mine on its hills. */
  function romeWithMine(): GameState {
    return arranged(foundCapital(gameOn(ROWS, [[2, 2]]), 'p1'), (draft) => {
      cityOf(draft, 'p1').population = 3;
      draft.map.tiles[HILLS].improvement = 'mine';
    });
  }

  it('cityEconomy gives up a mine for coast when the city would not grow', () => {
    const state = romeWithMine();
    const rome = cityOf(state, 'p1');
    // The land is what the drawing says: all five tiles are Rome's.
    for (const tile of [GRASS_A, GRASS_B, COAST, FOREST, HILLS]) expect(state.map.tiles[tile].cityId).toBe(rome.id);

    // First choice: grassland, grassland and the mined hill (3 each in total),
    // which is 2 + 2 + 2 + 0 = 6 food for 6 eaten: the city would stand still.
    // So the mine (no food) is given up for the coast (2 food).
    expect(cityEconomy(state, rome)).toEqual({
      worked: [GRASS_A, GRASS_B, COAST],
      food: 8,
      production: 3,
      foodSurplus: 2,
    });

    // Once a farm lets the city afford it, the mine is worked.
    const withFarm = arranged(state, (draft) => {
      draft.map.tiles[GRASS_A].improvement = 'farm';
    });
    expect(cityEconomy(withFarm, cityOf(withFarm, 'p1'))).toEqual({
      worked: [GRASS_A, GRASS_B, HILLS],
      food: 7,
      production: 6,
      foodSurplus: 1,
    });

    // A city that grows anyway keeps the first choice: with two citizens
    // both work grassland and the surplus is 2.
    const smaller = arranged(state, (draft) => {
      cityOf(draft, 'p1').population = 2;
    });
    expect(cityEconomy(smaller, cityOf(smaller, 'p1'))).toEqual({
      worked: [GRASS_A, GRASS_B],
      food: 6,
      production: 3,
      foodSurplus: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// 2. One turn of a city
// ---------------------------------------------------------------------------

describe('contracts: one turn of a city', () => {
  function city(fields: Partial<City>): City {
    return {
      id: 'c1_test01', owner: 'p1', name: 'Rome', tile: 0, population: 1, foodStored: 0, buildQueue: [], productionStored: 0,
      ...fields,
    };
  }
  /** An economy that neither feeds nor starves the city and makes 3 production. */
  const steady: CityEconomy = { worked: [], food: 2, production: 3, foodSurplus: 0 };

  it('runCityTurn: an empty queue loses the production; a paid-for Settler in a city of 1 stays first and the store keeps growing', () => {
    // An empty queue: nothing is added, what is stored stays.
    const idle = city({ productionStored: 7 });
    expect(runCityTurn(idle, steady, () => 5)).toEqual({ grew: false, completed: null });
    expect(idle.productionStored).toBe(7);
    expect(idle.buildQueue).toEqual([]);

    // A Settler that is paid for in a city of one citizen: it stays first,
    // the store keeps growing, and the Warrior behind it is not looked at
    // although it is paid for too. Nobody asks for a tile meanwhile.
    const asked: UnitTypeId[] = [];
    const spawnTile = (unitType: UnitTypeId): TileIndex | null => {
      asked.push(unitType);
      return 5;
    };
    const waiting = city({ productionStored: 29, buildQueue: [item('settler'), item('warrior')] });
    expect(runCityTurn(waiting, steady, spawnTile)).toEqual({ grew: false, completed: null });
    expect(waiting.productionStored).toBe(32);
    expect(runCityTurn(waiting, steady, spawnTile)).toEqual({ grew: false, completed: null });
    expect(waiting.productionStored).toBe(35);
    expect(waiting.buildQueue).toEqual([item('settler'), item('warrior')]);
    expect(waiting.population).toBe(1);
    expect(asked).toEqual([]);

    // The turn the city grows to 2 it lets the Settler go: the citizen is
    // judged after the food. The entry leaves the queue, the rest of the
    // store carries over, and only one entry is completed per turn.
    const growing: CityEconomy = { worked: [], food: 12, production: 3, foodSurplus: 10 };
    expect(runCityTurn(waiting, growing, spawnTile)).toEqual({ grew: true, completed: { unitType: 'settler', tile: 5 } });
    expect(asked).toEqual(['settler']);
    expect(waiting.population).toBe(1);
    expect(waiting.foodStored).toBe(0);
    expect(waiting.productionStored).toBe(8);
    expect(waiting.buildQueue).toEqual([item('warrior')]);

    // No free tile: the entry is paid for and stays.
    const crowded = city({ productionStored: 20, buildQueue: [item('warrior')] });
    expect(runCityTurn(crowded, steady, () => null)).toEqual({ grew: false, completed: null });
    expect(crowded.productionStored).toBe(23);
    expect(crowded.buildQueue).toEqual([item('warrior')]);
  });
});

// ---------------------------------------------------------------------------
// 3. The forecast
// ---------------------------------------------------------------------------

describe('contracts: the forecast', () => {
  /** A new capital on open grassland (one citizen, +2 food and +2 production a turn) with this queue. */
  function capitalWithQueue(queue: UnitTypeId[]): GameState {
    return arranged(foundCapital(gameOn(MEADOW, [[7, 5]]), 'p1'), (draft) => {
      cityOf(draft, 'p1').buildQueue = queue.map(item);
    });
  }

  it('buildPlan forecasts with growth: a new capital on open grassland with the queue Warrior, Scout, Settler says 8, 12 and 20', () => {
    const state = capitalWithQueue(['warrior', 'scout', 'settler']);
    const rome = cityOf(state, 'p1');
    const before = cloneJson(state);
    const plan = buildPlan(state, rome);

    expect(plan.economy).toEqual(cityEconomy(state, rome));
    expect(plan.economy.foodSurplus).toBe(2);
    expect(plan.economy.production).toBe(2);
    expect(plan.queue).toEqual([
      { item: item('warrior'), cost: 18, turns: 8, wait: null },
      { item: item('scout'), cost: 12, turns: 12, wait: null },
      { item: item('settler'), cost: 30, turns: 20, wait: null },
    ]);
    expect(plan.held).toBeNull();
    // The menu, in the table's order, each as if added behind the queue.
    expect(plan.options.map((option) => option.item.unitType)).toEqual([...UNIT_TYPE_IDS]);
    for (const option of plan.options) {
      expect(option.cost).toBe(UNITS[option.item.unitType].cost);
      expect(option.addError).toBeNull();
      expect(option.wait).toBeNull();
      expect(option.turns).toBeGreaterThan(20);
      expect(option.turns).toBeLessThanOrEqual(RULES.forecastTurns);
    }
    // The forecast is a look, not a move.
    expect(state).toEqual(before);

    // The other order of the same three (the Settler first): 12, 18 and 21.
    const settlerFirst = capitalWithQueue(['settler', 'warrior', 'scout']);
    expect(buildPlan(settlerFirst, cityOf(settlerFirst, 'p1')).queue.map((row) => row.turns)).toEqual([12, 18, 21]);
  });

  it('what the forecast says is what happens when the turns are played', () => {
    let state = capitalWithQueue(['warrior', 'scout', 'settler']);
    const forecast = buildPlan(state, cityOf(state, 'p1')).queue.map((row) => row.turns);
    const built: { unitType: UnitTypeId; after: number; queueEmpty: boolean }[] = [];
    for (let ended = 1; ended <= 20; ended++) {
      const result = applyAction(state, 'p1', state.turn, { type: 'endTurn' });
      if (!result.ok) throw new Error(`endTurn was refused: ${result.error.code}`);
      state = result.state;
      for (const { event } of result.events) {
        if (event.type === 'unitBuilt') built.push({ unitType: event.unitType, after: ended, queueEmpty: event.queueEmpty });
      }
    }
    expect(built).toEqual([
      { unitType: 'warrior', after: 8, queueEmpty: false },
      { unitType: 'scout', after: 12, queueEmpty: false },
      { unitType: 'settler', after: 20, queueEmpty: true },
    ]);
    expect(built.map((unit) => unit.after)).toEqual(forecast);
    expect(cityOf(state, 'p1').buildQueue).toEqual([]);
    // Every unit a city completes has no job.
    for (const unit of Object.values(state.units)) expect(unit.job).toBeNull();
  });

  it('a paid-for Settler in a city that cannot grow is held, with no end in sight', () => {
    // The centre and one hills tile: one citizen eats what the city makes.
    const ROWS: readonly string[] = ['m m m m m', ' m m m m m', 'm m g h m', ' m m m m m', 'm m m m m'];
    const state = arranged(foundCapital(gameOn(ROWS, [[2, 2]]), 'p1'), (draft) => {
      const rome = cityOf(draft, 'p1');
      rome.buildQueue = [item('settler'), item('warrior')];
      rome.productionStored = 30;
    });
    const plan = buildPlan(state, cityOf(state, 'p1'));
    expect(plan.economy.foodSurplus).toBe(0);
    expect(plan.held).toBe('needsPopulation');
    expect(plan.queue.map((row) => [row.turns, row.wait])).toEqual([
      [null, 'needsPopulation'],
      [null, 'earlier'],
    ]);
    for (const option of plan.options) expect([option.turns, option.wait]).toEqual([null, 'earlier']);
  });

  it('a full queue says so on every option of the menu', () => {
    const state = capitalWithQueue(new Array<UnitTypeId>(RULES.maxQueueLength).fill('scout'));
    const plan = buildPlan(state, cityOf(state, 'p1'));
    expect(plan.queue).toHaveLength(RULES.maxQueueLength);
    for (const option of plan.options) expect(option.addError).toBe('queueFull');
    // A number exactly when there is no reason, for every row and every option.
    for (const entry of [...plan.queue, ...plan.options]) expect(entry.turns === null).toBe(entry.wait !== null);
  });
});

// ---------------------------------------------------------------------------
// 4. Where an improvement may be built
// ---------------------------------------------------------------------------

describe('contracts: improvement sites', () => {
  function site(fields: Partial<ImprovementSite>): ImprovementSite {
    return { ground: { terrain: 'grassland', feature: null, improvement: null }, own: true, city: false, ...fields };
  }

  /**
   * Rome at (3, 2) on a small island of grassland with hills right of the
   * city and forest left of it; a second island lies out of its borders.
   */
  const ROWS: readonly string[] = [
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ' ~ g g g g ~ ~ ~ ~ ~ ~',
    '~ g f g h g ~ ~ ~ g ~',
    ' ~ g g g g ~ ~ ~ ~ ~ ~',
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ];
  const size = { width: 11, height: 5 };
  const CITY = tileIndex({ x: 3, y: 2 }, size);
  const OPEN = tileIndex({ x: 3, y: 1 }, size);
  const HILLS = tileIndex({ x: 4, y: 2 }, size);
  const FOREST = tileIndex({ x: 2, y: 2 }, size);
  const FAR = tileIndex({ x: 9, y: 2 }, size);

  /** A Worker of p1 on a tile, put there by hand. */
  function worker(tile: TileIndex, fields: Partial<Unit> = {}): Unit {
    return { id: 'u1_work01', type: 'worker', owner: 'p1', tile, movesLeft: 0, job: null, ...fields };
  }

  it('improvementSiteError answers in the documented order, and jobOptions follows it', () => {
    const hills = { terrain: 'grassland', feature: 'hills', improvement: null } as const;
    const forest = { terrain: 'plains', feature: 'forest', improvement: null } as const;

    // 1. Not the player's own land comes first, whatever else is wrong.
    expect(improvementSiteError(null, 'farm')).toBe('notYourLand');
    expect(improvementSiteError(site({ own: false, city: true, ground: forest }), 'farm')).toBe('notYourLand');
    // 2. A city on the tile, before the ground is looked at.
    expect(improvementSiteError(site({ city: true, ground: forest }), 'farm')).toBe('cityOnTile');
    expect(improvementSiteError(site({ city: true }), 'farm')).toBe('cityOnTile');
    // 3. Ground that does not suit the improvement.
    expect(improvementSiteError(site({ ground: forest }), 'farm')).toBe('badImprovementTile');
    expect(improvementSiteError(site({ ground: forest }), 'mine')).toBe('badImprovementTile');
    expect(improvementSiteError(site({ ground: hills }), 'farm')).toBe('badImprovementTile');
    expect(improvementSiteError(site({}), 'mine')).toBe('badImprovementTile');
    expect(improvementSiteError(site({ ground: { terrain: 'coast', feature: null } }), 'farm')).toBe('badImprovementTile');
    // A farm stands on the hills (it could not, but the ground is judged first).
    expect(improvementSiteError(site({ ground: { ...hills, improvement: 'farm' } }), 'farm')).toBe('badImprovementTile');
    // 4. The improvement is there already.
    expect(improvementSiteError(site({ ground: { terrain: 'plains', feature: null, improvement: 'farm' } }), 'farm')).toBe('alreadyImproved');
    expect(improvementSiteError(site({ ground: { ...hills, improvement: 'mine' } }), 'mine')).toBe('alreadyImproved');
    // Otherwise yes; a ground that says nothing about improvements has none.
    expect(improvementSiteError(site({}), 'farm')).toBeNull();
    expect(improvementSiteError(site({ ground: { terrain: 'desert', feature: null } }), 'farm')).toBeNull();
    expect(improvementSiteError(site({ ground: { terrain: 'desert', feature: 'hills' } }), 'mine')).toBeNull();

    // The same answers reach a Worker's owner through jobOptions.
    const state = foundCapital(gameOn(ROWS, [[3, 2]]), 'p1');
    expect(cityOf(state, 'p1').tile).toBe(CITY);
    const optionsOn = (tile: TileIndex, fields: Partial<Unit> = {}) => jobOptions(state, worker(tile, fields));
    const farm = { improvement: 'farm', turns: IMPROVEMENTS.farm.turns };
    const mine = { improvement: 'mine', turns: IMPROVEMENTS.mine.turns };

    expect(optionsOn(FAR)).toEqual([{ ...farm, error: 'notYourLand' }, { ...mine, error: 'notYourLand' }]);
    expect(optionsOn(CITY)).toEqual([{ ...farm, error: 'cityOnTile' }, { ...mine, error: 'cityOnTile' }]);
    expect(optionsOn(OPEN)).toEqual([{ ...farm, error: null }, { ...mine, error: 'badImprovementTile' }]);
    expect(optionsOn(HILLS)).toEqual([{ ...farm, error: 'badImprovementTile' }, { ...mine, error: null }]);
    expect(optionsOn(FOREST)).toEqual([{ ...farm, error: 'badImprovementTile' }, { ...mine, error: 'badImprovementTile' }]);
    // The moves left are not looked at: every Worker above had none.

    const farmed = arranged(state, (draft) => {
      draft.map.tiles[OPEN].improvement = 'farm';
    });
    expect(jobOptions(farmed, worker(OPEN))).toEqual([{ ...farm, error: 'alreadyImproved' }, { ...mine, error: 'badImprovementTile' }]);

    // A unit at work is busy for every job; a unit that cannot improve has no jobs at all.
    const busy = { job: { improvement: 'farm', turnsWorked: 1 } } as const;
    expect(optionsOn(OPEN, busy)).toEqual([{ ...farm, error: 'unitBusy' }, { ...mine, error: 'unitBusy' }]);
    expect(optionsOn(OPEN, { type: 'warrior' })).toEqual([]);
    expect(optionsOn(OPEN).map((option) => option.improvement)).toEqual([...IMPROVEMENT_IDS]);

    // startJobError, which jobOptions is made of: the unit first, then its job, then the tile.
    expect(startJobError(state, worker(FAR, { type: 'settler' }), 'farm')).toBe('cannotImprove');
    expect(startJobError(state, worker(OPEN), 'dragon')).toBe('cannotImprove');
    expect(startJobError(state, worker(OPEN), 'constructor')).toBe('cannotImprove');
    expect(startJobError(state, worker(FAR, busy), 'farm')).toBe('unitBusy');
    expect(startJobError(state, worker(FAR), 'farm')).toBe('notYourLand');
    expect(startJobError(state, worker(OPEN), 'farm')).toBeNull();
  });

  it('siteInView says about the viewer\'s own land what siteOfTile says, and nothing about a tile never seen or off the map', () => {
    const state = arranged(foundCapital(gameOn(ROWS, [[3, 2]]), 'p1'), (draft) => {
      draft.map.tiles[OPEN].improvement = 'farm';
    });
    const view = buildPlayerView(state, 'p1');
    let own = 0;
    view.tiles.forEach((tile, index) => {
      if (tile === null || tile.owner !== 'p1') return;
      own += 1;
      expect(siteInView(view, index)).toEqual(siteOfTile(state, 'p1', index));
    });
    expect(own).toBeGreaterThan(10);
    expect(siteInView(view, CITY)).toEqual({ ground: { terrain: 'grassland', feature: null, improvement: null }, own: true, city: true });
    expect(siteInView(view, OPEN)).toEqual({ ground: { terrain: 'grassland', feature: null, improvement: 'farm' }, own: true, city: false });

    // The far island has never been seen; and these are not tiles at all.
    expect(view.tiles[FAR]).toBeNull();
    expect(siteInView(view, FAR)).toBeNull();
    for (const tile of [-1, view.tiles.length, 1.5, Number.NaN]) expect(siteInView(view, tile)).toBeNull();
    // The truth has a site for it all the same: land that is nobody's.
    expect(siteOfTile(state, 'p1', FAR)).toEqual({ ground: { terrain: 'grassland', feature: null, improvement: null }, own: false, city: false });
  });

  it('the tables and small helpers the view and the tile information read', () => {
    // An improvement adds to what the tile yields; a ground that says nothing about one yields as before.
    expect(tileYields({ terrain: 'grassland', feature: null })).toEqual({ food: 2, production: 1 });
    expect(tileYields({ terrain: 'grassland', feature: null, improvement: null })).toEqual({ food: 2, production: 1 });
    expect(tileYields({ terrain: 'grassland', feature: null, improvement: 'farm' })).toEqual({ food: 3, production: 1 });
    expect(tileYields({ terrain: 'plains', feature: null, improvement: 'farm' })).toEqual({ food: 2, production: 2 });
    expect(tileYields({ terrain: 'desert', feature: null, improvement: 'farm' })).toEqual({ food: 1, production: 1 });
    expect(tileYields({ terrain: 'plains', feature: 'hills', improvement: 'mine' })).toEqual({ food: 0, production: 3 });

    // Where each improvement fits: a farm on open land, a mine on hills, neither on forest, water or mountains.
    expect(improvementFits('farm', { terrain: 'desert', feature: null })).toBe(true);
    expect(improvementFits('farm', { terrain: 'grassland', feature: 'hills' })).toBe(false);
    expect(improvementFits('farm', { terrain: 'coast', feature: null })).toBe(false);
    expect(improvementFits('mine', { terrain: 'desert', feature: 'hills' })).toBe(true);
    expect(improvementFits('mine', { terrain: 'grassland', feature: null })).toBe(false);
    expect(improvementFits('mine', { terrain: 'plains', feature: 'forest' })).toBe(false);
    expect(improvementFits('mine', { terrain: 'grassland', feature: 'mountains' })).toBe(false);

    // The centre of a city: the tile's own yields, but never less than the minimum.
    expect(RULES.cityCenterMinYields).toEqual({ food: 2, production: 1 });
    expect(cityCenterYields({ terrain: 'grassland', feature: null })).toEqual({ food: 2, production: 1 });
    expect(cityCenterYields({ terrain: 'plains', feature: null })).toEqual({ food: 2, production: 2 });
    expect(cityCenterYields({ terrain: 'desert', feature: null })).toEqual({ food: 2, production: 1 });
    expect(cityCenterYields({ terrain: 'grassland', feature: 'hills' })).toEqual({ food: 2, production: 2 });

    // A job as its owner sees it: never less than one turn left.
    expect(jobView({ improvement: 'farm', turnsWorked: 0 })).toEqual({ improvement: 'farm', turnsWorked: 0, turnsTotal: 4, turnsLeft: 4 });
    expect(jobView({ improvement: 'mine', turnsWorked: 4 })).toEqual({ improvement: 'mine', turnsWorked: 4, turnsTotal: 5, turnsLeft: 1 });
    expect(jobView({ improvement: 'mine', turnsWorked: 9 })).toEqual({ improvement: 'mine', turnsWorked: 9, turnsTotal: 5, turnsLeft: 1 });

    // The Worker: the fourth entry of the build menu, the one unit that can improve.
    expect([...UNIT_TYPE_IDS]).toEqual(['warrior', 'scout', 'settler', 'worker']);
    expect(UNIT_TYPE_IDS.filter((type) => UNITS[type].canImprove)).toEqual(['worker']);
    expect(UNITS.worker).toMatchObject({ unitClass: 'civilian', moves: 2, sight: 2, cost: 20, populationCost: 0, canFoundCity: false });
    expect([RULES.maxQueueLength, RULES.forecastTurns, RULES.minFoodSurplus]).toEqual([8, 50, 1]);
  });
});

// ---------------------------------------------------------------------------
// 5. Views
// ---------------------------------------------------------------------------

describe('contracts: views', () => {
  it("a new game's views carry the new fields", () => {
    // A real generated map, four players.
    let state = createGame({
      seed: 'contracts-views',
      settings: { mapSize: 'small', turnMode: 'simultaneous' },
      players: PLAYERS.map((player) => ({ ...player })),
    });
    expect(state.schema).toBe(STATE_SCHEMA);
    expect(STATE_SCHEMA).toBe(2);
    for (const tile of state.map.tiles) expect(tile.improvement).toBeNull();
    for (const unit of Object.values(state.units)) expect(unit.job).toBeNull();

    for (const player of state.players) {
      const view = buildPlayerView(state, player.id);
      const known = view.tiles.filter((tile) => tile !== null);
      expect(known.length).toBeGreaterThan(0);
      for (const tile of known) expect(tile.improvement).toBeNull();
      const own = view.units.filter((unit) => unit.owner === player.id);
      expect(own).toHaveLength(RULES.startingUnits.length);
      for (const unit of own) {
        expect(unit.own).not.toBeNull();
        expect(unit.own?.job).toBeNull();
        expect(unit.own?.jobOptions).toEqual([]);
      }
      for (const unit of view.units) if (unit.owner !== player.id) expect(unit.own).toBeNull();
      // A view is plain JSON: nothing in it is undefined.
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    }

    // A city that has just been founded: an empty queue, a full menu.
    state = foundCapital(state, 'p1');
    expect(cityOf(state, 'p1').buildQueue).toEqual([]);
    for (const player of state.players) {
      const view = buildPlayerView(state, player.id);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
      for (const city of view.cities) {
        if (city.owner !== player.id) {
          expect(city.own).toBeNull();
          continue;
        }
        expect(city.own).toMatchObject({ buildQueue: [], held: null, productionStored: 0 });
        expect(city.own?.buildOptions.map((option) => option.item)).toEqual(UNIT_TYPE_IDS.map(item));
        for (const option of city.own?.buildOptions ?? []) {
          expect(option.addError).toBeNull();
          expect(option.turns === null).toBe(option.wait !== null);
        }
      }
    }
    const mine = buildPlayerView(state, 'p1').cities.filter((city) => city.own !== null);
    expect(mine).toHaveLength(1);
  });

  it('a tile out of sight shows the improvement as it was last seen, and a job is only in its owner\'s view', () => {
    // Two capitals far apart on the meadow; p2's Warrior stands next to Rome's land and then walks away.
    const base = foundCapital(foundCapital(gameOn(MEADOW, [[3, 5], [12, 5]]), 'p1'), 'p2');
    const size = { width: 16, height: 11 };
    const FIELD = tileIndex({ x: 4, y: 5 }, size);
    const watcher = Object.values(base.units).find((unit) => unit.owner === 'p2' && unit.type === 'warrior');
    if (watcher === undefined) throw new Error('p2 has no Warrior');

    // p2 looks at the field while it is bare, then leaves.
    const seenBare = arranged(base, (draft) => {
      draft.units[watcher.id].tile = tileIndex({ x: 6, y: 5 }, size);
    });
    expect(buildPlayerView(seenBare, 'p2').tiles[FIELD]).toMatchObject({ visible: true, improvement: null });
    const gone = arranged(seenBare, (draft) => {
      draft.units[watcher.id].tile = tileIndex({ x: 12, y: 5 }, size);
    });
    // A farm is finished there, and a Worker of p1 is at work on it, out of p2's sight.
    const farmed = arranged(gone, (draft) => {
      draft.map.tiles[FIELD].improvement = 'farm';
      draft.units.u1_work01 = { id: 'u1_work01', type: 'worker', owner: 'p1', tile: FIELD, movesLeft: 2, job: { improvement: 'farm', turnsWorked: 3 } };
    });
    expect(buildPlayerView(farmed, 'p2').tiles[FIELD]).toMatchObject({ visible: false, improvement: null });
    expect(buildPlayerView(farmed, 'p1').tiles[FIELD]).toMatchObject({ visible: true, improvement: 'farm' });

    // p2 comes back and sees the farm; leaves again and remembers it although it is gone.
    const back = arranged(farmed, (draft) => {
      draft.units[watcher.id].tile = tileIndex({ x: 6, y: 5 }, size);
    });
    const p2View = buildPlayerView(back, 'p2');
    expect(p2View.tiles[FIELD]).toMatchObject({ visible: true, improvement: 'farm' });
    expect(p2View.units.find((unit) => unit.id === 'u1_work01')).toEqual({ id: 'u1_work01', type: 'worker', owner: 'p1', tile: FIELD, own: null });
    const leftAgain = arranged(back, (draft) => {
      draft.units[watcher.id].tile = tileIndex({ x: 12, y: 5 }, size);
    });
    const cleared = cloneJson(leftAgain);
    cleared.map.tiles[FIELD].improvement = null; // not through updateKnowledge of p2's sight: p2 is away
    updateKnowledge(cleared);
    expect(buildPlayerView(cleared, 'p2').tiles[FIELD]).toMatchObject({ visible: false, improvement: 'farm' });

    // The owner's view of the Worker: the job with every number, and every option busy.
    const worker = buildPlayerView(back, 'p1').units.find((unit) => unit.id === 'u1_work01');
    expect(worker?.own).toEqual({
      movesLeft: 2,
      foundCityError: 'cannotFoundCity',
      job: { improvement: 'farm', turnsWorked: 3, turnsTotal: IMPROVEMENTS.farm.turns, turnsLeft: Math.max(1, IMPROVEMENTS.farm.turns - 3) },
      jobOptions: IMPROVEMENT_IDS.map((improvement) => ({ improvement, turns: IMPROVEMENTS[improvement].turns, error: 'unitBusy' })),
    });
  });
});
