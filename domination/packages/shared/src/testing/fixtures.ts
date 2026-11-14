/**
 * Ready-made sample data, so the client can be built and looked at before
 * the rules engine, the map generator and the server exist:
 *
 *  - sampleMap()    a small hand-drawn map;
 *  - sampleView()   what a player ('p1', Rome) might see on that map in turn 7;
 *  - sampleLobby()  a lobby with two players.
 *
 * The client's demo mode (open the page with ?demo in the address) shows
 * these without a server. The data is hand-made: it looks like the real
 * thing and obeys the documented shapes, but it was not produced by the
 * rules engine.
 */

import { tileIsWater } from '../data/terrain';
import { foodToGrow, maxPlayers } from '../data/rules';
import { distance, neighbors, tileCount, tilesInRange } from '../hex';
import type { LobbyView } from '../protocol';
import type { GameMap, PlayerId, TileIndex } from '../types';
import type { CityView, PlayerView, TileView, UnitView } from '../viewTypes';
import { mapFromAscii } from './asciiMap';

/** The sample map, 14 x 10. Water is drawn as '~' only; coast is worked out by markCoast. */
export const SAMPLE_MAP_ROWS: readonly string[] = [
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ' ~ ~ g g f ~ ~ ~ ~ d d ~ ~ ~',
  '~ g g p f f g ~ d d D p ~ ~',
  ' ~ g g g p g h g p p g m ~ ~',
  '~ g f g g p h g g p g g ~ ~',
  ' ~ g g p g g m g p F g g ~ ~',
  '~ ~ g g p g g g g p g ~ ~ ~',
  ' ~ ~ g h g f g ~ g g d ~ ~ ~',
  '~ ~ ~ g g ~ ~ ~ ~ d ~ ~ ~ ~',
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
];

/**
 * Applies the map rule "a water tile is coast if it touches land, otherwise
 * ocean" to a map, in place, and returns it. Handy after mapFromAscii.
 */
export function markCoast(map: GameMap): GameMap {
  for (let tile = 0; tile < map.tiles.length; tile++) {
    if (!tileIsWater(map.tiles[tile])) continue;
    const touchesLand = neighbors(tile, map).some((n) => !tileIsWater(map.tiles[n]));
    map.tiles[tile].terrain = touchesLand ? 'coast' : 'ocean';
  }
  return map;
}

/** A fresh copy of the sample map (safe to modify). */
export function sampleMap(): GameMap {
  return markCoast(mapFromAscii(SAMPLE_MAP_ROWS));
}

// Where things stand in the sample view. tile = y * 14 + x.
const ROME_TILE: TileIndex = 4 * 14 + 3;
const THEBES_TILE: TileIndex = 3 * 14 + 10;
const OWN_WARRIOR_TILE: TileIndex = 3 * 14 + 5;
const OWN_SETTLER_TILE: TileIndex = 6 * 14 + 8;
const FOREIGN_WARRIOR_TILE: TileIndex = 4 * 14 + 7;
/** Centre of an area the player explored earlier and has since left. */
const OLD_EXPLORED_CENTER: TileIndex = 3 * 14 + 9;

/**
 * A plausible view for player 'p1' (Rome) in turn 7:
 *  - the city of Rome (population 2, building a Warrior) with its territory;
 *  - an own Warrior and an own Settler (the Settler may found a city);
 *  - a Warrior of 'p2' (Egypt) in sight;
 *  - the Egyptian city of Thebes, remembered but currently out of sight;
 *  - a ring of fogged (explored, not visible) tiles and never-seen tiles.
 */
export function sampleView(): PlayerView {
  const map = sampleMap();
  const count = tileCount(map);

  // In sight now: around both units and around Rome's territory.
  const visible: boolean[] = new Array(count).fill(false);
  for (const tile of tilesInRange(OWN_WARRIOR_TILE, 2, map)) visible[tile] = true;
  for (const tile of tilesInRange(OWN_SETTLER_TILE, 3, map)) visible[tile] = true;
  for (const tile of tilesInRange(ROME_TILE, 3, map)) visible[tile] = true;

  // Seen at some point: everything in sight plus an area visited earlier.
  const explored: boolean[] = visible.slice();
  for (const tile of tilesInRange(OLD_EXPLORED_CENTER, 3, map)) explored[tile] = true;

  const ownerOf = (tile: TileIndex): PlayerId | null => {
    if (distance(tile, ROME_TILE, map) <= 2) return 'p1';
    if (distance(tile, THEBES_TILE, map) <= 2) return 'p2';
    return null;
  };

  const tiles: (TileView | null)[] = [];
  for (let tile = 0; tile < count; tile++) {
    if (!explored[tile]) {
      tiles.push(null);
      continue;
    }
    tiles.push({
      terrain: map.tiles[tile].terrain,
      feature: map.tiles[tile].feature,
      owner: ownerOf(tile),
      visible: visible[tile],
    });
  }

  const units: UnitView[] = [
    {
      id: 'u1_k7m2qd', type: 'warrior', owner: 'p1', tile: OWN_WARRIOR_TILE,
      own: { movesLeft: 2, foundCityError: 'cannotFoundCity' },
    },
    {
      id: 'u1_x3fp9a', type: 'settler', owner: 'p1', tile: OWN_SETTLER_TILE,
      own: { movesLeft: 2, foundCityError: null },
    },
    { id: 'u2_b8nq4t', type: 'warrior', owner: 'p2', tile: FOREIGN_WARRIOR_TILE, own: null },
  ];

  const cities: CityView[] = [
    {
      id: 'c1_r6wz2e', owner: 'p1', name: 'Rome', tile: ROME_TILE, population: 2, visible: true,
      own: {
        foodStored: 4,
        foodToGrow: foodToGrow(2),
        foodPerTurn: 2,
        production: { kind: 'unit', unitType: 'warrior' },
        productionStored: 6,
        productionCost: 18,
        productionPerTurn: 3,
        turnsLeft: 4,
        productionBlocked: null,
        worked: [3 * 14 + 3, 4 * 14 + 4],
        buildOptions: [
          { item: { kind: 'unit', unitType: 'warrior' }, cost: 18, turns: 4 },
          { item: { kind: 'unit', unitType: 'scout' }, cost: 12, turns: 2 },
          { item: { kind: 'unit', unitType: 'settler' }, cost: 30, turns: 8 },
        ],
      },
    },
    { id: 'c2_h5yd7m', owner: 'p2', name: 'Thebes', tile: THEBES_TILE, population: 1, visible: false, own: null },
  ];

  return {
    you: 'p1',
    turn: 7,
    width: map.width,
    height: map.height,
    tiles,
    units,
    cities,
    players: [
      { id: 'p1', name: 'Ada', civ: 'rome', endedTurn: false },
      { id: 'p2', name: 'Ben', civ: 'egypt', endedTurn: true },
    ],
  };
}

/** A lobby with two players, seen by the host 'p1'. */
export function sampleLobby(): LobbyView {
  return {
    code: 'K7QXM',
    you: 'p1',
    hostId: 'p1',
    mapSize: 'small',
    maxPlayers: maxPlayers(),
    seats: [
      { playerId: 'p1', name: 'Ada', civ: 'rome', connected: true },
      { playerId: 'p2', name: 'Ben', civ: 'egypt', connected: false },
    ],
  };
}
