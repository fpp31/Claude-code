/**
 * What every start is given besides fair land (round 3): the sea and a hill.
 *
 *   H6. Inside the land a capital founded on the start is SURE to own there
 *       are at least MAPGEN.startCoastTiles coast tiles of the sea. So the
 *       capital can build boats, a Fishing Boat has work for three nets or
 *       more, and a boat can sail from every capital to every other.
 *   H7. Inside that land there is a tile a Mine can be built on, and a
 *       land unit can walk to it from the start without leaving that land
 *       (joinedSureLand): a hill across a strip of water or behind
 *       mountains is no promise kept.
 *
 * "The sea" is the largest body of water of the map (seaCoast). "Sure to
 * own" (sureLand) is every tile within two of the start that is not within
 * two of another start: a founder claims what nobody owns yet, so where two
 * starts are four tiles apart the tiles between them go to whoever founds
 * first, and no promise is built on them.
 *
 * H6 is kept by choosing the sites: a start can only be where the sea is in
 * reach (sitesBySea, handed to placeStarts). H7 is kept by putting a hill
 * near a start that has none (raiseStartHills), after the starts are chosen:
 * choosing sites by hills moved every start and cost fairness and room on
 * crowded maps, a hill put near a start moves none and changes its score by
 * 1 at most.
 */

import { improvementFits } from '../data/improvements';
import { FEATURES, tileIsWater, tileMoveCost } from '../data/terrain';
import type { GameMap, TileIndex } from '../types';
import type { Grid } from './grid';
import { gridDistance, labelRegions } from './grid';
import { MAPGEN } from './tuning';

/**
 * isSeaCoast[tile]: is the tile a coast tile of THE SEA, the largest body
 * of water of the map (coast and ocean together; of two bodies of one size
 * the one that holds the lower tile)? A lake's coast is not.
 */
export function seaCoast(grid: Grid, map: GameMap): boolean[] {
  const water = labelRegions(grid, map.tiles.map((tile) => tileIsWater(tile)));
  let sea = -1;
  for (let region = 0; region < water.sizes.length; region++) {
    if (sea === -1 || water.sizes[region] > water.sizes[sea]) sea = region;
  }
  return water.regionOf.map((region, tile) => region !== -1 && region === sea && map.tiles[tile].terrain === 'coast');
}

/**
 * allowed[tile]: may the tile be a start as far as rule H6 goes? True if at
 * least MAPGEN.startCoastTiles coast tiles of the sea lie within two of it.
 * This is the list placeStarts takes as `allowed`.
 *
 * It is asked before the starts are chosen, so it cannot leave out a coast
 * tile that another start will be as near to. Where two starts end up four
 * apart with such a tile between them, startNeedsHold notices and the map
 * is thrown away. (On the game's own sizes no two starts come that close.)
 */
export function sitesBySea(grid: Grid, isSeaCoast: readonly boolean[]): boolean[] {
  const allowed: boolean[] = [];
  for (let tile = 0; tile < grid.count; tile++) {
    let coast = 0;
    for (const near of grid.withinTwo[tile]) if (near !== tile && isSeaCoast[near]) coast++;
    allowed.push(coast >= MAPGEN.startCoastTiles);
  }
  return allowed;
}

/**
 * The tiles a capital founded on `start` is sure to own, whoever founds
 * first: within two of it (itself not counted) and not within two of any
 * other start. In tile order.
 */
export function sureLand(grid: Grid, starts: readonly TileIndex[], start: TileIndex): TileIndex[] {
  return grid.withinTwo[start].filter(
    (tile) => tile !== start && starts.every((other) => other === start || gridDistance(grid, other, tile) > 2),
  );
}

/**
 * The tiles of a start's sure land that a land unit can walk to from the
 * start without leaving the sure land: the start's neighbours a land unit
 * can enter, their neighbours in the sure land, and so on. In tile order.
 * (Land across a strip of water or behind mountains is not among them.)
 */
export function joinedSureLand(grid: Grid, map: GameMap, starts: readonly TileIndex[], start: TileIndex): TileIndex[] {
  const sure = new Set(sureLand(grid, starts, start));
  const reached = new Set<TileIndex>();
  const todo: TileIndex[] = [start];
  while (todo.length > 0) {
    const from = todo.pop() as TileIndex;
    for (const next of grid.neighbors[from]) {
      if (!sure.has(next) || reached.has(next) || tileMoveCost(map.tiles[next], 'land') === null) continue;
      reached.add(next);
      todo.push(next);
    }
  }
  return [...reached].sort((a, b) => a - b);
}

/** Rules H6 and H7 for every start. Call it after raiseStartHills. */
export function startNeedsHold(grid: Grid, map: GameMap, starts: readonly TileIndex[]): boolean {
  const isSeaCoast = seaCoast(grid, map);
  for (const start of starts) {
    const land = sureLand(grid, starts, start);
    if (land.filter((tile) => isSeaCoast[tile]).length < MAPGEN.startCoastTiles) return false; // H6
    if (!joinedSureLand(grid, map, starts, start).some((tile) => improvementFits('mine', map.tiles[tile]))) return false; // H7
  }
  return true;
}

/**
 * Gives every start that has no tile for a Mine in its JOINED sure land ONE
 * hill there (a hill the start has on land a Worker cannot walk to does not
 * count, and no hill is put on such land). EDITS `map` (the map of this
 * attempt). The tile that changes the start's score least is taken:
 *   1. a forest tile (forest and hills both count 2: the score stays),
 *   2. open desert (1 becomes 2),
 *   3. open plains, 4. open grassland (3 becomes 2);
 * among equals a tile of the second ring before one next to the start, then
 * the lower tile. Water, mountains and tiles that carry hills are never
 * touched (a start with hills in its joined sure land needs nothing).
 *
 * @returns how many hills were put; -1 if some start has no tile that could
 *          carry one (the caller throws the map away)
 */
export function raiseStartHills(grid: Grid, map: GameMap, starts: readonly TileIndex[]): number {
  let put = 0;
  for (const start of starts) {
    const land = joinedSureLand(grid, map, starts, start);
    if (land.some((tile) => improvementFits('mine', map.tiles[tile]))) continue;
    let best = -1;
    let bestKey = 0;
    for (const tile of land) {
      const ground = map.tiles[tile];
      if (tileIsWater(ground) || !FEATURES.hills.allowedOn.includes(ground.terrain)) continue;
      if (ground.feature !== null && ground.feature !== 'forest') continue;
      const kind = ground.feature === 'forest' ? 0 : ground.terrain === 'desert' ? 1 : ground.terrain === 'plains' ? 2 : 3;
      const nextToStart = grid.neighbors[start].includes(tile) ? 1 : 0;
      const key = (kind * 2 + nextToStart) * grid.count + tile;
      if (best === -1 || key < bestKey) {
        best = tile;
        bestKey = key;
      }
    }
    if (best === -1) return -1;
    map.tiles[best].feature = 'hills';
    put++;
  }
  return put;
}
