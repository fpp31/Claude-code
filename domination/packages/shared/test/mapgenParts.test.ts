import { describe, expect, it } from 'vitest';
import { MAP_SIZES } from '../src/data/rules';
import { tileIsWater, tileMoveCost } from '../src/data/terrain';
import { distance, neighbors, tilesInRange } from '../src/hex';
import { UNREACHED, gridDistance, gridFor, labelRegions, stepsFrom, topTiles } from '../src/mapgen/grid';
import { chance, layeredNoise, noiseLayer, randomBetween } from '../src/mapgen/noise';
import { openPasses } from '../src/mapgen/passes';
import { seedRng } from '../src/rng';
import { mapFromAscii } from '../src/testing/asciiMap';
import type { GameMap, TileIndex } from '../src/types';

/**
 * Tests of the tools and terrain steps the map generator (work package WP1)
 * is built from: grid.ts, noise.ts and passes.ts in
 * packages/shared/src/mapgen/.
 *
 * generateMap as a whole is tested in mapgen.test.ts (the map) and
 * mapgenStarts.test.ts (the start positions); how the starts are placed and
 * what happens when an attempt fails is in mapgenPlacement.test.ts. The
 * tests here pin down the pieces, mostly on small hand-drawn maps where the
 * right answer is plain to see.
 */

/** Tile index of column x, row y. */
function at(map: { width: number }, x: number, y: number): TileIndex {
  return y * map.width + x;
}

/** How many tiles of the map carry the given feature. */
function countFeature(map: GameMap, feature: string): number {
  return map.tiles.filter((tile) => tile.feature === feature).length;
}

/** How many separate areas a land unit can walk in. */
function walkableAreaCount(map: GameMap): number {
  return labelRegions(gridFor(map), map.tiles.map((tile) => tileMoveCost(tile, 'land') !== null)).sizes.length;
}

describe('grid: lookup tables', () => {
  const size = { width: 7, height: 6 };
  const grid = gridFor(size);

  it('agrees with hex.ts about neighbors, distances and the tiles within two steps', () => {
    expect(grid.count).toBe(42);
    for (let tile = 0; tile < grid.count; tile++) {
      expect(grid.neighbors[tile]).toEqual(neighbors(tile, size));
      expect(grid.withinTwo[tile]).toEqual(tilesInRange(tile, 2, size));
      for (let other = 0; other < grid.count; other++) {
        expect(gridDistance(grid, tile, other)).toBe(distance(tile, other, size));
      }
    }
  });

  it('knows how far each tile is from the map edge', () => {
    expect(grid.edgeDistance[at(size, 0, 0)]).toBe(0);
    expect(grid.edgeDistance[at(size, 6, 3)]).toBe(0);
    expect(grid.edgeDistance[at(size, 1, 4)]).toBe(1);
    expect(grid.edgeDistance[at(size, 3, 2)]).toBe(2);
    expect(grid.edgeDistance[at(size, 3, 3)]).toBe(2);
  });

  it('places odd rows half a tile to the right, and rows a little less than a tile apart', () => {
    expect(grid.px[at(size, 2, 0)]).toBe(2);
    expect(grid.px[at(size, 2, 1)]).toBe(2.5);
    expect(grid.py[at(size, 2, 0)]).toBe(0);
    expect(grid.py[at(size, 2, 2)]).toBeCloseTo(1.732, 3);
  });

  it('builds separate tables for different sizes', () => {
    expect(gridFor({ width: 6, height: 7 }).neighbors[0]).toEqual(neighbors(0, { width: 6, height: 7 }));
    expect(gridFor(size).width).toBe(7);
  });
});

describe('grid: regions, distances and ranking', () => {
  const map = mapFromAscii([
    '~ ~ ~ ~ ~ ~ ~ ~',
    ' ~ g g ~ ~ g ~ ~',
    '~ g g ~ ~ g g ~',
    ' ~ ~ ~ ~ ~ ~ g ~',
    '~ ~ ~ ~ ~ ~ ~ ~',
  ]);
  const grid = gridFor(map);
  const isLand = map.tiles.map((tile) => !tileIsWater(tile));

  it('labelRegions groups connected tiles and counts them', () => {
    const regions = labelRegions(grid, isLand);
    expect(regions.sizes).toEqual([4, 4]);
    // Numbered in the order the first tile of each region appears.
    expect(regions.regionOf[at(map, 1, 1)]).toBe(0);
    expect(regions.regionOf[at(map, 2, 2)]).toBe(0);
    expect(regions.regionOf[at(map, 5, 1)]).toBe(1);
    expect(regions.regionOf[at(map, 6, 3)]).toBe(1);
    expect(regions.regionOf[at(map, 0, 0)]).toBe(-1);
  });

  it('labelRegions finds nothing where there are no members', () => {
    const regions = labelRegions(grid, isLand.map(() => false));
    expect(regions.sizes).toEqual([]);
    expect(regions.regionOf.every((region) => region === -1)).toBe(true);
  });

  it('stepsFrom gives the distance to the nearest source', () => {
    const steps = stepsFrom(grid, isLand);
    for (let tile = 0; tile < grid.count; tile++) {
      let nearest = Infinity;
      for (let source = 0; source < grid.count; source++) {
        if (isLand[source]) nearest = Math.min(nearest, distance(tile, source, map));
      }
      expect(steps[tile]).toBe(nearest);
    }
  });

  it('stepsFrom marks everything as unreached when there is no source', () => {
    expect(stepsFrom(grid, isLand.map(() => false)).every((steps) => steps === UNREACHED)).toBe(true);
  });

  it('topTiles picks the tiles with the highest scores', () => {
    const score = [5, 1, 9, 3, 7];
    expect(topTiles([0, 1, 2, 3, 4], score, 2).sort()).toEqual([2, 4]);
    expect(topTiles([0, 1, 3], score, 2).sort()).toEqual([0, 3]);
  });

  it('topTiles returns exactly as many as asked for, also when scores are equal (the earlier tile wins)', () => {
    const score = [4, 4, 4, 4, 8];
    expect(topTiles([0, 1, 2, 3, 4], score, 3).sort()).toEqual([0, 1, 4]);
    expect(topTiles([3, 2, 1, 0], score, 2).sort()).toEqual([2, 3]);
  });

  it('topTiles copes with asking for none, or for more than there are', () => {
    const score = [5, 1, 9];
    expect(topTiles([0, 1, 2], score, 0)).toEqual([]);
    expect(topTiles([0, 1, 2], score, -3)).toEqual([]);
    expect(topTiles([0, 1, 2], score, 10).sort()).toEqual([0, 1, 2]);
    expect(topTiles([], score, 2)).toEqual([]);
  });
});

describe('noise: smooth random numbers', () => {
  const grid = gridFor(MAP_SIZES.medium);

  it('stays between 0 and 1', () => {
    for (const values of [noiseLayer(seedRng('n', 'map'), grid, 6), layeredNoise(seedRng('n', 'map'), grid, [7, 3.5, 1.75])]) {
      expect(values).toHaveLength(grid.count);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...values)).toBeLessThanOrEqual(1);
    }
  });

  it('is the same for the same random stream and different for another', () => {
    expect(layeredNoise(seedRng('n', 'map'), grid, [6, 3])).toEqual(layeredNoise(seedRng('n', 'map'), grid, [6, 3]));
    expect(layeredNoise(seedRng('n', 'map'), grid, [6, 3])).not.toEqual(layeredNoise(seedRng('n', 'map:moisture'), grid, [6, 3]));
  });

  it('changes gently from tile to tile, and uses most of its range across the map', () => {
    const values = noiseLayer(seedRng('smooth', 'map'), grid, 6);
    let steps = 0;
    let totalStep = 0;
    for (let tile = 0; tile < grid.count; tile++) {
      for (const neighbor of grid.neighbors[tile]) {
        totalStep += Math.abs(values[tile] - values[neighbor]);
        steps++;
      }
    }
    // Independent random numbers would differ by 0.33 on average.
    expect(totalStep / steps).toBeLessThan(0.1);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.7);
  });

  it('makes smaller patches with a smaller cell', () => {
    const roughness = (cell: number): number => {
      const values = noiseLayer(seedRng('cells', 'map'), grid, cell);
      let total = 0;
      for (let tile = 0; tile < grid.count; tile++) {
        for (const neighbor of grid.neighbors[tile]) total += Math.abs(values[tile] - values[neighbor]);
      }
      return total;
    };
    expect(roughness(3)).toBeGreaterThan(roughness(9) * 2);
  });

  it('randomBetween stays in its range and chance respects 0 and 1', () => {
    const rng = seedRng('r', 'map');
    for (let i = 0; i < 200; i++) {
      const value = randomBetween(rng, { min: 0.38, max: 0.42 });
      expect(value).toBeGreaterThanOrEqual(0.38);
      expect(value).toBeLessThan(0.42);
      expect(chance(rng, 0)).toBe(false);
      expect(chance(rng, 1)).toBe(true);
    }
  });
});

describe('passes: no valley is sealed off', () => {
  // The tile (4, 2) is ringed by six mountains, and the same block of
  // mountains separates the west of the island from the east.
  const SEALED = [
    '~ ~ ~ ~ ~ ~ ~ ~ ~',
    ' ~ g g m m g g g ~',
    '~ g g m g m g g ~',
    ' ~ g g m m g g g ~',
    '~ ~ ~ ~ ~ ~ ~ ~ ~',
  ];

  it('the example really is cut into three pieces', () => {
    const map = mapFromAscii(SEALED);
    expect(neighbors(at(map, 4, 2), map).every((tile) => map.tiles[tile].feature === 'mountains')).toBe(true);
    expect(walkableAreaCount(map)).toBe(3);
  });

  it('opens just enough mountains to join all the pieces, and turns them into hills', () => {
    const map = mapFromAscii(SEALED);
    openPasses(gridFor(map), map.tiles);
    expect(walkableAreaCount(map)).toBe(1);
    // Two passes are enough: one into the valley, one on to the far side.
    expect(countFeature(map, 'mountains')).toBe(6 - 2);
    expect(countFeature(map, 'hills')).toBe(2);
  });

  it('changes nothing but the mountains it opens', () => {
    const before = mapFromAscii(SEALED);
    const after = mapFromAscii(SEALED);
    openPasses(gridFor(after), after.tiles);
    after.tiles.forEach((tile, index) => {
      if (tile.feature === before.tiles[index].feature) expect(tile).toEqual(before.tiles[index]);
      else expect([before.tiles[index].feature, tile.feature, tile.terrain]).toEqual(['mountains', 'hills', before.tiles[index].terrain]);
    });
  });

  it('leaves a map alone when the mountains cut nothing off', () => {
    const rows = [
      '~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ g g m m g g g ~',
      '~ g g m m m g g ~',
      ' ~ g g g g g g g ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~',
    ];
    const map = mapFromAscii(rows);
    openPasses(gridFor(map), map.tiles);
    expect(map).toEqual(mapFromAscii(rows));
  });

  it('does not join separate islands', () => {
    const rows = [
      '~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ g g ~ ~ g m g ~',
      '~ g g ~ ~ g m g ~',
      ' ~ g g ~ ~ g m g ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~',
    ];
    const map = mapFromAscii(rows);
    openPasses(gridFor(map), map.tiles);
    // The eastern island was cut in two and is joined by one pass; the sea stays.
    expect(walkableAreaCount(map)).toBe(2);
    expect(countFeature(map, 'mountains')).toBe(2);
    expect(map.tiles.filter(tileIsWater).length).toBe(mapFromAscii(rows).tiles.filter(tileIsWater).length);
  });
});
