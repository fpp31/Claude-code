/**
 * The promises about start positions (rules H1-H5 and S1-S3 in the doc
 * comment of generateMap), written down as checks.
 *
 * placeStarts (starts.ts) is built to keep these rules. generateMap still
 * runs the checks on every result before handing it out, and starts over
 * with the next attempt if one fails: the rules engine, the client and the
 * end-to-end test all rely on them, so they are verified, not assumed.
 */

import { RULES } from '../data/rules';
import { tileAllowsCity, tileIsWorkable, tileMoveCost, tileYields } from '../data/terrain';
import { isValidTile } from '../hex';
import type { GameMap, TileIndex } from '../types';
import type { Grid, Regions } from './grid';
import { gridDistance, labelRegions } from './grid';
import { MAPGEN } from './tuning';

/** Can a land unit enter this tile? */
export function isWalkable(map: GameMap, tile: TileIndex): boolean {
  return tileMoveCost(map.tiles[tile]) !== null;
}

/**
 * The areas a land unit can roam: two tiles are in the same area if a land
 * unit can walk from one to the other.
 */
export function walkableAreas(grid: Grid, map: GameMap): Regions {
  return labelRegions(grid, map.tiles.map((tile) => tileMoveCost(tile) !== null));
}

/** How many neighbors of the tile a land unit can enter (rule H4 wants at least 2). */
export function walkableNeighbors(grid: Grid, map: GameMap, tile: TileIndex): number {
  let total = 0;
  for (const neighbor of grid.neighbors[tile]) if (isWalkable(map, neighbor)) total++;
  return total;
}

/** What one tile adds to the score of a start near it: its food + production if it can be worked, otherwise 0. */
export function tileWorth(map: GameMap, tile: TileIndex): number {
  if (!tileIsWorkable(map.tiles[tile])) return 0;
  const yields = tileYields(map.tiles[tile]);
  return yields.food + yields.production;
}

/**
 * The score of a start (rule S3): food + production of every workable tile
 * within two steps, the start tile included. It says how much a capital
 * founded there will have to live on.
 */
export function startScore(grid: Grid, map: GameMap, start: TileIndex): number {
  let score = 0;
  for (const tile of grid.withinTwo[start]) score += tileWorth(map, tile);
  return score;
}

/** The smallest distance between any two of the tiles (a huge number for fewer than two tiles). */
export function smallestDistance(grid: Grid, tiles: readonly TileIndex[]): number {
  let smallest = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) smallest = Math.min(smallest, gridDistance(grid, tiles[i], tiles[j]));
  }
  return smallest;
}

/** True if `lowest` is a fair score next to `highest` (rule S3: at least 70% of it). */
export function isFairScore(lowest: number, highest: number): boolean {
  // Whole-number arithmetic: "lowest >= 0.7 * highest" could be off by a hair in floating point.
  return lowest * 100 >= MAPGEN.fairScorePercent * highest;
}

/**
 * The hard rules H1-H5: they must hold for every result. (That there is
 * one start per player is checked by the caller, who knows the player count.)
 */
export function hardRulesHold(grid: Grid, map: GameMap, starts: readonly TileIndex[]): boolean {
  // H1: every start is a tile of the map, and no two are the same tile.
  // (The second half is part of H3: two equal tiles are 0 apart.)
  if (!starts.every((start) => isValidTile(start, grid))) return false;
  if (smallestDistance(grid, starts) < RULES.minCityDistance) return false; // H3
  const areas = walkableAreas(grid, map);
  for (const start of starts) {
    if (!tileAllowsCity(map.tiles[start]) || !isWalkable(map, start)) return false; // H2
    if (walkableNeighbors(grid, map, start) < 2) return false; // H4
    if (areas.sizes[areas.regionOf[start]] < RULES.minStartLandmass) return false; // H5
  }
  return true;
}

/**
 * The standard rules S1-S3: they must hold when the map is not crowded.
 * Call it only for starts that passed `hardRulesHold`.
 */
export function standardRulesHold(grid: Grid, map: GameMap, starts: readonly TileIndex[]): boolean {
  if (smallestDistance(grid, starts) < RULES.minStartDistance) return false; // S1
  const areas = walkableAreas(grid, map);
  const scores: number[] = [];
  for (const start of starts) {
    const area = areas.regionOf[start];
    if (area === -1 || area !== areas.regionOf[starts[0]]) return false; // S2
    scores.push(startScore(grid, map, start));
  }
  return isFairScore(Math.min(...scores), Math.max(...scores)); // S3
}
