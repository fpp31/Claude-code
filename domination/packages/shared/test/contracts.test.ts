import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CITY_FOCUS,
  CITY_FOCUS_IDS,
  DEFAULT_CITY_FOCUS,
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  PROTOCOL_VERSION,
  RULES,
  RULE_ERROR_MESSAGES,
  STATE_SCHEMA,
  UNITS,
  UNIT_TYPE_IDS,
  applyAction,
  boardFromState,
  boardFromView,
  buildItemError,
  buildPlan,
  buildPlayerView,
  checkInvariants,
  cityCenterYields,
  cityEconomy,
  cloneJson,
  createGame,
  distance,
  findSpawnTile,
  improvementFits,
  improvementSiteError,
  jobOptions,
  jobView,
  migrateGameState,
  reachableTiles,
  runCityTurn,
  siteInView,
  siteOfTile,
  startJobError,
  tileIndex,
  tileIsWater,
  tileMoveCost,
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
 *
 * The last block, 'contracts: round 3', is of the same kind for the boats,
 * the Fishing Net and the "Grow first / Build first" choice: six smoke
 * tests written together with that code, before any other test knew it.
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

/** The unit types by where they move: the menu of a city without water treats the two groups differently. */
const LAND_UNITS = UNIT_TYPE_IDS.filter((type) => UNITS[type].domain === 'land');
const BOATS = UNIT_TYPE_IDS.filter((type) => UNITS[type].domain === 'sea');

/** A meadow of open grassland, 16 x 11, with water all around. A city in its middle owns no water. */
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

    // First choice: the mined hill (5 in total) and both grassland tiles (3 each),
    // which is 2 + 0 + 2 + 2 = 6 food for 6 eaten: the city would stand still.
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
      production: 8,
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
      focus: 'grow',
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
    // The menu, in the table's order: one option per unit type, always.
    expect(plan.options.map((option) => option.item.unitType)).toEqual([...UNIT_TYPE_IDS]);
    for (const option of plan.options) expect(option.cost).toBe(UNITS[option.item.unitType].cost);
    // The four land units, each as if added behind the queue.
    const landOptions = plan.options.filter((option) => UNITS[option.item.unitType].domain === 'land');
    expect(landOptions.map((option) => option.item.unitType)).toEqual(LAND_UNITS);
    for (const option of landOptions) {
      expect(option.addError).toBeNull();
      expect(option.wait).toBeNull();
      expect(option.turns).toBeGreaterThan(20);
      expect(option.turns).toBeLessThanOrEqual(RULES.forecastTurns);
    }
    // The two boats: this city owns no water, so it can never build one. No number, and the reason.
    const boatOptions = plan.options.filter((option) => UNITS[option.item.unitType].domain === 'sea');
    expect(boatOptions.map((option) => option.item.unitType)).toEqual(BOATS);
    for (const option of boatOptions) {
      expect([option.turns, option.wait, option.addError], option.item.unitType).toEqual([null, 'noRoom', 'noWaterForBoat']);
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
    // Behind a queue that is stuck every land unit waits for the entry before it;
    // a boat in this city without water has its own, lasting reason.
    for (const option of plan.options) {
      const boat = UNITS[option.item.unitType].domain === 'sea';
      expect([option.turns, option.wait, option.addError], option.item.unitType).toEqual(
        boat ? [null, 'noRoom', 'noWaterForBoat'] : [null, 'earlier', null],
      );
    }
  });

  it('a full queue says so on every option of the menu the city can build; a boat in a city without water keeps its own reason', () => {
    const state = capitalWithQueue(new Array<UnitTypeId>(RULES.maxQueueLength).fill('scout'));
    const plan = buildPlan(state, cityOf(state, 'p1'));
    expect(plan.queue).toHaveLength(RULES.maxQueueLength);
    // The lasting reason comes first (BuildOption.addError): the queue will have room again, the city will never have water.
    expect(plan.options.map((option) => [option.item.unitType, option.addError])).toEqual([
      ...LAND_UNITS.map((type) => [type, 'queueFull']),
      ...BOATS.map((type) => [type, 'noWaterForBoat']),
    ]);
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
    // One option per improvement the unit's TYPE builds, in the table's order: a Worker has no button for a net.
    expect(optionsOn(OPEN).map((option) => option.improvement)).toEqual([...UNITS.worker.improvements]);
    expect(optionsOn(OPEN).map((option) => option.improvement)).toEqual(['farm', 'mine']);

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
    expect(tileYields({ terrain: 'plains', feature: 'hills', improvement: 'mine' })).toEqual({ food: 0, production: 5 });

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

    // The lists this round pinned. The six unit types in the order of the build menu: the Worker fourth, the boats last.
    expect([...UNIT_TYPE_IDS]).toEqual(['warrior', 'scout', 'settler', 'worker', 'fishingBoat', 'scoutBoat']);
    // Who builds what: the Worker a farm and a mine, the Fishing Boat a net, the other four nothing.
    expect(UNIT_TYPE_IDS.map((type) => [...UNITS[type].improvements])).toEqual([[], [], [], ['farm', 'mine'], ['fishingNet'], []]);
    expect([...IMPROVEMENT_IDS]).toEqual(['farm', 'mine', 'fishingNet']);
    expect(UNITS.worker).toMatchObject({ unitClass: 'civilian', domain: 'land', moves: 2, sight: 2, cost: 20, populationCost: 0, canFoundCity: false });
    expect(UNITS.fishingBoat).toMatchObject({ unitClass: 'civilian', domain: 'sea', moves: 2, sight: 2, cost: 20, populationCost: 0, canFoundCity: false });
    expect(UNITS.scoutBoat).toMatchObject({ unitClass: 'military', domain: 'sea', moves: 4, sight: 4, cost: 24, populationCost: 0, canFoundCity: false });
    expect([RULES.maxQueueLength, RULES.forecastTurns, RULES.minFoodSurplus]).toEqual([8, 50, 1]);
    // The save layout and the protocol of round 3.
    expect(STATE_SCHEMA).toBe(3);
    expect(PROTOCOL_VERSION).toBe(5);

    // The rows round 3 added, whole: the words are on the page's buttons and in the README, and
    // the buttons were measured with them. (A number that is tuned on purpose is changed here with it.)
    expect(UNITS.fishingBoat).toEqual({
      name: 'Fishing Boat', description: 'Builds fishing nets inside the borders.',
      unitClass: 'civilian', domain: 'sea', moves: 2, sight: 2, cost: 20, populationCost: 0, canFoundCity: false, improvements: ['fishingNet'],
    });
    expect(UNITS.scoutBoat).toEqual({
      name: 'Scout Boat', description: 'A fast boat that explores the sea.',
      unitClass: 'military', domain: 'sea', moves: 4, sight: 4, cost: 24, populationCost: 0, canFoundCity: false, improvements: [],
    });
    expect(IMPROVEMENTS.fishingNet).toEqual({
      name: 'Fishing Net', description: 'Nets along the coast for more food.',
      needs: 'coast', terrains: ['coast'], features: [null], yields: { food: 2, production: 0 }, turns: 4,
    });
    expect(CITY_FOCUS_IDS).toEqual(['grow', 'build']);
    expect(DEFAULT_CITY_FOCUS).toBe('grow');
    expect(CITY_FOCUS).toEqual({
      grow: {
        name: 'Grow first', summary: 'growth before production',
        description: 'Citizens take the best tiles, and food before production whenever the city would stop growing.',
      },
      build: {
        name: 'Build first', summary: 'most production, growth may stop',
        description: 'Citizens take the tiles with the most production. The city grows slowly or not at all; it never shrinks.',
      },
    });
    // The three sentences a refusal carries to the page that round 3 wrote or reworded.
    expect(RULE_ERROR_MESSAGES.impassable).toBe('This unit cannot go there.');
    expect(RULE_ERROR_MESSAGES.notYourLand).toBe('That can only be built inside your own borders.');
    expect(RULE_ERROR_MESSAGES.noWaterForBoat).toBe('This city has no water inside its borders, so it cannot build boats.');
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
    expect(STATE_SCHEMA).toBe(3);
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

    // A city that has just been founded: an empty queue, a full menu, and on Grow.
    // (A capital of a generated map owns water, so it can add the boats too: rule H6 of the map generator.)
    state = foundCapital(state, 'p1');
    expect(cityOf(state, 'p1').buildQueue).toEqual([]);
    expect(cityOf(state, 'p1').focus).toBe('grow');
    for (const player of state.players) {
      const view = buildPlayerView(state, player.id);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
      for (const city of view.cities) {
        if (city.owner !== player.id) {
          expect(city.own).toBeNull();
          continue;
        }
        expect(city.own).toMatchObject({ buildQueue: [], held: null, productionStored: 0, focus: 'grow' });
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
      jobOptions: UNITS.worker.improvements.map((improvement) => ({ improvement, turns: IMPROVEMENTS[improvement].turns, error: 'unitBusy' })),
    });
    expect(worker?.own?.jobOptions.map((option) => option.improvement)).toEqual(['farm', 'mine']);
  });
});

// ---------------------------------------------------------------------------
// 6. Round 3: domains, boats, the Fishing Net, Grow or Build, save layout 3
// ---------------------------------------------------------------------------

describe('contracts: round 3', () => {
  /**
   * Land in the north, the sea in the south, 12 x 9. Rome is founded at
   * (5, 4), in the last row of land. Its land (everything within 2):
   *
   *   row 2   (4,2) (5,2) (6,2)              grassland
   *   row 3   (3,3) (4,3) (5,3) (6,3)        grassland, but (4,3) is plains
   *   row 4   (3,4) (4,4) ROME (6,4) (7,4)   grassland
   *   row 5   (3,5) (4,5) (5,5) (6,5)        coast; (4,5) and (5,5) touch the city
   *   row 6   (4,6) (5,6) (6,6)              coast
   *
   * Tile numbers are y * 12 + x: Rome 53, the plains tile 40, the two coast
   * tiles next to the city 64 and 65.
   */
  const SHORE: readonly string[] = [
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ' ~ g g g g g g g g g g ~',
    '~ g g g g g g g g g g ~',
    ' ~ g g g p g g g g g g ~',
    '~ g g g g g g g g g g ~',
    ' ~ , , , , , , , , , , ~',
    '~ , , , , , , , , , , ~',
    ' ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ];
  const SHORE_SIZE = { width: 12, height: 9 };
  const shoreTile = (x: number, y: number): TileIndex => tileIndex({ x, y }, SHORE_SIZE);
  const ROME = shoreTile(5, 4);
  const PLAINS = shoreTile(4, 3);
  const COAST_WEST = shoreTile(4, 5);
  const COAST_EAST = shoreTile(5, 5);

  /** One player on the shore, the capital founded: Rome, one citizen, its Warrior on the city tile. */
  function rome(): GameState {
    return foundCapital(gameOn(SHORE, [[5, 4]]), 'p1');
  }

  /** A copy of the state with one more unit of p1, as new as a city would make it. */
  function withUnit(state: GameState, id: string, type: UnitTypeId, tile: TileIndex): GameState {
    return arranged(state, (draft) => {
      draft.units[id] = { id, type, owner: 'p1', tile, movesLeft: UNITS[type].moves, job: null };
    });
  }

  /** The only player ends the turn, which resolves it. Hands back the whole answer, for its events. */
  function endTurn(state: GameState): Extract<ReturnType<typeof applyAction>, { ok: true }> {
    const result = applyAction(state, 'p1', state.turn, { type: 'endTurn' });
    if (!result.ok) throw new Error(`endTurn was refused: ${result.error.code}`);
    return result;
  }

  it('tileMoveCost has a cost per domain: coast and ocean 1 for a boat and null for a land unit; grassland the other way round; mountains null for both', () => {
    for (const terrain of ['coast', 'ocean'] as const) {
      expect(tileMoveCost({ terrain, feature: null }, 'sea'), terrain).toBe(1);
      expect(tileMoveCost({ terrain, feature: null }, 'land'), terrain).toBeNull();
    }
    expect(tileMoveCost({ terrain: 'grassland', feature: null }, 'land')).toBe(1);
    expect(tileMoveCost({ terrain: 'grassland', feature: null }, 'sea')).toBeNull();
    for (const terrain of ['grassland', 'plains', 'desert'] as const) {
      expect(tileMoveCost({ terrain, feature: 'mountains' }, 'land'), terrain).toBeNull();
      expect(tileMoveCost({ terrain, feature: 'mountains' }, 'sea'), terrain).toBeNull();
    }
    // A feature replaces the LAND cost only: hills cost a land unit 2 and still let no boat in.
    expect(tileMoveCost({ terrain: 'plains', feature: 'hills' }, 'land')).toBe(2);
    expect(tileMoveCost({ terrain: 'plains', feature: 'hills' }, 'sea')).toBeNull();
    // The domains come from the unit table: four land units, two boats.
    expect(UNIT_TYPE_IDS.map((type) => UNITS[type].domain)).toEqual(['land', 'land', 'land', 'land', 'sea', 'sea']);
  });

  it("on a hand-drawn coast a new Fishing Boat's reachable tiles are water only, and a Warrior's land only", () => {
    const state = withUnit(rome(), 'u1_boat01', 'fishingBoat', COAST_EAST);
    const boat = state.units.u1_boat01;
    const warrior = Object.values(state.units).find((unit) => unit.type === 'warrior');
    if (warrior === undefined) throw new Error('no Warrior');
    expect(warrior.tile).toBe(ROME);

    const byBoat = [...reachableTiles(boardFromState(state), boat).keys()].sort((a, b) => a - b);
    const onFoot = [...reachableTiles(boardFromState(state), warrior).keys()].sort((a, b) => a - b);

    // Two moves over water that costs 1: every water tile within two steps of (5, 5), and no tile of the land.
    const withinTwo = state.map.tiles.map((_, tile) => tile).filter((tile) => tile !== boat.tile && distance(boat.tile, tile, state.map) <= 2);
    expect(byBoat).toEqual(withinTwo.filter((tile) => tileIsWater(state.map.tiles[tile])));
    expect(byBoat.length).toBe(11);
    for (const tile of byBoat) expect(tileIsWater(state.map.tiles[tile]), `the boat reaches tile ${tile}`).toBe(true);

    // The Warrior, from the city tile next to the boat: every land tile within two steps, and no water.
    expect(onFoot).toEqual(
      state.map.tiles.map((_, tile) => tile).filter((tile) => tile !== ROME && distance(ROME, tile, state.map) <= 2 && !tileIsWater(state.map.tiles[tile])),
    );
    expect(onFoot.length).toBe(11);
    for (const tile of onFoot) expect(tileIsWater(state.map.tiles[tile]), `the Warrior reaches tile ${tile}`).toBe(false);

    // The page lights the same tiles from the player's own view.
    const view = buildPlayerView(state, 'p1');
    expect([...reachableTiles(boardFromView(view), boat).keys()].sort((a, b) => a - b)).toEqual(byBoat);
    expect([...reachableTiles(boardFromView(view), warrior).keys()].sort((a, b) => a - b)).toEqual(onFoot);

    // And the server refuses the other ground with the code for it: no carrying, no landing.
    const ashore = applyAction(state, 'p1', state.turn, { type: 'moveUnit', unitId: boat.id, path: [ROME] });
    expect(ashore.ok ? null : ashore.error.code).toBe('impassable');
    const afloat = applyAction(state, 'p1', state.turn, { type: 'moveUnit', unitId: warrior.id, path: [COAST_WEST] });
    expect(afloat.ok ? null : afloat.error.code).toBe('impassable');
    // A boat on water is a healthy state; a boat on land is named.
    expect(checkInvariants(state)).toEqual([]);
    const stranded = arranged(state, (draft) => {
      draft.units.u1_boat01.tile = shoreTile(5, 2);
    });
    expect(checkInvariants(stranded)).toEqual([`Unit u1_boat01 stands on tile ${shoreTile(5, 2)}, which a sea unit cannot enter.`]);
  });

  it('a city that owns coast completes a Fishing Boat onto its nearest water tile, the higher tile among equals; a city without water offers the boats with noWaterForBoat and setBuildQueue refuses them', () => {
    let state = rome();
    const city = cityOf(state, 'p1');
    expect(city.tile).toBe(ROME);
    // What the test stands on: two water tiles touch the city (64 and 65), and the city owns water further out
    // with higher numbers still, so "the lower tile" and "the highest tile of all" would both be other answers.
    const water = state.map.tiles
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile }) => tile.cityId === city.id && tileIsWater(tile))
      .map(({ index }) => index);
    expect(water).toEqual([shoreTile(3, 5), COAST_WEST, COAST_EAST, shoreTile(6, 5), shoreTile(4, 6), shoreTile(5, 6), shoreTile(6, 6)]);
    expect(water.filter((tile) => distance(ROME, tile, state.map) === 1)).toEqual([COAST_WEST, COAST_EAST]);

    // Both boat types are offered, with a number, and both would appear on the same tile.
    expect(buildItemError(state, city, item('fishingBoat'))).toBeNull();
    expect(buildItemError(state, city, item('scoutBoat'))).toBeNull();
    expect(findSpawnTile(state, city, 'fishingBoat')).toBe(COAST_EAST);
    expect(findSpawnTile(state, city, 'scoutBoat')).toBe(COAST_EAST);
    // A land unit still appears on the city tile (the Warrior of the start stands there: a Worker shares it).
    expect(findSpawnTile(state, city, 'worker')).toBe(ROME);
    for (const option of buildPlan(state, city).options) {
      expect(option.addError, option.item.unitType).toBeNull();
      expect(option.turns, option.item.unitType).not.toBeNull();
    }

    // The real thing: the boat is queued, paid for, and the turn resolves.
    state = act(state, 'p1', { type: 'setBuildQueue', cityId: city.id, queue: [item('fishingBoat')] });
    state = arranged(state, (draft) => {
      draft.cities[city.id].productionStored = UNITS.fishingBoat.cost;
    });
    const resolved = endTurn(state);
    state = resolved.state;
    const boats = Object.values(state.units).filter((unit) => unit.type === 'fishingBoat');
    expect(boats).toHaveLength(1);
    expect(boats[0]).toMatchObject({ owner: 'p1', tile: COAST_EAST, movesLeft: UNITS.fishingBoat.moves, job: null });
    expect(resolved.events.filter((entry) => entry.event.type === 'unitBuilt')).toEqual([
      { to: ['p1'], event: { type: 'unitBuilt', playerId: 'p1', cityId: city.id, cityName: city.name, unitId: boats[0].id, unitType: 'fishingBoat', queueEmpty: true } },
    ]);
    expect(cityOf(state, 'p1').buildQueue).toEqual([]);
    expect(checkInvariants(state)).toEqual([]);
    // The next Fishing Boat takes the other tile next to the city; a Scout Boat (the other class) shares the first.
    expect(findSpawnTile(state, cityOf(state, 'p1'), 'fishingBoat')).toBe(COAST_WEST);
    expect(findSpawnTile(state, cityOf(state, 'p1'), 'scoutBoat')).toBe(COAST_EAST);

    // A city in the middle of the meadow owns no water.
    const inland = foundCapital(gameOn(MEADOW, [[7, 5]]), 'p1');
    const dry = cityOf(inland, 'p1');
    expect(inland.map.tiles.filter((tile) => tile.cityId === dry.id && tileIsWater(tile))).toEqual([]);
    const boatOptions = { turns: null, wait: 'noRoom', addError: 'noWaterForBoat' };
    const menu = buildPlayerView(inland, 'p1').cities.find((candidate) => candidate.id === dry.id)?.own?.buildOptions ?? [];
    expect(menu.map((option) => option.item.unitType)).toEqual(['warrior', 'scout', 'settler', 'worker', 'fishingBoat', 'scoutBoat']);
    expect(menu[4]).toEqual({ item: item('fishingBoat'), cost: 20, ...boatOptions });
    expect(menu[5]).toEqual({ item: item('scoutBoat'), cost: 24, ...boatOptions });
    for (const option of menu.slice(0, 4)) expect(option.addError, option.item.unitType).toBeNull();
    expect(buildPlan(inland, dry).options).toEqual(menu);
    expect(buildItemError(inland, dry, item('fishingBoat'))).toBe('noWaterForBoat');
    expect(buildItemError(inland, dry, item('scoutBoat'))).toBe('noWaterForBoat');
    expect(buildItemError(inland, dry, item('warrior'))).toBeNull();
    for (const queue of [[item('fishingBoat')], [item('scoutBoat')], [item('warrior'), item('scoutBoat')]]) {
      const refused = applyAction(inland, 'p1', inland.turn, { type: 'setBuildQueue', cityId: dry.id, queue });
      expect(refused.ok ? null : refused.error.code, JSON.stringify(queue)).toBe('noWaterForBoat');
    }
    expect(cityOf(inland, 'p1').buildQueue).toEqual([]);
    // The land units are queued as ever.
    expect(cityOf(act(inland, 'p1', { type: 'setBuildQueue', cityId: dry.id, queue: [item('warrior')] }), 'p1').buildQueue).toEqual([item('warrior')]);
  });

  it("a Fishing Boat builds a net in four turns; a Worker's job options are farm and mine, the boat's the net", () => {
    expect(IMPROVEMENTS.fishingNet.turns).toBe(4);
    let state = withUnit(withUnit(rome(), 'u1_boat01', 'fishingBoat', COAST_EAST), 'u1_work01', 'worker', shoreTile(5, 3));
    const warrior = Object.values(state.units).find((unit) => unit.type === 'warrior');
    if (warrior === undefined) throw new Error('no Warrior');

    // Who builds what: one option per improvement of the unit's type, in the table's order.
    expect(UNITS.worker.improvements).toEqual(['farm', 'mine']);
    expect(UNITS.fishingBoat.improvements).toEqual(['fishingNet']);
    expect(jobOptions(state, state.units.u1_work01).map((option) => option.improvement)).toEqual(['farm', 'mine']);
    expect(jobOptions(state, state.units.u1_boat01)).toEqual([{ improvement: 'fishingNet', turns: 4, error: null }]);
    expect(jobOptions(state, warrior)).toEqual([]);
    const view = buildPlayerView(state, 'p1');
    expect(view.units.find((unit) => unit.id === 'u1_work01')?.own?.jobOptions.map((option) => option.improvement)).toEqual(['farm', 'mine']);
    expect(view.units.find((unit) => unit.id === 'u1_boat01')?.own?.jobOptions.map((option) => option.improvement)).toEqual(['fishingNet']);
    // The other one's work is refused, whatever the tile.
    expect(startJobError(state, state.units.u1_work01, 'fishingNet')).toBe('cannotImprove');
    expect(startJobError(state, state.units.u1_boat01, 'farm')).toBe('cannotImprove');
    const wrong = applyAction(state, 'p1', state.turn, { type: 'startJob', unitId: 'u1_work01', improvement: 'fishingNet' });
    expect(wrong.ok ? null : wrong.error.code).toBe('cannotImprove');

    // The net: started, three turns of work with nothing on the tile, and there after the fourth.
    state = act(state, 'p1', { type: 'startJob', unitId: 'u1_boat01', improvement: 'fishingNet' });
    expect(state.units.u1_boat01.job).toEqual({ improvement: 'fishingNet', turnsWorked: 0 });
    for (let turn = 1; turn <= 3; turn++) {
      const resolved = endTurn(state);
      state = resolved.state;
      expect(state.units.u1_boat01.job, `after ${turn} turns`).toEqual({ improvement: 'fishingNet', turnsWorked: turn });
      expect(state.map.tiles[COAST_EAST].improvement, `after ${turn} turns`).toBeNull();
      expect(resolved.events.some((entry) => entry.event.type === 'improvementBuilt')).toBe(false);
    }
    const fourth = endTurn(state);
    state = fourth.state;
    expect(state.map.tiles[COAST_EAST].improvement).toBe('fishingNet');
    expect(state.units.u1_boat01).toMatchObject({ tile: COAST_EAST, job: null });
    expect(fourth.events.filter((entry) => entry.event.type === 'improvementBuilt')).toEqual([
      { to: ['p1'], event: { type: 'improvementBuilt', playerId: 'p1', unitId: 'u1_boat01', improvement: 'fishingNet', tile: COAST_EAST, cityName: 'Rome' } },
    ]);
    // A fished coast tile: 2 + 2 food, no production. The boat is not used up and finds the tile done.
    expect(tileYields(state.map.tiles[COAST_EAST])).toEqual({ food: 4, production: 0 });
    expect(jobOptions(state, state.units.u1_boat01)).toEqual([{ improvement: 'fishingNet', turns: 4, error: 'alreadyImproved' }]);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('cityEconomy: the same city works other tiles under build than under grow; setCityFocus changes it; the view carries focus', () => {
    const grown = rome();
    const city = cityOf(grown, 'p1');
    expect(city.focus).toBe('grow');
    expect(city.population).toBe(1);
    // Grow: the best tile by food + production. Grassland (2 + 1) and plains (1 + 2) are level, the food decides,
    // and of the grassland the lowest tile is taken: (4, 2). With the centre (2 and 1): 4 food, 2 production.
    expect(cityEconomy(grown, city)).toEqual({ worked: [shoreTile(4, 2)], food: 4, production: 2, foodSurplus: 2 });
    const before = buildPlayerView(grown, 'p1').cities[0].own;
    expect(before).toMatchObject({ focus: 'grow', worked: [shoreTile(4, 2)], foodPerTurn: 2, productionPerTurn: 2 });

    // Build: the tile with the most production, the plains tile. 3 food, 3 production.
    const result = applyAction(grown, 'p1', grown.turn, { type: 'setCityFocus', cityId: city.id, focus: 'build' });
    if (!result.ok) throw new Error(`setCityFocus was refused: ${result.error.code}`);
    expect(result.changed).toBe(true);
    expect(result.events).toEqual([]);
    const built = result.state;
    expect(grown.cities[city.id].focus).toBe('grow'); // the state handed in is not edited
    expect(built.cities[city.id]).toEqual({ ...city, focus: 'build' }); // nothing else of the city has changed
    expect(cityEconomy(built, built.cities[city.id])).toEqual({ worked: [PLAINS], food: 3, production: 3, foodSurplus: 1 });
    const after = buildPlayerView(built, 'p1').cities[0].own;
    expect(after).toMatchObject({ focus: 'build', worked: [PLAINS], foodPerTurn: 1, productionPerTurn: 3 });
    // The forecast is made with the focus too. A Warrior costs 18. Build: 3 a turn, six turns. Grow: 2 a turn for
    // five turns, then the city has grown (5 x 2 food of the 10 it needs) and a second citizen makes it 3: eight.
    expect(before?.buildOptions[0]).toMatchObject({ item: item('warrior'), turns: 8 });
    expect(after?.buildOptions[0]).toMatchObject({ item: item('warrior'), turns: 6 });
    expect(checkInvariants(built)).toEqual([]);

    // The same choice again changes nothing; back to grow is the first economy again.
    const again = applyAction(built, 'p1', built.turn, { type: 'setCityFocus', cityId: city.id, focus: 'build' });
    expect(again).toMatchObject({ ok: true, changed: false });
    const back = act(built, 'p1', { type: 'setCityFocus', cityId: city.id, focus: 'grow' });
    expect(cityEconomy(back, back.cities[city.id])).toEqual(cityEconomy(grown, city));

    // What is refused: a city that is not the player's, and a focus that is none.
    const stranger = applyAction(grown, 'p1', grown.turn, { type: 'setCityFocus', cityId: 'c2_nobody', focus: 'build' });
    expect(stranger.ok ? null : stranger.error.code).toBe('noSuchCity');
    for (const focus of ['', 'Build', 'constructor', 'toString']) {
      const nonsense = applyAction(grown, 'p1', grown.turn, { type: 'setCityFocus', cityId: city.id, focus } as unknown as Action);
      expect(nonsense.ok ? null : nonsense.error.code, focus).toBe('badAction');
    }

    // A focus lost by hand is placed as Grow, the view says 'grow', and the health check names the city.
    const lost = arranged(built, (draft) => {
      (draft.cities[city.id] as { focus: string }).focus = 'fast';
    });
    expect(cityEconomy(lost, lost.cities[city.id])).toEqual(cityEconomy(grown, city));
    expect(buildPlayerView(lost, 'p1').cities[0].own).toMatchObject({ focus: 'grow', worked: [shoreTile(4, 2)] });
    expect(checkInvariants(lost)).toEqual([`City ${city.id} has the unknown focus 'fast'.`]);
  });

  it('the round 2 save converts to layout 3 with every city on grow and passes checkInvariants', () => {
    const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
    const saved = read('state-layout-2.json') as { schema: number; turn: number; cities: Record<string, Record<string, unknown>> };
    const room = read('room-layout-2.json') as { code: string; game: unknown };
    // The two files hold the same game: the state alone, and inside the room file the round 2 server wrote.
    expect([saved.schema, saved.turn, Object.keys(saved.cities).length, room.code]).toEqual([2, 41, 6, 'SECND']);
    expect(room.game).toEqual(saved);
    for (const city of Object.values(saved.cities)) expect('focus' in city).toBe(false);

    const untouched = cloneJson(saved);
    const converted = migrateGameState(saved);
    expect(saved).toEqual(untouched); // the save handed in is not edited
    if (converted === null) throw new Error('the round 2 save was not converted');
    expect(STATE_SCHEMA).toBe(3);
    expect(converted.schema).toBe(3);
    // Every city: what it was, and on grow. Nothing else of the state has changed.
    expect(Object.keys(converted.cities)).toEqual(Object.keys(saved.cities));
    for (const [id, city] of Object.entries(converted.cities)) {
      expect(city, id).toEqual({ ...saved.cities[id], focus: 'grow' });
    }
    expect({ ...converted, schema: 2, cities: saved.cities }).toEqual(saved);
    expect(checkInvariants(converted)).toEqual([]);
    expect(migrateGameState(room.game)).toEqual(converted);

    // Every player's view can be built, and every city says 'grow' to its owner and nothing to the others.
    for (const player of converted.players) {
      for (const city of buildPlayerView(converted, player.id).cities) {
        if (city.owner === player.id) expect(city.own?.focus, city.name).toBe('grow');
        else expect(city.own, city.name).toBeNull();
      }
    }
  });
});
