import { describe, expect, it } from 'vitest';
import {
  CITY_FOCUS,
  CITY_FOCUS_IDS,
  CIVS,
  CIV_IDS,
  DEFAULT_CITY_FOCUS,
  FEATURES,
  FEATURE_IDS,
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  MAP_SIZES,
  MAP_SIZE_IDS,
  RULES,
  RULE_ERROR_MESSAGES,
  TERRAIN,
  TERRAIN_IDS,
  UNITS,
  UNIT_DOMAINS,
  UNIT_TYPE_IDS,
  cityNameFor,
  foodToGrow,
  improvementBuilder,
  improvementFits,
  maxPlayers,
  ruleError,
  tileAllowsCity,
  tileIsWater,
  tileIsWorkable,
  tileMoveCost,
  tileYields,
  unitCanImprove,
} from '../src/index';
import type { FeatureId, Ground, TerrainId } from '../src/index';

/**
 * These tests guard the RELATIONSHIPS between numbers in the data tables.
 * The numbers themselves are free to tune; if a change breaks one of these,
 * the rules or the fog of war would stop making sense.
 */

describe('id lists match the tables', () => {
  it('lists every key exactly once', () => {
    expect([...TERRAIN_IDS].sort()).toEqual(Object.keys(TERRAIN).sort());
    expect([...FEATURE_IDS].sort()).toEqual(Object.keys(FEATURES).sort());
    expect([...UNIT_TYPE_IDS].sort()).toEqual(Object.keys(UNITS).sort());
    expect([...IMPROVEMENT_IDS].sort()).toEqual(Object.keys(IMPROVEMENTS).sort());
    expect([...CIV_IDS].sort()).toEqual(Object.keys(CIVS).sort());
    expect([...MAP_SIZE_IDS].sort()).toEqual(Object.keys(MAP_SIZES).sort());
    expect([...CITY_FOCUS_IDS].sort()).toEqual(Object.keys(CITY_FOCUS).sort());
  });
});

/** Every kind of tile the game has: each ground, and each feature on each ground it may stand on. */
const GROUNDS: readonly { terrain: TerrainId; feature: FeatureId | null }[] = TERRAIN_IDS.flatMap((terrain) => [
  { terrain, feature: null },
  ...FEATURE_IDS.filter((feature) => FEATURES[feature].allowedOn.includes(terrain)).map((feature) => ({ terrain, feature })),
]);

/** "open coast", "hills grassland": a kind of tile in the words of a failure message. */
function groundName(ground: Ground): string {
  return `${ground.feature ?? 'open'} ${ground.terrain}`;
}

describe('terrain and features', () => {
  it('water cannot be entered by land units and cannot hold a city; land cannot be entered by boats', () => {
    for (const id of TERRAIN_IDS) {
      const terrain = TERRAIN[id];
      if (terrain.water) {
        expect(terrain.moveCost.land, id).toBeNull();
        expect(terrain.moveCost.sea, id).toBeGreaterThanOrEqual(1);
        expect(terrain.canFoundCity, id).toBe(false);
      } else {
        expect(terrain.moveCost.land, id).toBeGreaterThanOrEqual(1);
        expect(terrain.moveCost.sea, id).toBeNull();
      }
    }
  });

  it('every terrain has a cost for each domain, and no ground can be entered by both; water costs a boat 1 and land nothing; mountains let neither in', () => {
    expect(UNIT_DOMAINS).toEqual(['land', 'sea']);
    for (const id of TERRAIN_IDS) {
      // Exactly the two columns, each a whole number of at least 1 or null.
      expect(Object.keys(TERRAIN[id].moveCost).sort(), id).toEqual([...UNIT_DOMAINS].sort());
      for (const domain of UNIT_DOMAINS) {
        const cost = TERRAIN[id].moveCost[domain];
        expect(cost === null || (Number.isInteger(cost) && cost >= 1), `${id}, ${domain}`).toBe(true);
      }
    }
    for (const ground of GROUNDS) {
      const land = tileMoveCost(ground, 'land');
      const sea = tileMoveCost(ground, 'sea');
      // Rule M5 stands on this: a land unit and a boat can never share a
      // tile, so the stacking rule needs no word about domains. (It also
      // keeps a city, which stands on land, out of every boat's reach.)
      expect(land !== null && sea !== null, `${groundName(ground)}: a tile both a land unit and a boat can enter`).toBe(false);
      if (tileIsWater(ground)) {
        expect(sea, groundName(ground)).toBe(1);
        expect(land, groundName(ground)).toBeNull();
      } else {
        expect(sea, groundName(ground)).toBeNull();
      }
      if (ground.feature === 'mountains') {
        expect(land, groundName(ground)).toBeNull();
        expect(sea, groundName(ground)).toBeNull();
      }
    }
    // Water is the only ground a boat can enter, and every water tile is one.
    expect(TERRAIN_IDS.filter((id) => TERRAIN[id].moveCost.sea !== null)).toEqual(TERRAIN_IDS.filter((id) => TERRAIN[id].water));
  });

  it('no feature is allowed on a terrain a boat can enter', () => {
    // tileMoveCost gives a boat the ground's cost and never looks at the
    // feature. That is right only while no feature stands on water: a
    // feature that could (a reef, ice) needs a sea cost of its own first.
    for (const id of FEATURE_IDS) {
      for (const terrain of FEATURES[id].allowedOn) {
        expect(TERRAIN[terrain].moveCost.sea, `${id} on ${terrain}: give features a cost for sea units before one may stand on water`).toBeNull();
      }
    }
  });

  it('features are only allowed on land and cost at least 1 to enter', () => {
    for (const id of FEATURE_IDS) {
      const feature = FEATURES[id];
      expect(feature.allowedOn.length).toBeGreaterThan(0);
      for (const ground of feature.allowedOn) expect(TERRAIN[ground].water).toBe(false);
      if (feature.moveCost !== null) expect(feature.moveCost).toBeGreaterThanOrEqual(1);
    }
  });

  it('yields are whole numbers, never negative', () => {
    const all = [...TERRAIN_IDS.map((id) => TERRAIN[id].yields), ...FEATURE_IDS.map((id) => FEATURES[id].yields)];
    for (const yields of [...all, RULES.cityCenterMinYields]) {
      expect(Number.isInteger(yields.food) && yields.food >= 0).toBe(true);
      expect(Number.isInteger(yields.production) && yields.production >= 0).toBe(true);
    }
  });

  it('a feature replaces the numbers of the ground it stands on', () => {
    // For a land unit the feature's cost replaces the ground's.
    expect(tileMoveCost({ terrain: 'grassland', feature: null }, 'land')).toBe(TERRAIN.grassland.moveCost.land);
    expect(tileMoveCost({ terrain: 'grassland', feature: 'forest' }, 'land')).toBe(FEATURES.forest.moveCost);
    expect(tileMoveCost({ terrain: 'plains', feature: 'mountains' }, 'land')).toBeNull();
    expect(tileMoveCost({ terrain: 'ocean', feature: null }, 'land')).toBeNull();
    // A sea unit pays the ground's own cost for sea units, whatever stands on the tile.
    expect(tileMoveCost({ terrain: 'ocean', feature: null }, 'sea')).toBe(TERRAIN.ocean.moveCost.sea);
    expect(tileMoveCost({ terrain: 'coast', feature: null }, 'sea')).toBe(TERRAIN.coast.moveCost.sea);
    expect(tileMoveCost({ terrain: 'grassland', feature: null }, 'sea')).toBeNull();
    expect(tileMoveCost({ terrain: 'grassland', feature: 'forest' }, 'sea')).toBeNull();
    expect(tileMoveCost({ terrain: 'plains', feature: 'mountains' }, 'sea')).toBeNull();

    expect(tileYields({ terrain: 'plains', feature: null })).toEqual(TERRAIN.plains.yields);
    expect(tileYields({ terrain: 'plains', feature: 'hills' })).toEqual(FEATURES.hills.yields);
    expect(tileYields({ terrain: 'desert', feature: 'hills' })).toEqual(FEATURES.hills.yields);

    expect(tileIsWater({ terrain: 'coast', feature: null })).toBe(true);
    expect(tileIsWater({ terrain: 'desert', feature: null })).toBe(false);

    expect(tileIsWorkable({ terrain: 'coast', feature: null })).toBe(true);
    expect(tileIsWorkable({ terrain: 'grassland', feature: 'mountains' })).toBe(false);

    expect(tileAllowsCity({ terrain: 'grassland', feature: null })).toBe(true);
    expect(tileAllowsCity({ terrain: 'grassland', feature: 'hills' })).toBe(true);
    expect(tileAllowsCity({ terrain: 'grassland', feature: 'forest' })).toBe(false);
    expect(tileAllowsCity({ terrain: 'coast', feature: null })).toBe(false);
  });

  it('tileYields hands out a copy, so callers cannot damage the table', () => {
    const yields = tileYields({ terrain: 'grassland', feature: null });
    yields.food = 99;
    expect(TERRAIN.grassland.yields.food).not.toBe(99);
  });

  it('rough ground costs a land unit more than open ground; all water costs a boat the same', () => {
    expect(FEATURES.forest.moveCost as number).toBeGreaterThan(TERRAIN.grassland.moveCost.land as number);
    expect(FEATURES.hills.moveCost as number).toBeGreaterThan(TERRAIN.plains.moveCost.land as number);
    expect(FEATURES.mountains.moveCost).toBeNull();
    // The sea has no rough water: a Scout Boat's four moves are four tiles.
    expect(TERRAIN.ocean.moveCost.sea).toBe(TERRAIN.coast.moveCost.sea);
  });
});

describe('units', () => {
  it('every unit can move, see at least one tile away, and costs something', () => {
    for (const id of UNIT_TYPE_IDS) {
      const unit = UNITS[id];
      expect(unit.moves).toBeGreaterThanOrEqual(1);
      // Sight >= 1 is what makes "the server walks the path" leak-free:
      // a unit always sees the tile it is about to step on.
      expect(unit.sight).toBeGreaterThanOrEqual(1);
      expect(unit.cost).toBeGreaterThan(0);
      expect(unit.populationCost).toBeGreaterThanOrEqual(0);
    }
  });

  it('every unit has a domain of UNIT_DOMAINS: the two boats are sea units, the four others land units', () => {
    for (const id of UNIT_TYPE_IDS) expect(UNIT_DOMAINS, id).toContain(UNITS[id].domain);
    expect(UNIT_TYPE_IDS.filter((id) => UNITS[id].domain === 'sea')).toEqual(['fishingBoat', 'scoutBoat']);
    expect(UNIT_TYPE_IDS.filter((id) => UNITS[id].domain === 'land')).toEqual(['warrior', 'scout', 'settler', 'worker']);
    // The build menu lists land units first and the boats last, so the four older buttons stay where they were.
    const firstBoat = UNIT_TYPE_IDS.findIndex((id) => UNITS[id].domain === 'sea');
    expect(UNIT_TYPE_IDS.slice(firstBoat).every((id) => UNITS[id].domain === 'sea')).toBe(true);
    // Every unit has ground it can enter at all.
    for (const id of UNIT_TYPE_IDS) {
      expect(GROUNDS.some((ground) => tileMoveCost(ground, UNITS[id].domain) !== null), id).toBe(true);
    }
  });

  it('starting units exist, include a city founder, and fit on one tile', () => {
    expect(RULES.startingUnits.length).toBeGreaterThan(0);
    for (const id of RULES.startingUnits) expect(UNITS[id]).toBeDefined();
    expect(RULES.startingUnits.some((id) => UNITS[id].canFoundCity)).toBe(true);
    const military = RULES.startingUnits.filter((id) => UNITS[id].unitClass === 'military').length;
    const civilian = RULES.startingUnits.filter((id) => UNITS[id].unitClass === 'civilian').length;
    expect(military).toBeLessThanOrEqual(1);
    expect(civilian).toBeLessThanOrEqual(1);
    // They are put on the start tile, which is land (rule H1 of the map generator).
    for (const id of RULES.startingUnits) expect(UNITS[id].domain, id).toBe('land');
    // A city stands on land, so its founder walks there.
    for (const id of UNIT_TYPE_IDS) if (UNITS[id].canFoundCity) expect(UNITS[id].domain, id).toBe('land');
  });

  it('a city founder always sees any city that could be too close (so that error reveals nothing hidden)', () => {
    for (const id of UNIT_TYPE_IDS) {
      if (UNITS[id].canFoundCity) expect(RULES.minCityDistance - 1).toBeLessThanOrEqual(UNITS[id].sight);
    }
  });

  it('every unit sees at least as far as it can walk in one turn', () => {
    // Entering a tile costs at least 1, so a unit with `moves` movement
    // points never walks further than `moves` tiles, and with sight >= moves
    // it could see every tile of its route when the player chose it. The
    // tiles the client highlights are then exactly the tiles the server
    // lets the unit reach: nothing out of sight can stop it half-way. If a
    // faster unit is ever wanted, give it the sight to match, or accept that
    // its moves may end early ("something is in the way").
    for (const id of UNIT_TYPE_IDS) {
      expect(UNITS[id].moves, `${id}: moves must not be larger than sight`).toBeLessThanOrEqual(UNITS[id].sight);
    }
  });
});

/**
 * What every one-line description for players must be: one line, at most
 * 42 characters, no digit, ending with a full stop.
 *
 * Why 42: under an add button of the city panel a description has 258
 * pixels in a browser that shows its scroll bars, and the longest one there
 * is (the Worker's, 42 characters) takes 241. With 45 characters the
 * Warrior's took 262 and stood on two lines. Characters are not pixels, so
 * the end-to-end test looks at the lines themselves (step 33); a line that
 * is too long for a font wraps and is never cut.
 */
function expectOneLineDescription(description: string, what: string): void {
  expect(
    description.length,
    `${what}: at most 42 characters (a rule of thumb for one line under an add button of the city panel, also beside a scroll bar; the end-to-end test looks at the lines themselves)`,
  ).toBeLessThanOrEqual(42);
  expect(description.length, what).toBeGreaterThan(10);
  expect(description, `${what}: one line`).not.toMatch(/[\n\r]/);
  expect(description, `${what}: no digit (the numbers are in the other columns and would go stale here)`).not.toMatch(/[0-9]/);
  expect(description.endsWith('.'), `${what}: ends with a full stop`).toBe(true);
  expect(description, `${what}: no space at either end`).toBe(description.trim());
}

describe('descriptions for players', () => {
  it('every unit has a description: one line, at most 42 characters, no digit, ending with a full stop', () => {
    for (const id of UNIT_TYPE_IDS) expectOneLineDescription(UNITS[id].description, id);
    // No two units are described with the same words.
    expect(new Set(UNIT_TYPE_IDS.map((id) => UNITS[id].description)).size).toBe(UNIT_TYPE_IDS.length);
  });

  it('the improvement ids match the table, and every improvement has a name, a "needs" phrase, at least 1 turn, and a description of one line, at most 42 characters, no digit, ending with a full stop', () => {
    expect([...IMPROVEMENT_IDS].sort()).toEqual(Object.keys(IMPROVEMENTS).sort());
    expect(new Set(IMPROVEMENT_IDS).size).toBe(IMPROVEMENT_IDS.length);
    expect(IMPROVEMENT_IDS.length).toBeGreaterThan(0);
    for (const id of IMPROVEMENT_IDS) {
      const improvement = IMPROVEMENTS[id];
      expect(improvement.name).toMatch(/^[A-Z][a-z]+( [A-Za-z]+)*$/);
      // "A <name> needs <needs>." is printed next to a greyed-out button: a phrase, not a sentence.
      expect(improvement.needs.length, id).toBeGreaterThan(3);
      expect(improvement.needs, id).not.toMatch(/[.\n\r]/);
      expect(improvement.needs, id).toBe(improvement.needs.trim());
      expect(Number.isInteger(improvement.turns) && improvement.turns >= 1, `${id}: turns`).toBe(true);
      expectOneLineDescription(improvement.description, id);
    }
    expect(new Set(IMPROVEMENT_IDS.map((id) => IMPROVEMENTS[id].name)).size).toBe(IMPROVEMENT_IDS.length);
  });
});

describe('improvements', () => {
  const grounds = GROUNDS;

  it('an improvement only fits tiles its builder can stand on and a citizen can gather from', () => {
    for (const id of IMPROVEMENT_IDS) {
      const fitting = grounds.filter((ground) => improvementFits(id, ground));
      // It can be built somewhere at all...
      expect(fitting.length, id).toBeGreaterThan(0);
      const builder = improvementBuilder(id);
      for (const ground of fitting) {
        const what = `${id} on ${groundName(ground)}`;
        // ...and only where the unit type that builds it can go (a job is
        // done on the tile the unit stands on) and where the yield is of
        // use to a city.
        expect(tileMoveCost(ground, UNITS[builder].domain), `${what}: a ${UNITS[builder].name} cannot enter it`).not.toBeNull();
        expect(tileIsWorkable(ground), what).toBe(true);
      }
      // The two lists of the table name real grounds and real features (or null for open ground).
      expect(IMPROVEMENTS[id].terrains.length, id).toBeGreaterThan(0);
      expect(IMPROVEMENTS[id].features.length, id).toBeGreaterThan(0);
      for (const terrain of IMPROVEMENTS[id].terrains) expect(TERRAIN_IDS, id).toContain(terrain);
      for (const feature of IMPROVEMENTS[id].features) if (feature !== null) expect(FEATURE_IDS, id).toContain(feature);
    }

    // improvementFits wants the ground AND what stands on it to be listed.
    expect(improvementFits('farm', { terrain: 'grassland', feature: null })).toBe(true);
    expect(improvementFits('farm', { terrain: 'plains', feature: null })).toBe(true);
    expect(improvementFits('farm', { terrain: 'desert', feature: null })).toBe(true);
    expect(improvementFits('farm', { terrain: 'grassland', feature: 'hills' })).toBe(false);
    expect(improvementFits('farm', { terrain: 'grassland', feature: 'forest' })).toBe(false);
    expect(improvementFits('farm', { terrain: 'coast', feature: null })).toBe(false);
    expect(improvementFits('mine', { terrain: 'grassland', feature: 'hills' })).toBe(true);
    expect(improvementFits('mine', { terrain: 'plains', feature: 'hills' })).toBe(true);
    expect(improvementFits('mine', { terrain: 'desert', feature: 'hills' })).toBe(true);
    expect(improvementFits('mine', { terrain: 'desert', feature: null })).toBe(false);
    expect(improvementFits('mine', { terrain: 'plains', feature: 'forest' })).toBe(false);
    expect(improvementFits('mine', { terrain: 'grassland', feature: 'mountains' })).toBe(false);
    // A net is for the coast: not for the open ocean, and for no land.
    expect(improvementFits('fishingNet', { terrain: 'coast', feature: null })).toBe(true);
    expect(improvementFits('fishingNet', { terrain: 'ocean', feature: null })).toBe(false);
    expect(improvementFits('fishingNet', { terrain: 'grassland', feature: null })).toBe(false);
    expect(improvementFits('fishingNet', { terrain: 'desert', feature: 'hills' })).toBe(false);
    expect(grounds.filter((ground) => improvementFits('fishingNet', ground))).toEqual([{ terrain: 'coast', feature: null }]);
    // What is already built there is not its business (improvementSiteError judges that).
    expect(improvementFits('farm', { terrain: 'grassland', feature: null, improvement: 'farm' })).toBe(true);
  });

  it('every improvement is in the list of exactly one unit type, improvementBuilder names it, and every list is in IMPROVEMENT_IDS order', () => {
    for (const id of IMPROVEMENT_IDS) {
      const builders = UNIT_TYPE_IDS.filter((type) => UNITS[type].improvements.includes(id));
      expect(
        builders.length,
        `${id} is built by ${builders.length} unit types (${builders.join(', ')}): the page says "A ${UNITS[improvementBuilder(id)].name} can build a ${IMPROVEMENTS[id].name} here" ` +
          'and names ONE builder. A second builder is a decision about that sentence first (client game/tileInfo.ts), then about this test',
      ).toBe(1);
      expect(improvementBuilder(id), id).toBe(builders[0]);
    }
    expect(improvementBuilder('farm')).toBe('worker');
    expect(improvementBuilder('mine')).toBe('worker');
    expect(improvementBuilder('fishingNet')).toBe('fishingBoat');

    for (const type of UNIT_TYPE_IDS) {
      const list = UNITS[type].improvements;
      // Real improvements, each once, in the order the unit panel lists its buttons (rule N2).
      for (const id of list) expect(IMPROVEMENT_IDS, `${type}: ${id}`).toContain(id);
      expect(new Set(list).size, type).toBe(list.length);
      expect([...list], type).toEqual(IMPROVEMENT_IDS.filter((id) => list.includes(id)));
      expect(unitCanImprove(type), type).toBe(list.length > 0);
    }
    expect(UNIT_TYPE_IDS.map((type) => [type, [...UNITS[type].improvements]])).toEqual([
      ['warrior', []],
      ['scout', []],
      ['settler', []],
      ['worker', ['farm', 'mine']],
      ['fishingBoat', ['fishingNet']],
      ['scoutBoat', []],
    ]);
  });

  it('no ground fits two improvements', () => {
    // improvementSiteError lets a job begin on a tile that carries ANOTHER
    // improvement and fits this one ("the new one replaces the old one").
    // No tile can come to that today. The round that adds such a ground
    // decides what replacing means (is the old one lost at once, or when the
    // new one is finished? is the player asked?) before this test changes.
    for (const ground of grounds) {
      const fitting = IMPROVEMENT_IDS.filter((id) => improvementFits(id, ground));
      expect(fitting.length, `${groundName(ground)} fits ${fitting.join(' and ')}`).toBeLessThanOrEqual(1);
    }
  });

  it('an improvement adds whole, non-negative yields, and at least one of them is more than 0', () => {
    for (const id of IMPROVEMENT_IDS) {
      const yields = IMPROVEMENTS[id].yields;
      expect(Number.isInteger(yields.food) && yields.food >= 0, `${id}: food`).toBe(true);
      expect(Number.isInteger(yields.production) && yields.production >= 0, `${id}: production`).toBe(true);
      expect(yields.food + yields.production, `${id}: it must be worth building`).toBeGreaterThan(0);
      expect(Object.keys(yields).sort()).toEqual(['food', 'production']);
    }
  });

  it('a mined hill\'s food + production is higher than that of every unimproved tile', () => {
    // Citizens take the tiles with the highest food + production first
    // (cityEconomy, step 1). A mined hill gives no food, so it loses every
    // tie. With +1 production it stood level with open grassland and plains
    // and was the LAST tile a capital took: measured on generated maps, no
    // capital worked its mine within 200 turns.
    const best = Math.max(...grounds.map((ground) => tileYields(ground).food + tileYields(ground).production));
    for (const ground of grounds.filter((candidate) => improvementFits('mine', candidate))) {
      const mined = tileYields({ ...ground, improvement: 'mine' });
      expect(
        mined.food + mined.production,
        `a mine on ${ground.terrain} hills gives ${mined.food} food + ${mined.production} production, and the best unimproved tile gives ${best} in all: ` +
          'the mine must give MORE, or citizens take every open tile before it and the Worker\'s five turns are wasted. ' +
          'Do not put the Mine back to +1 production without changing how citizens choose their tiles (rules/city.ts)',
      ).toBeGreaterThan(best);
    }
  });

  it('a mined hill\'s food + production is higher than that of every tile with any other improvement', () => {
    // The same first choice, one step on: a Worker goes on building farms,
    // and a Fishing Boat nets the coast.
    // With +2 production a mined hill (0 + 4) stood level with a farmed
    // grassland tile (3 + 1) and a farmed plains tile (2 + 2) and lost the
    // tie on food. Every farm after the first then pushed the mine one
    // citizen back: measured on generated capitals with a Worker that went on
    // farming, the mine was worked in fewer than half of the turns after it
    // stood, and a mine that had been worked fell out of use again.
    // A fished coast tile (4 + 0) is held by the same limit: at +3 food it
    // would stand level with the mine (5) and win the tie on food.
    const others = IMPROVEMENT_IDS.filter((id) => id !== 'mine').flatMap((id) =>
      grounds
        .filter((candidate) => improvementFits(id, candidate))
        .map((ground) => ({ id, ground, yields: tileYields({ ...ground, improvement: id }) })),
    );
    expect(others.some((other) => other.id === 'farm')).toBe(true);
    expect(others.some((other) => other.id === 'fishingNet')).toBe(true);
    for (const ground of grounds.filter((candidate) => improvementFits('mine', candidate))) {
      const mined = tileYields({ ...ground, improvement: 'mine' });
      for (const other of others) {
        const sum = other.yields.food + other.yields.production;
        expect(
          mined.food + mined.production,
          `a mine on ${ground.terrain} hills gives ${mined.food} food + ${mined.production} production, and a ${other.id} on ${groundName(other.ground)} gives ${sum} in all: ` +
            'the mine must give MORE. Level with another improved tile it loses the tie (it gives no food), so every farm a Worker ' +
            'builds and every net a Fishing Boat builds pushes the mine one citizen back, and a mine that was worked stands unused again. ' +
            'Do not put the Mine back to +2 production, do not make a Farm give more, and do not make a Fishing Net give +3 food, ' +
            'without changing how citizens choose their tiles (rules/city.ts)',
        ).toBeGreaterThan(sum);
      }
    }
  });

  it('a fished coast tile gives 4 food and no production: more food + production than every unimproved tile', () => {
    expect(tileYields({ terrain: 'coast', feature: null, improvement: 'fishingNet' })).toEqual({ food: 4, production: 0 });
    // What a net adds is food and nothing else: the sea has one plain meaning.
    expect(IMPROVEMENTS.fishingNet.yields.production).toBe(0);
    const best = Math.max(...grounds.map((ground) => tileYields(ground).food + tileYields(ground).production));
    for (const ground of grounds.filter((candidate) => improvementFits('fishingNet', candidate))) {
      const fished = tileYields({ ...ground, improvement: 'fishingNet' });
      expect(
        fished.food + fished.production,
        `a fished ${ground.terrain} tile gives ${fished.food} food + ${fished.production} production, and the best unimproved tile gives ${best} in all: ` +
          'the net must give MORE, or citizens take open land before it and the Fishing Boat\'s turns are wasted: ' +
          'at +1 food a net was worked in two thirds of the turns in a farmed city (facts 3B)',
      ).toBeGreaterThan(best);
    }
  });

  it('tileYields adds the improvement to what the tile yields; without one, and with null, nothing changes; the result is a copy', () => {
    // Added, where a feature replaces.
    expect(tileYields({ terrain: 'grassland', feature: null, improvement: 'farm' })).toEqual({ food: 3, production: 1 });
    expect(tileYields({ terrain: 'plains', feature: null, improvement: 'farm' })).toEqual({ food: 2, production: 2 });
    expect(tileYields({ terrain: 'desert', feature: null, improvement: 'farm' })).toEqual({ food: 1, production: 1 });
    expect(tileYields({ terrain: 'grassland', feature: 'hills', improvement: 'mine' })).toEqual({ food: 0, production: 5 });
    expect(tileYields({ terrain: 'desert', feature: 'hills', improvement: 'mine' })).toEqual({ food: 0, production: 5 });
    expect(tileYields({ terrain: 'coast', feature: null, improvement: 'fishingNet' })).toEqual({ food: 4, production: 0 });

    // In general: the tile's own yields plus the table's, for every improvement on every ground it fits.
    for (const id of IMPROVEMENT_IDS) {
      for (const ground of grounds.filter((candidate) => improvementFits(id, candidate))) {
        const bare = tileYields(ground);
        expect(tileYields({ ...ground, improvement: id }), `${id} on ${ground.feature ?? 'open'} ${ground.terrain}`).toEqual({
          food: bare.food + IMPROVEMENTS[id].yields.food,
          production: bare.production + IMPROVEMENTS[id].yields.production,
        });
      }
    }

    // A caller that only knows the land leaves the field out; null says "nothing built". Both give the land's numbers.
    for (const ground of grounds) {
      const source = ground.feature === null ? TERRAIN[ground.terrain].yields : FEATURES[ground.feature].yields;
      expect(tileYields(ground)).toEqual(source);
      expect(tileYields({ ...ground, improvement: null })).toEqual(source);
      expect(tileYields({ ...ground, improvement: undefined })).toEqual(source);
    }

    // The result is a copy: scribbling on it damages neither table.
    const yields = tileYields({ terrain: 'grassland', feature: null, improvement: 'farm' });
    yields.food = 99;
    yields.production = 99;
    expect(tileYields({ terrain: 'grassland', feature: null, improvement: 'farm' })).toEqual({ food: 3, production: 1 });
    expect(IMPROVEMENTS.farm.yields).toEqual({ food: 1, production: 0 });
    expect(TERRAIN.grassland.yields).toEqual({ food: 2, production: 1 });
    // The other tile helpers do not look at what is built.
    expect(tileMoveCost({ terrain: 'grassland', feature: 'hills', improvement: 'mine' }, 'land')).toBe(FEATURES.hills.moveCost);
    expect(tileMoveCost({ terrain: 'coast', feature: null, improvement: 'fishingNet' }, 'sea')).toBe(TERRAIN.coast.moveCost.sea);
    expect(tileIsWorkable({ terrain: 'grassland', feature: null, improvement: 'farm' })).toBe(true);
    expect(tileAllowsCity({ terrain: 'grassland', feature: null, improvement: 'farm' })).toBe(true);
  });

  it('at least one unit type can build improvements, and every such unit is a civilian', () => {
    const builders = UNIT_TYPE_IDS.filter((id) => UNITS[id].improvements.length > 0);
    expect(builders.length).toBeGreaterThan(0);
    for (const id of builders) {
      // A tile holds one civilian: that is what keeps two units from sharing a job.
      expect(UNITS[id].unitClass, id).toBe('civilian');
    }
    for (const id of UNIT_TYPE_IDS) expect(Array.isArray(UNITS[id].improvements), id).toBe(true);
    // The column that was replaced must not come back beside the list: two columns that must agree are one bug waiting.
    for (const id of UNIT_TYPE_IDS) expect(Object.hasOwn(UNITS[id], 'canImprove'), id).toBe(false);
    // A city can build one, so the column is of use.
    expect(builders.some((id) => UNITS[id].cost > 0)).toBe(true);
  });
});

describe('the two ways of placing citizens', () => {
  it('the ids match the table and the first is the default', () => {
    expect([...CITY_FOCUS_IDS]).toEqual(['grow', 'build']);
    expect(Object.keys(CITY_FOCUS).sort()).toEqual([...CITY_FOCUS_IDS].sort());
    expect(new Set(CITY_FOCUS_IDS).size).toBe(CITY_FOCUS_IDS.length);
    // The city panel shows the default on the left, where a new city stands.
    expect(DEFAULT_CITY_FOCUS).toBe(CITY_FOCUS_IDS[0]);
    expect(DEFAULT_CITY_FOCUS).toBe('grow');
  });

  it('each name has at most 11 characters and the two differ; each summary has at most 34 characters, no digit and no full stop; each description ends with a full stop and has no digit', () => {
    for (const id of CITY_FOCUS_IDS) {
      const way = CITY_FOCUS[id];
      // The words on a button 138 pixels wide: one line.
      expect(way.name.length, `${id}: the name takes one line in the button at 11 characters or fewer`).toBeLessThanOrEqual(11);
      expect(way.name, id).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
      // Not the bare verb: "Build" alone reads as an order to the city's queue.
      expect(way.name.includes(' '), `${id}: two words`).toBe(true);
      // The small line in the button: two lines at most, and it never changes with the city.
      expect(way.summary.length, `${id}: the summary takes two lines at most in the button at 34 characters or fewer`).toBeLessThanOrEqual(34);
      expect(way.summary.length, id).toBeGreaterThan(5);
      expect(way.summary, `${id}: no digit`).not.toMatch(/[0-9]/);
      expect(way.summary, `${id}: no full stop, one line`).not.toMatch(/[.\n\r]/);
      expect(way.summary, `${id}: begins with a small letter`).toMatch(/^[a-z]/);
      expect(way.summary, id).toBe(way.summary.trim());
      // The tooltip: one or two sentences.
      expect(way.description.endsWith('.'), `${id}: the description ends with a full stop`).toBe(true);
      expect(way.description, `${id}: no digit`).not.toMatch(/[0-9]/);
      expect(way.description, id).not.toMatch(/[\n\r]/);
      expect(way.description, id).toBe(way.description.trim());
      expect(way.description.length, id).toBeGreaterThan(20);
      expect(Object.keys(way).sort(), id).toEqual(['description', 'name', 'summary']);
    }
    expect(new Set(CITY_FOCUS_IDS.map((id) => CITY_FOCUS[id].name)).size).toBe(CITY_FOCUS_IDS.length);
    expect(new Set(CITY_FOCUS_IDS.map((id) => CITY_FOCUS[id].summary)).size).toBe(CITY_FOCUS_IDS.length);
    // The words on the two buttons (the page and the README use them).
    expect(CITY_FOCUS_IDS.map((id) => CITY_FOCUS[id].name)).toEqual(['Grow first', 'Build first']);
    // Build's food line may show a minus, which reads as starvation: its description says the city never shrinks.
    expect(CITY_FOCUS.build.description).toContain('never shrinks');
  });
});

describe('civilizations', () => {
  it('have the colours fixed by the art direction', () => {
    expect([CIVS.rome.primary, CIVS.rome.secondary]).toEqual(['#c81e1e', '#f6dc8c']);
    expect([CIVS.egypt.primary, CIVS.egypt.secondary]).toEqual(['#e3b94a', '#17323a']);
    expect([CIVS.china.primary, CIVS.china.secondary]).toEqual(['#1f8f5a', '#f5e3a3']);
    expect([CIVS.mali.primary, CIVS.mali.secondary]).toEqual(['#d98a3a', '#2a1606']);
    expect([CIVS.maya.primary, CIVS.maya.secondary]).toEqual(['#1f7fa0', '#a9ecd4']);
    expect([CIVS.norse.primary, CIVS.norse.secondary]).toEqual(['#4a5a9a', '#dfe5f2']);
  });

  it('small page text on a civilization\'s colour can be read: at least 4.5 to 1 (WCAG AA), and the accent wherever the accent manages that', () => {
    /** Relative luminance of '#rrggbb', as WCAG 2 defines it. */
    const luminance = (color: string): number => {
      const channel = (offset: number): number => {
        const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };
    const contrast = (a: string, b: string): number => {
      const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
      return (light + 0.05) / (dark + 0.05);
    };
    // The formula, on pairs whose contrast everybody knows.
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);

    for (const id of CIV_IDS) {
      const civ = CIVS[id];
      expect(civ.text).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrast(civ.text, civ.primary), `${id}: text on primary`).toBeGreaterThanOrEqual(4.5);
      if (contrast(civ.secondary, civ.primary) >= 4.5) expect(civ.text, id).toBe(civ.secondary);
    }
    // Three accents do not manage it (cream on red and on green, mint on blue): those are the ones with a text colour of their own.
    expect(CIV_IDS.filter((id) => CIVS[id].text !== CIVS[id].secondary)).toEqual(['rome', 'china', 'maya']);
  });

  it('have distinct primary colours and names the pixel font can draw', () => {
    expect(new Set(CIV_IDS.map((id) => CIVS[id].primary)).size).toBe(CIV_IDS.length);
    const everyCityName: string[] = [];
    for (const id of CIV_IDS) {
      const civ = CIVS[id];
      expect(civ.primary).toMatch(/^#[0-9a-f]{6}$/);
      expect(civ.secondary).toMatch(/^#[0-9a-f]{6}$/);
      expect(civ.cityNames.length).toBeGreaterThanOrEqual(4);
      // What the pixel font of the city banners has: letters, and single spaces between words.
      for (const name of [civ.name, ...civ.cityNames]) expect(name).toMatch(/^[A-Za-z]+( [A-Za-z]+)*$/);
      // A leader's name is only ever page text (the lobby), so its words may carry apostrophes: "Yax K'uk' Mo'".
      expect(civ.leader).toMatch(/^[A-Za-z][A-Za-z']*( [A-Za-z][A-Za-z']*)*$/);
      everyCityName.push(...civ.cityNames);
    }
    expect(new Set(everyCityName).size).toBe(everyCityName.length);
  });

  it('have the leaders and capitals of the approved civilization board', () => {
    const board = CIV_IDS.map((id) => [CIVS[id].name, CIVS[id].leader, cityNameFor(id, 0)]);
    expect(board).toEqual([
      ['Rome', 'Hadrian', 'Rome'],
      ['Egypt', 'Hatshepsut', 'Thebes'],
      ['China', 'Taizong of Tang', 'Changan'],
      ['Mali', 'Mansa Musa', 'Niani'],
      ['Maya', "Yax K'uk' Mo'", 'Copan'],
      ['Norse', 'Harald Hardrada', 'Nidaros'],
    ]);
    // The lists kept their other names: Copan only moved to the front, and
    // Nidaros replaced Trondheim (the same town under its later name).
    expect(CIVS.maya.cityNames).toEqual(['Copan', 'Tikal', 'Palenque', 'Calakmul', 'Uxmal', 'Chichen Itza', 'Caracol', 'Yaxchilan']);
    expect(CIVS.norse.cityNames).toEqual(['Nidaros', 'Uppsala', 'Birka', 'Hedeby', 'Ribe', 'Kaupang', 'Jelling', 'Sigtuna']);
    expect(CIV_IDS.flatMap((id) => CIVS[id].cityNames)).not.toContain('Trondheim');
  });

  it('names cities in list order and numbers them when the list runs out', () => {
    const names = CIVS.rome.cityNames;
    expect(cityNameFor('rome', 0)).toBe('Rome');
    expect(cityNameFor('rome', 1)).toBe(names[1]);
    expect(cityNameFor('rome', names.length - 1)).toBe(names[names.length - 1]);
    expect(cityNameFor('rome', names.length)).toBe('Rome 2');
    expect(cityNameFor('rome', names.length + 1)).toBe(`${names[1]} 2`);
    expect(cityNameFor('rome', 2 * names.length)).toBe('Rome 3');
  });
});

describe('map sizes and balance constants', () => {
  it('map sizes grow and have room for their players', () => {
    let previousArea = 0;
    for (const id of MAP_SIZE_IDS) {
      const size = MAP_SIZES[id];
      expect(size.width).toBeGreaterThanOrEqual(16);
      expect(size.height).toBeGreaterThanOrEqual(12);
      expect(size.width * size.height).toBeGreaterThan(previousArea);
      expect(size.recommendedPlayers).toBeGreaterThanOrEqual(1);
      expect(size.recommendedPlayers).toBeLessThanOrEqual(RULES.maxSeats);
      previousArea = size.width * size.height;
    }
  });

  it('the player limit follows from seats and civilizations', () => {
    expect(RULES.maxSeats).toBe(8);
    expect(maxPlayers()).toBe(Math.min(RULES.maxSeats, CIV_IDS.length));
    expect(maxPlayers()).toBeGreaterThanOrEqual(1);
  });

  it('city numbers hang together', () => {
    expect(RULES.minCityDistance).toBeGreaterThanOrEqual(2);
    expect(RULES.cityClaimRadius).toBeGreaterThanOrEqual(1);
    expect(RULES.territorySightMargin).toBeGreaterThanOrEqual(0);
    expect(RULES.minStartDistance).toBeGreaterThanOrEqual(RULES.minCityDistance);
    // A start must have somewhere to walk to, or its units could never move.
    expect(RULES.minStartLandmass).toBeGreaterThanOrEqual(2);
    expect(RULES.maxPathLength).toBeGreaterThanOrEqual(Math.max(...UNIT_TYPE_IDS.map((id) => UNITS[id].moves)));
    // A brand-new city (centre only, one citizen with nothing to work) must not starve.
    expect(RULES.cityCenterMinYields.food).toBeGreaterThanOrEqual(RULES.foodPerCitizen);
  });

  it('the map generator scores a start by the land its first city would claim', () => {
    // Rule S3 of generateMap ("fair starts") adds up the tiles within 2 steps
    // of every start, which is the land a city claims today. That 2 is built
    // into the generator (withinTwo in mapgen/grid.ts). When cityClaimRadius
    // is changed, change the generator and its doc comment with it, then
    // this number.
    expect(RULES.cityClaimRadius, 'see the comment above this line').toBe(2);
  });

  it('maxQueueLength, forecastTurns and minFoodSurplus are whole numbers of at least 1, and maxQueueLength is at most 64', () => {
    for (const name of ['maxQueueLength', 'forecastTurns', 'minFoodSurplus'] as const) {
      expect(Number.isInteger(RULES[name]), name).toBe(true);
      expect(RULES[name], name).toBeGreaterThanOrEqual(1);
    }
    expect(
      RULES.maxQueueLength,
      "the server's message check lets 64 queue entries through: change MAX_QUEUE_INPUT_LENGTH in server/src/parseMessage.ts with it",
    ).toBeLessThanOrEqual(64);
  });

  it('growth needs more food each time', () => {
    expect(foodToGrow(1)).toBe(RULES.growthBase);
    expect(foodToGrow(2)).toBe(RULES.growthBase + RULES.growthPerPopulation);
    expect(foodToGrow(5)).toBeGreaterThan(foodToGrow(4));
    expect(foodToGrow(1)).toBeGreaterThan(0);
  });
});

describe('rule errors', () => {
  it('every code has a plain-English message', () => {
    for (const [code, message] of Object.entries(RULE_ERROR_MESSAGES)) {
      expect(message.length).toBeGreaterThan(5);
      expect(ruleError(code as keyof typeof RULE_ERROR_MESSAGES)).toEqual({ code, message });
    }
  });
});
