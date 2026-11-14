/**
 * Step 4 of map generation: hills and forest.
 *
 * Both are placed the same way: every tile that may carry the feature gets
 * a score from a smooth noise, and the best-scoring tiles get the feature.
 * Because the noise changes gently from tile to tile, the winners lie
 * together in clusters, not scattered one by one.
 *
 *  - HILLS also score higher next to mountains (foothills) and on the
 *    passes the mountain ranges left open.
 *  - FOREST also scores higher where the ground is wet.
 */

import { FEATURES } from '../data/terrain';
import type { FeatureId, TerrainId } from '../data/terrain';
import type { RngState } from '../rng';
import type { TileIndex } from '../types';
import type { Grid } from './grid';
import { countTrue, filled, stepsFrom, topTiles } from './grid';
import type { Mountains } from './mountains';
import { layeredNoise, randomBetween } from './noise';
import { MAPGEN } from './tuning';

/** Chooses the hill tiles. Returns, for every tile, whether it is hills. */
export function growHills(
  grid: Grid,
  isLand: readonly boolean[],
  terrain: readonly TerrainId[],
  mountains: Mountains,
  rng: RngState,
): boolean[] {
  const score = layeredNoise(rng, grid, MAPGEN.hillsNoiseCells);
  const stepsToMountain = stepsFrom(grid, mountains.isMountain);
  for (let tile = 0; tile < grid.count; tile++) {
    const steps = stepsToMountain[tile];
    if (steps < MAPGEN.foothillBonus.length) score[tile] += MAPGEN.foothillBonus[steps];
  }
  for (const tile of mountains.passes) score[tile] += MAPGEN.passBonus;

  const free = tilesThatMayCarry('hills', grid, isLand, terrain, mountains.isMountain);
  const wanted = Math.round(countTrue(isLand) * randomBetween(rng, MAPGEN.hillsShare));
  return flagged(grid, topTiles(free, score, wanted));
}

/**
 * Chooses the forest tiles. Returns, for every tile, whether it is forest.
 *
 * @param isTaken   tiles that already carry a feature (mountains, hills)
 * @param moisture  how wet every tile is, 0..1 (from the ground step)
 */
export function growForest(
  grid: Grid,
  isLand: readonly boolean[],
  terrain: readonly TerrainId[],
  isTaken: readonly boolean[],
  moisture: readonly number[],
  rng: RngState,
): boolean[] {
  const score = layeredNoise(rng, grid, MAPGEN.forestNoiseCells);
  for (let tile = 0; tile < grid.count; tile++) {
    score[tile] = score[tile] * (1 - MAPGEN.forestMoistureWeight) + moisture[tile] * MAPGEN.forestMoistureWeight;
  }
  const free = tilesThatMayCarry('forest', grid, isLand, terrain, isTaken);
  const wanted = Math.round(countTrue(isLand) * randomBetween(rng, MAPGEN.forestShare));
  return flagged(grid, topTiles(free, score, wanted));
}

/** Land tiles without a feature whose ground the terrain table allows the feature on. */
function tilesThatMayCarry(
  feature: FeatureId,
  grid: Grid,
  isLand: readonly boolean[],
  terrain: readonly TerrainId[],
  isTaken: readonly boolean[],
): TileIndex[] {
  const tiles: TileIndex[] = [];
  for (let tile = 0; tile < grid.count; tile++) {
    if (isLand[tile] && !isTaken[tile] && FEATURES[feature].allowedOn.includes(terrain[tile])) tiles.push(tile);
  }
  return tiles;
}

/** Turns a list of tiles into a true/false entry for every tile of the map. */
function flagged(grid: Grid, tiles: readonly TileIndex[]): boolean[] {
  const flags = filled(grid, false);
  for (const tile of tiles) flags[tile] = true;
  return flags;
}
