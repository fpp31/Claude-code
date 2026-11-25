/**
 * For the server tests that need the REAL rules engine (owned by WP3). Not a
 * test file.
 *
 * Those tests play on a hand-drawn map instead of a generated one, so that
 * each test can say exactly where everybody starts: next to each other for
 * the conflict tests, far apart for the fog-of-war tests. There are two
 * such maps: LONG_MEADOW, which has no water a city could own, and (since
 * round 3) LONG_SHORE, the same meadow with the sea on one side, for the
 * tests with boats, nets and "Grow first / Build first".
 */

import { createGame, tileIsWater } from '@domination/shared';
import type {
  Action,
  BuildItem,
  CityFocusId,
  CityView,
  OwnCityDetail,
  PlayerView,
  TileIndex,
  UnitTypeId,
  UnitView,
} from '@domination/shared';
import { mapFromAscii } from '@domination/shared/testing';
import { expect } from 'vitest';
import { realRules } from '../src/rules';
import type { Rules } from '../src/rules';
import type { TestClient } from './harness';

/**
 * A long plain meadow, 24 x 11, with water all around. Two players at its
 * two ends are far outside each other's sight (units see 2 or 3 tiles).
 * Odd rows are drawn one space to the right, as they sit on the hex map.
 *
 * No start the tests use is within two tiles of the water, so no city on
 * this map owns a water tile and none can build a boat. It stays exactly as
 * it is: the tile numbers of many tests stand on it.
 */
export const LONG_MEADOW: readonly string[] = [
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ' ~ g g g g g g g g g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g g g g g g g g g ~',
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
];

/**
 * The same meadow with the sea on its south side, 24 x 12: as wide as
 * LONG_MEADOW, so `at` gives the tiles of both. Rows 1 to 7 are land,
 * grassland but for row 6, which is plains. Rows 8 and 9 are coast, and
 * everything beyond is ocean: one sea.
 *
 * Where a player starts decides what the capital founded there owns (a city
 * claims every tile within two):
 *
 *  - in ROW 7, on the shore (columns 3 to 20): seven coast tiles, the two
 *    that touch the city in row 8, two more of row 8 and three of row 9. So
 *    the city can build boats, and a Fishing Boat has coast to net. Behind
 *    the city it owns four plains tiles of row 6, which give more
 *    production and less food than grassland: its one citizen gathers from
 *    grassland under "Grow first" and from plains under "Build first", so a
 *    press on either shows in the worked tiles and in both numbers.
 *  - in ROW 3, inland (columns 3 to 20): grassland only. No water, so both
 *    boats are refused ('noWaterForBoat'), and no plains, so the two ways
 *    of placing citizens choose the same tiles.
 *
 * A new boat appears on the coast tile that touches the city and has the
 * higher number: for a city at (x, 7) that is (x + 1, 8).
 */
export const LONG_SHORE: readonly string[] = [
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ' ~ g g g g g g g g g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g g g g g g g g g ~',
  '~ p p p p p p p p p p p p p p p p p p p p p p ~',
  ' ~ g g g g g g g g g g g g g g g g g g g g g g ~',
  '~ , , , , , , , , , , , , , , , , , , , , , , ~',
  ' ~ , , , , , , , , , , , , , , , , , , , , , , ~',
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ' ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
];

/** How many tiles a row of LONG_MEADOW has, and a row of LONG_SHORE. */
export const MEADOW_WIDTH = 24;

/** The tile in column `x` of row `y` of LONG_MEADOW or of LONG_SHORE (both counted from 0). */
export function at(x: number, y: number): TileIndex {
  return y * MEADOW_WIDTH + x;
}

/** The real rules, playing on a hand-drawn map of MEADOW_WIDTH columns with the given start tiles instead of a generated map. */
function realRulesOn(rows: readonly string[], starts: readonly [x: number, y: number][]): Rules {
  return {
    ...realRules,
    createGame: (setup) => createGame(setup, () => ({ map: mapFromAscii(rows), starts: starts.map(([x, y]) => at(x, y)) })),
  };
}

/**
 * The real rules, playing on LONG_MEADOW with the given start tiles (one per
 * player, in seat order) instead of a generated map.
 */
export function realRulesOnMeadow(starts: readonly [x: number, y: number][]): Rules {
  return realRulesOn(LONG_MEADOW, starts);
}

/**
 * The real rules, playing on LONG_SHORE with the given start tiles (one per
 * player, in seat order): row 7 for a capital with coast, row 3 for one
 * without water.
 */
export function realRulesOnShore(starts: readonly [x: number, y: number][]): Rules {
  return realRulesOn(LONG_SHORE, starts);
}

/** The viewer's own unit of a type (every player starts with one Settler and one Warrior). */
export function ownUnit(view: PlayerView | null, type: UnitTypeId): UnitView {
  const unit = view?.units.find((candidate) => candidate.owner === view.you && candidate.type === type);
  if (unit === undefined) throw new Error(`the view has no own ${type}`);
  return unit;
}

/** One of the viewer's own cities, with everything its owner is told about it. */
export type OwnCityView = CityView & { own: OwnCityDetail };

/** The viewer's own city (their first one, which is all these tests ever found). */
export function ownCity(view: PlayerView | null): OwnCityView {
  const city = view?.cities.find((candidate) => candidate.owner === view.you);
  if (city === undefined || city.own === null) throw new Error('the view has no own city');
  return { ...city, own: city.own };
}

/** A build queue of these units, in this order. */
export function queueOf(...unitTypes: UnitTypeId[]): BuildItem[] {
  return unitTypes.map((unitType) => ({ kind: 'unit', unitType }));
}

/** The action that replaces the whole build queue of a city with `queue`. */
export function setQueue(cityId: string, queue: BuildItem[]): Action {
  return { type: 'setBuildQueue', cityId, queue };
}

/** The action of a press on "Grow first" or "Build first": how the city is to place its citizens from now on. */
export function setFocus(cityId: string, focus: CityFocusId): Action {
  return { type: 'setCityFocus', cityId, focus };
}

/**
 * The water tiles inside the viewer's own borders, ascending: where their
 * boats can appear, and (the coast among them) where a Fishing Boat can
 * build a net.
 */
export function ownWater(view: PlayerView | null): TileIndex[] {
  if (view === null) throw new Error('there is no view yet');
  return view.tiles.flatMap((tile, index) => (tile !== null && tile.owner === view.you && tileIsWater(tile) ? [index] : []));
}

/** The items of a queue as its owner's view shows it, without the numbers of the rows. */
export function queueItems(city: OwnCityView): BuildItem[] {
  return city.own.buildQueue.map((row) => row.item);
}

/** The turn a client's view shows. */
export function turnOf(client: TestClient): number {
  if (client.view === null) throw new Error('the client has no view yet');
  return client.view.turn;
}

/**
 * Every player ends the current turn, in the order given (the last one
 * resolves it), and everybody reads everything they were sent. `players`
 * must be one socket of every seat of the game.
 */
export async function endTurn(players: readonly TestClient[]): Promise<void> {
  const turn = turnOf(players[0]);
  for (const player of players) await player.actOk(turn, { type: 'endTurn' });
  for (const player of players) await player.drain();
  for (const player of players) expect(turnOf(player)).toBe(turn + 1);
}

/**
 * Plays until `owner` has a new unit of this type, and returns it: the owner
 * founds a capital where the Settler stands (unless they have a city
 * already), makes the unit the one entry of its queue, and all `players`
 * end turn after turn. The unit must appear in exactly the turn the queue's
 * row promised ("in N turns"), not before and not after; so nothing else
 * may change the city on the way (no press on "Grow first / Build first").
 */
async function raiseUnit(owner: TestClient, players: readonly TestClient[], type: UnitTypeId): Promise<UnitView> {
  const turn = turnOf(owner);
  const hasCity = owner.view?.cities.some((city) => city.owner === owner.view?.you) ?? false;
  if (!hasCity) await owner.actOk(turn, { type: 'foundCity', unitId: ownUnit(owner.view, 'settler').id });
  const before = new Set(owner.view?.units.map((unit) => unit.id));
  await owner.actOk(turn, setQueue(ownCity(owner.view).id, queueOf(type)));
  const promised = ownCity(owner.view).own.buildQueue[0].turns;
  if (promised === null) throw new Error(`the queue does not say when the ${type} will be done`);

  for (let turnsLeft = promised; turnsLeft > 0; turnsLeft--) {
    expect(ownCity(owner.view).own.buildQueue[0].turns).toBe(turnsLeft);
    await endTurn(players);
  }
  // Built, and the queue is empty now: the city builds nothing.
  expect(ownCity(owner.view).own.buildQueue).toEqual([]);
  const built = owner.view?.units.filter((unit) => unit.owner === owner.view?.you && unit.type === type && !before.has(unit.id)) ?? [];
  if (built.length !== 1) throw new Error(`expected one new ${type}, found ${built.length}`);
  return built[0];
}

/**
 * Plays until `owner` has a Worker, and returns it (see raiseUnit: a capital
 * where the Settler stands, a Worker in its queue, turn after turn until the
 * turn the queue's row promised).
 *
 * It stands on the city's tile then, where nothing can be built: a test
 * moves it one tile on before it gives it a job.
 */
export function raiseWorker(owner: TestClient, players: readonly TestClient[]): Promise<UnitView> {
  return raiseUnit(owner, players, 'worker');
}

/**
 * Plays until `owner` has a boat, and returns it (see raiseUnit). The
 * capital must own water: on LONG_SHORE, a start in row 7.
 *
 * The boat lies on a water tile of the city then, never in the city. On
 * LONG_SHORE that is coast inside the borders, so a Fishing Boat can begin
 * a net where it appears.
 */
export function raiseBoat(
  owner: TestClient,
  players: readonly TestClient[],
  type: 'fishingBoat' | 'scoutBoat' = 'fishingBoat',
): Promise<UnitView> {
  return raiseUnit(owner, players, type);
}
