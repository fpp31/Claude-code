import { describe, expect, it } from 'vitest';
import {
  CIVS,
  CIV_IDS,
  FEATURES,
  FEATURE_IDS,
  MAP_SIZES,
  MAP_SIZE_IDS,
  RULES,
  RULE_ERROR_MESSAGES,
  TERRAIN,
  TERRAIN_IDS,
  UNITS,
  UNIT_TYPE_IDS,
  cityNameFor,
  foodToGrow,
  maxPlayers,
  ruleError,
  tileAllowsCity,
  tileIsWater,
  tileIsWorkable,
  tileMoveCost,
  tileYields,
} from '../src/index';

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
    expect([...CIV_IDS].sort()).toEqual(Object.keys(CIVS).sort());
    expect([...MAP_SIZE_IDS].sort()).toEqual(Object.keys(MAP_SIZES).sort());
  });
});

describe('terrain and features', () => {
  it('water cannot be entered by land units and cannot hold a city', () => {
    for (const id of TERRAIN_IDS) {
      const terrain = TERRAIN[id];
      if (terrain.water) {
        expect(terrain.moveCost).toBeNull();
        expect(terrain.canFoundCity).toBe(false);
      } else {
        expect(terrain.moveCost).toBeGreaterThanOrEqual(1);
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
    expect(tileMoveCost({ terrain: 'grassland', feature: null })).toBe(TERRAIN.grassland.moveCost);
    expect(tileMoveCost({ terrain: 'grassland', feature: 'forest' })).toBe(FEATURES.forest.moveCost);
    expect(tileMoveCost({ terrain: 'plains', feature: 'mountains' })).toBeNull();
    expect(tileMoveCost({ terrain: 'ocean', feature: null })).toBeNull();

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

  it('rough ground costs more than open ground', () => {
    expect(FEATURES.forest.moveCost as number).toBeGreaterThan(TERRAIN.grassland.moveCost as number);
    expect(FEATURES.hills.moveCost as number).toBeGreaterThan(TERRAIN.plains.moveCost as number);
    expect(FEATURES.mountains.moveCost).toBeNull();
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

  it('starting units exist, include a city founder, and fit on one tile', () => {
    expect(RULES.startingUnits.length).toBeGreaterThan(0);
    for (const id of RULES.startingUnits) expect(UNITS[id]).toBeDefined();
    expect(RULES.startingUnits.some((id) => UNITS[id].canFoundCity)).toBe(true);
    const military = RULES.startingUnits.filter((id) => UNITS[id].unitClass === 'military').length;
    const civilian = RULES.startingUnits.filter((id) => UNITS[id].unitClass === 'civilian').length;
    expect(military).toBeLessThanOrEqual(1);
    expect(civilian).toBeLessThanOrEqual(1);
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
