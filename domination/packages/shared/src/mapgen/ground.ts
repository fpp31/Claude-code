/**
 * Step 2 of map generation: the ground of every tile.
 *
 * Water becomes coast (next to land) or ocean. Land becomes desert, plains
 * or grassland:
 *
 *  - DESERT lies in one band that crosses the map at a slant, wanders a
 *    little and frays into patches at its edges, like a dry belt.
 *  - Of the rest, the wetter part is GRASSLAND and the drier part PLAINS,
 *    following a smooth "moisture" noise, so both come in broad areas.
 *    Tiles next to the desert count as drier, so plains surround it.
 */

import type { TerrainId } from '../data/terrain';
import { pick } from '../rng';
import type { RngState } from '../rng';
import type { TileIndex } from '../types';
import type { Grid } from './grid';
import { ROW_HEIGHT, filled, stepsFrom, topTiles } from './grid';
import { layeredNoise, noiseLayer, randomBetween } from './noise';
import { MAPGEN } from './tuning';

/** The result of `paintGround`. */
export interface PaintedGround {
  /** The ground of every tile. */
  terrain: TerrainId[];
  /** How wet every tile is, 0 (dry) to 1 (wet). The forests use it too. */
  moisture: number[];
}

/**
 * Chooses the ground of every tile.
 *
 * @param moistureRng  random stream for the moisture noise
 * @param desertRng    random stream for the desert band
 */
export function paintGround(grid: Grid, isLand: readonly boolean[], moistureRng: RngState, desertRng: RngState): PaintedGround {
  const terrain: TerrainId[] = filled<TerrainId>(grid, 'ocean');
  const moisture = layeredNoise(moistureRng, grid, MAPGEN.moistureNoiseCells);
  const land: TileIndex[] = [];
  for (let tile = 0; tile < grid.count; tile++) {
    if (isLand[tile]) land.push(tile);
    // The water rule of generateMap: coast if any neighbor is land, otherwise ocean.
    else if (grid.neighbors[tile].some((neighbor) => isLand[neighbor])) terrain[tile] = 'coast';
  }

  // Desert: the driest tiles, which are those nearest the middle of the band.
  const dryness = desertDryness(grid, land, desertRng);
  const desertTiles = Math.round(land.length * randomBetween(desertRng, MAPGEN.desertShare));
  const isDesert = filled(grid, false);
  for (const tile of topTiles(land, dryness, desertTiles)) {
    isDesert[tile] = true;
    terrain[tile] = 'desert';
  }

  // Grassland and plains: the wettest tiles of the rest are grassland.
  const stepsToDesert = stepsFrom(grid, isDesert);
  const wetness = filled(grid, 0);
  const green: TileIndex[] = [];
  for (const tile of land) {
    if (isDesert[tile]) continue;
    const steps = stepsToDesert[tile];
    const dryAir = steps < MAPGEN.drynessNearDesert.length ? MAPGEN.drynessNearDesert[steps] : 0;
    wetness[tile] = moisture[tile] - dryAir;
    green.push(tile);
  }
  const grasslandTiles = Math.round(green.length * randomBetween(moistureRng, MAPGEN.grasslandShare));
  for (const tile of green) terrain[tile] = 'plains';
  for (const tile of topTiles(green, wetness, grasslandTiles)) terrain[tile] = 'grassland';

  return { terrain, moisture };
}

/**
 * How dry every tile is: highest along the middle line of the desert band,
 * falling off to both sides. The band passes through a random land tile, so
 * it never misses the land altogether.
 */
function desertDryness(grid: Grid, land: readonly TileIndex[], rng: RngState): number[] {
  const dryness = filled(grid, 0);
  if (land.length === 0) return dryness;

  const anchor = pick(rng, land);
  // The band's middle line runs along (1, tilt). `across` is the direction
  // at right angles to it, made 1 long, so that "(point - anchor) . across"
  // is the distance of a point from the middle line.
  const tilt = randomBetween(rng, MAPGEN.desertBandTilt);
  const length = Math.sqrt(1 + tilt * tilt);
  const across = { x: -tilt / length, y: 1 / length };
  const halfWidth = MAPGEN.desertBandHalfWidth * grid.height * ROW_HEIGHT;

  const wander = noiseLayer(rng, grid, MAPGEN.desertWanderCell);
  const patches = noiseLayer(rng, grid, MAPGEN.desertPatchCell);
  for (const tile of land) {
    const fromLine = (grid.px[tile] - grid.px[anchor]) * across.x + (grid.py[tile] - grid.py[anchor]) * across.y;
    // The wander noise pushes the line up and down; the patch noise makes
    // single areas drier or wetter, which frays the edges of the band.
    const wandering = fromLine / halfWidth + MAPGEN.desertWanderWeight * (wander[tile] * 2 - 1);
    dryness[tile] = 1 - Math.abs(wandering) + MAPGEN.desertPatchWeight * (patches[tile] * 2 - 1);
  }
  return dryness;
}
