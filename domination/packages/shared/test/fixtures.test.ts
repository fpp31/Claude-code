import { describe, expect, it } from 'vitest';
import {
  FEATURES,
  FEATURE_IDS,
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  RULES,
  TERRAIN_IDS,
  UNITS,
  UNIT_TYPE_IDS,
  applyAction,
  buildPlayerView,
  checkInvariants,
  cloneJson,
  createGame,
  foodToGrow,
  generateMap,
  improvementFits,
  improvementSiteError,
  jobView,
  maxPlayers,
  neighbors,
  siteInView,
  tileCount,
  tileIsWater,
  tileYields,
  updateKnowledge,
} from '../src/index';
import type { TileView } from '../src/index';
import {
  ASCII_LEGEND,
  isImplemented,
  isNotImplementedError,
  mapFromAscii,
  mapToAscii,
  markCoast,
  notImplementedError,
  sampleLobby,
  sampleMap,
  sampleView,
} from '../src/testing';

describe('mapFromAscii', () => {
  it('reads one tile per character and ignores spaces', () => {
    const map = mapFromAscii(['~ g f', ' , p m']);
    expect(map.width).toBe(3);
    expect(map.height).toBe(2);
    expect(map.tiles).toEqual([
      { terrain: 'ocean', feature: null, improvement: null, cityId: null },
      { terrain: 'grassland', feature: null, improvement: null, cityId: null },
      { terrain: 'grassland', feature: 'forest', improvement: null, cityId: null },
      { terrain: 'coast', feature: null, improvement: null, cityId: null },
      { terrain: 'plains', feature: null, improvement: null, cityId: null },
      { terrain: 'grassland', feature: 'mountains', improvement: null, cityId: null },
    ]);
  });

  it('only puts features on grounds the tables allow', () => {
    for (const entry of Object.values(ASCII_LEGEND)) {
      if (entry.feature !== null) expect(FEATURES[entry.feature].allowedOn).toContain(entry.terrain);
    }
  });

  it('rejects bad drawings', () => {
    expect(() => mapFromAscii([])).toThrow();
    expect(() => mapFromAscii(['gg', 'g'])).toThrow();
    expect(() => mapFromAscii(['g?'])).toThrow();
    expect(() => mapFromAscii([''])).toThrow();
  });
});

describe('the legend of the map drawings', () => {
  it('has exactly one character for every kind of tile: each ground, and each feature on each ground it may stand on', () => {
    const kinds: string[] = [];
    for (const terrain of TERRAIN_IDS) {
      kinds.push(`${terrain}`);
      for (const feature of FEATURE_IDS) {
        if (FEATURES[feature].allowedOn.includes(terrain)) kinds.push(`${terrain}+${feature}`);
      }
    }
    const drawn = Object.values(ASCII_LEGEND).map((entry) =>
      entry.feature === null ? `${entry.terrain}` : `${entry.terrain}+${entry.feature}`,
    );
    expect([...drawn].sort()).toEqual([...kinds].sort());
  });
});

describe('mapToAscii: drawing a map as text', () => {
  const ROWS = [
    '~ ~ ~ ~ ~ ~',
    ' , g f h m ~',
    '~ p F H M ~',
    ' ~ d D A , ~',
  ];

  it('draws every tile with its character of the legend, odd rows indented', () => {
    expect(mapToAscii(mapFromAscii(ROWS))).toEqual(ROWS);
  });

  it('draws a generated map so that mapFromAscii reads the very same map back', () => {
    for (const mapSize of ['small', 'medium', 'large'] as const) {
      const { map } = generateMap('drawn as text', mapSize, 2);
      const rows = mapToAscii(map);
      expect(rows.join('')).not.toContain('?');
      expect(mapFromAscii(rows)).toEqual(map);
    }
  });

  it('draws starts as seat numbers', () => {
    const map = mapFromAscii(['~ A g', ' g g ~']);
    expect(mapToAscii(map, [4, 2])).toEqual(['~ A 2', ' g 1 ~']);
  });
});

describe('markCoast', () => {
  it('turns water next to land into coast and other water into ocean', () => {
    const map = markCoast(mapFromAscii(['~ ~ ~ ~ ~', ' ~ ~ g , ~', '~ ~ ~ ~ ~']));
    for (let tile = 0; tile < map.tiles.length; tile++) {
      if (!tileIsWater(map.tiles[tile])) continue;
      const touchesLand = neighbors(tile, map).some((n) => !tileIsWater(map.tiles[n]));
      expect(map.tiles[tile].terrain).toBe(touchesLand ? 'coast' : 'ocean');
    }
    expect(map.tiles[0].terrain).toBe('ocean');
    expect(map.tiles[5 + 1].terrain).toBe('coast'); // west of the land tile
    expect(map.tiles[5 + 4].terrain).toBe('ocean'); // drawn as coast, but touches no land
  });
});

describe('the sample map', () => {
  it('obeys the map rules the generator promises', () => {
    const map = sampleMap();
    expect(map.tiles).toHaveLength(map.width * map.height);
    for (let tile = 0; tile < map.tiles.length; tile++) {
      const x = tile % map.width;
      const y = Math.floor(tile / map.width);
      const onEdge = x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;
      if (onEdge) expect(tileIsWater(map.tiles[tile])).toBe(true);
      const feature = map.tiles[tile].feature;
      if (feature !== null) expect(FEATURES[feature].allowedOn).toContain(map.tiles[tile].terrain);
      expect(map.tiles[tile].cityId).toBeNull();
      expect(map.tiles[tile].improvement).toBeNull();
    }
  });

  it('is a fresh copy every time', () => {
    const first = sampleMap();
    first.tiles[0].terrain = 'desert';
    expect(sampleMap().tiles[0].terrain).toBe('ocean');
  });
});

describe('the sample view', () => {
  const view = sampleView();

  it('has the documented shape', () => {
    expect(view.tiles).toHaveLength(tileCount(view));
    expect(view.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(view.you).toBe('p1');
    expect(view.units.map((u) => u.id)).toEqual(view.units.map((u) => u.id).slice().sort());
    expect(view.cities.map((c) => c.id)).toEqual(view.cities.map((c) => c.id).slice().sort());
    // It must survive a trip through JSON unchanged, like every view.
    expect(cloneJson(view)).toEqual(view);
  });

  it('shows all three kinds of tile: in sight, fogged and never seen', () => {
    expect(view.tiles.some((tile) => tile === null)).toBe(true);
    expect(view.tiles.some((tile) => tile !== null && tile.visible)).toBe(true);
    expect(view.tiles.some((tile) => tile !== null && !tile.visible)).toBe(true);
  });

  it('follows the fog rules a real view follows', () => {
    for (const unit of view.units) {
      // Every unit stands on a tile in sight, on land a unit can enter.
      expect(view.tiles[unit.tile]?.visible).toBe(true);
      // Details only for the viewer's own units.
      expect(unit.own !== null).toBe(unit.owner === view.you);
    }
    for (const city of view.cities) {
      expect(view.tiles[city.tile]).not.toBeNull();
      expect(city.visible).toBe(view.tiles[city.tile]!.visible);
      expect(view.tiles[city.tile]!.owner).toBe(city.owner);
      expect(city.own !== null).toBe(city.owner === view.you);
      if (city.owner === view.you) expect(city.visible).toBe(true);
    }
    // One city in sight (own) and one remembered (foreign).
    expect(view.cities.filter((c) => c.visible)).toHaveLength(1);
    expect(view.cities.filter((c) => !c.visible)).toHaveLength(1);
  });

  it('gives the settler a place to found a city and the warrior none', () => {
    const settler = view.units.find((u) => u.type === 'settler' && u.owner === 'p1');
    const warrior = view.units.find((u) => u.type === 'warrior' && u.owner === 'p1');
    expect(settler?.own?.foundCityError).toBeNull();
    expect(warrior?.own?.foundCityError).toBe('cannotFoundCity');
  });

  it('the sample city\'s queue and menu obey the rule "turns or wait, never both"', () => {
    const rome = view.cities.find((city) => city.own !== null);
    const own = rome?.own;
    expect(own).toBeDefined();
    if (own === null || own === undefined) return;

    expect(own.buildQueue.length).toBeGreaterThan(1);
    expect(own.buildQueue.length).toBeLessThanOrEqual(RULES.maxQueueLength);
    for (const entry of [...own.buildQueue, ...own.buildOptions]) {
      expect(entry.turns !== null, entry.item.unitType).toBe(entry.wait === null);
      if (entry.turns !== null) {
        expect(Number.isInteger(entry.turns)).toBe(true);
        expect(entry.turns).toBeGreaterThanOrEqual(1);
        expect(entry.turns).toBeLessThanOrEqual(RULES.forecastTurns);
      }
      expect(entry.cost).toBe(UNITS[entry.item.unitType].cost);
      expect(Object.keys(entry.item).sort()).toEqual(['kind', 'unitType']);
    }
    // The rows come one after the other, and the menu is forecast behind the whole queue.
    const rowTurns = own.buildQueue.map((row) => row.turns ?? 0);
    expect(rowTurns).toEqual([...rowTurns].sort((a, b) => a - b));
    expect(new Set(rowTurns).size).toBe(rowTurns.length);
    for (const option of own.buildOptions) expect(option.turns).toBeGreaterThan(rowTurns[rowTurns.length - 1]);
    // The menu is the unit table, in its order; the queue is not full, so everything can be added.
    expect(own.buildOptions.map((option) => option.item.unitType)).toEqual(UNIT_TYPE_IDS);
    for (const option of own.buildOptions) expect(option.addError).toBeNull();
    // Nothing is held: the first entry is not even paid for.
    expect(own.held).toBeNull();
    expect(own.productionStored).toBeLessThan(own.buildQueue[0].cost);
    expect(own.foodToGrow).toBe(foodToGrow(rome?.population ?? 0));
  });

  it('the sample city\'s numbers are what the rules give for such a city', () => {
    // The sample view is hand-made. Here the same city is set up in a real
    // game on the sample map, and the rules are asked for its panel.
    const sample = view.cities.find((city) => city.own !== null);
    const thebes = view.cities.find((city) => city.own === null);
    if (sample === undefined || sample.own === null || thebes === undefined) throw new Error('the sample view has lost its cities');
    const farm = view.tiles.findIndex((tile) => tile !== null && tile.visible && tile.improvement === 'farm');

    const start = createGame(
      {
        seed: 'sample',
        settings: { mapSize: 'small', turnMode: 'simultaneous' },
        players: [{ id: 'p1', name: 'Ada', civ: 'rome' }, { id: 'p2', name: 'Ben', civ: 'egypt' }],
      },
      () => ({ map: sampleMap(), starts: [sample.tile, thebes.tile] }),
    );
    const settler = Object.values(start.units).find((unit) => unit.owner === 'p1' && unit.type === 'settler');
    const founded = applyAction(start, 'p1', start.turn, { type: 'foundCity', unitId: settler?.id ?? '' });
    if (!founded.ok) throw new Error(`Rome could not be founded on the sample map: ${founded.error.code}`);
    const state = cloneJson(founded.state);
    const rome = Object.values(state.cities)[0];
    rome.population = sample.population;
    rome.foodStored = sample.own.foodStored;
    rome.productionStored = sample.own.productionStored;
    rome.buildQueue = sample.own.buildQueue.map((row) => ({ kind: 'unit', unitType: row.item.unitType }));
    state.map.tiles[farm].improvement = 'farm';
    updateKnowledge(state);
    expect(checkInvariants(state)).toEqual([]);

    const real = buildPlayerView(state, 'p1').cities.find((city) => city.id === rome.id)?.own;
    // Everything but the list of worked tiles: the citizen next to the farm
    // has several grassland tiles alike to choose from, and the sample,
    // drawn by hand, shows another of them than the rule's tie-break picks.
    expect({ ...real, worked: null }).toEqual({ ...sample.own, worked: null });
    expect(real?.worked).toContain(farm);
    expect(real?.worked).toHaveLength(sample.own.worked.length);
    for (const tile of sample.own.worked) {
      expect(view.tiles[tile]).toMatchObject({ owner: 'p1', visible: true });
      expect(tile).not.toBe(sample.tile);
    }
    const yieldsOf = (tiles: number[]): number[] =>
      tiles.map((tile) => tileYields(view.tiles[tile] as TileView)).map((yields) => yields.food * 100 + yields.production).sort();
    expect(yieldsOf(sample.own.worked)).toEqual(yieldsOf(real?.worked ?? []));
  });

  it('the sample view\'s improvements stand on ground that fits them, and its Worker\'s job and options are consistent', () => {
    // A finished farm in sight, on the viewer's own land and worked by the city; a mine that is only remembered.
    const improved = view.tiles.map((tile, index) => ({ tile, index })).filter(({ tile }) => tile !== null && tile.improvement !== null);
    expect(improved.map(({ tile }) => [tile?.improvement, tile?.visible, tile?.owner])).toEqual([
      ['mine', false, 'p2'],
      ['farm', true, 'p1'],
    ]);
    for (const { tile, index } of improved) {
      if (tile === null || tile.improvement === null) continue;
      expect(improvementFits(tile.improvement, tile), `tile ${index}`).toBe(true);
      expect(view.cities.some((city) => city.tile === index), `tile ${index}`).toBe(false);
    }
    const farm = improved[1].index;
    expect(view.cities.find((city) => city.own !== null)?.own?.worked).toContain(farm);

    // The Worker: at work on a farm, on own land where a farm fits and none stands yet.
    const worker = view.units.find((unit) => unit.type === 'worker');
    const own = worker?.own;
    if (worker === undefined || own === null || own === undefined || own.job === null) throw new Error('the sample view has lost its Worker at work');
    expect(UNITS[worker.type].canImprove).toBe(true);
    expect(own.job).toEqual(jobView({ improvement: own.job.improvement, turnsWorked: own.job.turnsWorked }));
    expect(own.job.turnsWorked).toBeLessThan(own.job.turnsTotal);
    expect(improvementSiteError(siteInView(view, worker.tile), own.job.improvement)).toBeNull();
    // While it works, every option says so; the turns are the table's.
    expect(own.jobOptions).toEqual(IMPROVEMENT_IDS.map((improvement) => ({
      improvement, turns: IMPROVEMENTS[improvement].turns, error: 'unitBusy',
    })));
    expect(own.foundCityError).toBe('cannotFoundCity');

    // Units that cannot build carry no job and no options; the foreign unit carries nothing at all.
    for (const unit of view.units) {
      if (unit.own === null) continue;
      if (UNITS[unit.type].canImprove) continue;
      expect(unit.own.job, unit.id).toBeNull();
      expect(unit.own.jobOptions, unit.id).toEqual([]);
    }
    // "2 units can still move": the Warrior and the Settler. The Worker is busy.
    expect(view.units.filter((unit) => unit.own !== null && unit.own.movesLeft > 0 && unit.own.job === null)).toHaveLength(2);
  });
});

describe('the sample lobby', () => {
  it('has a host, two seats and a valid code', () => {
    const lobby = sampleLobby();
    expect(lobby.seats.map((s) => s.playerId)).toEqual(['p1', 'p2']);
    expect(lobby.hostId).toBe('p1');
    expect(lobby.maxPlayers).toBe(maxPlayers());
    expect(lobby.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  });
});

describe('isImplemented', () => {
  it('is false for a function that is still to be written and for code that calls one', () => {
    const stub = (): never => {
      throw notImplementedError('something');
    };
    expect(isImplemented(stub)).toBe(false);
    expect(isImplemented(() => [1, 2].map(() => stub()))).toBe(false);
  });

  it('is true for working code and for code that fails in any other way', () => {
    expect(isImplemented(() => 42)).toBe(true);
    expect(
      isImplemented(() => {
        throw new Error('a real bug');
      }),
    ).toBe(true);
  });

  it('recognises the error itself', () => {
    expect(isNotImplementedError(notImplementedError('generateMap'))).toBe(true);
    expect(isNotImplementedError(new Error('something else'))).toBe(false);
    // Only a real Error counts, not a text that happens to read the same.
    expect(isNotImplementedError(notImplementedError('a string, not an Error').message)).toBe(false);
  });

  it('names the missing function in the message', () => {
    expect(notImplementedError('resolveCombat').message).toContain('resolveCombat');
  });
});
