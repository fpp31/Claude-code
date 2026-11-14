import { describe, expect, it } from 'vitest';
import {
  DIRECTION_COUNT,
  DIRECTION_NAMES,
  areAdjacent,
  axialToCube,
  axialToOffset,
  coordDistance,
  cubeToOffset,
  directionBetween,
  distance,
  inBounds,
  isValidTile,
  neighborCoord,
  neighborInDirection,
  neighbors,
  offsetToAxial,
  offsetToCube,
  ring,
  tileCoord,
  tileCount,
  tileIndex,
  tilesInRange,
} from '../src/hex';
import type { GridSize } from '../src/hex';

const GRID: GridSize = { width: 12, height: 10 };

/** Tile index of (x, y) on the test grid. */
function at(x: number, y: number): number {
  return tileIndex({ x, y }, GRID);
}

/** Distances from `start` to every tile, found by walking neighbor to neighbor (slow but obviously right). */
function distancesByWalking(start: number, size: GridSize): number[] {
  const result: number[] = new Array(tileCount(size)).fill(-1);
  result[start] = 0;
  const queue = [start];
  while (queue.length > 0) {
    const tile = queue.shift() as number;
    for (const next of neighbors(tile, size)) {
      if (result[next] === -1) {
        result[next] = result[tile] + 1;
        queue.push(next);
      }
    }
  }
  return result;
}

describe('tile indexes', () => {
  it('numbers tiles row by row', () => {
    expect(at(0, 0)).toBe(0);
    expect(at(11, 0)).toBe(11);
    expect(at(0, 1)).toBe(12);
    expect(at(5, 3)).toBe(41);
    expect(tileCount(GRID)).toBe(120);
  });

  it('converts index -> coordinate -> index for every tile', () => {
    for (let tile = 0; tile < tileCount(GRID); tile++) {
      const c = tileCoord(tile, GRID);
      expect(inBounds(c, GRID)).toBe(true);
      expect(tileIndex(c, GRID)).toBe(tile);
    }
  });

  it('knows what is on the map', () => {
    expect(inBounds({ x: 0, y: 0 }, GRID)).toBe(true);
    expect(inBounds({ x: 11, y: 9 }, GRID)).toBe(true);
    expect(inBounds({ x: -1, y: 0 }, GRID)).toBe(false);
    expect(inBounds({ x: 12, y: 0 }, GRID)).toBe(false);
    expect(inBounds({ x: 0, y: 10 }, GRID)).toBe(false);

    expect(isValidTile(0, GRID)).toBe(true);
    expect(isValidTile(119, GRID)).toBe(true);
    expect(isValidTile(120, GRID)).toBe(false);
    expect(isValidTile(-1, GRID)).toBe(false);
    expect(isValidTile(1.5, GRID)).toBe(false);
    expect(isValidTile(Number.NaN, GRID)).toBe(false);
  });
});

describe('coordinate conversions', () => {
  it('matches hand-worked odd-r examples', () => {
    expect(offsetToAxial({ x: 0, y: 0 })).toEqual({ q: 0, r: 0 });
    expect(offsetToAxial({ x: 3, y: 0 })).toEqual({ q: 3, r: 0 });
    expect(offsetToAxial({ x: 0, y: 1 })).toEqual({ q: 0, r: 1 });
    expect(offsetToAxial({ x: 0, y: 2 })).toEqual({ q: -1, r: 2 });
    expect(offsetToAxial({ x: 2, y: 3 })).toEqual({ q: 1, r: 3 });
    expect(offsetToAxial({ x: 5, y: 4 })).toEqual({ q: 3, r: 4 });
    expect(offsetToCube({ x: 2, y: 3 })).toEqual({ q: 1, r: 3, s: -4 });
    expect(axialToCube({ q: 0, r: 0 })).toEqual({ q: 0, r: 0, s: 0 });
  });

  it('round-trips offset -> axial -> offset and offset -> cube -> offset, also off the map', () => {
    for (let y = -4; y <= 12; y++) {
      for (let x = -4; x <= 14; x++) {
        const c = { x, y };
        expect(axialToOffset(offsetToAxial(c))).toEqual(c);
        expect(cubeToOffset(offsetToCube(c))).toEqual(c);
        const cube = offsetToCube(c);
        expect(cube.q + cube.r + cube.s).toBe(0);
      }
    }
  });
});

describe('neighbors', () => {
  it('lists the directions clockwise from east', () => {
    expect(DIRECTION_COUNT).toBe(6);
    expect(DIRECTION_NAMES).toEqual(['E', 'SE', 'SW', 'W', 'NW', 'NE']);
  });

  it('gives the right six neighbors on an EVEN row', () => {
    // (4, 2): even rows are not shifted, so the rows above and below sit half a tile to the right of it.
    const c = { x: 4, y: 2 };
    expect(neighborCoord(c, 0)).toEqual({ x: 5, y: 2 }); // E
    expect(neighborCoord(c, 1)).toEqual({ x: 4, y: 3 }); // SE
    expect(neighborCoord(c, 2)).toEqual({ x: 3, y: 3 }); // SW
    expect(neighborCoord(c, 3)).toEqual({ x: 3, y: 2 }); // W
    expect(neighborCoord(c, 4)).toEqual({ x: 3, y: 1 }); // NW
    expect(neighborCoord(c, 5)).toEqual({ x: 4, y: 1 }); // NE
    expect(neighbors(at(4, 2), GRID)).toEqual([at(5, 2), at(4, 3), at(3, 3), at(3, 2), at(3, 1), at(4, 1)]);
  });

  it('gives the right six neighbors on an ODD row', () => {
    const c = { x: 4, y: 3 };
    expect(neighborCoord(c, 0)).toEqual({ x: 5, y: 3 }); // E
    expect(neighborCoord(c, 1)).toEqual({ x: 5, y: 4 }); // SE
    expect(neighborCoord(c, 2)).toEqual({ x: 4, y: 4 }); // SW
    expect(neighborCoord(c, 3)).toEqual({ x: 3, y: 3 }); // W
    expect(neighborCoord(c, 4)).toEqual({ x: 4, y: 2 }); // NW
    expect(neighborCoord(c, 5)).toEqual({ x: 5, y: 2 }); // NE
    expect(neighbors(at(4, 3), GRID)).toEqual([at(5, 3), at(5, 4), at(4, 4), at(3, 3), at(4, 2), at(5, 2)]);
  });

  it('agrees with the art layout: column pitch 26, row pitch 22, odd rows shifted right by 13', () => {
    // Centre of a tile in art pixels, as the renderer places it.
    const center = (c: { x: number; y: number }) => ({ px: c.x * 26 + (c.y & 1) * 13, py: c.y * 22 });
    const expected = [
      { dx: 26, dy: 0 },    // E
      { dx: 13, dy: 22 },   // SE
      { dx: -13, dy: 22 },  // SW
      { dx: -26, dy: 0 },   // W
      { dx: -13, dy: -22 }, // NW
      { dx: 13, dy: -22 },  // NE
    ];
    for (const c of [{ x: 4, y: 2 }, { x: 4, y: 3 }, { x: 0, y: 0 }, { x: 7, y: 9 }]) {
      for (let direction = 0; direction < 6; direction++) {
        const n = neighborCoord(c, direction);
        expect({ dx: center(n).px - center(c).px, dy: center(n).py - center(c).py }).toEqual(expected[direction]);
      }
    }
  });

  it('drops neighbors that are off the map', () => {
    expect(neighbors(at(0, 0), GRID)).toEqual([at(1, 0), at(0, 1)]);
    expect(neighbors(at(11, 0), GRID)).toEqual([at(11, 1), at(10, 1), at(10, 0)]);
    expect(neighbors(at(0, 9), GRID)).toEqual([at(1, 9), at(0, 8), at(1, 8)]);
    expect(neighbors(at(11, 9), GRID)).toEqual([at(10, 9), at(11, 8)]);
    expect(neighborInDirection(at(0, 0), 3, GRID)).toBeNull();
    expect(neighborInDirection(at(0, 0), 0, GRID)).toBe(at(1, 0));
  });

  it('is symmetric: if b is a neighbor of a, then a is a neighbor of b, in the opposite direction', () => {
    for (let a = 0; a < tileCount(GRID); a++) {
      for (let direction = 0; direction < 6; direction++) {
        const b = neighborInDirection(a, direction, GRID);
        if (b === null) continue;
        expect(neighborInDirection(b, (direction + 3) % 6, GRID)).toBe(a);
        expect(directionBetween(a, b, GRID)).toBe(direction);
        expect(areAdjacent(a, b, GRID)).toBe(true);
      }
    }
  });

  it('has no direction between tiles that do not touch', () => {
    expect(directionBetween(at(4, 2), at(4, 2), GRID)).toBeNull();
    expect(directionBetween(at(4, 2), at(6, 2), GRID)).toBeNull();
    expect(areAdjacent(at(4, 2), at(4, 2), GRID)).toBe(false);
    expect(areAdjacent(at(4, 2), at(4, 4), GRID)).toBe(false);
  });
});

describe('distance', () => {
  it('matches hand-worked examples', () => {
    expect(distance(at(3, 3), at(3, 3), GRID)).toBe(0);
    expect(distance(at(0, 0), at(5, 0), GRID)).toBe(5);
    expect(distance(at(0, 0), at(0, 2), GRID)).toBe(2);
    expect(distance(at(0, 0), at(0, 4), GRID)).toBe(4);
    expect(distance(at(0, 0), at(2, 4), GRID)).toBe(4);
    expect(distance(at(0, 0), at(3, 4), GRID)).toBe(5);
    expect(distance(at(0, 0), at(11, 9), GRID)).toBe(16);
    expect(coordDistance({ x: -2, y: -1 }, { x: 1, y: 1 })).toBe(4);
  });

  it('is symmetric', () => {
    for (let a = 0; a < tileCount(GRID); a += 7) {
      for (let b = 0; b < tileCount(GRID); b += 5) {
        expect(distance(a, b, GRID)).toBe(distance(b, a, GRID));
      }
    }
  });

  it('equals the number of neighbor-to-neighbor steps, for every pair of tiles', () => {
    for (let a = 0; a < tileCount(GRID); a++) {
      const walked = distancesByWalking(a, GRID);
      for (let b = 0; b < tileCount(GRID); b++) {
        expect(distance(a, b, GRID)).toBe(walked[b]);
      }
    }
  });
});

describe('tilesInRange and ring', () => {
  const center = at(5, 4);

  it('returns the full hexagon away from the edges', () => {
    expect(tilesInRange(center, 0, GRID)).toEqual([center]);
    expect(tilesInRange(center, 1, GRID)).toHaveLength(7);
    expect(tilesInRange(center, 2, GRID)).toHaveLength(19);
    expect(tilesInRange(center, 3, GRID)).toHaveLength(37);
    expect(ring(center, 0, GRID)).toEqual([center]);
    expect(ring(center, 1, GRID)).toHaveLength(6);
    expect(ring(center, 2, GRID)).toHaveLength(12);
    expect(ring(center, 3, GRID)).toHaveLength(18);
  });

  it('contains exactly the tiles within the radius, sorted by tile index', () => {
    for (const c of [center, at(0, 0), at(11, 9), at(0, 5), at(6, 0)]) {
      for (let radius = 0; radius <= 4; radius++) {
        const expected: number[] = [];
        const expectedRing: number[] = [];
        for (let tile = 0; tile < tileCount(GRID); tile++) {
          const d = distance(c, tile, GRID);
          if (d <= radius) expected.push(tile);
          if (d === radius) expectedRing.push(tile);
        }
        expect(tilesInRange(c, radius, GRID)).toEqual(expected);
        expect(ring(c, radius, GRID)).toEqual(expectedRing);
      }
    }
  });

  it('a ring of radius 1 is the set of neighbors', () => {
    for (let tile = 0; tile < tileCount(GRID); tile++) {
      expect(ring(tile, 1, GRID)).toEqual(neighbors(tile, GRID).slice().sort((a, b) => a - b));
    }
  });

  it('is clipped at the map edge', () => {
    expect(tilesInRange(at(0, 0), 1, GRID)).toEqual([at(0, 0), at(1, 0), at(0, 1)]);
    expect(tilesInRange(at(0, 0), 2, GRID)).toHaveLength(7);
  });
});
