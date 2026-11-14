/**
 * Lookup tables and small tools every step of the map generator uses.
 *
 * The generator asks "who are the neighbors of this tile?" and "how far apart
 * are these two tiles?" many thousands of times per map. hex.ts answers both,
 * but builds a few small objects for every answer. So a `Grid` asks hex.ts
 * once per tile and keeps the answers in plain lists.
 */

import { neighbors, offsetToAxial, tileCoord, tileCount, tilesInRange } from '../hex';
import type { GridSize } from '../hex';
import type { TileIndex } from '../types';

/**
 * How far apart the rows of a hex map are when a tile is 1 wide: half the
 * square root of 3. Written as a plain number so it is the same on every
 * machine. Only the look of the land depends on it, no rule does.
 */
export const ROW_HEIGHT = 0.866;

/** Stands for "cannot be reached" in the lists made by `stepsFrom`. Larger than any real distance. */
export const UNREACHED = 1000000;

/** The lookup tables of one map size. Read-only: every map of that size shares them (see gridFor). */
export interface Grid extends GridSize {
  /** Number of tiles: width * height. */
  count: number;
  /** neighbors[tile]: the tiles next to `tile`, in direction order (E, SE, SW, W, NW, NE). */
  neighbors: TileIndex[][];
  /** withinTwo[tile]: every tile at most two steps from `tile`, itself included, sorted by tile index. */
  withinTwo: TileIndex[][];
  /**
   * Where the centre of each tile sits on a flat drawing of the map, measured
   * in tile widths. Noise and land shapes use these instead of column and row,
   * so that they are not squashed or sheared by the hex layout.
   */
  px: number[];
  py: number[];
  /** Axial coordinates of each tile (see hex.ts), kept for fast distances. */
  q: number[];
  r: number[];
  /** Steps from each tile to the nearest map edge: 0 for the outer ring of tiles. */
  edgeDistance: number[];
}

/** Grids that were already built, by size ('44x28'). */
const builtGrids: Record<string, Grid> = {};

/**
 * The lookup tables for a map of the given size.
 *
 * The tables depend on nothing but the size and are never changed once they
 * are built, so one copy per size is kept and handed to every caller. This
 * is a shortcut, not hidden state: it cannot change what any function
 * returns, it only saves building the same lists again for every map.
 */
export function gridFor(size: GridSize): Grid {
  const key = `${size.width}x${size.height}`;
  if (builtGrids[key] === undefined) builtGrids[key] = makeGrid(size);
  return builtGrids[key];
}

/** Builds the lookup tables for a map of the given size. */
function makeGrid(size: GridSize): Grid {
  const grid: Grid = {
    width: size.width,
    height: size.height,
    count: tileCount(size),
    neighbors: [],
    withinTwo: [],
    px: [],
    py: [],
    q: [],
    r: [],
    edgeDistance: [],
  };
  for (let tile = 0; tile < grid.count; tile++) {
    const coord = tileCoord(tile, size);
    const axial = offsetToAxial(coord);
    grid.neighbors.push(neighbors(tile, size));
    grid.withinTwo.push(tilesInRange(tile, 2, size));
    // Odd rows sit half a tile to the right.
    grid.px.push(coord.x + (coord.y % 2 === 1 ? 0.5 : 0));
    grid.py.push(coord.y * ROW_HEIGHT);
    grid.q.push(axial.q);
    grid.r.push(axial.r);
    grid.edgeDistance.push(Math.min(coord.x, coord.y, size.width - 1 - coord.x, size.height - 1 - coord.y));
  }
  return grid;
}

/** Number of steps between two tiles, ignoring terrain. The same answer as `distance` in hex.ts. */
export function gridDistance(grid: Grid, a: TileIndex, b: TileIndex): number {
  const dq = grid.q[a] - grid.q[b];
  const dr = grid.r[a] - grid.r[b];
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

/** A list with one entry per tile, all set to `value`. */
export function filled<T>(grid: Grid, value: T): T[] {
  return new Array<T>(grid.count).fill(value);
}

/** How many entries of the list are true. */
export function countTrue(flags: readonly boolean[]): number {
  let total = 0;
  for (const flag of flags) if (flag) total++;
  return total;
}

/** The result of `labelRegions`. */
export interface Regions {
  /** regionOf[tile]: the number of the region the tile belongs to, or -1 if the tile is not a member. */
  regionOf: number[];
  /** sizes[region]: how many tiles the region has. */
  sizes: number[];
}

/**
 * Groups the member tiles into regions: two members are in the same region
 * if one can be reached from the other by stepping from member to member.
 * Used with "is land" it finds the landmasses, with "can be walked on" the
 * areas a land unit can roam.
 *
 * Regions are numbered in the order their first tile appears (by tile
 * index), so the numbering is the same on every machine.
 */
export function labelRegions(grid: Grid, isMember: readonly boolean[]): Regions {
  const regionOf = filled(grid, -1);
  const sizes: number[] = [];
  for (let first = 0; first < grid.count; first++) {
    if (!isMember[first] || regionOf[first] !== -1) continue;
    const region = sizes.length;
    let size = 0;
    const todo = [first];
    regionOf[first] = region;
    while (todo.length > 0) {
      const tile = todo.pop() as TileIndex;
      size++;
      for (const next of grid.neighbors[tile]) {
        if (isMember[next] && regionOf[next] === -1) {
          regionOf[next] = region;
          todo.push(next);
        }
      }
    }
    sizes.push(size);
  }
  return { regionOf, sizes };
}

/**
 * For every tile, the number of steps to the nearest source tile (0 for a
 * source itself), walking over any tile. UNREACHED everywhere if there is no
 * source at all.
 */
export function stepsFrom(grid: Grid, isSource: readonly boolean[]): number[] {
  const steps = filled(grid, UNREACHED);
  let frontier: TileIndex[] = [];
  for (let tile = 0; tile < grid.count; tile++) {
    if (isSource[tile]) {
      steps[tile] = 0;
      frontier.push(tile);
    }
  }
  // Breadth first: all tiles at distance 1, then all at distance 2, and so on.
  while (frontier.length > 0) {
    const next: TileIndex[] = [];
    for (const tile of frontier) {
      for (const neighbor of grid.neighbors[tile]) {
        if (steps[neighbor] === UNREACHED) {
          steps[neighbor] = steps[tile] + 1;
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return steps;
}

/**
 * The `count` tiles with the highest score (all the tiles if there are
 * fewer than `count`), in no particular order. Among tiles with exactly the
 * same score, those that come first in `tiles` win, so the choice never
 * depends on how a machine happens to sort.
 *
 * Picking "the best N" instead of "everything above a fixed score" is how
 * the generator hits its targets (so much land, so much forest) on every map.
 */
export function topTiles(tiles: readonly TileIndex[], score: readonly number[], count: number): TileIndex[] {
  if (count <= 0) return [];
  if (count >= tiles.length) return [...tiles];

  // Find the lowest score that still gets in: sort the scores alone (a
  // plain list of numbers sorts much faster than a list of tiles compared
  // by score) and read off the one in position `count` from the top.
  const sorted = new Float64Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) sorted[i] = score[tiles[i]];
  sorted.sort();
  const lowestIn = sorted[tiles.length - count];

  const top: TileIndex[] = [];
  for (const tile of tiles) if (score[tile] > lowestIn) top.push(tile);
  // Tiles with exactly the lowest score share the places that are left.
  for (const tile of tiles) {
    if (top.length === count) break;
    if (score[tile] === lowestIn) top.push(tile);
  }
  return top;
}
