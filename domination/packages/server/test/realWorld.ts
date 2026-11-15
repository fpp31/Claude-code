/**
 * For the server tests that need the REAL rules engine (owned by WP3). Not a
 * test file.
 *
 * Those tests play on a hand-drawn map instead of a generated one, so that
 * each test can say exactly where everybody starts: next to each other for
 * the conflict tests, far apart for the fog-of-war tests.
 */

import { createGame } from '@domination/shared';
import type { Action, BuildItem, CityView, OwnCityDetail, PlayerView, TileIndex, UnitTypeId, UnitView } from '@domination/shared';
import { mapFromAscii } from '@domination/shared/testing';
import { expect } from 'vitest';
import { realRules } from '../src/rules';
import type { Rules } from '../src/rules';
import type { TestClient } from './harness';

/**
 * A long plain meadow, 24 x 11, with water all around. Two players at its
 * two ends are far outside each other's sight (units see 2 or 3 tiles).
 * Odd rows are drawn one space to the right, as they sit on the hex map.
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

export const MEADOW_WIDTH = 24;

/** The tile in column `x` of row `y` of LONG_MEADOW (both counted from 0). */
export function at(x: number, y: number): TileIndex {
  return y * MEADOW_WIDTH + x;
}

/**
 * The real rules, playing on LONG_MEADOW with the given start tiles (one per
 * player, in seat order) instead of a generated map.
 */
export function realRulesOnMeadow(starts: readonly [x: number, y: number][]): Rules {
  return {
    ...realRules,
    createGame: (setup) =>
      createGame(setup, () => ({ map: mapFromAscii(LONG_MEADOW), starts: starts.map(([x, y]) => at(x, y)) })),
  };
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
 * Plays until `owner` has a Worker, and returns it: the owner founds a
 * capital where the Settler stands, queues a Worker, and all `players` end
 * turn after turn. The Worker must appear in exactly the turn the queue's
 * row promised ("in N turns"), not before and not after.
 *
 * It stands on the city's tile then, where nothing can be built: a test
 * moves it one tile on before it gives it a job.
 */
export async function raiseWorker(owner: TestClient, players: readonly TestClient[]): Promise<UnitView> {
  const turn = turnOf(owner);
  await owner.actOk(turn, { type: 'foundCity', unitId: ownUnit(owner.view, 'settler').id });
  await owner.actOk(turn, setQueue(ownCity(owner.view).id, queueOf('worker')));
  const promised = ownCity(owner.view).own.buildQueue[0].turns;
  if (promised === null) throw new Error('the queue does not say when the Worker will be done');

  for (let turnsLeft = promised; turnsLeft > 0; turnsLeft--) {
    expect(ownCity(owner.view).own.buildQueue[0].turns).toBe(turnsLeft);
    await endTurn(players);
  }
  // Built, and the queue is empty now: the city builds nothing.
  expect(ownCity(owner.view).own.buildQueue).toEqual([]);
  return ownUnit(owner.view, 'worker');
}
