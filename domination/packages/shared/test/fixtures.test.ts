import { describe, expect, it } from 'vitest';
import { FEATURES, cloneJson, maxPlayers, neighbors, tileCount, tileIsWater } from '../src/index';
import {
  ASCII_LEGEND,
  isImplemented,
  isNotImplementedError,
  mapFromAscii,
  markCoast,
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
      { terrain: 'ocean', feature: null, cityId: null },
      { terrain: 'grassland', feature: null, cityId: null },
      { terrain: 'grassland', feature: 'forest', cityId: null },
      { terrain: 'coast', feature: null, cityId: null },
      { terrain: 'plains', feature: null, cityId: null },
      { terrain: 'grassland', feature: 'mountains', cityId: null },
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
  it('is false for a scaffold stub and for code that calls one', () => {
    const stub = (): never => {
      throw new Error('not implemented: something');
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
    expect(isNotImplementedError(new Error('not implemented: generateMap'))).toBe(true);
    expect(isNotImplementedError(new Error('something else'))).toBe(false);
    expect(isNotImplementedError('not implemented: a string, not an Error')).toBe(false);
  });
});
