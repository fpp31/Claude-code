import { describe, expect, it } from 'vitest';
import {
  CIVS,
  RULES,
  TERRAIN,
  UNITS,
  UNIT_TYPE_IDS,
  buildCost,
  buildOptions,
  cityEconomy,
  cloneJson,
  distance,
  findSpawnTile,
  foundCityError,
  tileYields,
} from '../src/index';
import type { BuildItem, City, GameState, PlayerId, TileIndex } from '../src/index';
import {
  EAST,
  MEADOW,
  act,
  actWithEvents,
  arrange,
  at,
  citiesOf,
  cityOn,
  foundCityAt,
  newGame,
  placeUnit,
  refusal,
  stepFrom,
  unitOf,
  unitsOf,
} from './rulesKit';

/**
 * Tests for cities: founding them, what they produce each turn, and what
 * they can build (rules/city.ts and the foundCity / setProduction actions).
 */

/** Two players on the meadow: p1 at (3,5), p2 at (12,5). */
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
      production: null,
      productionStored: 0,
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

  it('assigns citizens by total yield, then food, then lower tile index', () => {
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

  it('setProduction: rejects foreign or missing cities (noSuchCity) and unknown items (cannotBuild), keeps stored production', () => {
    const start = withCapital(meadowGame());
    const rome = cityOn(start, at(start.map, 3, 5));
    const scout: BuildItem = { kind: 'unit', unitType: 'scout' };

    expect(refusal(start, 'p2', { type: 'setProduction', cityId: rome.id, item: scout })).toBe('noSuchCity');
    for (const id of ['c1_nowhere', 'constructor', '__proto__', '']) {
      expect(refusal(start, 'p1', { type: 'setProduction', cityId: id, item: scout }), id).toBe('noSuchCity');
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
      const action = { type: 'setProduction' as const, cityId: rome.id, item: item as BuildItem };
      expect(refusal(start, 'p1', action), JSON.stringify(item)).toBe('cannotBuild');
      // "Whose city" is answered first.
      expect(refusal(start, 'p2', action), JSON.stringify(item)).toBe('noSuchCity');
    }

    // Every unit type of the table can be chosen.
    for (const unitType of UNIT_TYPE_IDS) {
      const chosen = act(start, 'p1', { type: 'setProduction', cityId: rome.id, item: { kind: 'unit', unitType } });
      expect(chosen.cities[rome.id].production).toEqual({ kind: 'unit', unitType });
    }

    // Switching keeps what was stored, and changes nothing else about the city.
    const halfBuilt = arrange(start, (draft) => {
      draft.cities[rome.id].production = { kind: 'unit', unitType: 'warrior' };
      draft.cities[rome.id].productionStored = 7;
    });
    const switched = act(halfBuilt, 'p1', { type: 'setProduction', cityId: rome.id, item: scout });
    expect(switched.cities[rome.id]).toEqual({ ...halfBuilt.cities[rome.id], production: scout });

    // Only the known fields of an item are stored, whatever else a client sends along.
    const padded = { kind: 'unit', unitType: 'settler', note: 'x'.repeat(50) } as unknown as BuildItem;
    const stored = act(start, 'p1', { type: 'setProduction', cityId: rome.id, item: padded });
    expect(stored.cities[rome.id].production).toEqual({ kind: 'unit', unitType: 'settler' });
  });

  it('buildCost and buildOptions follow the unit table and the city\'s production', () => {
    for (const unitType of UNIT_TYPE_IDS) expect(buildCost({ kind: 'unit', unitType })).toBe(UNITS[unitType].cost);

    const start = withCapital(meadowGame());
    const rome = cityOn(start, at(start.map, 3, 5));
    const perTurn = cityEconomy(start, rome).production;
    expect(perTurn).toBeGreaterThan(0);

    for (const stored of [0, 1, 5, UNITS.scout.cost - 1, UNITS.scout.cost, UNITS.settler.cost + 40]) {
      const state = arrange(start, (draft) => {
        draft.cities[rome.id].productionStored = stored;
      });
      const options = buildOptions(state, state.cities[rome.id]);
      expect(options.map((option) => option.item)).toEqual(UNIT_TYPE_IDS.map((unitType) => ({ kind: 'unit', unitType })));
      for (const option of options) {
        const cost = UNITS[option.item.unitType].cost;
        expect(option.cost).toBe(cost);
        // Count the turn resolutions by hand: add the production until the cost is reached.
        let turns = 0;
        let have = stored;
        do {
          have += perTurn;
          turns += 1;
        } while (have < cost);
        expect(option.turns, `${option.item.unitType} with ${stored} stored`).toBe(turns);
      }
    }
  });

  it('buildOptions gives no number of turns for a city that makes no production', () => {
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
      for (const option of buildOptions(state, city)) expect(option.turns).toBeNull();
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

  it('buildOptions reads the city\'s own stored production, not another city\'s', () => {
    const start = meadowGame();
    const both = arrange(withCapital(withCapital(start), 'p2'), (draft) => {
      cityOn(draft, at(draft.map, 12, 5)).productionStored = UNITS.scout.cost - 1;
    });
    const rome = cityOn(both, at(both.map, 3, 5));
    const thebes = cityOn(both, at(both.map, 12, 5));
    const scoutOf = (city: City) => buildOptions(both, city).find((option) => option.item.unitType === 'scout');
    expect(scoutOf(thebes)?.turns).toBe(1);
    expect(scoutOf(rome)?.turns).toBeGreaterThan(1);
  });
});
