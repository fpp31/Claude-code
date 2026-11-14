/**
 * Step 1 of map generation: where is land, where is sea?
 *
 * Every tile gets a HEIGHT, and the highest tiles become land. The height
 * has three parts:
 *
 *  - LOBES: a handful of round hills of land. The main continent is a
 *    chain of large lobes, each joined to the one it grew out of by a
 *    bridge of land, which gives it bays, necks and peninsulas. A few
 *    smaller lobes far from it become islands.
 *  - NOISE: smooth random bumps that make the coastline ragged.
 *  - a PENALTY near the map edge, so that open sea surrounds the land.
 *
 * One connected main continent is wanted on purpose: all players of an
 * uncrowded game start on the same landmass (rule S2 of generateMap), so
 * that landmass has to be big enough for all of them. This is why the line
 * from each lobe to the one it grew out of (the "spine") is always land.
 *
 * Because "the highest N tiles" become land (not "every tile above some
 * height"), each map has exactly the share of land it asked for.
 */

import { nextFloat, nextInt, pick } from '../rng';
import type { RngState } from '../rng';
import type { TileIndex } from '../types';
import type { Grid } from './grid';
import { ROW_HEIGHT, filled, labelRegions, topTiles } from './grid';
import { layeredNoise, noiseLayer, randomBetween } from './noise';
import { MAPGEN } from './tuning';

/** A round hill of land: height 1 in the centre, falling evenly to 0 at `radius` and below 0 further out. */
interface Lobe {
  x: number;
  y: number;
  radius: number;
  /**
   * How fast the height falls outside the radius, compared with inside.
   * 1 for the lobes of the main continent. Side lobes and islets use a
   * larger number: if the main continent turns out smaller than planned,
   * the missing land is then added around the continent, not by blowing
   * the islands up into continents of their own.
   */
  outerSlope: number;
}

/**
 * A ridge of land between the centres of two lobes of the main continent:
 * height 1 along the line from a to b, falling evenly to 0 at `halfWidth`
 * to either side. The tiles right on the line (the "spine") are land
 * whatever the noise says, so the sea can narrow the neck between two
 * lobes to an isthmus, but never cut the continent in two.
 */
interface Bridge {
  a: Lobe;
  b: Lobe;
  halfWidth: number;
}

/** The plan of the land before the noise is added. */
interface LandPlan {
  lobes: Lobe[];
  bridges: Bridge[];
}

/** How many random places are tried for each new lobe. */
const LOBE_POSITION_TRIES = 10;
/** How many random places are tried for a side lobe or islet before it is left out. */
const SIDE_LOBE_TRIES = 20;
/** Far from every lobe the height stops falling here, so the open sea is flat. */
const SEA_FLOOR = -1;
/** The height of a spine tile: far above anything the lobes and the noise can add up to. */
const ALWAYS_LAND = 100;

/** Decides for every tile whether it is land (true) or water (false). */
export function shapeLand(grid: Grid, rng: RngState): boolean[] {
  const plan = planLand(grid, rng);
  const bumps = layeredNoise(rng, grid, MAPGEN.coastNoiseCells);
  const marginNoise = noiseLayer(rng, grid, MAPGEN.edgeMarginCell);

  const height = filled(grid, 0);
  const mayBeLand: TileIndex[] = [];
  for (let tile = 0; tile < grid.count; tile++) {
    const edge = grid.edgeDistance[tile];
    // The margin is wider in some places than in others (see MAPGEN.edgeMarginVariation).
    const margin = MAPGEN.edgeMargin * (1 + MAPGEN.edgeMarginVariation * (marginNoise[tile] * 2 - 1));
    // 1 at the map edge, 0 from the margin inwards; squared, so it fades out gently.
    const nearEdge = Math.max(0, (margin - edge) / margin);
    const penalty = MAPGEN.edgePenalty * nearEdge * nearEdge;
    // The noise is 0..1; "* 2 - 1" spreads it to -1..1 so it both raises and lowers the coast.
    const bump = MAPGEN.coastNoiseWeight * (bumps[tile] * 2 - 1);
    const planned = planHeight(plan, grid.px[tile], grid.py[tile]);
    height[tile] = planned === ALWAYS_LAND ? ALWAYS_LAND : planned + bump - penalty;
    // The outer ring of the map is always water (a promise of generateMap).
    if (edge > 0) mayBeLand.push(tile);
  }

  const landTiles = Math.round(grid.count * randomBetween(rng, MAPGEN.landShare));
  const isLand = filled(grid, false);
  for (const tile of topTiles(mayBeLand, height, landTiles)) isLand[tile] = true;
  removeSpecks(grid, isLand);
  return isLand;
}

/**
 * The height the plan gives to a point: that of the lobe or bridge it is
 * deepest inside, or ALWAYS_LAND if it lies on the spine of a bridge.
 */
function planHeight(plan: LandPlan, x: number, y: number): number {
  let best = SEA_FLOOR;
  for (const lobe of plan.lobes) {
    const dx = x - lobe.x;
    const dy = y - lobe.y;
    // 1 in the centre, 0 at the radius, negative outside.
    const height = 1 - Math.sqrt(dx * dx + dy * dy) / lobe.radius;
    best = Math.max(best, height >= 0 ? height : height * lobe.outerSlope);
  }
  for (const bridge of plan.bridges) {
    const fromLine = distanceToLine(x, y, bridge.a, bridge.b);
    if (fromLine <= MAPGEN.spineHalfWidth) return ALWAYS_LAND;
    best = Math.max(best, 1 - fromLine / bridge.halfWidth);
  }
  return best;
}

/** How far the point (x, y) is from the nearest point of the straight line between a and b. */
function distanceToLine(x: number, y: number, a: Lobe, b: Lobe): number {
  const lineX = b.x - a.x;
  const lineY = b.y - a.y;
  const lengthSquared = lineX * lineX + lineY * lineY;
  // How far along the line (0 = at a, 1 = at b) the nearest point lies.
  let along = lengthSquared === 0 ? 0 : ((x - a.x) * lineX + (y - a.y) * lineY) / lengthSquared;
  along = Math.min(Math.max(along, 0), 1);
  const dx = x - (a.x + along * lineX);
  const dy = y - (a.y + along * lineY);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Chooses where the lobes go: first the chain of the main continent, then side lobes and islets. */
function planLand(grid: Grid, rng: RngState): LandPlan {
  const mapWidth = grid.width;
  const mapHeight = grid.height * ROW_HEIGHT;
  const mainCount = intBetween(rng, MAPGEN.mainLobes);

  // The radius at which the main lobes together cover about the wanted land:
  // a circle has an area of about 3.14 * radius * radius, and overlapping
  // neighbors hide roughly a third of it, leaving about 2.2 * radius * radius.
  const landArea = ((MAPGEN.landShare.min + MAPGEN.landShare.max) / 2) * mapWidth * mapHeight;
  const typicalRadius = Math.sqrt(landArea / (2.2 * mainCount));

  // The first lobe sits somewhere in the middle of the map ...
  const lobes: Lobe[] = [
    keepInside(grid, {
      x: mapWidth * (0.3 + 0.4 * nextFloat(rng)),
      y: mapHeight * (0.35 + 0.3 * nextFloat(rng)),
      radius: typicalRadius * randomBetween(rng, MAPGEN.lobeSizeFactor),
      outerSlope: 1,
    }),
  ];
  // ... and each further one grows out of a lobe that is already there,
  // joined to it by a bridge.
  const bridges: Bridge[] = [];
  while (lobes.length < mainCount) {
    const grown = growLobe(grid, rng, lobes, typicalRadius * randomBetween(rng, MAPGEN.lobeSizeFactor));
    lobes.push(grown.lobe);
    bridges.push({
      a: grown.parent,
      b: grown.lobe,
      halfWidth: MAPGEN.bridgeHalfWidth * Math.min(grown.parent.radius, grown.lobe.radius),
    });
  }

  const sideCount = intBetween(rng, MAPGEN.sideLobes);
  for (let i = 0; i < sideCount; i++) {
    addSideLobe(grid, rng, lobes, typicalRadius * randomBetween(rng, MAPGEN.sideLobeSizeFactor));
  }
  const isletCount = intBetween(rng, MAPGEN.islets);
  for (let i = 0; i < isletCount; i++) {
    addSideLobe(grid, rng, lobes, randomBetween(rng, MAPGEN.isletRadius));
  }
  return { lobes, bridges };
}

/**
 * A new lobe of the main continent, overlapping one that exists. Of a few
 * random places it takes the one with the most room around it, which makes
 * the continent spread out instead of piling up in one spot.
 */
function growLobe(grid: Grid, rng: RngState, lobes: readonly Lobe[], radius: number): { lobe: Lobe; parent: Lobe } {
  let best: { lobe: Lobe; parent: Lobe } | null = null;
  let bestRoom = -1;
  for (let i = 0; i < LOBE_POSITION_TRIES; i++) {
    const parent = pick(rng, lobes);
    const direction = randomDirection(rng);
    const reach = (randomBetween(rng, MAPGEN.lobeSpacing) * (parent.radius + radius)) / 2;
    const lobe = keepInside(grid, {
      x: parent.x + direction.x * reach,
      y: parent.y + direction.y * reach,
      radius,
      outerSlope: 1,
    });
    const room = distanceToNearest(lobe, lobes);
    if (room > bestRoom) {
      best = { lobe, parent };
      bestRoom = room;
    }
  }
  return best as { lobe: Lobe; parent: Lobe };
}

/**
 * Adds a lobe that stands apart from all the others (an island), if a few
 * random tries find room for one. On a full map it is simply left out.
 */
function addSideLobe(grid: Grid, rng: RngState, lobes: Lobe[], radius: number): void {
  for (let i = 0; i < SIDE_LOBE_TRIES; i++) {
    const lobe = keepInside(grid, {
      x: grid.width * nextFloat(rng),
      y: grid.height * ROW_HEIGHT * nextFloat(rng),
      radius,
      outerSlope: MAPGEN.sideLobeOuterSlope,
    });
    const standsApart = lobes.every(
      (other) => centerDistance(lobe, other) >= MAPGEN.sideLobeGap * (lobe.radius + other.radius),
    );
    if (standsApart) {
      lobes.push(lobe);
      return;
    }
  }
}

/**
 * Moves a lobe's centre far enough from the map edge that the whole lobe is
 * on the map with some sea to spare (on a small map: as far as there is
 * room). A lobe that leans on the edge would get a ruler-straight coast there.
 */
function keepInside(grid: Grid, lobe: Lobe): Lobe {
  const mapWidth = grid.width;
  const mapHeight = grid.height * ROW_HEIGHT;
  const marginX = Math.min(lobe.radius + MAPGEN.lobeEdgeGap, mapWidth / 2);
  const marginY = Math.min(lobe.radius + MAPGEN.lobeEdgeGap, mapHeight / 2);
  return {
    x: Math.min(Math.max(lobe.x, marginX), mapWidth - marginX),
    y: Math.min(Math.max(lobe.y, marginY), mapHeight - marginY),
    radius: lobe.radius,
    outerSlope: lobe.outerSlope,
  };
}

function centerDistance(a: Lobe, b: Lobe): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distanceToNearest(lobe: Lobe, others: readonly Lobe[]): number {
  let nearest = centerDistance(lobe, others[0]);
  for (const other of others) nearest = Math.min(nearest, centerDistance(lobe, other));
  return nearest;
}

/**
 * A random direction as a step of length 1. Made without sines and cosines
 * (not allowed here, see generateMap.ts): pick random points in a square
 * until one lies inside the circle, then stretch it to length 1.
 */
function randomDirection(rng: RngState): { x: number; y: number } {
  // About three of four points lie inside the circle, so the limit on the
  // tries is never reached in practice; it only rules out an endless loop.
  for (let tries = 0; tries < 100; tries++) {
    const x = nextFloat(rng) * 2 - 1;
    const y = nextFloat(rng) * 2 - 1;
    const lengthSquared = x * x + y * y;
    if (lengthSquared > 0.01 && lengthSquared <= 1) {
      const length = Math.sqrt(lengthSquared);
      return { x: x / length, y: y / length };
    }
  }
  return { x: 1, y: 0 };
}

/** A random whole number from `min` to `max`, both included. */
function intBetween(rng: RngState, range: { min: number; max: number }): number {
  return range.min + nextInt(rng, range.max - range.min + 1);
}

/**
 * Tidies the land in place: removes islands that are only a speck and fills
 * in lakes that are only a puddle. Both look like mistakes on the map.
 */
function removeSpecks(grid: Grid, isLand: boolean[]): void {
  const islands = labelRegions(grid, isLand);
  for (let tile = 0; tile < grid.count; tile++) {
    if (isLand[tile] && islands.sizes[islands.regionOf[tile]] < MAPGEN.minIslandTiles) isLand[tile] = false;
  }

  const isWater = isLand.map((land) => !land);
  const waters = labelRegions(grid, isWater);
  // Tile 0 is a corner of the map, so its water region is the open sea;
  // every other water region is enclosed by land: a lake.
  const openSea = waters.regionOf[0];
  for (let tile = 0; tile < grid.count; tile++) {
    const region = waters.regionOf[tile];
    if (isWater[tile] && region !== openSea && waters.sizes[region] <= MAPGEN.maxFilledLakeTiles) isLand[tile] = true;
  }
}
