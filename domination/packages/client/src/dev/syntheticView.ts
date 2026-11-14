/**
 * A made-up view of any size (work package WP5), for the big-map test page
 * (bigMapHarness.ts): the renderer has to be tried on the largest map
 * before the map generator and the rules exist, and it should not depend on
 * them afterwards either.
 *
 * The land is simple smoothed noise, not the real map generator, and the
 * cities and units are placed without asking the rules. It only has to
 * LOOK like a game in full swing: every terrain and feature, six
 * civilizations with territory, all three unit types, some fog.
 * The same options always give the same view.
 */

import {
  CIV_IDS, cityNameFor, distance, nextFloat, nextInt, seedRng, tileCoord, tileCount, tileIndex, tilesInRange,
} from '@domination/shared';
import type {
  CityView, FeatureId, GridSize, PlayerId, PlayerView, RngState, TerrainId, TileIndex, TileView, UnitTypeId, UnitView,
} from '@domination/shared';

export interface SyntheticViewOptions {
  width: number;
  height: number;
  /**
   * 'none': every tile is in sight (the most there can be to draw);
   * 'some': in sight around player 1's things, explored a little further, unknown beyond.
   */
  fog: 'none' | 'some';
}

/** Random values on a coarse grid, read off smoothly in between ("value noise"), from 0 to 1. */
function makeNoise(rng: RngState, size: GridSize, step: number): (x: number, y: number) => number {
  const columns = Math.ceil(size.width / step) + 2;
  const rows = Math.ceil(size.height / step) + 2;
  const grid: number[] = [];
  for (let i = 0; i < columns * rows; i++) grid.push(nextFloat(rng));
  return (x, y) => {
    const gx = x / step;
    const gy = y / step;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const at = (cx: number, cy: number): number => grid[cy * columns + cx];
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

export function syntheticView(options: SyntheticViewOptions): PlayerView {
  const size: GridSize = { width: options.width, height: options.height };
  const count = tileCount(size);
  const rng = seedRng('wp5-big-map', `${size.width}x${size.height}`);
  const height = makeNoise(rng, size, 7);
  const detail = makeNoise(rng, size, 3);
  const dryness = makeNoise(rng, size, 9);
  const cover = makeNoise(rng, size, 4);

  // ---- Ground and features ------------------------------------------------
  const terrains: TerrainId[] = [];
  const features: (FeatureId | null)[] = [];
  for (let tile = 0; tile < count; tile++) {
    const { x, y } = tileCoord(tile, size);
    // Lower towards the edges, so the map is land in a sea.
    const edge = Math.min(x, y, size.width - 1 - x, size.height - 1 - y);
    const level = height(x, y) * 0.7 + detail(x, y) * 0.3 - (edge < 3 ? (3 - edge) * 0.15 : 0);
    let terrain: TerrainId = 'ocean';
    let feature: FeatureId | null = null;
    if (level > 0.44) {
      const dry = dryness(x, y);
      terrain = dry > 0.62 ? 'desert' : dry > 0.42 ? 'plains' : 'grassland';
      const c = cover(x, y);
      if (level > 0.7) feature = 'mountains';
      else if (level > 0.62) feature = 'hills';
      else if (c > 0.62 && terrain !== 'desert') feature = 'forest';
      else if (c < 0.2) feature = 'hills';
    }
    terrains.push(terrain);
    features.push(feature);
  }
  // Water that touches land is coast.
  const isLand = (tile: TileIndex): boolean => terrains[tile] !== 'ocean' && terrains[tile] !== 'coast';
  for (let tile = 0; tile < count; tile++) {
    if (!isLand(tile) && tilesInRange(tile, 1, size).some(isLand)) terrains[tile] = 'coast';
  }

  // ---- Six players: cities with territory, and units around them ---------
  const players = CIV_IDS.map((civ, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}`, civ, endedTurn: false }));
  const owners: (PlayerId | null)[] = new Array(count).fill(null);
  const cities: CityView[] = [];
  const units: UnitView[] = [];
  const openLand = (tile: TileIndex): boolean => isLand(tile) && features[tile] !== 'mountains';

  const citiesPerPlayer = Math.max(2, Math.round(count / 400));
  players.forEach((player, playerIndex) => {
    let founded = 0;
    for (let attempt = 0; attempt < 400 && founded < citiesPerPlayer; attempt++) {
      // Each player keeps to one sixth of the map's width.
      const x = Math.floor((playerIndex + nextFloat(rng)) * (size.width / players.length));
      const y = 2 + nextInt(rng, size.height - 4);
      const tile = tileIndex({ x: Math.min(size.width - 1, x), y }, size);
      if (!openLand(tile) || features[tile] === 'forest') continue;
      if (cities.some((city) => distance(city.tile, tile, size) < 4)) continue;

      for (const claimed of tilesInRange(tile, 2, size)) owners[claimed] ??= player.id;
      cities.push({
        id: `c${playerIndex + 1}_${founded}`, owner: player.id, name: cityNameFor(player.civ, founded), tile,
        population: 1 + nextInt(rng, 12), visible: true, own: null,
      });
      // Units in and around the city, so that every way of standing on a tile
      // shows up: alone, two in a city, two on open ground.
      const near = tilesInRange(tile, 2, size).filter((candidate) => candidate !== tile && openLand(candidate));
      const wanted: [spot: TileIndex | undefined, type: UnitTypeId][] = [
        [tile, founded % 2 === 0 ? 'warrior' : 'scout'],
        [near[0], 'warrior'],
        [near[1], 'scout'],
        [founded % 2 === 0 ? tile : near[0], 'settler'],
      ];
      for (const [spot, type] of wanted) {
        if (spot === undefined) continue;
        units.push({
          id: `u${playerIndex + 1}_${units.length}`, type, owner: player.id, tile: spot,
          own: playerIndex === 0 ? { movesLeft: units.length % 3 === 0 ? 0 : 2, foundCityError: 'cannotFoundCity' } : null,
        });
      }
      founded += 1;
    }
  });

  // ---- Fog ---------------------------------------------------------------
  const visible: boolean[] = new Array(count).fill(options.fog === 'none');
  const explored: boolean[] = new Array(count).fill(options.fog === 'none');
  if (options.fog === 'some') {
    const mine = [
      ...units.filter((unit) => unit.owner === 'p1').map((unit) => unit.tile),
      ...cities.filter((city) => city.owner === 'p1').map((city) => city.tile),
    ];
    for (const tile of mine) {
      for (const seen of tilesInRange(tile, 3, size)) visible[seen] = true;
      for (const seen of tilesInRange(tile, 7, size)) explored[seen] = true;
    }
  }

  const tiles: (TileView | null)[] = [];
  for (let tile = 0; tile < count; tile++) {
    tiles.push(explored[tile] ? { terrain: terrains[tile], feature: features[tile], owner: owners[tile], visible: visible[tile] } : null);
  }

  return {
    you: 'p1',
    turn: 120,
    width: size.width,
    height: size.height,
    tiles,
    // Other players' units only where the viewer sees them; cities also where they were seen once.
    units: units.filter((unit) => visible[unit.tile]),
    cities: cities
      .filter((city) => explored[city.tile])
      .map((city) => ({ ...city, visible: visible[city.tile] })),
    players,
  };
}
