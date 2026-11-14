/**
 * Smooth random numbers for the map generator ("value noise").
 *
 * Rolling a separate die for every tile gives salt and pepper. Land, forests
 * and deserts need numbers that change gently from tile to tile, so that
 * high values come in patches. The recipe:
 *
 *  1. lay a coarse square lattice over the map and roll one die per lattice point;
 *  2. a tile between four lattice points gets a smooth blend of their four values.
 *
 * The spacing of the lattice (`cell`, in tile widths) sets the size of the
 * patches. Several layers with different spacings, added up, give large
 * shapes with ragged edges.
 *
 * Only + - * / and Math.floor/ceil are used, so every machine computes
 * exactly the same numbers (see the Determinism notes in generateMap.ts).
 */

import { nextFloat } from '../rng';
import type { RngState } from '../rng';
import type { Grid } from './grid';
import { filled } from './grid';

/** A range to pick a random number from. */
export interface Range {
  min: number;
  max: number;
}

/** A random number from the range: at least `min`, less than `max`. */
export function randomBetween(rng: RngState, range: Range): number {
  return range.min + nextFloat(rng) * (range.max - range.min);
}

/** True with the given probability (0 = never, 1 = always). */
export function chance(rng: RngState, probability: number): boolean {
  return nextFloat(rng) < probability;
}

/** Eases a blend factor (0..1) in and out, which hides the lattice lines. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * One layer of smooth noise: a value from 0 to 1 for every tile, in patches
 * roughly `cell` tiles across.
 */
export function noiseLayer(rng: RngState, grid: Grid, cell: number): number[] {
  // Enough lattice points to cover the map, plus room for the random shift below.
  const columns = Math.ceil(grid.width / cell) + 3;
  const rows = Math.ceil(grid.height / cell) + 3;
  const lattice: number[] = [];
  for (let i = 0; i < columns * rows; i++) lattice.push(nextFloat(rng));
  // Shift the lattice by a random part of a cell, so its lines do not fall on
  // the same tiles in every layer and on every map.
  const shiftX = nextFloat(rng);
  const shiftY = nextFloat(rng);

  const values = filled(grid, 0);
  for (let tile = 0; tile < grid.count; tile++) {
    const x = grid.px[tile] / cell + shiftX;
    const y = grid.py[tile] / cell + shiftY;
    const column = Math.floor(x);
    const row = Math.floor(y);
    const blendX = ease(x - column);
    const blendY = ease(y - row);
    const corner = row * columns + column;
    const top = lattice[corner] + (lattice[corner + 1] - lattice[corner]) * blendX;
    const bottom = lattice[corner + columns] + (lattice[corner + columns + 1] - lattice[corner + columns]) * blendX;
    values[tile] = top + (bottom - top) * blendY;
  }
  return values;
}

/**
 * Several layers added up: a value from 0 to 1 for every tile. `cells`
 * lists the patch size of each layer, largest first; every further layer
 * counts half as much as the one before, so the first sets the big shapes
 * and the rest roughen the edges.
 */
export function layeredNoise(rng: RngState, grid: Grid, cells: readonly number[]): number[] {
  const total = filled(grid, 0);
  let weight = 1;
  let weightSum = 0;
  for (const cell of cells) {
    const layer = noiseLayer(rng, grid, cell);
    for (let tile = 0; tile < grid.count; tile++) total[tile] += layer[tile] * weight;
    weightSum += weight;
    weight = weight / 2;
  }
  for (let tile = 0; tile < grid.count; tile++) total[tile] = total[tile] / weightSum;
  return total;
}
