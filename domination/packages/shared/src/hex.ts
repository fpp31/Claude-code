/**
 * Hex-grid maths for the map.
 *
 * The map is made of POINTY-TOP hexes stored in an "odd-r" OFFSET grid:
 * tiles sit in rows; `x` is the column and `y` is the row; every ODD row is
 * shifted half a tile to the right. A small 4 x 3 map looks like this:
 *
 *      row 0:   (0,0) (1,0) (2,0) (3,0)
 *      row 1:      (0,1) (1,1) (2,1) (3,1)
 *      row 2:   (0,2) (1,2) (2,2) (3,2)
 *
 * Game state stores a position as one number, the TILE INDEX
 * `y * width + x`. Most functions here take tile indexes plus the grid size,
 * because that is what the rest of the code has at hand.
 *
 * Offset coordinates are awkward for distances, so internally the maths
 * converts to AXIAL coordinates (q, r) or CUBE coordinates (q, r, s with
 * q + r + s = 0), where one step in any of the six directions changes two of
 * the three numbers by one.
 *
 * The map does not wrap around: tiles on the edge simply have fewer neighbors.
 */

import type { TileIndex } from './types';

/** Offset coordinates: x = column, y = row (odd rows are shifted right). */
export interface Coord {
  x: number;
  y: number;
}

/** Axial coordinates. r is the row; q runs along the row but slants with it. */
export interface Axial {
  q: number;
  r: number;
}

/** Cube coordinates: axial plus s = -q - r, so that q + r + s is always 0. */
export interface Cube {
  q: number;
  r: number;
  s: number;
}

/** Anything with a width and a height in tiles (a GameMap and a PlayerView both fit). */
export interface GridSize {
  width: number;
  height: number;
}

/**
 * The six directions, clockwise starting from east (y grows downwards on
 * screen). A direction is its index in this list: 0 = E, 1 = SE, 2 = SW,
 * 3 = W, 4 = NW, 5 = NE. The opposite of direction d is (d + 3) % 6.
 */
export const DIRECTION_NAMES = ['E', 'SE', 'SW', 'W', 'NW', 'NE'] as const;
export const DIRECTION_COUNT = 6;

/** One step in each direction, in axial coordinates. Same order as DIRECTION_NAMES. */
const AXIAL_STEPS: readonly Axial[] = [
  { q: 1, r: 0 },   // E
  { q: 0, r: 1 },   // SE
  { q: -1, r: 1 },  // SW
  { q: -1, r: 0 },  // W
  { q: 0, r: -1 },  // NW
  { q: 1, r: -1 },  // NE
];

// ---------------------------------------------------------------------------
// Conversions between coordinate systems
// ---------------------------------------------------------------------------

export function offsetToAxial(c: Coord): Axial {
  // (y & 1) is 1 on odd rows and 0 on even rows (also for negative y).
  return { q: c.x - (c.y - (c.y & 1)) / 2, r: c.y };
}

export function axialToOffset(a: Axial): Coord {
  return { x: a.q + (a.r - (a.r & 1)) / 2, y: a.r };
}

export function axialToCube(a: Axial): Cube {
  return { q: a.q, r: a.r, s: 0 - a.q - a.r };
}

export function cubeToAxial(c: Cube): Axial {
  return { q: c.q, r: c.r };
}

export function offsetToCube(c: Coord): Cube {
  return axialToCube(offsetToAxial(c));
}

export function cubeToOffset(c: Cube): Coord {
  return axialToOffset(cubeToAxial(c));
}

// ---------------------------------------------------------------------------
// Tile indexes
// ---------------------------------------------------------------------------

/** Number of tiles in the grid. */
export function tileCount(size: GridSize): number {
  return size.width * size.height;
}

/** Is this coordinate on the map? */
export function inBounds(c: Coord, size: GridSize): boolean {
  return c.x >= 0 && c.x < size.width && c.y >= 0 && c.y < size.height;
}

/** Is this number the index of a tile on the map? (Use it to check untrusted input.) */
export function isValidTile(tile: number, size: GridSize): boolean {
  return Number.isInteger(tile) && tile >= 0 && tile < tileCount(size);
}

/** Coordinate -> tile index. The coordinate must be on the map (check with inBounds first). */
export function tileIndex(c: Coord, size: GridSize): TileIndex {
  return c.y * size.width + c.x;
}

/** Tile index -> coordinate. */
export function tileCoord(tile: TileIndex, size: GridSize): Coord {
  return { x: tile % size.width, y: Math.floor(tile / size.width) };
}

// ---------------------------------------------------------------------------
// Neighbors
// ---------------------------------------------------------------------------

/** The coordinate one step away in the given direction (0..5). It may be off the map. */
export function neighborCoord(c: Coord, direction: number): Coord {
  const a = offsetToAxial(c);
  const step = AXIAL_STEPS[direction];
  return axialToOffset({ q: a.q + step.q, r: a.r + step.r });
}

/** The tile one step away in the given direction (0..5), or null if that is off the map. */
export function neighborInDirection(tile: TileIndex, direction: number, size: GridSize): TileIndex | null {
  const c = neighborCoord(tileCoord(tile, size), direction);
  return inBounds(c, size) ? tileIndex(c, size) : null;
}

/**
 * All tiles next to `tile` that are on the map, in direction order
 * (E, SE, SW, W, NW, NE). Two to six tiles.
 */
export function neighbors(tile: TileIndex, size: GridSize): TileIndex[] {
  const result: TileIndex[] = [];
  for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
    const neighbor = neighborInDirection(tile, direction, size);
    if (neighbor !== null) result.push(neighbor);
  }
  return result;
}

/** The direction (0..5) that leads from `from` to the adjacent tile `to`, or null if they are not adjacent. */
export function directionBetween(from: TileIndex, to: TileIndex, size: GridSize): number | null {
  for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
    if (neighborInDirection(from, direction, size) === to) return direction;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------

/** Number of steps between two cube coordinates. */
export function cubeDistance(a: Cube, b: Cube): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
}

/** Number of steps between two offset coordinates (they need not be on the map). */
export function coordDistance(a: Coord, b: Coord): number {
  return cubeDistance(offsetToCube(a), offsetToCube(b));
}

/** Number of steps between two tiles, ignoring terrain. 0 for the same tile, 1 for neighbors. */
export function distance(a: TileIndex, b: TileIndex, size: GridSize): number {
  return coordDistance(tileCoord(a, size), tileCoord(b, size));
}

/** True if the two tiles touch (distance exactly 1). */
export function areAdjacent(a: TileIndex, b: TileIndex, size: GridSize): boolean {
  return distance(a, b, size) === 1;
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

/**
 * Every tile on the map within `radius` steps of `center`, the center
 * included. Sorted by tile index (top row first, left to right), so the
 * order is the same on every machine. Away from the map edge the result has
 * 1 + 3 * radius * (radius + 1) tiles (7 for radius 1, 19 for radius 2).
 */
export function tilesInRange(center: TileIndex, radius: number, size: GridSize): TileIndex[] {
  const origin = offsetToAxial(tileCoord(center, size));
  const result: TileIndex[] = [];
  for (let dr = -radius; dr <= radius; dr++) {
    const qFrom = Math.max(-radius, -dr - radius);
    const qTo = Math.min(radius, -dr + radius);
    for (let dq = qFrom; dq <= qTo; dq++) {
      const c = axialToOffset({ q: origin.q + dq, r: origin.r + dr });
      if (inBounds(c, size)) result.push(tileIndex(c, size));
    }
  }
  return result;
}

/**
 * Every tile on the map exactly `radius` steps from `center`, sorted by tile
 * index. Radius 0 gives just the center. Away from the map edge a ring of
 * radius r >= 1 has 6 * r tiles.
 */
export function ring(center: TileIndex, radius: number, size: GridSize): TileIndex[] {
  return tilesInRange(center, radius, size).filter((tile) => distance(center, tile, size) === radius);
}
