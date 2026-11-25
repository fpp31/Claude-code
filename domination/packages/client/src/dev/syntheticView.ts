/**
 * A made-up view of any size (work package WP5), for the big-map test page
 * (bigMapHarness.ts): the renderer has to be tried on the largest map
 * before the map generator and the rules exist, and it should not depend on
 * them afterwards either.
 *
 * The land is simple smoothed noise, not the real map generator, and the
 * cities and units are placed without asking the rules. It only has to
 * LOOK like a game in full swing: every terrain and feature, six
 * civilizations with territory, farms and mines on their land, fishing
 * nets on their coast, all six unit types, some fog. A boat is always put
 * on water and a land unit on land. Player 1 is the viewer: some of their
 * Workers and Fishing Boats are at work, and their first city has nothing
 * to build, so both small signs of the map can be looked at.
 *
 * For the art of the water (round 3) it shows, wherever the made-up coast
 * has the room: a Fishing Boat of every city with coast inside its
 * borders; a Scout Boat on a second coast tile, in every second such city
 * with another Fishing Boat beside it on that tile; nets that a citizen
 * gathers from (the gold token, with the city selected) beside nets nobody
 * gathers from; and ONE thing the rules never show: the viewer's first
 * Fishing Boat is at work on a coast tile that already has its net, next
 * to a plain one. (A job ends in the turn its net stands.) It is there so
 * that the "at work" sign can be looked at over the float it covers.
 * test/renderDevView.test.ts counts all of these on the three map sizes.
 * The same options always give the same view.
 */

import {
  CIV_IDS, IMPROVEMENTS, UNITS, UNIT_TYPE_IDS, cityNameFor, distance, foodToGrow, improvementFits, neighbors,
  nextFloat, nextInt, seedRng, tileCoord, tileCount, tileIndex, tilesInRange,
} from '@domination/shared';
import type {
  CityView, FeatureId, GridSize, ImprovementId, OwnCityDetail, OwnUnitDetail, PlayerId, PlayerView, RngState, TerrainId,
  TileIndex, TileView, UnitTypeId, UnitView,
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
      // shows up: alone, two in a city, two on open ground (a Worker behind
      // a Scout among them).
      const near = tilesInRange(tile, 2, size).filter((candidate) => candidate !== tile && openLand(candidate));
      const wanted: [spot: TileIndex | undefined, type: UnitTypeId][] = [
        [tile, founded % 2 === 0 ? 'warrior' : 'scout'],
        [near[0], 'warrior'],
        [near[1], 'scout'],
        [founded % 2 === 0 ? tile : near[0], 'settler'],
        [near[1], 'worker'],
        [near[2], 'worker'],
      ];
      for (const [spot, type] of wanted) {
        if (spot === undefined) continue;
        units.push({
          id: `u${playerIndex + 1}_${units.length}`, type, owner: player.id, tile: spot,
          own:
            playerIndex === 0
              ? { movesLeft: units.length % 3 === 0 ? 0 : 2, foundCityError: 'cannotFoundCity', job: null, jobOptions: [] }
              : null,
        });
      }
      founded += 1;
    }
  });

  // ---- Farms, mines and nets on owned tiles; the viewer's Workers and cities
  // A stream of its own, so the land and the cities above stay exactly as
  // they were before there were improvements. (One number is drawn per
  // tile whatever stands there, so the nets moved no farm and no mine.)
  const improvementRng = seedRng('wp5-big-map', `${size.width}x${size.height} improvements`);
  const cityTiles = new Set(cities.map((city) => city.tile));
  const fits = (tile: TileIndex, improvement: ImprovementId): boolean =>
    improvementFits(improvement, { terrain: terrains[tile], feature: features[tile] });
  const improvements: (ImprovementId | null)[] = [];
  for (let tile = 0; tile < count; tile++) {
    const chance = nextFloat(improvementRng);
    let improvement: ImprovementId | null = null;
    if (owners[tile] !== null && !cityTiles.has(tile)) {
      if (fits(tile, 'mine') && chance < 0.6) improvement = 'mine';
      else if (fits(tile, 'farm') && chance < 0.35) improvement = 'farm';
      else if (fits(tile, 'fishingNet') && chance < 0.45) improvement = 'fishingNet';
    }
    improvements.push(improvement);
  }

  // ---- Boats: on the water inside each city's borders, never on land ------
  // They come after every land unit in the list, so the land units keep
  // their ids and the Workers their jobs. A tile holds one boat of a class.
  const fishingBoatTiles = new Set<TileIndex>();
  const scoutBoatTiles = new Set<TileIndex>();
  const launch = (type: UnitTypeId, tile: TileIndex, owner: PlayerId): void => {
    (type === 'fishingBoat' ? fishingBoatTiles : scoutBoatTiles).add(tile);
    units.push({
      id: `u${owner.slice(1)}_${units.length}`, type, owner, tile,
      own:
        owner === 'p1'
          ? { movesLeft: units.length % 3 === 0 ? 0 : UNITS[type].moves, foundCityError: 'cannotFoundCity', job: null, jobOptions: [] }
          : null,
    });
  };
  cities.forEach((city, cityIndex) => {
    const coast = tilesInRange(city.tile, 2, size).filter((tile) => terrains[tile] === 'coast' && owners[tile] === city.owner);
    const free = (taken: Set<TileIndex>): TileIndex[] => coast.filter((tile) => !taken.has(tile));
    // A Fishing Boat for every city with coast. On a second coast tile, if
    // the city has one, a Scout Boat: alone, or in every second city with
    // another Fishing Boat on its tile (one of each class: the two share it).
    const [first] = free(fishingBoatTiles);
    if (first === undefined) return;
    launch('fishingBoat', first, city.owner);
    const [second] = free(scoutBoatTiles).filter((tile) => tile !== first);
    if (second === undefined) return;
    launch('scoutBoat', second, city.owner);
    if (cityIndex % 2 === 0 && !fishingBoatTiles.has(second)) launch('fishingBoat', second, city.owner);
  });

  // Every other Worker and Fishing Boat of the viewer that stands where something can be built is building it.
  let workersSeen = 0;
  for (const unit of units) {
    if (unit.own === null || UNITS[unit.type].improvements.length === 0) continue;
    const site = unit.tile;
    const possible = UNITS[unit.type].improvements.filter(
      (improvement) => owners[site] === unit.owner && !cityTiles.has(site) && improvements[site] === null && fits(site, improvement),
    );
    const job = possible.length > 0 && workersSeen % 2 === 0 ? possible[0] : null;
    workersSeen += 1;
    const turnsTotal = job === null ? 0 : IMPROVEMENTS[job].turns;
    const own: OwnUnitDetail = {
      // At work it is dimmed whatever its moves; without a job it is bright here.
      movesLeft: UNITS[unit.type].moves,
      foundCityError: 'cannotFoundCity',
      job: job === null ? null : { improvement: job, turnsWorked: 1, turnsTotal, turnsLeft: turnsTotal - 1 },
      // One option per improvement the unit's type builds: two for a Worker, one for a Fishing Boat.
      jobOptions: UNITS[unit.type].improvements.map((improvement) => ({
        improvement,
        turns: IMPROVEMENTS[improvement].turns,
        error: job !== null ? 'unitBusy' : possible.includes(improvement) ? null : 'badImprovementTile',
      })),
    };
    unit.own = own;
  }

  // The one look the rules never give (see the top of this file): the
  // viewer's first Fishing Boat that has a coast tile of the viewer's
  // beside it is at work on a finished net, and that tile beside it is
  // plain coast.
  for (const unit of units) {
    if (unit.type !== 'fishingBoat' || unit.own === null) continue;
    const beside = neighbors(unit.tile, size).find((tile) => terrains[tile] === 'coast' && owners[tile] === unit.owner);
    if (beside === undefined) continue;
    improvements[unit.tile] = 'fishingNet';
    improvements[beside] = null;
    const turnsTotal = IMPROVEMENTS.fishingNet.turns;
    unit.own = {
      ...unit.own,
      job: { improvement: 'fishingNet', turnsWorked: 1, turnsTotal, turnsLeft: turnsTotal - 1 },
      jobOptions: [{ improvement: 'fishingNet', turns: turnsTotal, error: 'unitBusy' }],
    };
    break;
  }

  // The viewer's cities get the facts only an owner is shown. The first one has an empty build queue.
  cities.forEach((city, index) => {
    if (city.owner !== 'p1') return;
    const home = tilesInRange(city.tile, 2, size).filter((tile) => tile !== city.tile && owners[tile] === city.owner);
    const land = home.filter(isLand);
    // Every second net first, so that a net with the worked-tile token lies beside one without; then the
    // improved land, so that the tokens can be seen on farms and mines.
    const nets = home.filter((tile) => improvements[tile] === 'fishingNet');
    const worked = [
      ...nets.filter((_, place) => place % 2 === 0),
      ...land.filter((tile) => improvements[tile] !== null),
      ...land.filter((tile) => improvements[tile] === null),
    ].slice(0, city.population);
    const idle = index === cities.findIndex((candidate) => candidate.owner === 'p1');
    const own: OwnCityDetail = {
      foodStored: 3,
      foodToGrow: foodToGrow(city.population),
      foodPerTurn: 2,
      buildQueue: idle ? [] : [{ item: { kind: 'unit', unitType: 'warrior' }, cost: UNITS.warrior.cost, turns: 3, wait: null }],
      held: null,
      productionStored: 4,
      productionPerTurn: 4,
      worked,
      buildOptions: UNIT_TYPE_IDS.map((unitType, place) => ({
        item: { kind: 'unit', unitType }, cost: UNITS[unitType].cost, turns: 6 + 2 * place, wait: null, addError: null,
      })),
      focus: 'grow',
    };
    city.own = own;
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
    tiles.push(
      explored[tile]
        ? { terrain: terrains[tile], feature: features[tile], improvement: improvements[tile], owner: owners[tile], visible: visible[tile] }
        : null,
    );
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
