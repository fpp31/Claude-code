/**
 * Creating a new game (work package WP2).
 */

import { generateMap } from '../mapgen/generateMap';
import type { MapGenerator } from '../mapgen/generateMap';
import type { GameSetup, GameState } from '../types';

/**
 * Builds the initial state of a game.
 *
 * Steps, in this order:
 *  1. `generate(setup.seed, setup.settings.mapSize, setup.players.length)`
 *     gives the map and one start tile per player (seat order).
 *  2. One PlayerState per entry of `setup.players`, in the same order:
 *     endedTurn false, citiesFounded 0, idRng = seedRng(seed, 'ids:' + id),
 *     knowledge with `explored` all 0 and `remembered` empty.
 *  3. For each player in seat order, for each type in RULES.startingUnits in
 *     list order: one unit on the player's start tile with full movement
 *     points, its id from newUnitId. (A Settler and a Warrior may share a
 *     tile: one civilian plus one military.)
 *  4. schema = STATE_SCHEMA, turn = 1, rng = seedRng(seed, 'dice'),
 *     settings = setup.settings, no cities.
 *  5. updateKnowledge(state), so every player has explored what their
 *     starting units can see.
 *
 * Deterministic: the same setup always gives a deep-equal state.
 *
 * Throws an Error (a programming error of the caller, not a player error) if
 * `setup.players` is empty or longer than RULES.maxSeats; if an id is not a
 * seat name (playerIdForSeat(n), n from 1 to RULES.maxSeats: unit and city
 * ids are built from the seat number); if the ids are not in strictly
 * ascending seat order (which also rules out duplicates; gaps such as
 * 'p1', 'p3' are fine); or if the seed is empty. Duplicate civilizations are
 * allowed here; uniqueness is a lobby rule.
 *
 * @param generate  the map generator; tests pass a function that returns a
 *                  hand-made map (see testing/asciiMap.ts) so they do not
 *                  depend on WP1.
 */
export function createGame(setup: GameSetup, generate: MapGenerator = generateMap): GameState {
  throw new Error('not implemented: createGame');
}
