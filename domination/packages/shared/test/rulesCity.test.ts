import { describe, expect, it } from 'vitest';
import {
  CITY_FOCUS_IDS,
  CIVS,
  DEFAULT_CITY_FOCUS,
  RULES,
  TERRAIN,
  UNITS,
  UNIT_TYPE_IDS,
  buildCost,
  buildPlan,
  buildPlayerView,
  cityCenterYields,
  cityEconomy,
  cloneJson,
  createGame,
  diffViews,
  distance,
  findSpawnTile,
  foodToGrow,
  foundCityError,
  improvementFits,
  neighbors,
  nextInt,
  pick,
  resolveTurn,
  seedRng,
  tileIsWater,
  tileMoveCost,
  tileYields,
} from '../src/index';
import type { Action, BuildItem, City, CityEconomy, CityFocusId, GameState, PlayerId, RuleErrorCode, TileIndex, UnitTypeId } from '../src/index';
import {
  EAST,
  MEADOW,
  act,
  actWithEvents,
  arrange,
  at,
  citiesOf,
  cityOn,
  deepFreeze,
  endTurnForAll,
  foundCityAt,
  improve,
  newGame,
  placeUnit,
  playUntilBuilt,
  queueOf,
  refusal,
  send,
  setupFor,
  stepFrom,
  tamper,
  unitOf,
  unitsOf,
} from './rulesKit';
import { LONG_TEST } from './rulesRandomPlay';

/**
 * Tests for cities: founding them, where their citizens work, what they
 * produce each turn and where their units appear (rules/city.ts and the
 * foundCity action). The build queue has a file of its own
 * (rulesQueue.test.ts); the cases about it here are the ones that were here
 * before there was a queue.
 */

/** The unit types by where they move, each in the order of the build menu. A city without water builds the first four only. */
const LAND_UNITS: readonly UnitTypeId[] = UNIT_TYPE_IDS.filter((type) => UNITS[type].domain === 'land');
const BOATS: readonly UnitTypeId[] = UNIT_TYPE_IDS.filter((type) => UNITS[type].domain === 'sea');

/** Two players on the meadow: p1 at (3,5), p2 at (12,5). Their capitals stand inland and own no water. */
function meadowGame(): GameState {
  return newGame(MEADOW, [[3, 5], [12, 5]]);
}

/** p1's Settler founds a city on the start tile. */
function withCapital(state: GameState, playerId: PlayerId = 'p1'): GameState {
  return act(state, playerId, { type: 'foundCity', unitId: unitOf(state, playerId, 'settler').id });
}

/** The state with one more settler of `owner` on `tile`, and that settler's id. */
function withSettlerAt(state: GameState, owner: PlayerId, tile: TileIndex): { state: GameState; settlerId: string } {
  let settlerId = '';
  const next = arrange(state, (draft) => {
    settlerId = placeUnit(draft, owner, 'settler', tile).id;
  });
  return { state: next, settlerId };
}

/** What a settler of `owner` is told when it tries to found a city on `tile` (null = founded). */
function foundingRefusal(state: GameState, owner: PlayerId, tile: TileIndex): string | null {
  const ready = withSettlerAt(state, owner, tile);
  return refusal(ready.state, owner, { type: 'foundCity', unitId: ready.settlerId });
}

/**
 * A single enterable tile ringed by mountains two deep: a city founded on
 * it owns nothing a citizen could work and has no second tile for a unit.
 * `centre` is the character of the tile at (3,3).
 */
function lonelyPeak(centre: string): string[] {
  return [
    'm m m m m m m',
    ' m m m m m m m',
    'm m m m m m m',
    ` m m m ${centre} m m m`,
    'm m m m m m m',
    ' m m m m m m m',
    'm m m m m m m',
  ];
}

/**
 * A city at (3,3) whose six neighbors are one tile of each interesting
 * kind; everything further out is mountains, which nobody can work.
 *   north-west (3,2) grass     north-east (4,2) plains
 *   west       (2,3) forest    east       (4,3) grass
 *   south-west (3,4) hills     south-east (4,4) coast
 */
const SAMPLER: readonly string[] = [
  'm m m m m m m',
  ' m m m m m m m',
  'm m m g p m m',
  ' m m f g g m m',
  'm m m h , m m',
  ' m m m m m m m',
  'm m m m m m m',
];

/** A one-player game on `rows` with the capital founded at (3,3) and its population set. */
function cityAtCentre(rows: readonly string[], population = 1): { state: GameState; city: City } {
  const founded = withCapital(newGame(rows, [[3, 3]]));
  const state = arrange(founded, (draft) => {
    Object.values(draft.cities)[0].population = population;
  });
  return { state, city: Object.values(state.cities)[0] };
}

describe('applyAction: foundCity (WP2)', () => {
  it('consumes the settler and creates a population-1 city named from the civ list', () => {
    const start = meadowGame();
    const settler = unitOf(start, 'p1', 'settler');
    const warrior = unitOf(start, 'p1', 'warrior');

    const step = actWithEvents(start, 'p1', { type: 'foundCity', unitId: settler.id });
    const cities = Object.values(step.state.cities);
    expect(cities).toHaveLength(1);
    const city = cities[0];

    expect(city).toEqual({
      id: city.id,
      owner: 'p1',
      name: CIVS.rome.cityNames[0],
      tile: settler.tile,
      population: 1,
      foodStored: 0,
      buildQueue: [],
      productionStored: 0,
      focus: 'grow',
    });
    expect(city.id.startsWith('c1_')).toBe(true);
    expect(step.state.cities[city.id]).toBe(city);

    // The settler is gone; the warrior that stood with it stays, now inside the city.
    expect(step.state.units[settler.id]).toBeUndefined();
    expect(step.state.units[warrior.id]).toEqual(start.units[warrior.id]);
    expect(step.state.players[0].citiesFounded).toBe(1);
    expect(step.state.players[1].citiesFounded).toBe(0);

    expect(step.events).toEqual([
      { to: ['p1'], event: { type: 'cityFounded', playerId: 'p1', cityId: city.id, name: city.name, tile: settler.tile } },
    ]);
  });

  it('rejects a missing unit and another player\'s unit with noSuchUnit', () => {
    const start = meadowGame();
    expect(refusal(start, 'p1', { type: 'foundCity', unitId: unitOf(start, 'p2', 'settler').id })).toBe('noSuchUnit');
    expect(refusal(start, 'p1', { type: 'foundCity', unitId: 'u1_nobody' })).toBe('noSuchUnit');
    expect(refusal(start, 'p1', { type: 'foundCity', unitId: 'constructor' })).toBe('noSuchUnit');
  });

  it('claims every unowned tile within RULES.cityClaimRadius and leaves owned tiles alone', () => {
    // On the coast, next to a mountain: water and mountains are claimed like any other tile.
    const coastal = newGame(
      ['~ ~ ~ ~ ~ ~ ~ ~', ' ~ , g m g g g ~', '~ , g g g g g ~', ' ~ , g g g g g ~', '~ ~ ~ ~ ~ ~ ~ ~'],
      [[2, 2]],
    );
    const coastCity = withCapital(coastal);
    const coastCityId = Object.keys(coastCity.cities)[0];
    coastCity.map.tiles.forEach((tile, index) => {
      const inRadius = distance(index, at(coastal.map, 2, 2), coastal.map) <= RULES.cityClaimRadius;
      expect(tile.cityId, `tile ${index}`).toBe(inRadius ? coastCityId : null);
    });
    expect(coastCity.map.tiles[at(coastal.map, 0, 2)].terrain).toBe('ocean');
    expect(coastCity.map.tiles[at(coastal.map, 3, 1)].feature).toBe('mountains');

    // Two cities exactly minCityDistance apart: their radii overlap, and the
    // tiles in the overlap stay with the city that was there first.
    const start = meadowGame();
    const map = start.map;
    const first = withCapital(start);
    const firstCity = cityOn(first, at(map, 3, 5));
    const secondTile = at(map, 3 + RULES.minCityDistance, 5);
    const second = foundCityAt(first, 'p2', secondTile);
    const secondCity = cityOn(second, secondTile);

    let overlap = 0;
    second.map.tiles.forEach((tile, index) => {
      const nearFirst = distance(index, firstCity.tile, map) <= RULES.cityClaimRadius;
      const nearSecond = distance(index, secondTile, map) <= RULES.cityClaimRadius;
      if (nearFirst && nearSecond) overlap += 1;
      const expected = nearFirst ? firstCity.id : nearSecond ? secondCity.id : null;
      expect(tile.cityId, `tile ${index}`).toBe(expected);
    });
    expect(overlap).toBeGreaterThan(0);
  });

  it('rejects non-settlers (cannotFoundCity), spent settlers (noMovesLeft), bad ground (badCityTile)', () => {
    const start = meadowGame();
    const map = start.map;
    const warrior = unitOf(start, 'p1', 'warrior');
    const settler = unitOf(start, 'p1', 'settler');

    // Only settlers found cities.
    expect(refusal(start, 'p1', { type: 'foundCity', unitId: warrior.id })).toBe('cannotFoundCity');
    let scoutId = '';
    const withScout = arrange(start, (draft) => {
      scoutId = placeUnit(draft, 'p1', 'scout', at(map, 6, 5)).id;
    });
    expect(refusal(withScout, 'p1', { type: 'foundCity', unitId: scoutId })).toBe('cannotFoundCity');

    // A settler that has used all its moves must wait for the next turn; one with a move left may settle.
    const east = stepFrom(map, settler.tile, EAST);
    const oneStep = act(start, 'p1', { type: 'moveUnit', unitId: settler.id, path: [east] });
    expect(refusal(oneStep, 'p1', { type: 'foundCity', unitId: settler.id })).toBeNull();
    const twoSteps = act(oneStep, 'p1', { type: 'moveUnit', unitId: settler.id, path: [stepFrom(map, east, EAST)] });
    expect(twoSteps.units[settler.id].movesLeft).toBe(0);
    expect(refusal(twoSteps, 'p1', { type: 'foundCity', unitId: settler.id })).toBe('noMovesLeft');

    // Ground: forest refuses a city; hills, plains and desert take one.
    const grounds = newGame(['~ ~ ~ ~ ~ ~ ~', ' ~ f h p d F ~', '~ ~ ~ ~ ~ ~ ~'], [[2, 1]]);
    expect(foundingRefusal(grounds, 'p1', at(grounds.map, 1, 1)), 'forest on grassland').toBe('badCityTile');
    expect(foundingRefusal(grounds, 'p1', at(grounds.map, 5, 1)), 'forest on plains').toBe('badCityTile');
    expect(foundingRefusal(grounds, 'p1', at(grounds.map, 3, 1)), 'plains').toBeNull();
    expect(foundingRefusal(grounds, 'p1', at(grounds.map, 4, 1)), 'desert').toBeNull();
    expect(refusal(grounds, 'p1', { type: 'foundCity', unitId: unitOf(grounds, 'p1', 'settler').id }), 'hills').toBeNull();

    // The reasons come in the documented order: the unit type first, then its moves, then the ground.
    const tiredInForest = arrange(grounds, (draft) => {
      placeUnit(draft, 'p1', 'settler', at(grounds.map, 1, 1), 0);
      placeUnit(draft, 'p1', 'scout', at(grounds.map, 1, 1), 0);
    });
    const [tiredSettler] = unitsOf(tiredInForest, 'p1', 'settler').filter((unit) => unit.movesLeft === 0);
    expect(refusal(tiredInForest, 'p1', { type: 'foundCity', unitId: tiredSettler.id })).toBe('noMovesLeft');
    expect(refusal(tiredInForest, 'p1', { type: 'foundCity', unitId: unitOf(tiredInForest, 'p1', 'scout').id })).toBe('cannotFoundCity');
  });

  it('rejects founding on another player\'s territory (tileOwned) but allows it inside own territory', () => {
    const start = meadowGame();
    const map = start.map;
    const withThebes = withCapital(start, 'p2'); // p2's city at (12,5)
    const thebes = cityOn(withThebes, at(map, 12, 5));

    // Two tiles west of Thebes is Egyptian land. "Whose land" is answered
    // before "how close", so the answer is tileOwned, not tooCloseToCity.
    const onTheirLand = at(map, 10, 5);
    expect(withThebes.map.tiles[onTheirLand].cityId).toBe(thebes.id);
    expect(foundingRefusal(withThebes, 'p1', onTheirLand)).toBe('tileOwned');
    // And "what ground" is answered before "whose land": a forest there is simply bad ground.
    const theirForest = arrange(withThebes, (draft) => {
      draft.map.tiles[onTheirLand].feature = 'forest';
    });
    expect(foundingRefusal(theirForest, 'p1', onTheirLand)).toBe('badCityTile');

    // Inside one's own territory founding is allowed. With today's numbers
    // a city's own land ends before the minimum distance to it, so the test
    // stretches Rome's land by hand (as border growth will, one day).
    const withRome = withCapital(start);
    const rome = cityOn(withRome, at(map, 3, 5));
    const site = at(map, 3 + RULES.minCityDistance, 5);
    const beyond = stepFrom(map, site, EAST);
    const stretched = arrange(withRome, (draft) => {
      draft.map.tiles[site].cityId = rome.id;
      draft.map.tiles[beyond].cityId = rome.id;
    });
    const settled = foundCityAt(stretched, 'p1', site);
    const ostia = cityOn(settled, site);
    // The new centre changes hands; Rome keeps every other tile it had.
    expect(settled.map.tiles[site].cityId).toBe(ostia.id);
    expect(settled.map.tiles[beyond].cityId).toBe(rome.id);
    settled.map.tiles.forEach((tile, index) => {
      if (index === site) return;
      if (stretched.map.tiles[index].cityId === rome.id) expect(tile.cityId, `tile ${index}`).toBe(rome.id);
    });
    // The same stretched tile is closed to the other player.
    expect(foundingRefusal(stretched, 'p2', site)).toBe('tileOwned');
  });

  it('rejects a city closer than RULES.minCityDistance to any city (tooCloseToCity) and accepts exactly that distance', () => {
    const start = meadowGame();
    const map = start.map;
    const withRome = withCapital(start);
    const romeTile = at(map, 3, 5);

    // Too close to one's own city, at every distance below the minimum.
    for (let apart = 1; apart < RULES.minCityDistance; apart++) {
      const site = at(map, 3 + apart, 5);
      expect(distance(site, romeTile, map)).toBe(apart);
      expect(foundingRefusal(withRome, 'p1', site), `own city, ${apart} away`).toBe('tooCloseToCity');
    }
    expect(foundingRefusal(withRome, 'p1', at(map, 3 + RULES.minCityDistance, 5))).toBeNull();

    // Too close to somebody else's city, just outside its land.
    const justOutside = at(map, 3 + RULES.cityClaimRadius + 1, 5);
    expect(withRome.map.tiles[justOutside].cityId).toBeNull();
    expect(foundingRefusal(withRome, 'p2', justOutside)).toBe('tooCloseToCity');
    expect(foundingRefusal(withRome, 'p2', at(map, 3 + RULES.minCityDistance, 5))).toBeNull();

    // The distance is measured in every direction, not only along a row.
    const diagonal = at(map, 5, 2);
    expect(distance(diagonal, romeTile, map)).toBe(3);
    expect(foundingRefusal(withRome, 'p1', diagonal)).toBe('tooCloseToCity');
  });

  it('gives a second city the second name of the list', () => {
    const start = meadowGame();
    const map = start.map;
    const one = withCapital(start);
    const two = foundCityAt(one, 'p1', at(map, 7, 5));
    const three = foundCityAt(two, 'p1', at(map, 3, 1));
    expect(citiesOf(three, 'p1').map((city) => city.name)).toEqual(CIVS.rome.cityNames.slice(0, 3));
    expect(three.players[0].citiesFounded).toBe(3);

    // Another player's names start at the top of their own list, whatever the others have founded.
    const theirs = withCapital(three, 'p2');
    expect(citiesOf(theirs, 'p2').map((city) => city.name)).toEqual([CIVS.egypt.cityNames[0]]);
    expect(theirs.players[1].citiesFounded).toBe(1);

    // City ids carry the founder's seat and are all different.
    const ids = Object.keys(theirs.cities);
    expect(new Set(ids).size).toBe(4);
    expect(ids.map((id) => id.slice(0, 3))).toEqual(['c1_', 'c1_', 'c1_', 'c2_']);
  });

  it('foundCityError gives the same answer as the action, without changing anything', () => {
    const start = meadowGame();
    const settler = unitOf(start, 'p1', 'settler');
    const warrior = unitOf(start, 'p1', 'warrior');
    expect(foundCityError(start, settler)).toBeNull();
    expect(foundCityError(start, warrior)).toBe('cannotFoundCity');
    expect(foundCityError(start, { ...settler, movesLeft: 0 })).toBe('noMovesLeft');
  });
});

describe('city economy and production (WP2)', () => {
  it('works the centre for free with at least RULES.cityCenterMinYields', () => {
    const minimum = RULES.cityCenterMinYields;

    // Alone on a peak the city has nothing but its centre, whatever its citizens would like to do.
    for (const [centre, ground] of [
      ['d', { terrain: 'desert', feature: null }],
      ['p', { terrain: 'plains', feature: null }],
      ['g', { terrain: 'grassland', feature: null }],
      ['h', { terrain: 'grassland', feature: 'hills' }],
    ] as const) {
      const { state, city } = cityAtCentre(lonelyPeak(centre));
      const own = tileYields(ground);
      const economy = cityEconomy(state, city);
      expect(economy.worked, centre).toEqual([]);
      expect(economy.food, centre).toBe(Math.max(own.food, minimum.food));
      expect(economy.production, centre).toBe(Math.max(own.production, minimum.production));
      expect(economy.foodSurplus, centre).toBe(economy.food - RULES.foodPerCitizen * city.population);
    }
    // Desert and hills show the minimum at work for food.
    expect(TERRAIN.desert.yields.food).toBeLessThan(minimum.food);
    // For production it never bites with today's tables (all land gives at
    // least as much). What if the minimum is raised? Changed for a moment
    // and put back.
    const productionBefore = minimum.production;
    try {
      RULES.cityCenterMinYields.production = 3;
      const { state, city } = cityAtCentre(lonelyPeak('d'));
      expect(cityEconomy(state, city).production).toBe(3);
    } finally {
      RULES.cityCenterMinYields.production = productionBefore;
    }
    expect(RULES.cityCenterMinYields.production).toBe(productionBefore);

    // "For free": the single citizen of a new city works another tile on top of the centre.
    const meadow = withCapital(meadowGame());
    const rome = cityOn(meadow, at(meadow.map, 3, 5));
    const economy = cityEconomy(meadow, rome);
    const grass = TERRAIN.grassland.yields;
    expect(economy.worked).toHaveLength(1);
    expect(economy.worked).not.toContain(rome.tile);
    expect(economy.food).toBe(Math.max(grass.food, minimum.food) + grass.food);
    expect(economy.production).toBe(Math.max(grass.production, minimum.production) + grass.production);
  });

  it('assigns citizens by total yield, then food, then lower tile index, then swaps for food while the city would not grow', () => {
    const map = cityAtCentre(SAMPLER).state.map;
    // Best first. Both grass tiles give 2 food + 1 production: the lower
    // tile index goes first. Plains give 3 in total as well, but less food.
    // Coast, forest and hills all give 2 in total: more food goes first.
    const ranking = [
      at(map, 3, 2), // grass   2 + 1
      at(map, 4, 3), // grass   2 + 1
      at(map, 4, 2), // plains  1 + 2
      at(map, 4, 4), // coast   2 + 0
      at(map, 2, 3), // forest  1 + 1
      at(map, 3, 4), // hills   0 + 2
    ];

    for (let population = 1; population <= ranking.length; population++) {
      const { state, city } = cityAtCentre(SAMPLER, population);
      const economy = cityEconomy(state, city);
      const expected = ranking.slice(0, population);
      expect(economy.worked, `population ${population}`).toEqual([...expected].sort((a, b) => a - b));

      // The totals are the centre plus exactly those tiles.
      const centre = tileYields(state.map.tiles[city.tile]);
      let food = Math.max(centre.food, RULES.cityCenterMinYields.food);
      let production = Math.max(centre.production, RULES.cityCenterMinYields.production);
      for (const tile of expected) {
        food += tileYields(state.map.tiles[tile]).food;
        production += tileYields(state.map.tiles[tile]).production;
      }
      expect(economy.food).toBe(food);
      expect(economy.production).toBe(production);
      expect(economy.foodSurplus).toBe(food - RULES.foodPerCitizen * population);
    }
  });

  it('never works mountains, tiles of other cities, or more tiles than citizens', () => {
    // More citizens than workable tiles: the six neighbors are worked, the
    // mountains never, and the citizens left over work nothing.
    const crowded = cityAtCentre(SAMPLER, 10);
    const economy = cityEconomy(crowded.state, crowded.city);
    expect(economy.worked).toHaveLength(6);
    for (const tile of economy.worked) expect(crowded.state.map.tiles[tile].feature).not.toBe('mountains');
    expect(economy.foodSurplus).toBe(economy.food - RULES.foodPerCitizen * 10);

    // Never more tiles than citizens.
    for (const population of [1, 2, 3]) {
      const { state, city } = cityAtCentre(SAMPLER, population);
      expect(cityEconomy(state, city).worked).toHaveLength(population);
    }

    // Two neighboring cities, both huge: each works only tiles that are its own.
    const start = meadowGame();
    const map = start.map;
    const both = arrange(foundCityAt(withCapital(start), 'p2', at(map, 3 + RULES.minCityDistance, 5)), (draft) => {
      for (const city of Object.values(draft.cities)) city.population = 30;
    });
    const worked: TileIndex[] = [];
    for (const city of Object.values(both.cities)) {
      const cityWork = cityEconomy(both, city).worked;
      for (const tile of cityWork) expect(both.map.tiles[tile].cityId).toBe(city.id);
      expect(cityWork).not.toContain(city.tile);
      expect(cityWork).toEqual([...cityWork].sort((a, b) => a - b));
      worked.push(...cityWork);
    }
    expect(new Set(worked).size).toBe(worked.length); // no tile is worked twice

    // Units standing on a tile do not matter: a foreign warrior on the best tile changes nothing.
    const peaceful = cityAtCentre(SAMPLER, 1);
    const occupied = arrange(peaceful.state, (draft) => {
      // A second player, made up on the spot (this one-player map has no room for a real start).
      draft.players.push({ ...cloneJson(draft.players[0]), id: 'p2', name: 'Ben', civ: 'egypt' });
      placeUnit(draft, 'p2', 'warrior', at(draft.map, 3, 2));
    });
    expect(cityEconomy(occupied, peaceful.city)).toEqual(cityEconomy(peaceful.state, peaceful.city));
  });

  it('setBuildQueue: rejects foreign or missing cities (noSuchCity) and unknown items (cannotBuild), keeps stored production', () => {
    const start = withCapital(meadowGame());
    const rome = cityOn(start, at(start.map, 3, 5));
    const scout: BuildItem = { kind: 'unit', unitType: 'scout' };

    expect(refusal(start, 'p2', { type: 'setBuildQueue', cityId: rome.id, queue: [scout] })).toBe('noSuchCity');
    for (const id of ['c1_nowhere', 'constructor', '__proto__', '']) {
      expect(refusal(start, 'p1', { type: 'setBuildQueue', cityId: id, queue: [scout] }), id).toBe('noSuchCity');
    }

    const unknownItems: unknown[] = [
      { kind: 'building', unitType: 'scout' },
      { kind: 'unit', unitType: 'dragon' },
      { kind: 'unit', unitType: 'constructor' },
      { kind: 'unit', unitType: 3 },
      { kind: 'unit' },
      {},
    ];
    for (const item of unknownItems) {
      const action = { type: 'setBuildQueue' as const, cityId: rome.id, queue: [item as BuildItem] };
      expect(refusal(start, 'p1', action), JSON.stringify(item)).toBe('cannotBuild');
      // "Whose city" is answered first.
      expect(refusal(start, 'p2', action), JSON.stringify(item)).toBe('noSuchCity');
    }

    // Every land unit of the table can be chosen. (Rome stands inland: a boat is refused, and nothing is stored.)
    for (const unitType of LAND_UNITS) {
      const chosen = act(start, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf(unitType) });
      expect(chosen.cities[rome.id].buildQueue).toEqual([{ kind: 'unit', unitType }]);
    }
    for (const unitType of BOATS) {
      expect(refusal(start, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf(unitType) }), unitType).toBe('noWaterForBoat');
      // "Whose city" is answered first here too.
      expect(refusal(start, 'p2', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf(unitType) }), unitType).toBe('noSuchCity');
    }
    expect(LAND_UNITS.length + BOATS.length).toBe(UNIT_TYPE_IDS.length);

    // Switching keeps what was stored, and changes nothing else about the city.
    const halfBuilt = arrange(start, (draft) => {
      draft.cities[rome.id].buildQueue = queueOf('warrior');
      draft.cities[rome.id].productionStored = 7;
    });
    const switched = act(halfBuilt, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: [scout] });
    expect(switched.cities[rome.id]).toEqual({ ...halfBuilt.cities[rome.id], buildQueue: [scout] });

    // Only the known fields of an item are stored, whatever else a client sends along.
    const padded = { kind: 'unit', unitType: 'settler', note: 'x'.repeat(50) } as unknown as BuildItem;
    const stored = act(start, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: [padded] });
    expect(stored.cities[rome.id].buildQueue).toEqual([{ kind: 'unit', unitType: 'settler' }]);
  });

  it('buildCost and the options of buildPlan follow the unit table and what the city really does', () => {
    for (const unitType of UNIT_TYPE_IDS) expect(buildCost({ kind: 'unit', unitType })).toBe(UNITS[unitType].cost);

    const start = withCapital(meadowGame());
    const rome = cityOn(start, at(start.map, 3, 5));
    expect(cityEconomy(start, rome).production).toBeGreaterThan(0);

    for (const stored of [0, 1, 5, UNITS.scout.cost - 1, UNITS.scout.cost, UNITS.settler.cost + 40]) {
      const state = arrange(start, (draft) => {
        draft.cities[rome.id].productionStored = stored;
      });
      const options = buildPlan(state, state.cities[rome.id]).options;
      expect(options.map((option) => option.item)).toEqual(UNIT_TYPE_IDS.map((unitType) => ({ kind: 'unit', unitType })));
      for (const option of options) {
        const unitType = option.item.unitType;
        expect(option.cost).toBe(UNITS[unitType].cost);
        if (UNITS[unitType].domain === 'sea') {
          // Rome owns no water: a boat has its price, and never a number of turns.
          expect([option.turns, option.wait, option.addError], unitType).toEqual([null, 'noRoom', 'noWaterForBoat']);
          continue;
        }
        expect(option.wait).toBeNull();
        expect(option.addError).toBeNull();
        // Count the turn resolutions by playing: queue the item and end the
        // turn until the unit is there. (Dividing the cost by today's
        // production would be wrong: the city grows meanwhile, and a Settler
        // has to wait for the second citizen.)
        const queued = act(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf(unitType) });
        const played = playUntilBuilt(queued, rome.id, 1);
        expect(played.completions, `${unitType} with ${stored} stored`).toEqual([{ unitType, after: option.turns }]);
      }
    }
  });

  it('buildPlan gives no number of turns for a city that makes no production, and says why', () => {
    // No city makes 0 production with today's tables (the centre always
    // gives at least 1). This test asks "what if the numbers are tuned":
    // it changes two table entries for a moment and puts them back.
    const desertBefore = TERRAIN.desert.yields.production;
    const minimumBefore = RULES.cityCenterMinYields.production;
    try {
      TERRAIN.desert.yields.production = 0;
      RULES.cityCenterMinYields.production = 0;
      const { state, city } = (() => {
        const founded = withCapital(newGame(lonelyPeak('d'), [[3, 3]]));
        return { state: founded, city: Object.values(founded.cities)[0] };
      })();
      expect(cityEconomy(state, city).production).toBe(0);
      const plan = buildPlan(state, city);
      expect(plan.options).toHaveLength(UNIT_TYPE_IDS.length);
      for (const option of plan.options) {
        expect(option.turns, option.item.unitType).toBeNull();
        // The reason that will never pass comes before the one that might: the peak has no water for a boat.
        expect(option.wait, option.item.unitType).toBe(UNITS[option.item.unitType].domain === 'sea' ? 'noRoom' : 'noProduction');
      }
    } finally {
      TERRAIN.desert.yields.production = desertBefore;
      RULES.cityCenterMinYields.production = minimumBefore;
    }
    expect(TERRAIN.desert.yields.production).toBe(desertBefore);
    expect(RULES.cityCenterMinYields.production).toBe(minimumBefore);
  });

  it('findSpawnTile prefers the city tile, then the nearest free owned tile, else null', () => {
    const start = meadowGame();
    const map = start.map;
    const withRome = withCapital(start);
    const rome = cityOn(withRome, at(map, 3, 5));
    const warrior = unitOf(withRome, 'p1', 'warrior'); // stands in the city

    // The city tile, if a unit of that class fits: a civilian does, a second military unit does not.
    expect(findSpawnTile(withRome, rome, 'settler')).toBe(rome.tile);
    const nearest = Math.min(...[0, 1, 2, 3, 4, 5].map((direction) => stepFrom(map, rome.tile, direction)));
    expect(findSpawnTile(withRome, rome, 'warrior')).toBe(nearest);
    expect(findSpawnTile(withRome, rome, 'scout')).toBe(nearest);

    // An empty city takes the new unit itself.
    const emptied = arrange(withRome, (draft) => {
      draft.units[warrior.id].tile = at(map, 8, 8);
    });
    expect(findSpawnTile(emptied, rome, 'warrior')).toBe(rome.tile);

    // The whole first ring is taken (by own and by foreign units): the
    // nearest free tile is the lowest-numbered one of the second ring.
    const ringFull = arrange(withRome, (draft) => {
      [0, 1, 2, 3, 4, 5].forEach((direction, i) => {
        placeUnit(draft, i % 2 === 0 ? 'p1' : 'p2', 'scout', stepFrom(map, rome.tile, direction));
      });
    });
    const secondRing = map.tiles.map((_, tile) => tile).filter((tile) => distance(tile, rome.tile, map) === 2);
    expect(findSpawnTile(ringFull, rome, 'warrior')).toBe(Math.min(...secondRing));
    // A foreign unit closes its tile to both classes; an own military unit leaves room for a civilian.
    const withCivilianInCity = arrange(ringFull, (draft) => {
      placeUnit(draft, 'p1', 'settler', rome.tile);
    });
    const ownScoutTile = stepFrom(map, rome.tile, 0);
    const firstRingWithOwnScout = [0, 2, 4].map((direction) => stepFrom(map, rome.tile, direction));
    expect(firstRingWithOwnScout).toContain(ownScoutTile);
    expect(findSpawnTile(withCivilianInCity, rome, 'settler')).toBe(Math.min(...firstRingWithOwnScout));

    // Land of another city is never used, however close it is.
    const neighborTile = at(map, 3 + RULES.minCityDistance, 5);
    const twoCities = foundCityAt(withRome, 'p2', neighborTile);
    const thebes = cityOn(twoCities, neighborTile);
    const packed = arrange(twoCities, (draft) => {
      // Every tile of Thebes except one far corner holds an Egyptian warrior...
      for (let tile = 0; tile < draft.map.tiles.length; tile++) {
        if (draft.map.tiles[tile].cityId === thebes.id && tile !== thebes.tile) placeUnit(draft, 'p2', 'scout', tile);
      }
      placeUnit(draft, 'p2', 'warrior', thebes.tile);
    });
    // ...so although Roman tiles next to Thebes are free, there is no room.
    expect(findSpawnTile(packed, thebes, 'warrior')).toBeNull();
    expect(findSpawnTile(packed, thebes, 'settler')).toBe(thebes.tile);

    // Mountains and water of the city's own land are skipped.
    const peak = withCapital(newGame(lonelyPeak('g'), [[3, 3]]));
    const peakCity = Object.values(peak.cities)[0];
    expect(findSpawnTile(peak, peakCity, 'warrior')).toBeNull(); // the starting warrior holds the only tile
    expect(findSpawnTile(peak, peakCity, 'settler')).toBe(peakCity.tile);
    const peakFull = arrange(peak, (draft) => {
      placeUnit(draft, 'p1', 'settler', peakCity.tile);
    });
    expect(findSpawnTile(peakFull, peakCity, 'settler')).toBeNull();
  });

  it('findSpawnTile never puts a unit on land of the city that lies across the water', () => {
    // A city on a spit of three tiles. One tile of sea to the east lies more
    // land, close enough to belong to the city. The tiles marked L and C are
    // sea or grassland, depending on the case:
    //   L  a way around from the spit to the far shore, outside the city's borders;
    //   C  the channel between the city and the far shore.
    const coast = (way: '~' | 'g', channel: '~' | 'g'): string[] =>
      [
        '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
        ' ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
        '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
        ' ~ g g g C g g g ~ ~ ~',
        '~ L ~ ~ ~ ~ ~ ~ L ~ ~',
        ' ~ L ~ ~ ~ ~ ~ ~ L ~ ~',
        '~ L L L L L L L L ~ ~',
        ' ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      ].map((row) => row.replaceAll('L', way).replaceAll('C', channel));

    /** The city on (3,3), its starting warrior inside, and own scouts on every other tile of the city on its side of the channel. */
    function crowded(way: '~' | 'g', channel: '~' | 'g'): { state: GameState; city: City; across: TileIndex } {
      const founded = withCapital(newGame(coast(way, channel), [[3, 3]]));
      const map = founded.map;
      const state = arrange(founded, (draft) => {
        placeUnit(draft, 'p1', 'scout', at(map, 2, 3));
        placeUnit(draft, 'p1', 'scout', at(map, 1, 3));
        if (channel === 'g') placeUnit(draft, 'p1', 'scout', at(map, 4, 3));
        // A Warrior first in the queue, and paid for: "held" is only ever said of a paid-for entry.
        const capital = draft.cities[Object.keys(draft.cities)[0]];
        capital.buildQueue = queueOf('warrior');
        capital.productionStored = UNITS.warrior.cost;
      });
      const city = cityOn(state, at(map, 3, 3));
      const across = at(map, 5, 3);
      // The far shore is the city's, two steps away, with nothing standing on it;
      // the way around (where there is one) is nobody's land.
      expect(state.map.tiles[across].cityId).toBe(city.id);
      expect(distance(city.tile, across, map)).toBe(2);
      expect(unitsOf(state, 'p1').some((unit) => unit.tile === across)).toBe(false);
      for (const [x, y] of [[1, 4], [1, 5], [4, 6], [8, 5], [8, 4]]) expect(state.map.tiles[at(map, x, y)].cityId).toBeNull();
      return { state, city, across };
    }

    // An islet: the free tile over there is no room, so the city waits, and says so.
    const islet = crowded('~', '~');
    expect(islet.state.map.tiles[at(islet.state.map, 4, 3)].terrain).toBe('ocean');
    expect(findSpawnTile(islet.state, islet.city, 'warrior')).toBeNull();
    expect(findSpawnTile(islet.state, islet.city, 'scout')).toBeNull();
    expect(buildPlan(islet.state, islet.city).held).toBe('noRoom');
    expect(buildPlan(islet.state, islet.city).queue).toEqual([
      { item: { kind: 'unit', unitType: 'warrior' }, cost: UNITS.warrior.cost, turns: null, wait: 'noRoom' },
    ]);
    expect(buildPlayerView(islet.state, 'p1').cities[0].own?.held).toBe('noRoom');
    // Not paid for, the same city is not held: nothing waits yet.
    const unpaid = arrange(islet.state, (draft) => {
      draft.cities[islet.city.id].productionStored = UNITS.warrior.cost - 1;
    });
    expect(buildPlan(unpaid, unpaid.cities[islet.city.id]).held).toBeNull();
    // A civilian still fits into the city itself, and a freed tile of the spit is taken at once.
    expect(findSpawnTile(islet.state, islet.city, 'settler')).toBe(islet.city.tile);
    const freed = arrange(islet.state, (draft) => {
      const scout = Object.values(draft.units).find((unit) => unit.tile === at(draft.map, 1, 3));
      if (scout !== undefined) delete draft.units[scout.id];
    });
    expect(findSpawnTile(freed, cityOn(freed, islet.city.tile), 'warrior')).toBe(at(freed.map, 1, 3));

    // The turn resolves the same way: the paid-for warrior does not appear over there.
    const waited = endTurnForAll(islet.state).state;
    expect(unitsOf(waited, 'p1', 'warrior')).toHaveLength(1);
    expect(unitsOf(waited, 'p1').some((unit) => unit.tile === islet.across)).toBe(false);
    expect(waited.cities[islet.city.id].productionStored).toBeGreaterThanOrEqual(UNITS.warrior.cost);

    // The far shore joined to the spit by a long way around, outside the
    // city's borders: still no room. The rule looks no further than the
    // city's own land, which is all its owner is sure to see; so the answer
    // (which the owner is shown) cannot depend on land out of their sight.
    const wayAround = crowded('g', '~');
    expect(findSpawnTile(wayAround.state, wayAround.city, 'warrior')).toBeNull();
    expect(buildPlan(wayAround.state, wayAround.city).held).toBe('noRoom');

    // The channel filled in: now the far shore is joined to the city by the
    // city's own land, and is room like any other.
    const filled = crowded('~', 'g');
    expect(filled.state.map.tiles[at(filled.state.map, 4, 3)].cityId).toBe(filled.city.id);
    expect(findSpawnTile(filled.state, filled.city, 'warrior')).toBe(filled.across);
    expect(buildPlan(filled.state, filled.city).held).toBeNull();
    expect(buildPlan(filled.state, filled.city).queue[0].turns).toBe(1);
  });

  it('buildPlan reads the city\'s own stored production, not another city\'s', () => {
    const start = meadowGame();
    const both = arrange(withCapital(withCapital(start), 'p2'), (draft) => {
      cityOn(draft, at(draft.map, 12, 5)).productionStored = UNITS.scout.cost - 1;
    });
    const rome = cityOn(both, at(both.map, 3, 5));
    const thebes = cityOn(both, at(both.map, 12, 5));
    const scoutOf = (city: City) => buildPlan(both, city).options.find((option) => option.item.unitType === 'scout');
    expect(scoutOf(thebes)?.turns).toBe(1);
    expect(scoutOf(rome)?.turns).toBeGreaterThan(1);
  });
});

describe('citizens: food before production while the city would not grow', () => {
  /**
   * The example of the rule: a city at (3,3) with two open grassland tiles
   * (g), coast (,), forest (f) and hills (h) around it. The hills get a Mine.
   */
  const MINE_TOWN: readonly string[] = [
    'm m m m m m m',
    ' m m m m m m m',
    'm m m g m m m',
    ' m m f g g m m',
    'm m m h , m m',
    ' m m m m m m m',
    'm m m m m m m',
  ];

  /** MINE_TOWN with a city of `population` at the centre and the Mine built on its hills. */
  function mineTown(population: number): { state: GameState; city: City } {
    const bare = cityAtCentre(MINE_TOWN, population);
    const state = arrange(bare.state, (draft) => improve(draft, at(draft.map, 3, 4), 'mine'));
    return { state, city: state.cities[bare.city.id] };
  }

  it('cityCenterYields is the tile\'s yields with the minimum applied to food and to production separately (grassland, desert, desert hills), and it is what cityEconomy counts for the centre', () => {
    const minimum = RULES.cityCenterMinYields;
    expect(minimum).toEqual({ food: 2, production: 1 }); // the numbers below are worked out for these

    expect(cityCenterYields({ terrain: 'grassland', feature: null })).toEqual({ food: 2, production: 1 });
    expect(cityCenterYields({ terrain: 'desert', feature: null })).toEqual({ food: 2, production: 1 }); // food lifted from 0
    expect(cityCenterYields({ terrain: 'desert', feature: 'hills' })).toEqual({ food: 2, production: 2 }); // food lifted, production its own
    expect(cityCenterYields({ terrain: 'plains', feature: null })).toEqual({ food: 2, production: 2 });

    // Each number has its own minimum.
    const before = { ...minimum };
    try {
      RULES.cityCenterMinYields.food = 1;
      RULES.cityCenterMinYields.production = 3;
      expect(cityCenterYields({ terrain: 'grassland', feature: null })).toEqual({ food: 2, production: 3 });
      expect(cityCenterYields({ terrain: 'desert', feature: 'hills' })).toEqual({ food: 1, production: 3 });
    } finally {
      RULES.cityCenterMinYields.food = before.food;
      RULES.cityCenterMinYields.production = before.production;
    }
    expect(RULES.cityCenterMinYields).toEqual(before);

    // A fresh object every time, and a Tile fits as well as a bare ground.
    const first = cityCenterYields({ terrain: 'grassland', feature: null });
    first.food = 99;
    expect(cityCenterYields({ terrain: 'grassland', feature: null }).food).toBe(2);

    // Alone on a peak a city has nothing but its centre: the economy is exactly cityCenterYields.
    for (const centre of ['g', 'd', 'D']) {
      const { state, city } = cityAtCentre(lonelyPeak(centre));
      const economy = cityEconomy(state, city);
      const expected = cityCenterYields(state.map.tiles[city.tile]);
      expect({ food: economy.food, production: economy.production }, centre).toEqual(expected);
    }
  });

  it('a farm lifts a tile above its unimproved neighbors in the citizens\' first choice', () => {
    const founded = withCapital(meadowGame());
    const rome = cityOn(founded, at(founded.map, 3, 5));
    const map = founded.map;

    // On the meadow every tile is the same grassland: the single citizen takes the one with the lowest index.
    const ownTiles = map.tiles.map((_, tile) => tile).filter((tile) => map.tiles[tile].cityId === rome.id && tile !== rome.tile);
    expect(cityEconomy(founded, rome).worked).toEqual([Math.min(...ownTiles)]);

    // A farm on the LAST of the city's tiles: the citizen goes there.
    const farmTile = Math.max(...ownTiles);
    const farmed = arrange(founded, (draft) => improve(draft, farmTile, 'farm'));
    const economy = cityEconomy(farmed, farmed.cities[rome.id]);
    expect(economy.worked).toEqual([farmTile]);
    expect(economy.food).toBe(cityEconomy(founded, rome).food + 1);
    expect(economy.production).toBe(cityEconomy(founded, rome).production);

    // With two citizens: the farm and the lowest plain tile.
    const two = arrange(farmed, (draft) => {
      draft.cities[rome.id].population = 2;
    });
    expect(cityEconomy(two, two.cities[rome.id]).worked).toEqual([Math.min(...ownTiles), farmTile]);
  });

  it('a city does not stop growing over a mine: with two grassland tiles, coast, forest and a mined hill, three citizens work grassland, grassland and coast', () => {
    const { state, city } = mineTown(3);
    const map = state.map;
    const [grassA, grassB] = [at(map, 3, 2), at(map, 4, 3)];
    const [forest, mine, coast] = [at(map, 2, 3), at(map, 3, 4), at(map, 4, 4)];
    expect(tileYields(map.tiles[mine])).toEqual({ food: 0, production: 5 });

    // The first choice would be the mine, grassland and grassland (5 + 3 + 3):
    // food 2 + 0 + 2 + 2 = 6 for three citizens who eat 6. The mine is given up for the coast.
    const economy = cityEconomy(state, city);
    expect(economy.worked).toEqual([grassA, grassB, coast].sort((a, b) => a - b));
    expect(economy.worked).not.toContain(mine);
    expect(economy.worked).not.toContain(forest);
    expect(economy.food).toBe(8);
    expect(economy.foodSurplus).toBe(2);
    expect(economy.production).toBe(1 + 1 + 1 + 0);

    // And so the city grows where it would have stood still for good.
    const grown = playUntilGrown(state, city.id);
    expect(grown.cities[city.id].population).toBe(4);

    // With fewer citizens it is the same: the mine is the first choice,
    // feeds nobody, and is given up for the best grassland tile not yet worked.
    expect(cityEconomy(mineTown(1).state, mineTown(1).city).worked).toEqual([grassA]);
    expect(cityEconomy(mineTown(2).state, mineTown(2).city).worked).toEqual([grassA, grassB].sort((a, b) => a - b));
  });

  /** Ends turns until the city has gained a citizen (at most 40 turns). */
  function playUntilGrown(state: GameState, cityId: string): GameState {
    const before = state.cities[cityId].population;
    let current = state;
    for (let turn = 0; turn < 40 && current.cities[cityId].population === before; turn++) current = endTurnForAll(current).state;
    return current;
  }

  it('the mine is worked once the city can afford it: the same city with a farm on one of the grassland tiles works the farm, the grassland and the mine', () => {
    const bare = mineTown(3);
    const map = bare.state.map;
    const farm = at(map, 4, 3);
    const state = arrange(bare.state, (draft) => improve(draft, farm, 'farm'));
    const city = state.cities[bare.city.id];

    // Mine 0 + 5, farm 3 + 1, grassland 2 + 1: food 2 + 0 + 3 + 2 = 7 against 6 eaten. Nothing to swap.
    const economy = cityEconomy(state, city);
    expect(economy.worked).toEqual([at(map, 3, 2), farm, at(map, 3, 4)].sort((a, b) => a - b));
    expect(economy.foodSurplus).toBe(1);
    expect(economy.production).toBe(1 + 1 + 1 + 5);
  });

  /**
   * A city drawn like a real capital: the city at (3,3) on grassland, and
   * around it eight open grassland tiles, eight plains tiles, one hill (3,4)
   * and one mountain (3,5). (The small MINE_TOWN above has two grassland
   * tiles; a generated capital has about fourteen open tiles, and there a
   * mine must still be worth its five Worker turns.)
   */
  const CAPITAL: readonly string[] = [
    'm m m m m m m',
    ' m m g g p m m',
    'm m g g p p m',
    ' m g g g p p m',
    'm m g h p p m',
    ' m m g m p m m',
    'm m m m m m m',
  ];

  /** CAPITAL with two citizens and a Mine on its hill; `farm` puts a Farm on the grassland at (4,3). */
  function capitalWithMine(farm: boolean): { state: GameState; city: City; mine: TileIndex; farmTile: TileIndex } {
    const bare = cityAtCentre(CAPITAL, 2);
    const mine = at(bare.state.map, 3, 4);
    const farmTile = at(bare.state.map, 2, 3);
    const state = arrange(bare.state, (draft) => {
      improve(draft, mine, 'mine');
      if (farm) improve(draft, farmTile, 'farm');
    });
    return { state, city: state.cities[bare.city.id], mine, farmTile };
  }

  it('the land of CAPITAL is what its comment says: 8 open grassland, 8 plains, one hill and one mountain around the city', () => {
    const { state, city } = cityAtCentre(CAPITAL, 2);
    const kinds = state.map.tiles
      .filter((tile, index) => tile.cityId === city.id && index !== city.tile)
      .map((tile) => tile.feature ?? tile.terrain)
      .sort();
    expect(kinds).toEqual([...Array<string>(8).fill('grassland'), 'hills', 'mountains', ...Array<string>(8).fill('plains')]);
  });

  it('a capital of two citizens with ONE farmed grassland works its mine: the farm feeds the citizen in the mine', () => {
    const { state, city, mine, farmTile } = capitalWithMine(true);

    // Mine 0 + 5 and farm 3 + 1 are the two best tiles; food 2 + 0 + 3 = 5 against 4 eaten: the city still grows.
    const economy = cityEconomy(state, city);
    expect(economy.worked).toEqual([farmTile, mine].sort((a, b) => a - b));
    expect(tileYields(state.map.tiles[mine])).toEqual({ food: 0, production: 5 });
    expect(tileYields(state.map.tiles[farmTile])).toEqual({ food: 3, production: 1 });
    expect(economy.foodSurplus).toBe(1);
    expect(economy.production).toBe(1 + 1 + 5);
  });

  it('the same capital WITHOUT the farm does not work its mine: the centre feeds one citizen and no bare tile feeds a second, so a citizen in the mine would stop the city growing', () => {
    const { state, city, mine } = capitalWithMine(false);
    const map = state.map;

    // The first choice is the mine and a grassland tile: food 2 + 0 + 2 = 4
    // against 4 eaten. The mine is given up for the next grassland tile.
    const economy = cityEconomy(state, city);
    expect(economy.worked).not.toContain(mine);
    expect(economy.worked).toEqual([at(map, 2, 1), at(map, 3, 1)]);
    expect(economy.foodSurplus).toBe(2);
    expect(economy.production).toBe(1 + 1 + 1);

    // Growing does not bring the mine into use: at every size at which the
    // city can still grow, the city without a farm leaves it alone.
    for (let population = 1; population <= 9; population++) {
      const growing = cityEconomy(state, { ...city, population });
      expect(growing.foodSurplus, `population ${population}`).toBeGreaterThanOrEqual(RULES.minFoodSurplus);
      expect(growing.worked, `population ${population}`).not.toContain(mine);
    }
    // Only a city that has grown as large as its land can feed works it:
    // ten citizens eat 20, and the centre, eight grassland and two plains
    // tiles give 20. Nothing lets this city grow, so the first choice
    // stands, and the mine is the best tile of the first choice.
    const full = cityEconomy(state, { ...city, population: 10 });
    expect(full.foodSurplus).toBeLessThanOrEqual(0);
    expect(full.worked).toContain(mine);
  });

  it('a capital whose open tiles all carry farms still works its mine from the second citizen on', () => {
    // A Worker that goes on farming must not push the mine out of use. With
    // the Mine at +2 a mined hill (0 + 4) was level with a farmed grassland
    // tile (3 + 1) and a farmed plains tile (2 + 2) and lost the tie on food:
    // every farm after the first pushed the mine one citizen back, and with
    // farms everywhere it was the last tile this capital took.
    const bare = capitalWithMine(false);
    const map = bare.state.map;
    const open = map.tiles
      .map((_, tile) => tile)
      .filter((tile) => map.tiles[tile].cityId === bare.city.id && tile !== bare.city.tile && improvementFits('farm', map.tiles[tile]));
    expect(open.length).toBe(16);
    const state = arrange(bare.state, (draft) => {
      for (const tile of open) improve(draft, tile, 'farm');
    });
    const city = state.cities[bare.city.id];
    const mine = bare.mine;

    // One citizen: the centre feeds exactly that citizen, so the city could
    // not grow with it in the mine. It works the best farm instead.
    const one = cityEconomy(state, { ...city, population: 1 });
    expect(one.worked).not.toContain(mine);
    expect(one.worked).toEqual([Math.min(...open)]);
    expect(one.foodSurplus).toBe(3);

    // Two citizens: the mine (0 + 5, the tile with the most to give) and a
    // farmed grassland tile (3 + 1). Food 2 + 0 + 3 = 5 against 4 eaten.
    const two = cityEconomy(state, { ...city, population: 2 });
    expect(two.worked).toEqual([Math.min(...open), mine].sort((a, b) => a - b));
    expect(two.foodSurplus).toBe(1);
    expect(two.production).toBe(1 + 5 + 1);

    // And at every size after that, up to the size at which every tile is
    // worked: the mine stays in use and the city can still grow.
    for (let population = 2; population <= open.length + 1; population++) {
      const economy = cityEconomy(state, { ...city, population });
      expect(economy.worked, `population ${population}`).toContain(mine);
      expect(economy.foodSurplus, `population ${population}`).toBeGreaterThanOrEqual(RULES.minFoodSurplus);
    }
  });

  it('a city of 2 on plains that owns coast gives up one plains tile for the coast and grows', () => {
    // The stall phase 1 had: two plains tiles outrank the coast, and feed nobody.
    const rows = [
      'm m m m m m m',
      ' m m m m m m m',
      'm m m p m m m',
      ' m m m p p m m',
      'm m m m , m m',
      ' m m m m m m m',
      'm m m m m m m',
    ];
    const { state, city } = cityAtCentre(rows, 2);
    const map = state.map;
    const [plainsLow, plainsHigh, coast] = [at(map, 3, 2), at(map, 4, 3), at(map, 4, 4)];

    const economy = cityEconomy(state, city);
    // Both plains tiles are alike: the one with the higher index is given up.
    expect(economy.worked).toEqual([plainsLow, coast]);
    expect(economy.worked).not.toContain(plainsHigh);
    expect(economy.foodSurplus).toBe(1);

    const grown = playUntilGrown(state, city.id);
    expect(grown.cities[city.id].population).toBe(3);

    // With one citizen there is nothing to cure: plains, and a surplus of 1.
    const one = cityAtCentre(rows, 1);
    expect(cityEconomy(one.state, one.city).worked).toEqual([plainsLow]);
    expect(cityEconomy(one.state, one.city).foodSurplus).toBe(1);
  });

  it('the swap gives up the tile with the least food and takes the spare tile with the most, and breaks ties as documented', () => {
    // WHICH TILE IS GIVEN UP. Seven citizens; around the city a mined hill
    // (X: 0 food, 5 production), two bare hills (h: 0 food, 2 production)
    // and ocean (~: 1 food), and in the city's own row four grassland tiles
    // that all carry a farm (3 food, 1 production). First choice: the four
    // farms, the mine and both hills, 14 food for 14 eaten. One swap, for
    // the ocean, lets the city grow. The mine and both hills have the least
    // food; the tie goes to the lower total (a hill, not the mine), and then
    // to the HIGHER tile index. The four drawings put the same tiles in
    // another order; the rule does not care.
    for (const ring of ['X h h ~', '~ h h X', 'h X ~ h', 'h ~ X h']) {
      const [a, b, c, d] = ring.split(' ');
      const rows = [
        'm m m m m m m',
        ' m m m m m m m',
        `m m m ${a} ${b} m m`,
        ' m g g g g g m',
        `m m m ${c} ${d} m m`,
        ' m m m m m m m',
        'm m m m m m m',
      ].map((row) => row.replaceAll('X', 'h'));
      const size = { width: 7, height: 7 };
      const spots = [at(size, 3, 2), at(size, 4, 2), at(size, 3, 4), at(size, 4, 4)];
      const farms = [at(size, 1, 3), at(size, 2, 3), at(size, 4, 3), at(size, 5, 3)];
      const drawn = [a, b, c, d];
      const mine = spots[drawn.indexOf('X')];
      const ocean = spots[drawn.indexOf('~')];
      const hills = spots.filter((_, index) => drawn[index] === 'h');
      const bare = cityAtCentre(rows, 7);
      const state = arrange(bare.state, (draft) => {
        improve(draft, mine, 'mine');
        for (const tile of farms) improve(draft, tile, 'farm');
      });
      const economy = cityEconomy(state, state.cities[bare.city.id]);
      expect(economy.worked, ring).toEqual([...farms, mine, Math.min(...hills), ocean].sort((x, y) => x - y));
      expect(economy.food, ring).toBe(2 + 4 * 3 + 1);
      expect(economy.foodSurplus, ring).toBe(1);
    }

    // WHICH SPARE TILE IS TAKEN. Two mined hills (X) are the first choice of
    // the citizens; spare are a forest (f: 1 food, 1 production) and two
    // ocean tiles (~: 1 food). All three have the most food; the tie goes to
    // the higher total (the forest), and then to the LOWER tile index.
    for (const ring of ['X X f ~ ~', '~ ~ f X X', '~ f ~ X X', 'X ~ X ~ f', 'f X ~ X ~']) {
      const drawn = ring.split(' ');
      /** The land with the tile east of the city as mountains ('m') or as grassland that carries a farm ('g'). */
      const rowsWith = (east: 'm' | 'g'): string[] =>
        [
          'm m m m m m m',
          ' m m m m m m m',
          `m m m ${drawn[0]} ${drawn[1]} m m`,
          ` m m ${drawn[2]} g ${east} m m`,
          `m m m ${drawn[3]} ${drawn[4]} m m`,
          ' m m m m m m m',
          'm m m m m m m',
        ].map((row) => row.replaceAll('X', 'h'));
      const size = { width: 7, height: 7 };
      const spots = [at(size, 3, 2), at(size, 4, 2), at(size, 2, 3), at(size, 3, 4), at(size, 4, 4)];
      const east = at(size, 4, 3);
      const mines = spots.filter((_, index) => drawn[index] === 'X');
      const oceans = spots.filter((_, index) => drawn[index] === '~');
      const forest = spots[drawn.indexOf('f')];

      const withMines = (population: number, farm: boolean): { state: GameState; city: City } => {
        const bare = cityAtCentre(rowsWith(farm ? 'g' : 'm'), population);
        const state = arrange(bare.state, (draft) => {
          for (const tile of mines) improve(draft, tile, 'mine');
          if (farm) improve(draft, east, 'farm');
        });
        return { state, city: state.cities[bare.city.id] };
      };

      // One citizen: the first mine (lower index) is the first choice; it is given up for the forest.
      const one = withMines(1, false);
      expect(cityEconomy(one.state, one.city).worked, ring).toEqual([forest]);

      // Three citizens and a farm east of the city: the first choice is the
      // farm and both mines, 5 food for 6 eaten. The first swap takes the
      // forest, the second the ocean tile with the lower index; then the
      // city grows, and the other ocean tile stays spare.
      const three = withMines(3, true);
      const economy = cityEconomy(three.state, three.city);
      expect(economy.worked, ring).toEqual([east, forest, Math.min(...oceans)].sort((x, y) => x - y));
      expect(economy.foodSurplus, ring).toBe(1);
    }
  });

  it('a city that cannot reach the aim keeps its first choice (it used to end with the most food its land gives); a city with more citizens than tiles is left alone', () => {
    // Around the city: two mined hills (X), bare hills (h), two ocean tiles
    // (~) and desert (d). Three citizens would need 6 food; the land gives
    // the centre's 2 and one more from each ocean tile.
    const rows = [
      'm m m m m m m',
      ' m m m m m m m',
      'm m m h h m m',
      ' m m h g ~ m m',
      'm m m ~ d m m',
      ' m m m m m m m',
      'm m m m m m m',
    ];
    const bare = cityAtCentre(rows, 3);
    const map = bare.state.map;
    const mines = [at(map, 3, 2), at(map, 4, 2)];
    const state = arrange(bare.state, (draft) => {
      for (const tile of mines) improve(draft, tile, 'mine');
    });
    const city = state.cities[bare.city.id];
    const economy = cityEconomy(state, city);

    // The most food any three of its tiles give, worked out the plain way.
    const candidates = map.tiles.map((_, tile) => tile).filter((tile) => state.map.tiles[tile].cityId === city.id && tile !== city.tile);
    const foods = candidates
      .filter((tile) => state.map.tiles[tile].feature !== 'mountains')
      .map((tile) => tileYields(state.map.tiles[tile]).food)
      .sort((a, b) => b - a);
    const most = cityCenterYields(state.map.tiles[city.tile]).food + foods[0] + foods[1] + foods[2];
    expect(most).toBe(4);
    expect(most - 6).toBeLessThan(RULES.minFoodSurplus); // whatever the citizens do, the city does not grow
    // So nothing is given up for food that would change nothing: both mines
    // and the bare hills, the three best tiles, as the first choice has it.
    expect(economy.worked).toEqual([mines[0], mines[1], at(map, 2, 3)].sort((a, b) => a - b));
    expect(economy.food).toBe(2);
    expect(economy.foodSurplus).toBe(2 - 6); // short: the store runs empty, and the city never shrinks
    expect(economy.production).toBe(1 + 5 + 5 + 2);

    // More citizens than tiles: every tile is worked, nothing is spare, nothing is swapped.
    const crowded = cityAtCentre(SAMPLER, 10);
    const all = cityEconomy(crowded.state, crowded.city);
    expect(all.worked).toHaveLength(6);
    expect(all.foodSurplus).toBeLessThan(RULES.minFoodSurplus);
    // No tile is listed twice, whatever was swapped.
    expect(new Set(economy.worked).size).toBe(economy.worked.length);
  });

  /**
   * Plains by the sea, a common start: the city at (3,3) on plains, and
   * around it twelve plains tiles (1 food, 2 production), five coast tiles
   * (2 food) and one ocean tile (1 food).
   */
  const PLAINS_BY_THE_SEA: readonly string[] = [
    'm m m m m m m',
    ' m m , , , m m',
    'm m p p , , m',
    ' m p p p p ~ m',
    'm m p p p p m',
    ' m m p p p m m',
    'm m m m m m m',
  ];

  it('a city that cannot grow whatever its citizens do keeps its first choice: seven citizens on twelve plains, five coast and one ocean work seven plains', () => {
    const { state, city } = cityAtCentre(PLAINS_BY_THE_SEA, 7);
    const map = state.map;
    const own = map.tiles.map((_, tile) => tile).filter((tile) => map.tiles[tile].cityId === city.id && tile !== city.tile);
    expect(own.map((tile) => map.tiles[tile].terrain).sort()).toEqual([
      ...Array<string>(5).fill('coast'),
      'ocean',
      ...Array<string>(12).fill('plains'),
    ]);

    // The most food seven citizens can find: the centre's 2, five coast
    // tiles and two plains tiles, 14 in all, and they eat 14. The city
    // cannot grow, wherever they work.
    const foods = own.map((tile) => tileYields(map.tiles[tile]).food).sort((a, b) => b - a);
    const most = cityCenterYields(map.tiles[city.tile]).food + foods.slice(0, 7).reduce((sum, food) => sum + food, 0);
    expect(most - RULES.foodPerCitizen * 7).toBe(0);

    // So they stay where the first choice put them, on the seven plains
    // tiles with the lowest index: 14 production from the tiles and 2 from
    // the centre. (Swapped for the coast they made 6, for food nobody could use.)
    const plains = own.filter((tile) => map.tiles[tile].terrain === 'plains');
    const economy = cityEconomy(state, city);
    expect(economy.worked).toEqual(plains.slice(0, 7));
    expect(economy.production).toBe(2 + 14);
    expect(economy.food).toBe(2 + 7);
    expect(economy.foodSurplus).toBe(9 - 14);

    // The shortage empties the food store and never costs a citizen.
    let played = arrange(state, (draft) => {
      draft.cities[city.id].foodStored = 7;
    });
    for (let turn = 1; turn <= 5; turn++) {
      played = endTurnForAll(played).state;
      expect(played.cities[city.id].population, `after ${turn} turns`).toBe(7);
      expect(played.cities[city.id].foodStored, `after ${turn} turns`).toBe(turn === 1 ? 2 : 0);
    }

    // Growing first stays the rule for a city that CAN grow: with six
    // citizens the same land gives 13 food for 12 eaten, so five of them go
    // to sea and the city makes 4 production until it has grown.
    const six = cityAtCentre(PLAINS_BY_THE_SEA, 6);
    const growing = cityEconomy(six.state, six.city);
    expect(growing.foodSurplus).toBe(1);
    expect(growing.production).toBe(2 + 2);
    expect(growing.worked.filter((tile) => map.tiles[tile].terrain === 'coast')).toHaveLength(5);
  });

  it('with RULES.minFoodSurplus set to 2 for a moment, a city whose land gives a surplus of 1 at most keeps its swaps and goes on growing', () => {
    // The first choice comes back only for a city that cannot grow at all,
    // not for one that grows more slowly than the aim asks for.
    const { state, city } = cityAtCentre(PLAINS_BY_THE_SEA, 6);
    const before = RULES.minFoodSurplus;
    try {
      RULES.minFoodSurplus = 2;
      const economy = cityEconomy(state, city);
      expect(economy.foodSurplus).toBe(1);
      expect(economy.production).toBe(2 + 2);
    } finally {
      RULES.minFoodSurplus = before;
    }
    expect(RULES.minFoodSurplus).toBe(before);
  });

  it('with RULES.minFoodSurplus set to 0 for a moment, a city that makes exactly what it eats keeps its first choice', () => {
    const { state, city } = mineTown(3);
    const map = state.map;
    const before = RULES.minFoodSurplus;
    try {
      RULES.minFoodSurplus = 0;
      const economy = cityEconomy(state, city);
      // The mine, grassland and grassland: 6 food for 6 eaten is enough now.
      expect(economy.worked).toEqual([at(map, 3, 2), at(map, 4, 3), at(map, 3, 4)].sort((a, b) => a - b));
      expect(economy.foodSurplus).toBe(0);
      expect(economy.production).toBe(1 + 1 + 1 + 5);

      // And an aim of 0 that the swaps reach is reached: seven citizens by
      // the sea give up plains for coast until they make what they eat, and
      // keep those swaps (with the usual aim of 1 they could not grow, and
      // kept their first choice).
      const bySea = cityAtCentre(PLAINS_BY_THE_SEA, 7);
      expect(cityEconomy(bySea.state, bySea.city)).toMatchObject({ foodSurplus: 0, production: 2 + 2 * 2 });
    } finally {
      RULES.minFoodSurplus = before;
    }
    expect(RULES.minFoodSurplus).toBe(before);
    expect(cityEconomy(state, city).foodSurplus).toBe(2); // and the rule is back
  });

  it('cityEconomy reads nothing of the city but its id, tile, population and focus', () => {
    const { state, city } = mineTown(3);
    const usual = cityEconomy(state, city);
    const other: City = {
      id: city.id,
      owner: 'p9',
      name: 'Somewhere else',
      tile: city.tile,
      population: city.population,
      foodStored: 500,
      buildQueue: queueOf('settler', 'worker', 'scout'),
      productionStored: 900,
      focus: city.focus,
    };
    expect(cityEconomy(state, other)).toEqual(usual);
    // The four it does read each change the answer.
    expect(cityEconomy(state, { ...city, population: 2 })).not.toEqual(usual);
    expect(cityEconomy(state, { ...city, id: 'c1_nowhere' }).worked).toEqual([]);
    expect(cityEconomy(state, { ...city, tile: at(state.map, 3, 2) }).worked).toContain(city.tile);
    expect(city.focus).toBe('grow');
    expect(cityEconomy(state, { ...city, focus: 'build' })).not.toEqual(usual);
    expect(cityEconomy(state, { ...city, focus: 'build' }).worked).toContain(at(state.map, 3, 4)); // the mine, which Grow gave up
    // Pure: the same answer again, as a new object, and the state is not touched.
    const frozen = deepFreeze(cloneJson(state));
    expect(cityEconomy(frozen, frozen.cities[city.id])).toEqual(usual);
    expect(cityEconomy(frozen, frozen.cities[city.id])).not.toBe(cityEconomy(frozen, frozen.cities[city.id]));
  });

  it('on three hundred random lands: citizens are placed as the two steps say, and a city that could grow does grow', () => {
    // A second, plain reading of the rule, written from its sentences with
    // sorting where cityEconomy searches: the two must agree on every land.
    interface Candidate {
      tile: TileIndex;
      food: number;
      production: number;
    }
    const byFirstChoice = (a: Candidate, b: Candidate): number =>
      b.food + b.production - (a.food + a.production) || b.food - a.food || a.tile - b.tile;
    const givenUpFirst = (a: Candidate, b: Candidate): number =>
      a.food - b.food || a.food + a.production - (b.food + b.production) || b.tile - a.tile;
    const takenFirst = (a: Candidate, b: Candidate): number =>
      b.food - a.food || b.food + b.production - (a.food + a.production) || a.tile - b.tile;

    const dice = seedRng('random lands', 'citizens');
    const kinds = ['g', 'g', 'p', 'd', 'f', 'h', 'H', 'D', ',', '~', 'm'];
    let swapped = 0;
    let short = 0;
    let fed = 0;

    for (let land = 0; land < 300; land++) {
      // A city at (3,3) of a 7 x 7 map; every other tile is of a random kind.
      const rows: string[] = [];
      for (let y = 0; y < 7; y++) {
        const row: string[] = [];
        for (let x = 0; x < 7; x++) row.push(x === 3 && y === 3 ? 'g' : pick(dice, kinds));
        rows.push((y % 2 === 1 ? ' ' : '') + row.join(' '));
      }
      const population = 1 + nextInt(dice, 9);
      const bare = cityAtCentre(rows, population);
      // About every third tile of the city that can take an improvement has one.
      const state = arrange(bare.state, (draft) => {
        draft.map.tiles.forEach((tile, index) => {
          if (tile.cityId === null || index === bare.city.tile || nextInt(dice, 3) !== 0) return;
          if (improvementFits('farm', tile)) improve(draft, index, 'farm');
          else if (improvementFits('mine', tile)) improve(draft, index, 'mine');
        });
      });
      const city = state.cities[bare.city.id];
      const what = `land ${land}: ${rows.join(' / ')}, population ${population}`;

      // The plain reading.
      const centre = cityCenterYields(state.map.tiles[city.tile]);
      const candidates: Candidate[] = [];
      state.map.tiles.forEach((tile, index) => {
        if (tile.cityId !== city.id || index === city.tile || tile.feature === 'mountains') return;
        candidates.push({ tile: index, ...tileYields(tile) });
      });
      candidates.sort(byFirstChoice);
      const firstChoice = candidates.slice(0, population);
      const chosen = [...firstChoice];
      const spare = candidates.slice(population);
      const eaten = RULES.foodPerCitizen * population;
      const foodOf = (tiles: Candidate[]): number => centre.food + tiles.reduce((sum, candidate) => sum + candidate.food, 0);
      while (foodOf(chosen) - eaten < RULES.minFoodSurplus && chosen.length > 0 && spare.length > 0) {
        chosen.sort(givenUpFirst);
        spare.sort(takenFirst);
        if (spare[0].food <= chosen[0].food) break;
        const given = chosen[0];
        chosen[0] = spare[0];
        spare[0] = given;
      }
      // No placement lets the city grow: the first choice stands.
      const cannotGrow = foodOf(chosen) - eaten < RULES.minFoodSurplus && foodOf(chosen) - eaten <= 0;
      if (cannotGrow) chosen.splice(0, chosen.length, ...firstChoice);

      const economy = cityEconomy(state, city);
      expect(economy.worked, what).toEqual(chosen.map((candidate) => candidate.tile).sort((a, b) => a - b));
      expect(economy.food, what).toBe(foodOf(chosen));
      expect(economy.production, what).toBe(centre.production + chosen.reduce((sum, candidate) => sum + candidate.production, 0));
      expect(economy.foodSurplus, what).toBe(economy.food - eaten);

      // What follows from the rule, whatever the tie-breaks:
      const mostFood = centre.food + [...candidates].sort((a, b) => b.food - a.food).slice(0, population).reduce((sum, candidate) => sum + candidate.food, 0);
      if (foodOf(firstChoice) - eaten >= RULES.minFoodSurplus) {
        // The first choice feeds the city: nothing is swapped.
        expect(economy.worked, what).toEqual(firstChoice.map((candidate) => candidate.tile).sort((a, b) => a - b));
        fed += 1;
      } else if (mostFood - eaten >= RULES.minFoodSurplus) {
        // The land can feed the city: then it does, and the city grows.
        expect(economy.foodSurplus, what).toBeGreaterThanOrEqual(RULES.minFoodSurplus);
        swapped += 1;
      } else {
        // The land cannot, and the city cannot grow whatever its citizens
        // do: they keep their first choice.
        expect(mostFood - eaten, what).toBeLessThanOrEqual(0);
        expect(economy.worked, what).toEqual(firstChoice.map((candidate) => candidate.tile).sort((a, b) => a - b));
        expect(economy.food, what).toBe(foodOf(firstChoice));
        short += 1;
      }
    }
    // The lands were of every kind.
    expect(fed).toBeGreaterThan(20);
    expect(swapped).toBeGreaterThan(20);
    expect(short).toBeGreaterThan(20);
  });
});

/**
 * Rule F2 read a second time and plainly, with sorting where cityEconomy
 * searches: what a city's citizens gather under a way of placing them.
 * Anything that is not exactly 'build' is placed as Grow, with the three
 * steps cities have always taken.
 */
function economyByTheBook(state: GameState, city: City, focus: unknown): CityEconomy {
  interface Candidate {
    tile: TileIndex;
    food: number;
    production: number;
  }
  const centre = cityCenterYields(state.map.tiles[city.tile]);
  const candidates: Candidate[] = [];
  state.map.tiles.forEach((tile, index) => {
    if (tile.cityId !== city.id || index === city.tile || tile.feature === 'mountains') return;
    candidates.push({ tile: index, ...tileYields(tile) });
  });
  const eaten = RULES.foodPerCitizen * city.population;
  const foodOf = (tiles: Candidate[]): number => centre.food + tiles.reduce((sum, candidate) => sum + candidate.food, 0);

  let chosen: Candidate[];
  if (focus === 'build') {
    // The most production first; then the most food; then the lower tile. Nothing else.
    chosen = [...candidates].sort((a, b) => b.production - a.production || b.food - a.food || a.tile - b.tile).slice(0, city.population);
  } else {
    // 1. The best tiles by food + production, then food, then the lower tile.
    candidates.sort((a, b) => b.food + b.production - (a.food + a.production) || b.food - a.food || a.tile - b.tile);
    const firstChoice = candidates.slice(0, city.population);
    chosen = [...firstChoice];
    const spare = candidates.slice(city.population);
    // 2. While the city would not grow: the chosen tile with the least food for the spare tile with the most.
    while (foodOf(chosen) - eaten < RULES.minFoodSurplus && chosen.length > 0 && spare.length > 0) {
      chosen.sort((a, b) => a.food - b.food || a.food + a.production - (b.food + b.production) || b.tile - a.tile);
      spare.sort((a, b) => b.food - a.food || b.food + b.production - (a.food + a.production) || a.tile - b.tile);
      if (spare[0].food <= chosen[0].food) break;
      const given = chosen[0];
      chosen[0] = spare[0];
      spare[0] = given;
    }
    // 3. No placement lets the city grow: the first choice stands.
    if (foodOf(chosen) - eaten < RULES.minFoodSurplus && foodOf(chosen) - eaten <= 0) chosen = firstChoice;
  }
  return {
    worked: chosen.map((candidate) => candidate.tile).sort((a, b) => a - b),
    food: foodOf(chosen),
    production: centre.production + chosen.reduce((sum, candidate) => sum + candidate.production, 0),
    foodSurplus: foodOf(chosen) - eaten,
  };
}

describe('Grow first or Build first: the focus of a city (round 3)', () => {
  /** p1's capital on the meadow, and p2's Scout next to it with the city in full sight. */
  function watchedRome(): { state: GameState; rome: City } {
    const founded = arrange(withCapital(meadowGame()), (draft) => {
      placeUnit(draft, 'p2', 'scout', at(draft.map, 5, 5));
    });
    return { state: founded, rome: cityOn(founded, at(founded.map, 3, 5)) };
  }

  function focusAction(cityId: string, focus: unknown): Action {
    return { type: 'setCityFocus', cityId, focus } as Action;
  }

  /** The owner's view of the first city of a one-city game (or of p1's first city). */
  function ownDetail(state: GameState, playerId: PlayerId = 'p1') {
    const own = buildPlayerView(state, playerId).cities.find((city) => city.own !== null)?.own;
    if (own === null || own === undefined) throw new Error(`${playerId} has no city in the view`);
    return own;
  }

  it('a new city starts on grow', () => {
    expect(DEFAULT_CITY_FOCUS).toBe('grow');
    // No city before the first is founded; every city that is founded starts on the default.
    const start = meadowGame();
    expect(Object.keys(start.cities)).toEqual([]);
    let state = withCapital(withCapital(start), 'p2');
    state = foundCityAt(state, 'p1', at(state.map, 3, 1));
    expect(Object.values(state.cities)).toHaveLength(3);
    for (const city of Object.values(state.cities)) expect(city.focus, city.name).toBe(DEFAULT_CITY_FOCUS);
    // A city founded by a player whose first city is on Build still starts on Grow: the choice is the city's.
    const rome = cityOn(state, at(state.map, 3, 5));
    const building = act(state, 'p1', focusAction(rome.id, 'build'));
    const third = foundCityAt(building, 'p1', at(state.map, 7, 5));
    expect(cityOn(third, at(state.map, 7, 5)).focus).toBe('grow');
    expect(third.cities[rome.id].focus).toBe('build');
    // The owner is told, and nobody else is told anything.
    const told = buildPlayerView(third, 'p1').cities.filter((city) => city.own !== null);
    expect(told).toHaveLength(3);
    for (const city of told) expect(city.own?.focus, city.name).toBe(city.id === rome.id ? 'build' : 'grow');
    for (const city of buildPlayerView(third, 'p2').cities) if (city.owner === 'p1') expect(city.own).toBeNull();
  });

  it('setCityFocus: noSuchCity for a missing or foreign city; badAction for a focus that is no key of the table ("constructor" too); a no-op for the focus the city has; nothing but focus changes; refused after End Turn', () => {
    const { state, rome } = watchedRome();
    const before = arrange(state, (draft) => {
      Object.assign(draft.cities[rome.id], { foodStored: 3, productionStored: 7, population: 2 });
      draft.cities[rome.id].buildQueue = queueOf('warrior', 'settler');
    });
    const answer = (situation: GameState, playerId: PlayerId, cityId: string, focus: unknown): RuleErrorCode | null =>
      refusal(situation, playerId, focusAction(cityId, focus));

    // A city that is not the player's and a city that does not exist get one and the same answer,
    // whatever the focus is: ids cannot be probed.
    for (const focus of ['build', 'grow', 'fast', 'constructor', '']) {
      expect(answer(before, 'p2', rome.id, focus), `p2, '${focus}'`).toBe('noSuchCity');
      for (const cityId of ['c1_nowhere', 'c2_nowhere', 'constructor', '__proto__', 'toString', '']) {
        expect(answer(before, 'p1', cityId, focus), `${cityId}, '${focus}'`).toBe('noSuchCity');
      }
    }
    // A unit id is not a city id.
    expect(answer(before, 'p1', unitOf(before, 'p1', 'warrior').id, 'build')).toBe('noSuchCity');

    // One's own city and a focus that is no key of the table: a malformed action. The two values are a closed list.
    for (const focus of ['fast', '', 'Build', 'GROW', 'grow ', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'name']) {
      expect(answer(before, 'p1', rome.id, focus), `'${focus}'`).toBe('badAction');
    }
    // So is a focus that is no string at all, or none, or a city id that is no string (the shape check of applyAction).
    for (const action of [
      { type: 'setCityFocus', cityId: rome.id },
      { type: 'setCityFocus', cityId: rome.id, focus: 5 },
      { type: 'setCityFocus', cityId: rome.id, focus: null },
      { type: 'setCityFocus', cityId: rome.id, focus: ['build'] },
      { type: 'setCityFocus', cityId: rome.id, focus: { id: 'build' } },
      { type: 'setCityFocus', focus: 'build' },
      { type: 'setCityFocus', cityId: 7, focus: 'build' },
    ]) {
      expect(refusal(before, 'p1', action as unknown as Action), JSON.stringify(action)).toBe('badAction');
    }
    expect(before.cities[rome.id].focus).toBe('grow');

    // The real choice: nothing of the city changes but the focus, nothing else of the game changes, and nothing is news.
    const step = actWithEvents(before, 'p1', focusAction(rome.id, 'build'));
    expect(step.changed).toBe(true);
    expect(step.events).toEqual([]);
    expect(step.state.cities[rome.id]).toEqual({ ...before.cities[rome.id], focus: 'build' });
    expect(step.state.cities[rome.id]).toMatchObject({ foodStored: 3, productionStored: 7, population: 2, buildQueue: queueOf('warrior', 'settler') });
    expect({ ...step.state, cities: null }).toEqual({ ...before, cities: null });
    expect(Object.keys(step.state.cities[rome.id]).sort()).toEqual(
      ['buildQueue', 'focus', 'foodStored', 'id', 'name', 'owner', 'population', 'productionStored', 'tile'],
    );
    // Whatever else the action carried is not stored.
    const padded = act(before, 'p1', { type: 'setCityFocus', cityId: rome.id, focus: 'build', note: 'y'.repeat(40), population: 9 } as unknown as Action);
    expect(padded).toEqual(step.state);

    // The focus the city has already: accepted, and the very same state object comes back.
    for (const [situation, focus] of [[before, 'grow'], [step.state, 'build']] as [GameState, CityFocusId][]) {
      const again = send(situation, 'p1', focusAction(rome.id, focus));
      expect(again.ok).toBe(true);
      if (!again.ok) continue;
      expect(again.changed).toBe(false);
      expect(again.state).toBe(situation);
      expect(again.events).toEqual([]);
    }
    // And back again is the state it came from.
    expect(act(step.state, 'p1', focusAction(rome.id, 'grow'))).toEqual(before);

    // Like every order it needs the turn it was given in and a turn that is not ended.
    expect(refusal(before, 'p1', focusAction(rome.id, 'build'))).toBeNull();
    const ended = act(before, 'p1', { type: 'endTurn' });
    expect(ended.turn).toBe(before.turn); // p2 is still playing
    expect(answer(ended, 'p1', rome.id, 'build')).toBe('turnAlreadyEnded');
    expect(answer(ended, 'p1', 'c1_nowhere', 'fast')).toBe('turnAlreadyEnded');
    expect(answer(act(ended, 'p1', { type: 'cancelEndTurn' }), 'p1', rome.id, 'build')).toBeNull();
    for (const turn of [before.turn - 1, before.turn + 1]) {
      const stale = send(before, 'p1', focusAction(rome.id, 'build'), turn);
      expect(stale.ok ? null : stale.error.code).toBe('staleTurn');
    }
    // Somebody who is not in the game, and the order of the general checks: a stranger first, then the shape, then the turn.
    expect(answer(before, 'p9', rome.id, 'build')).toBe('badAction');
    const malformedAndStale = send(before, 'p1', { type: 'setCityFocus', cityId: rome.id } as unknown as Action, before.turn + 1);
    expect(malformedAndStale.ok ? null : malformedAndStale.error.code).toBe('badAction');

    // The other player, whose Scout stands next to the city, is sent nothing: their view is the same to the last character.
    const theirs = buildPlayerView(before, 'p2');
    expect(theirs.cities.find((city) => city.id === rome.id)).toMatchObject({ visible: true, own: null });
    expect(JSON.stringify(buildPlayerView(step.state, 'p2'))).toBe(JSON.stringify(theirs));
    expect(diffViews(theirs, buildPlayerView(step.state, 'p2'))).toBeNull();
    // The owner's view changed in its cities and nowhere else.
    expect(Object.keys(diffViews(buildPlayerView(before, 'p1'), buildPlayerView(step.state, 'p1')) ?? {})).toEqual(['cities']);
  });

  /**
   * A city at (3,3) on grassland with one tile of every kind that matters
   * to Build, and mountains everywhere else:
   *   (2,3) hills on plains, MINED (0 food, 5 production)
   *   (4,2) and (4,3) open plains (1, 2)        (3,2) hills on grassland (0, 2)
   *   (3,4) open grassland (2, 1)   (4,4) forest (1, 1)   (5,3) desert (0, 1)
   *   (2,5) coast with a NET (4, 0)   (3,5) coast (2, 0)   (4,5) ocean (1, 0)
   */
  const EVERY_KIND: readonly string[] = [
    'm m m m m m m',
    ' m m m m m m m',
    'm m m h p m m',
    ' m m H g p d m',
    'm m m g f m m',
    ' m m , , ~ m m',
    'm m m m m m m',
  ];

  it('build takes the tiles with the most production: ties by food, then by the lower tile; no tile is given up for food; with more citizens than tiles with production the net is first among the rest', () => {
    const bare = cityAtCentre(EVERY_KIND);
    const map = bare.state.map;
    const MINE = at(map, 2, 3);
    const NET = at(map, 2, 5);
    const withImprovements = arrange(bare.state, (draft) => {
      improve(draft, MINE, 'mine');
      improve(draft, NET, 'fishingNet');
    });
    // In the order Build takes them: production 5; 2, 2 (the lower plains tile first), 2 (hills: no food, so behind the plains
    // although its tile number is the lowest of the three); 1, 1, 1 by food; then the tiles without production, by food: the net first.
    const order: [TileIndex, number, number][] = [
      [MINE, 0, 5],
      [at(map, 4, 2), 1, 2],
      [at(map, 4, 3), 1, 2],
      [at(map, 3, 2), 0, 2],
      [at(map, 3, 4), 2, 1],
      [at(map, 4, 4), 1, 1],
      [at(map, 5, 3), 0, 1],
      [NET, 4, 0],
      [at(map, 3, 5), 2, 0],
      [at(map, 4, 5), 1, 0],
    ];
    for (const [tile, food, production] of order) {
      expect(withImprovements.map.tiles[tile].cityId, `tile ${tile}`).toBe(bare.city.id);
      expect(tileYields(withImprovements.map.tiles[tile]), `tile ${tile}`).toEqual({ food, production });
    }
    expect(at(map, 3, 2)).toBeLessThan(at(map, 4, 2));

    for (let population = 1; population <= order.length + 2; population++) {
      const state = arrange(withImprovements, (draft) => {
        Object.assign(draft.cities[bare.city.id], { population, focus: 'build' });
      });
      const taken = order.slice(0, population);
      const food = 2 + taken.reduce((sum, [, tileFood]) => sum + tileFood, 0);
      const economy = cityEconomy(state, state.cities[bare.city.id]);
      // Exactly the first tiles of the order. Citizens left over when the tiles run out gather nothing.
      expect(economy, `population ${population}`).toEqual({
        worked: taken.map(([tile]) => tile).sort((a, b) => a - b),
        food,
        production: 1 + taken.reduce((sum, [, , tileProduction]) => sum + tileProduction, 0),
        foodSurplus: food - 2 * population,
      });
      expect(economy, `population ${population}`).toEqual(economyByTheBook(state, state.cities[bare.city.id], 'build'));
      // The owner's panel prints these numbers.
      expect(ownDetail(state)).toMatchObject({ focus: 'build', worked: economy.worked, foodPerTurn: economy.foodSurplus, productionPerTurn: economy.production });
      // No tile is given up for food: up to seven citizens stand on the seven tiles with production
      // and eat more than they gather, while the net, with the most food of all, is left alone.
      if (population <= 7) {
        expect(economy.worked, `population ${population}`).not.toContain(NET);
        expect(economy.foodSurplus, `population ${population}`).toBeLessThanOrEqual(0);
      } else {
        // More citizens than tiles with production: the net is first among the rest.
        expect(economy.worked, `population ${population}`).toContain(NET);
      }
      // Grow, in the same city, never makes more production; here it makes less at every size with a choice.
      const grow = cityEconomy(state, { ...state.cities[bare.city.id], focus: 'grow' });
      expect(grow.production, `population ${population}`).toBeLessThanOrEqual(economy.production);
      if (population < order.length) expect(grow.worked, `population ${population}`).not.toEqual(economy.worked);
    }
    // RULES.minFoodSurplus is Grow's aim and is read under Grow only: with the aim set to 3 for a
    // moment, three citizens on Build stand where they stood, and three on Grow do not.
    const three = arrange(withImprovements, (draft) => {
      Object.assign(draft.cities[bare.city.id], { population: 3, focus: 'build' });
    });
    const buildUsual = cityEconomy(three, three.cities[bare.city.id]);
    const growUsual = cityEconomy(three, { ...three.cities[bare.city.id], focus: 'grow' });
    const aimBefore = RULES.minFoodSurplus;
    try {
      RULES.minFoodSurplus = 3;
      expect(cityEconomy(three, three.cities[bare.city.id])).toEqual(buildUsual);
      expect(cityEconomy(three, { ...three.cities[bare.city.id], focus: 'grow' })).not.toEqual(growUsual);
    } finally {
      RULES.minFoodSurplus = aimBefore;
    }
    expect(RULES.minFoodSurplus).toBe(1);

    // One citizen, for the eye: Build stands on the mine and the city stands still; Grow fishes.
    const one = arrange(withImprovements, (draft) => {
      draft.cities[bare.city.id].focus = 'build';
    });
    expect(cityEconomy(one, one.cities[bare.city.id])).toEqual({ worked: [MINE], food: 2, production: 6, foodSurplus: 0 });
    expect(cityEconomy(withImprovements, withImprovements.cities[bare.city.id])).toEqual({ worked: [NET], food: 6, production: 1, foodSurplus: 4 });
  });

  /** The city of the worked example: a hill to be mined (3,2), plains (4,2), grassland (4,3) and coast to be fished (3,4). */
  const EXAMPLE: readonly string[] = [
    'm m m m m m m',
    ' m m m m m m m',
    'm m m H p m m',
    ' m m m g g m m',
    'm m m , m m m',
    ' m m m m m m m',
    'm m m m m m m',
  ];

  /** The example city with two citizens, its mine and its net, on this focus. */
  function exampleCity(focus: CityFocusId): { state: GameState; city: City; tiles: Record<'mine' | 'plains' | 'grass' | 'net', TileIndex> } {
    const bare = cityAtCentre(EXAMPLE, 2);
    const map = bare.state.map;
    const tiles = { mine: at(map, 3, 2), plains: at(map, 4, 2), grass: at(map, 4, 3), net: at(map, 3, 4) };
    const state = arrange(bare.state, (draft) => {
      improve(draft, tiles.mine, 'mine');
      improve(draft, tiles.net, 'fishingNet');
      draft.cities[bare.city.id].focus = focus;
    });
    return { state, city: state.cities[bare.city.id], tiles };
  }

  it('the worked example of 3D: Grow gives food 6 and production 6, Build food 3 and production 8', () => {
    const grow = exampleCity('grow');
    const { mine, plains, grass, net } = grow.tiles;
    // The candidates are the four of the example, on a centre of 2 food and 1 production.
    expect(tileYields(grow.state.map.tiles[mine])).toEqual({ food: 0, production: 5 });
    expect(tileYields(grow.state.map.tiles[plains])).toEqual({ food: 1, production: 2 });
    expect(tileYields(grow.state.map.tiles[grass])).toEqual({ food: 2, production: 1 });
    expect(tileYields(grow.state.map.tiles[net])).toEqual({ food: 4, production: 0 });
    expect(cityCenterYields(grow.state.map.tiles[grow.city.tile])).toEqual({ food: 2, production: 1 });
    expect(grow.state.map.tiles.filter((tile) => tile.cityId === grow.city.id && tile.feature !== 'mountains')).toHaveLength(5);

    // Grow: the mined hill and the fished tile (5 and 4). Food 2 + 0 + 4 = 6, eaten 4, surplus +2: no swap.
    expect(cityEconomy(grow.state, grow.city)).toEqual({ worked: [mine, net].sort((a, b) => a - b), food: 6, production: 6, foodSurplus: 2 });
    // Build: the mined hill and the plains. Food 2 + 0 + 1 = 3, surplus -1. Production 1 + 5 + 2 = 8.
    const build = exampleCity('build');
    expect(cityEconomy(build.state, build.city)).toEqual({ worked: [mine, plains].sort((a, b) => a - b), food: 3, production: 8, foodSurplus: -1 });
    // The view of each says exactly that.
    expect(ownDetail(grow.state)).toMatchObject({ focus: 'grow', worked: [mine, net].sort((a, b) => a - b), foodPerTurn: 2, productionPerTurn: 6 });
    expect(ownDetail(build.state)).toMatchObject({ focus: 'build', worked: [mine, plains].sort((a, b) => a - b), foodPerTurn: -1, productionPerTurn: 8 });
  });

  it('a capital of two on build takes the hill and the plains and does not grow; on grow it grows; a city on build with a negative surplus loses its store and no citizen', () => {
    // Open grassland around the city, one hill (3,2) and one plains tile (4,2).
    const CAPITAL_OF_TWO: readonly string[] = [
      'm m m m m m m',
      ' m m m m m m m',
      'm m m h p m m',
      ' m m g g g m m',
      'm m m g g m m',
      ' m m m m m m m',
      'm m m m m m m',
    ];
    const bare = cityAtCentre(CAPITAL_OF_TWO, 2);
    const map = bare.state.map;
    const HILL = at(map, 3, 2);
    const PLAINS = at(map, 4, 2);
    const cityId = bare.city.id;
    const stocked = arrange(bare.state, (draft) => {
      draft.cities[cityId].foodStored = 3;
      draft.cities[cityId].buildQueue = queueOf('warrior', 'warrior', 'warrior', 'warrior', 'warrior', 'warrior', 'warrior', 'warrior');
    });

    // On Build: the two tiles with production 2 (the plains first: it has food), 3 food for 4 eaten.
    const building = act(stocked, 'p1', focusAction(cityId, 'build'));
    expect(cityEconomy(building, building.cities[cityId])).toEqual({ worked: [HILL, PLAINS].sort((a, b) => a - b), food: 3, production: 5, foodSurplus: -1 });
    // The store runs down by one a turn, stops at nothing and stays there; the city keeps both citizens and never grows.
    let current = building;
    const stores: number[] = [];
    for (let turn = 1; turn <= 20; turn++) {
      const step = endTurnForAll(current);
      current = step.state;
      stores.push(current.cities[cityId].foodStored);
      expect(current.cities[cityId].population, `turn ${turn}`).toBe(2);
      expect(step.events.some((addressed) => addressed.event.type === 'cityGrew'), `turn ${turn}`).toBe(false);
      // The citizens stay where Build put them, hungry or not.
      expect(cityEconomy(current, current.cities[cityId]).worked, `turn ${turn}`).toEqual([HILL, PLAINS].sort((a, b) => a - b));
    }
    expect(stores.slice(0, 5)).toEqual([2, 1, 0, 0, 0]);
    expect(stores.every((store) => store >= 0)).toBe(true);
    expect(stores[stores.length - 1]).toBe(0);
    // Meanwhile it built: 5 a turn, where Grow makes 3.
    expect(unitsOf(current, 'p1', 'warrior').length).toBe(1 + Math.floor((20 * 5) / UNITS.warrior.cost));

    // On Grow the same city gathers from two grassland tiles, +2 a turn, and has a third citizen in time.
    const growing = cityEconomy(stocked, stocked.cities[cityId]);
    expect(growing).toMatchObject({ food: 6, production: 3, foodSurplus: 2 });
    expect(growing.worked.every((tile) => stocked.map.tiles[tile].terrain === 'grassland' && stocked.map.tiles[tile].feature === null)).toBe(true);
    let grown = stocked;
    const needed = Math.ceil((foodToGrow(2) - 3) / 2);
    for (let turn = 1; turn <= needed; turn++) {
      expect(grown.cities[cityId].population, `turn ${turn}`).toBe(2);
      grown = endTurnForAll(grown).state;
    }
    expect(grown.cities[cityId].population).toBe(3);

    // Pressing "Grow first" again on the city that stood still: it grows from the next turn on.
    const back = act(current, 'p1', focusAction(cityId, 'grow'));
    expect(cityEconomy(back, back.cities[cityId]).foodSurplus).toBe(2);
    expect(endTurnForAll(back).state.cities[cityId].foodStored).toBe(2);
  });

  it('grow is today\'s placement: a second plain reading of the rule runs with focus grow and with a focus that is missing or nonsense, and agrees on every one of three hundred random lands; so does its reading of build', () => {
    const dice = seedRng('random lands, round 3', 'citizens');
    const kinds = ['g', 'g', 'p', 'p', 'd', 'f', 'h', 'H', 'D', ',', ',', '~', 'm'];
    const lost: unknown[] = [undefined, 'fast', '', 'Build', 'GROW', null, 'constructor', 7];
    let differs = 0;
    let hungryOnBuild = 0;
    let nets = 0;

    for (let land = 0; land < 300; land++) {
      // A city at (3,3) of a 7 x 7 map; every other tile is of a random kind.
      const rows: string[] = [];
      for (let y = 0; y < 7; y++) {
        const row: string[] = [];
        for (let x = 0; x < 7; x++) row.push(x === 3 && y === 3 ? 'g' : pick(dice, kinds));
        rows.push((y % 2 === 1 ? ' ' : '') + row.join(' '));
      }
      const population = 1 + nextInt(dice, 9);
      const bare = cityAtCentre(rows, population);
      // About every third tile of the city that can take an improvement has one: a farm, a mine or a net.
      const state = arrange(bare.state, (draft) => {
        draft.map.tiles.forEach((tile, index) => {
          if (tile.cityId === null || index === bare.city.tile || nextInt(dice, 3) !== 0) return;
          if (improvementFits('farm', tile)) improve(draft, index, 'farm');
          else if (improvementFits('mine', tile)) improve(draft, index, 'mine');
          else if (improvementFits('fishingNet', tile)) improve(draft, index, 'fishingNet');
        });
      });
      const city = state.cities[bare.city.id];
      const what = `land ${land}: ${rows.join(' / ')}, population ${population}`;
      nets += state.map.tiles.filter((tile) => tile.cityId === city.id && tile.improvement === 'fishingNet').length;

      // Grow: the engine and the plain reading agree...
      const byTheBook = economyByTheBook(state, city, 'grow');
      expect(city.focus).toBe('grow');
      expect(cityEconomy(state, city), what).toEqual(byTheBook);
      // ...and a city whose field was lost by hand is placed exactly so.
      const wrong = pick(dice, lost);
      const damaged = { ...city, focus: wrong } as unknown as City;
      if (wrong === undefined) delete (damaged as { focus?: unknown }).focus;
      expect(cityEconomy(state, damaged), `${what}, focus ${String(wrong)}`).toEqual(byTheBook);
      // Every tenth land: the view of such a city says 'grow' and prints Grow's numbers.
      if (land % 10 === 0) {
        const lostState = tamper(state, (draft) => {
          const fields = draft.cities[city.id] as unknown as { focus?: unknown };
          if (wrong === undefined) delete fields.focus;
          else fields.focus = wrong;
        });
        expect(ownDetail(lostState), `${what}, focus ${String(wrong)}`).toMatchObject({
          focus: 'grow', worked: byTheBook.worked, foodPerTurn: byTheBook.foodSurplus, productionPerTurn: byTheBook.production,
        });
      }

      // Build: the same for the other reading. It never makes less production than Grow, on any land.
      const built = cityEconomy(state, { ...city, focus: 'build' });
      expect(built, what).toEqual(economyByTheBook(state, city, 'build'));
      expect(built.production, what).toBeGreaterThanOrEqual(byTheBook.production);
      expect(built.worked.length, what).toBe(byTheBook.worked.length);
      if (JSON.stringify(built.worked) !== JSON.stringify(byTheBook.worked)) differs += 1;
      if (built.foodSurplus <= 0 && byTheBook.foodSurplus >= RULES.minFoodSurplus) hungryOnBuild += 1;
    }
    // The lands were of every kind: the two ways mostly take other tiles, Build often stands still where Grow grows, and nets were among the tiles.
    expect(differs).toBeGreaterThan(150);
    expect(hungryOnBuild).toBeGreaterThan(50);
    expect(nets).toBeGreaterThan(100);
  });

  it('the turn uses the choice made before End Turn: a city switched to build this turn gets build\'s production when the turn resolves; the view after the action carries the new worked tiles and numbers', () => {
    const { state: bare, city, tiles } = exampleCity('grow');
    const onGrow = arrange(bare, (draft) => {
      draft.cities[city.id].buildQueue = queueOf('worker', 'warrior');
    });
    const growTiles = [tiles.mine, tiles.net].sort((a, b) => a - b);
    const buildTiles = [tiles.mine, tiles.plains].sort((a, b) => a - b);

    // Before the press: Grow's tiles and numbers; a Worker (20) at 6 a turn is ready in 4 turns.
    const before = ownDetail(onGrow);
    expect(before).toMatchObject({ focus: 'grow', worked: growTiles, foodPerTurn: 2, productionPerTurn: 6, foodStored: 0, productionStored: 0 });
    expect(before.buildQueue[0]).toMatchObject({ turns: 4, wait: null });

    // The press. Nothing is paid and nothing is lost; the view that answers it is Build's, forecast and all: 8 a turn, 3 turns.
    const pressed = act(onGrow, 'p1', focusAction(city.id, 'build'));
    const after = ownDetail(pressed);
    expect(after).toMatchObject({ focus: 'build', worked: buildTiles, foodPerTurn: -1, productionPerTurn: 8, foodStored: 0, productionStored: 0 });
    expect(after.buildQueue[0]).toMatchObject({ turns: 3, wait: null });
    expect(after.buildQueue.map((row) => row.item)).toEqual(before.buildQueue.map((row) => row.item));
    expect(after.foodToGrow).toBe(before.foodToGrow);
    // Every number of the menu is forecast with the new way too.
    expect(after.buildOptions).not.toEqual(before.buildOptions);
    expect(after.buildOptions).toEqual(buildPlan(pressed, pressed.cities[city.id]).options);

    // The turn that resolves next reads the focus as it stands: Build's 8 production, and its hunger (the store stays at 0).
    const resolved = endTurnForAll(pressed).state;
    expect(resolved.cities[city.id]).toMatchObject({ productionStored: 8, foodStored: 0, population: 2, focus: 'build' });
    // Left on Grow, the same turn gives 6 and 2.
    expect(endTurnForAll(onGrow).state.cities[city.id]).toMatchObject({ productionStored: 6, foodStored: 2, focus: 'grow' });

    // Back and forth before End Turn costs nothing, and only the last press counts.
    const backAgain = act(pressed, 'p1', focusAction(city.id, 'grow'));
    expect(backAgain).toEqual(onGrow);
    expect(endTurnForAll(backAgain).state.cities[city.id]).toMatchObject({ productionStored: 6, foodStored: 2 });
    let wavering = onGrow;
    for (const focus of ['build', 'grow', 'build', 'grow', 'build'] as const) wavering = act(wavering, 'p1', focusAction(city.id, focus));
    expect(wavering).toEqual(pressed);
    expect(endTurnForAll(wavering).state.cities[city.id]).toMatchObject({ productionStored: 8, foodStored: 0 });

    // And the forecast was right: three End Turns on Build, four on Grow.
    expect(playUntilBuilt(pressed, city.id, 1).completions).toEqual([{ unitType: 'worker', after: 3 }]);
    expect(playUntilBuilt(onGrow, city.id, 1).completions).toEqual([{ unitType: 'worker', after: 4 }]);
  });

  it('a Settler in a city of one on build says needsPopulation, and held says so once it is paid for', () => {
    // One citizen, a hill and grassland, no plains: Build stands on the hill (0 food), and the city makes what it eats.
    const HILL_TOWN: readonly string[] = [
      'm m m m m m m',
      ' m m m m m m m',
      'm m m h g m m',
      ' m m g g g m m',
      'm m m m m m m',
      ' m m m m m m m',
      'm m m m m m m',
    ];
    const bare = cityAtCentre(HILL_TOWN);
    const cityId = bare.city.id;
    const queued = arrange(bare.state, (draft) => {
      draft.cities[cityId].buildQueue = queueOf('settler', 'warrior');
    });

    // On Grow the city grows, and the Settler has a number.
    const growPlan = buildPlan(queued, queued.cities[cityId]);
    expect(growPlan.economy.foodSurplus).toBe(2);
    expect(growPlan.queue[0].wait).toBeNull();
    expect(growPlan.queue[0].turns).toBeGreaterThan(0);

    // On Build: 3 production a turn, no surplus. The forecast saves up, finds one citizen for good, and says so; nothing is held yet.
    const building = act(queued, 'p1', focusAction(cityId, 'build'));
    const plan = buildPlan(building, building.cities[cityId]);
    expect(plan.economy).toMatchObject({ worked: [at(building.map, 3, 2)], production: 3, foodSurplus: 0 });
    expect(plan.queue.map((row) => [row.turns, row.wait])).toEqual([[null, 'needsPopulation'], [null, 'earlier']]);
    expect(plan.held).toBeNull();
    // An option that takes a citizen says the same; one that takes none waits for the queue in front of it.
    expect(plan.options.find((option) => option.item.unitType === 'settler')).toMatchObject({ turns: null, wait: 'earlier' });
    const emptyQueue = arrange(building, (draft) => {
      draft.cities[cityId].buildQueue = [];
    });
    const menu = buildPlan(emptyQueue, emptyQueue.cities[cityId]).options;
    expect(menu.find((option) => option.item.unitType === 'settler')).toMatchObject({ turns: null, wait: 'needsPopulation', addError: null });
    expect(menu.find((option) => option.item.unitType === 'warrior')).toMatchObject({ turns: 6, wait: null });
    // The owner's view says all of it.
    expect(ownDetail(building)).toMatchObject({ focus: 'build', held: null, foodPerTurn: 0, buildQueue: plan.queue });

    // Ten turns later the Settler is paid for (10 x 3 = 30), and now it is held.
    let current = building;
    for (let turn = 1; turn <= 10; turn++) {
      expect(buildPlan(current, current.cities[cityId]).held, `before turn ${turn}`).toBeNull();
      current = endTurnForAll(current).state;
    }
    expect(current.cities[cityId]).toMatchObject({ productionStored: UNITS.settler.cost, population: 1, foodStored: 0 });
    expect(buildPlan(current, current.cities[cityId]).held).toBe('needsPopulation');
    expect(ownDetail(current).held).toBe('needsPopulation');
    // For good: fifty turns on, there is no Settler and still one citizen.
    for (let turn = 0; turn < RULES.forecastTurns; turn++) current = endTurnForAll(current).state;
    expect(unitsOf(current, 'p1', 'settler')).toEqual([]);
    expect(current.cities[cityId].population).toBe(1);
    expect(current.cities[cityId].buildQueue).toEqual(queueOf('settler', 'warrior'));

    // "Grow first" again: the wait has an end, and the Settler comes when the row says.
    const growing = act(current, 'p1', focusAction(cityId, 'grow'));
    const promised = buildPlan(growing, growing.cities[cityId]).queue[0];
    expect(promised.wait).toBeNull();
    expect(buildPlan(growing, growing.cities[cityId]).held).toBe('needsPopulation'); // as the city is NOW it still cannot let it go
    expect(playUntilBuilt(growing, cityId, 1).completions).toEqual([{ unitType: 'settler', after: promised.turns }]);
  });

  it('the forecast follows the choice: for 100 generated capitals and both ways, every row\'s "in N turns" of buildPlan is the turn resolveTurn completes the entry in, when nothing outside the city changes, for queues of land units that find room and at most one boat of each class; and again after random flips of the focus', LONG_TEST, () => {
    const dice = seedRng('forecast and focus', 'rulesCity');
    const HORIZON = 30;

    /** Tiles of the city a new land unit could stand on with nobody there: joined to the city by its own land, and empty. */
    const emptyLand = (state: GameState, city: City): number => {
      const reached = new Set<TileIndex>([city.tile]);
      const waiting = [city.tile];
      while (waiting.length > 0) {
        for (const next of neighbors(waiting.pop() as TileIndex, state.map)) {
          const tile = state.map.tiles[next];
          if (reached.has(next) || tile.cityId !== city.id || tileMoveCost(tile, 'land') === null) continue;
          reached.add(next);
          waiting.push(next);
        }
      }
      reached.delete(city.tile);
      return [...reached].filter((tile) => !Object.values(state.units).some((unit) => unit.tile === tile)).length;
    };
    const emptyWater = (state: GameState, city: City): number =>
      state.map.tiles.filter((tile, index) => tile.cityId === city.id && tileIsWater(tile) && !Object.values(state.units).some((unit) => unit.tile === index)).length;

    /** Two to five different unit types in a random order: so at most one boat of each class, and at most four land units. */
    const randomQueue = (): UnitTypeId[] => {
      const pool = [...UNIT_TYPE_IDS];
      const queue: UnitTypeId[] = [];
      const length = 2 + nextInt(dice, 4);
      while (queue.length < length) queue.push(pool.splice(nextInt(dice, pool.length), 1)[0]);
      return queue;
    };

    let capitals = 0;
    let rowsOnTime = 0;
    let laterRowsOnTime = 0;
    let rowsWaiting = 0;
    let boatsOnTime = 0;
    let checkedOnBuild = 0;
    let flips = 0;

    /**
     * Forecasts every city's queue, plays HORIZON turns in which nobody does
     * anything, and holds every row against what happened.
     */
    const forecastAndPlay = (begin: GameState, what: string): GameState => {
      const promised = new Map<string, { unitType: UnitTypeId; turns: number | null }[]>();
      for (const city of Object.values(begin.cities)) {
        // Room for everything the queue holds, so that no unit completed earlier can be in a later one's way.
        const land = city.buildQueue.filter((entry) => UNITS[entry.unitType].domain === 'land').length;
        const boats = city.buildQueue.length - land;
        if (emptyLand(begin, city) < land || emptyWater(begin, city) < boats) continue;
        promised.set(city.id, buildPlan(begin, city).queue.map((row) => ({ unitType: row.item.unitType, turns: row.turns })));
        if (city.focus === 'build') checkedOnBuild += 1;
      }
      const built = new Map<string, { unitType: UnitTypeId; after: number }[]>();
      let state = begin;
      for (let played = 1; played <= HORIZON; played++) {
        const resolved = resolveTurn(state);
        state = resolved.state;
        for (const { event } of resolved.events) {
          if (event.type !== 'unitBuilt') continue;
          built.set(event.cityId, [...(built.get(event.cityId) ?? []), { unitType: event.unitType, after: played }]);
        }
      }
      for (const [cityId, rows] of promised) {
        const happened = built.get(cityId) ?? [];
        const inTime = rows.filter((row) => row.turns !== null && row.turns <= HORIZON);
        const where = `${what}, ${begin.cities[cityId].name} on ${begin.cities[cityId].focus}, queue ${rows.map((row) => row.unitType).join()}`;
        // Exactly the rows with a number within the horizon were completed, each in its turn, in the order of the queue.
        expect(happened, where).toEqual(inTime.map((row) => ({ unitType: row.unitType, after: row.turns })));
        rowsOnTime += inTime.length;
        laterRowsOnTime += Math.max(0, inTime.length - 1);
        rowsWaiting += rows.length - inTime.length;
        boatsOnTime += inTime.filter((row) => UNITS[row.unitType].domain === 'sea').length;
      }
      return state;
    };

    for (let game = 0; game < 25; game++) {
      let founded = createGame(setupFor(4, `forecast-focus-${game}`));
      for (const player of founded.players) founded = withCapital(founded, player.id);
      const queues = new Map(Object.values(founded.cities).map((city): [string, UnitTypeId[]] => [city.id, randomQueue()]));
      capitals += queues.size;

      // Both ways, from the first turn: every capital of the game on Grow, and every capital on Build.
      let last = founded;
      for (const focus of CITY_FOCUS_IDS) {
        let state = founded;
        for (const city of Object.values(founded.cities)) {
          state = act(state, city.owner, { type: 'setBuildQueue', cityId: city.id, queue: queueOf(...(queues.get(city.id) ?? [])) });
          state = act(state, city.owner, focusAction(city.id, focus));
        }
        last = forecastAndPlay(state, `game ${game}, all on ${focus}`);
      }

      // Then, in the game that was played on Build: fresh queues, and about half of the cities
      // are pressed over to the other way. From that turn on the new forecast holds.
      let state = last;
      for (const city of Object.values(last.cities)) {
        state = act(state, city.owner, { type: 'setBuildQueue', cityId: city.id, queue: queueOf(...randomQueue()) });
        if (nextInt(dice, 2) === 0) {
          state = act(state, city.owner, focusAction(city.id, 'grow'));
          flips += 1;
        }
      }
      forecastAndPlay(state, `game ${game}, after the flips`);
    }

    expect(capitals).toBe(100);
    // Hundreds of rows came when their number said, later rows and boats among them, under both ways and after flips.
    expect(rowsOnTime).toBeGreaterThan(400);
    expect(laterRowsOnTime).toBeGreaterThan(200);
    expect(boatsOnTime).toBeGreaterThan(60);
    expect(checkedOnBuild).toBeGreaterThan(100);
    expect(flips).toBeGreaterThan(30);
    // And rows without a number stayed away: a Settler on Build in a city that does not grow, and what stands behind it.
    expect(rowsWaiting).toBeGreaterThan(30);
  });
});
