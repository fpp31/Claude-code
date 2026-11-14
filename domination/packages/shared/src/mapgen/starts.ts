/**
 * Step 6 of map generation: where the players begin.
 *
 * The idea in three sentences:
 *  1. Find every SITE: a tile where a capital could legally be founded
 *     (rules H2, H4, H5 of generateMap), and give it a score for the land
 *     around it (the score of rule S3).
 *  2. Try to put all players on ONE landmass, on good sites of similar
 *     score, as far apart as that landmass allows. This is the only way a
 *     map that is not crowded gets its starts, and it keeps S1-S3.
 *  3. If the map is crowded and step 2 found no room, give way in the order
 *     the doc comment of generateMap asks for: first keep the starts as far
 *     apart as possible, then prefer one landmass, then similar scores.
 *
 * "As far apart as possible" is done by trial: ask for a large spacing
 * first and lower it step by step until the wanted number of starts fits.
 *
 * How step 3 reads "as far apart as the land allows": up to
 * RULES.minStartDistance, the distance every uncrowded map guarantees.
 * A crowded map that can give everybody that much room is not asked to
 * scatter the players over several islands for the sake of even more.
 */

import { RULES } from '../data/rules';
import { tileAllowsCity } from '../data/terrain';
import { nextFloat } from '../rng';
import type { RngState } from '../rng';
import type { GameMap, TileIndex } from '../types';
import type { Grid } from './grid';
import { ROW_HEIGHT, gridDistance } from './grid';
import { isWalkable, tileWorth, walkableAreas } from './startRules';
import { MAPGEN } from './tuning';

/** A tile a player could start on. */
interface Site {
  tile: TileIndex;
  /** The walkable area (see walkableAreas) the tile lies in: its landmass, as far as land units are concerned. */
  area: number;
  /** The score of rule S3: what the land around the tile yields. */
  score: number;
  /**
   * A comfortable site is open grassland or plains with land around it.
   * Hills and desert are legal city sites too, but a poor place for a capital.
   */
  comfortable: boolean;
}

/** A landmass that may become the one home of all players. */
interface Home {
  /** Its walkable area (see Site.area). */
  area: number;
  /** How many tiles of it a land unit can walk on. */
  size: number;
}

/**
 * Chooses a start tile for every player, or returns null if this map has
 * no room for them (generateMap then tries the next map).
 *
 * @param crowded  more players than the map size recommends: rules S1-S3
 *                 are only aims then
 */
export function placeStarts(
  grid: Grid,
  map: GameMap,
  playerCount: number,
  crowded: boolean,
  rng: RngState,
): TileIndex[] | null {
  const areas = walkableAreas(grid, map);
  const sites = findSites(grid, map, areas.regionOf, areas.sizes);

  // The landmasses that may become the one home of all players, largest first.
  const homes: Home[] = areas.sizes
    .map((size, area) => ({ area, size }))
    .filter((home) => home.size >= RULES.minStartLandmass)
    .sort((a, b) => (b.size !== a.size ? b.size - a.size : a.area - b.area))
    .slice(0, MAPGEN.homeLandmassTries);

  const together = placeTogether(grid, sites, homes, playerCount, rng);
  if (together !== null || !crowded) return together;
  return placeCrowded(grid, sites, homes, areas.sizes, playerCount, rng);
}

/**
 * The first choice, and the only one on a map that is not crowded: all
 * players on one landmass, on comfortable sites with similar scores, at
 * least RULES.minStartDistance apart and further if there is room. Whatever
 * this returns keeps the standard rules S1-S3. null if no landmass can do it.
 */
function placeTogether(
  grid: Grid,
  sites: readonly Site[],
  homes: readonly Home[],
  playerCount: number,
  rng: RngState,
): TileIndex[] | null {
  for (const home of homes) {
    const comfortable = sites.filter((site) => site.area === home.area && site.comfortable);
    if (comfortable.length < playerCount) continue;
    const ideal = idealSpacing(home.size, playerCount);
    for (const step of MAPGEN.fairnessSteps) {
      const closest = Math.max(RULES.minStartDistance, Math.floor((ideal * step.spacingPercent) / 100));
      const orders = tryOrders(grid, sitesNearTheBest(comfortable, step.scorePercent), rng);
      const starts = spreadOut(grid, orders, playerCount, Math.max(ideal, closest), closest);
      if (starts !== null) return starts;
    }
  }
  return null;
}

/**
 * The fallback for a crowded map on which `placeTogether` found no room.
 * It gives way in the order the doc comment of generateMap asks for:
 * distance first, then one landmass, then similar scores. The distance is
 * never lowered below RULES.minCityDistance (rule H3); null if even that
 * does not fit.
 */
function placeCrowded(
  grid: Grid,
  sites: readonly Site[],
  homes: readonly Home[],
  areaSizes: readonly number[],
  playerCount: number,
  rng: RngState,
): TileIndex[] | null {
  // The groups of sites to choose from, most wanted first:
  //   one landmass:   comfortable sites with fair scores, then all
  //                   comfortable sites, then every site on it;
  //   any landmass with room to grow: the same three;
  //   last resort:    every site there is.
  const groups: Site[][] = [];
  for (const home of homes) {
    const comfortable = sites.filter((site) => site.area === home.area && site.comfortable);
    groups.push(sitesNearTheBest(comfortable, MAPGEN.fairScorePercent));
  }
  for (const home of homes) groups.push(sites.filter((site) => site.area === home.area && site.comfortable));
  for (const home of homes) groups.push(sites.filter((site) => site.area === home.area));
  const roomy = sites.filter((site) => areaSizes[site.area] >= MAPGEN.roomyLandmassTiles);
  const roomyAndComfortable = roomy.filter((site) => site.comfortable);
  groups.push(sitesNearTheBest(roomyAndComfortable, MAPGEN.fairScorePercent), roomyAndComfortable, roomy);
  groups.push([...sites]);
  const groupOrders = groups.filter((group) => group.length >= playerCount).map((group) => tryOrders(grid, group, rng));

  // Distance matters most, so it is the outer loop: only when no group of
  // sites fits at a spacing is the spacing lowered.
  for (let spacing = RULES.minStartDistance; spacing >= RULES.minCityDistance; spacing--) {
    for (const orders of groupOrders) {
      const starts = spreadOut(grid, orders, playerCount, spacing, spacing);
      if (starts !== null) return starts;
    }
  }
  return null;
}

/** Every tile that satisfies the rules a single start must satisfy (H2, H4, H5), with its score. */
function findSites(grid: Grid, map: GameMap, areaOf: readonly number[], areaSizes: readonly number[]): Site[] {
  // Worked out once per tile here, because every tile is looked at from all the sites around it.
  const walkable: boolean[] = [];
  const worth: number[] = [];
  for (let tile = 0; tile < grid.count; tile++) {
    walkable.push(isWalkable(map, tile));
    worth.push(tileWorth(map, tile));
  }

  const sites: Site[] = [];
  for (let tile = 0; tile < grid.count; tile++) {
    const ground = map.tiles[tile];
    if (!walkable[tile] || !tileAllowsCity(ground)) continue; // H2
    let walkableNeighbors = 0;
    for (const neighbor of grid.neighbors[tile]) if (walkable[neighbor]) walkableNeighbors++;
    if (walkableNeighbors < 2) continue; // H4
    const area = areaOf[tile];
    if (areaSizes[area] < RULES.minStartLandmass) continue; // H5

    let score = 0;
    let landNearby = 0;
    for (const near of grid.withinTwo[tile]) {
      score += worth[near];
      if (walkable[near]) landNearby++;
    }
    const comfortable =
      ground.feature === null &&
      ground.terrain !== 'desert' &&
      walkableNeighbors >= MAPGEN.comfortNeighbors &&
      landNearby >= MAPGEN.comfortLandNearby;
    sites.push({ tile, area, score, comfortable });
  }
  return sites;
}

/**
 * The sites whose score is at least `percent` of the best score among
 * them. Any starts chosen from such a group keep rule S3 as long as
 * `percent` is 70 or more.
 */
function sitesNearTheBest(sites: readonly Site[], percent: number): Site[] {
  let best = 0;
  for (const site of sites) best = Math.max(best, site.score);
  return sites.filter((site) => site.score * 100 >= percent * best);
}

/**
 * How far apart the starts would be if every player had an equal,
 * hexagon-shaped share of the landmass. Real coastlines never allow quite
 * that much, so this is where the search for a spacing begins, not where
 * it ends.
 */
function idealSpacing(areaTiles: number, playerCount: number): number {
  // A hexagon whose opposite sides are d apart covers ROW_HEIGHT * d * d tiles.
  return Math.floor(Math.sqrt(areaTiles / (ROW_HEIGHT * playerCount)));
}

/**
 * The orders in which the sites are offered to `pickApart`: whoever comes
 * first in an order is taken first.
 *
 *  - A few "best first" orders, each after adding a small random bonus to
 *    every score: good land is preferred, and equally good sites take turns.
 *  - Four sweeps across the map (from the top, the bottom, the left and the
 *    right). Taking sites in the order a sweep meets them packs the starts
 *    tightly, which finds room on a full map where "best first" does not.
 */
function tryOrders(grid: Grid, sites: readonly Site[], rng: RngState): Site[][] {
  const orders: Site[][] = [];
  for (let i = 0; i < MAPGEN.placementTries; i++) {
    const keyed = sites.map((site) => ({ site, key: site.score + nextFloat(rng) * MAPGEN.scoreJitter }));
    keyed.sort((a, b) => (b.key !== a.key ? b.key - a.key : a.site.tile - b.site.tile));
    orders.push(keyed.map((entry) => entry.site));
  }
  const fromTop = [...sites].sort((a, b) => a.tile - b.tile);
  const fromLeft = [...sites].sort((a, b) =>
    grid.px[a.tile] !== grid.px[b.tile] ? grid.px[a.tile] - grid.px[b.tile] : a.tile - b.tile,
  );
  orders.push(fromTop, [...fromTop].reverse(), fromLeft, [...fromLeft].reverse());
  return orders;
}

/**
 * Looks for `count` sites that are pairwise at least `spacing` apart,
 * trying the largest spacing (`from`) first and lowering it down to `to`.
 * Returns their tiles, or null if even `to` does not fit.
 */
function spreadOut(grid: Grid, orders: readonly Site[][], count: number, from: number, to: number): TileIndex[] | null {
  for (let spacing = from; spacing >= to; spacing--) {
    for (const order of orders) {
      const starts = pickApart(grid, order, count, spacing);
      if (starts !== null) return starts;
    }
  }
  return null;
}

/** Goes through the sites in order and takes every one that is far enough from those already taken. */
function pickApart(grid: Grid, order: readonly Site[], count: number, spacing: number): TileIndex[] | null {
  const taken: TileIndex[] = [];
  for (const site of order) {
    if (taken.every((other) => gridDistance(grid, site.tile, other) >= spacing)) {
      taken.push(site.tile);
      if (taken.length === count) return taken;
    }
  }
  return null;
}
