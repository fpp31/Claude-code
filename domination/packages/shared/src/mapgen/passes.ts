/**
 * Step 5 of map generation: no valley is sealed off.
 *
 * Mountains cannot be entered. A ring of them (or a range across a narrow
 * neck of land) can therefore cut a piece of a landmass off from the rest,
 * and anybody starting inside would be locked in. This step looks for such
 * cut-off pieces and opens a pass to each: the mountains on the shortest
 * way in are turned into hills.
 *
 * Afterwards a land unit can walk between any two walkable tiles of the
 * same landmass, which is what makes "all starts on one landmass" mean
 * "the players can reach each other".
 */

import { FEATURES, tileIsWater, tileMoveCost } from '../data/terrain';
import type { Tile, TileIndex } from '../types';
import type { Grid, Regions } from './grid';
import { filled, labelRegions } from './grid';

/** Opens passes (in place) until every landmass has a single walkable area. */
export function openPasses(grid: Grid, tiles: Tile[]): void {
  const landmasses = labelRegions(grid, tiles.map((tile) => !tileIsWater(tile)));
  // Each round joins one cut-off piece to the main area of its landmass, so
  // there are at most as many rounds as there are cut-off pieces. (The limit
  // on the rounds only makes sure a mistake could never loop for ever.)
  for (let round = 0; round < grid.count; round++) {
    const areas = labelRegions(grid, tiles.map((tile) => tileMoveCost(tile) !== null));
    const mainArea = findMainAreaWithCutOffPiece(grid, landmasses, areas);
    if (mainArea === null) return;
    openPassFrom(grid, tiles, areas, mainArea);
  }
}

/**
 * Looks for a landmass whose walkable tiles fall into more than one area,
 * and returns the largest area of that landmass. null if there is none.
 */
function findMainAreaWithCutOffPiece(grid: Grid, landmasses: Regions, areas: Regions): number | null {
  // The largest walkable area of every landmass (the lower number wins a tie).
  const mainAreaOf = new Array<number>(landmasses.sizes.length).fill(-1);
  for (let tile = 0; tile < grid.count; tile++) {
    const area = areas.regionOf[tile];
    if (area === -1) continue;
    const landmass = landmasses.regionOf[tile];
    const main = mainAreaOf[landmass];
    if (main === -1 || areas.sizes[area] > areas.sizes[main]) mainAreaOf[landmass] = area;
  }
  for (let tile = 0; tile < grid.count; tile++) {
    const area = areas.regionOf[tile];
    if (area !== -1 && area !== mainAreaOf[landmasses.regionOf[tile]]) return mainAreaOf[landmasses.regionOf[tile]];
  }
  return null;
}

/**
 * Spreads out from the main area over the blocked land around it, ring by
 * ring, until it touches a walkable tile outside the main area. Then it
 * turns the blocked tiles on the way back into hills.
 */
function openPassFrom(grid: Grid, tiles: Tile[], areas: Regions, mainArea: number): void {
  // cameFrom[tile]: the tile from which the search reached it; -1 = not reached yet.
  const cameFrom = filled(grid, -1);
  let frontier: TileIndex[] = [];
  for (let tile = 0; tile < grid.count; tile++) {
    if (areas.regionOf[tile] === mainArea) {
      cameFrom[tile] = tile;
      frontier.push(tile);
    }
  }
  while (frontier.length > 0) {
    const next: TileIndex[] = [];
    for (const tile of frontier) {
      for (const neighbor of grid.neighbors[tile]) {
        if (cameFrom[neighbor] !== -1 || tileIsWater(tiles[neighbor])) continue;
        cameFrom[neighbor] = tile;
        if (areas.regionOf[neighbor] === -1) {
          // Blocked land: keep searching through it.
          next.push(neighbor);
          continue;
        }
        // A walkable tile the search had not reached: the cut-off piece.
        // Walk back to the main area and open every blocked tile on the way.
        let back = tile;
        while (areas.regionOf[back] !== mainArea) {
          makeWalkable(tiles[back]);
          back = cameFrom[back];
        }
        return;
      }
    }
    frontier = next;
  }
}

/** Replaces whatever blocks the tile by hills, or by open ground where hills are not allowed or would block too. */
function makeWalkable(tile: Tile): void {
  tile.feature = FEATURES.hills.allowedOn.includes(tile.terrain) && FEATURES.hills.moveCost !== null ? 'hills' : null;
}
