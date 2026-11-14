/**
 * For the server tests that need the REAL rules engine (owned by WP3). Not a
 * test file.
 *
 * Those tests play on a hand-drawn map instead of a generated one, so that
 * each test can say exactly where everybody starts: next to each other for
 * the conflict tests, far apart for the fog-of-war tests.
 */

import { createGame } from '@domination/shared';
import type { PlayerView, TileIndex, UnitTypeId, UnitView } from '@domination/shared';
import { mapFromAscii } from '@domination/shared/testing';
import { realRules } from '../src/rules';
import type { Rules } from '../src/rules';

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
