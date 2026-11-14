/**
 * Step 3 of map generation: mountain ranges.
 *
 * Mountains block land units, so where they stand shapes the whole game.
 * They are laid out as RANGES: a range starts at a random inland tile,
 * picks a direction and walks a few tiles, wobbling and sometimes bending,
 * raising a mountain on every tile it visits. Here and there it leaves a
 * tile open (a pass) or grows two tiles thick.
 *
 * Mountains stay off the shore, so there is always a way around a range
 * along the coast, and new ranges start away from old ones, so they do not
 * clump into one big block.
 */

import { FEATURES } from '../data/terrain';
import type { TerrainId } from '../data/terrain';
import { DIRECTION_COUNT, neighborInDirection } from '../hex';
import { nextInt, pick } from '../rng';
import type { RngState } from '../rng';
import type { TileIndex } from '../types';
import type { Grid } from './grid';
import { countTrue, filled, gridDistance, stepsFrom } from './grid';
import { chance, randomBetween } from './noise';
import { MAPGEN } from './tuning';

/** The result of `raiseMountains`. */
export interface Mountains {
  /** For every tile: does a mountain stand on it? */
  isMountain: boolean[];
  /** The mountain tiles as a list, in the order they were raised. */
  peaks: TileIndex[];
  /** Tiles a range walked over but left open. The hills step turns them into hill passes. */
  passes: TileIndex[];
}

/** Places the mountain ranges. */
export function raiseMountains(
  grid: Grid,
  isLand: readonly boolean[],
  terrain: readonly TerrainId[],
  rng: RngState,
): Mountains {
  const stepsToWater = stepsFrom(grid, isLand.map((land) => !land));
  const canHold = filled(grid, false);
  const startTiles: TileIndex[] = [];
  for (let tile = 0; tile < grid.count; tile++) {
    canHold[tile] =
      isLand[tile] &&
      stepsToWater[tile] >= MAPGEN.mountainCoastDistance &&
      FEATURES.mountains.allowedOn.includes(terrain[tile]);
    if (canHold[tile]) startTiles.push(tile);
  }

  const mountains: Mountains = { isMountain: filled(grid, false), peaks: [], passes: [] };
  const wanted = Math.round(countTrue(isLand) * randomBetween(rng, MAPGEN.mountainShare));
  for (let tries = 0; tries < MAPGEN.rangeStartTries && mountains.peaks.length < wanted && startTiles.length > 0; tries++) {
    const start = pick(rng, startTiles);
    const tooClose = mountains.peaks.some((peak) => gridDistance(grid, start, peak) < MAPGEN.rangeSpacing);
    if (tooClose) continue;
    const length = Math.min(
      MAPGEN.rangeLength.min + nextInt(rng, MAPGEN.rangeLength.max - MAPGEN.rangeLength.min + 1),
      wanted - mountains.peaks.length,
    );
    walkRange(grid, rng, canHold, mountains, start, length);
  }
  return mountains;
}

/**
 * Walks one range of up to `length` tiles from `start`, raising mountains
 * as it goes. The range ends early where it would leave the tiles that can
 * hold a mountain (at the shore, for example).
 */
function walkRange(
  grid: Grid,
  rng: RngState,
  canHold: readonly boolean[],
  mountains: Mountains,
  start: TileIndex,
  length: number,
): void {
  const raise = (tile: TileIndex): void => {
    if (!mountains.isMountain[tile]) {
      mountains.isMountain[tile] = true;
      mountains.peaks.push(tile);
    }
  };

  let heading = nextInt(rng, DIRECTION_COUNT);
  let tile: TileIndex | null = start;
  for (let step = 0; step < length && tile !== null && canHold[tile]; step++) {
    // Both ends of a range are mountains; a pass only makes sense in between.
    const isEnd = step === 0 || step === length - 1;
    if (!isEnd && chance(rng, MAPGEN.rangePassChance)) {
      mountains.passes.push(tile);
    } else {
      raise(tile);
      if (chance(rng, MAPGEN.rangeThickenChance)) {
        // The tile diagonally behind, on a random side, makes the range two thick here.
        const beside = neighborInDirection(tile, turned(heading, chance(rng, 0.5) ? 2 : -2), grid);
        if (beside !== null && canHold[beside]) raise(beside);
      }
    }
    if (chance(rng, MAPGEN.rangeBendChance)) heading = turned(heading, chance(rng, 0.5) ? 1 : -1);
    // A wobble sidesteps without changing where the range is heading.
    const stepDirection = chance(rng, MAPGEN.rangeWobbleChance) ? turned(heading, chance(rng, 0.5) ? 1 : -1) : heading;
    tile = neighborInDirection(tile, stepDirection, grid);
  }
}

/** The direction `turns` sixths of a full turn clockwise from `direction` (negative = anticlockwise). */
function turned(direction: number, turns: number): number {
  return (direction + turns + DIRECTION_COUNT) % DIRECTION_COUNT;
}
