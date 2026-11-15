/**
 * Builds the terrain of one map (no start positions yet) by running the
 * five steps in order:
 *
 *   1. land.ts            land or sea
 *   2. ground.ts          coast and ocean; desert, plains, grassland
 *   3. mountains.ts       mountain ranges
 *   4. hillsAndForest.ts  hills, then forest
 *   5. passes.ts          a pass into every valley the mountains sealed off
 *
 * Each step draws from its own random stream. That keeps the steps apart:
 * tuning the forests, say, moves no coastline and no mountain.
 */

import type { FeatureId } from '../data/terrain';
import type { RngState } from '../rng';
import type { GameMap, Tile } from '../types';
import type { Grid } from './grid';
import { paintGround } from './ground';
import { growForest, growHills } from './hillsAndForest';
import { shapeLand } from './land';
import { raiseMountains } from './mountains';
import { openPasses } from './passes';

/**
 * Hands out the random streams of one attempt: `streams('')` is the main
 * stream, `streams('forest')` the one for forests, and so on.
 */
export type MapStreams = (part: string) => RngState;

/** Builds the map for one attempt. Every tile has `cityId: null` and `improvement: null`. */
export function buildMap(grid: Grid, streams: MapStreams): GameMap {
  const isLand = shapeLand(grid, streams(''));
  const ground = paintGround(grid, isLand, streams('moisture'), streams('desert'));
  const mountains = raiseMountains(grid, isLand, ground.terrain, streams('mountains'));
  const isHills = growHills(grid, isLand, ground.terrain, mountains, streams('hills'));
  const hasFeature = mountains.isMountain.map((isMountain, tile) => isMountain || isHills[tile]);
  const isForest = growForest(grid, isLand, ground.terrain, hasFeature, ground.moisture, streams('forest'));

  const tiles: Tile[] = [];
  for (let tile = 0; tile < grid.count; tile++) {
    let feature: FeatureId | null = null;
    if (mountains.isMountain[tile]) feature = 'mountains';
    else if (isHills[tile]) feature = 'hills';
    else if (isForest[tile]) feature = 'forest';
    tiles.push({ terrain: ground.terrain[tile], feature, improvement: null, cityId: null });
  }
  openPasses(grid, tiles);
  return { width: grid.width, height: grid.height, tiles };
}
