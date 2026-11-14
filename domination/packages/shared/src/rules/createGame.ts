/**
 * Creating a new game (work package WP2).
 */

import { RULES } from '../data/rules';
import { UNITS } from '../data/units';
import { isValidTile, tileCount } from '../hex';
import { newUnitId, playerIdForSeat } from '../ids';
import { cloneJson } from '../json';
import { generateMap } from '../mapgen/generateMap';
import type { MapGenerator } from '../mapgen/generateMap';
import { seedRng } from '../rng';
import { STATE_SCHEMA } from '../types';
import type { GameSetup, GameState, PlayerState } from '../types';
import { updateKnowledge } from '../view/visibility';

/**
 * Builds the initial state of a game.
 *
 * Steps, in this order:
 *  1. `generate(setup.seed, setup.settings.mapSize, setup.players.length)`
 *     gives the map and one start tile per player (seat order). The state
 *     gets its own copy of the map, so it shares nothing with the generator.
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
 * allowed here; uniqueness is a lobby rule. It also throws if the generator
 * breaks its promise: a number of start tiles other than the number of
 * players, or a start tile that is not on the map.
 *
 * @param generate  the map generator; tests pass a function that returns a
 *                  hand-made map (see testing/asciiMap.ts) so they do not
 *                  depend on WP1.
 */
export function createGame(setup: GameSetup, generate: MapGenerator = generateMap): GameState {
  checkSetup(setup);

  // 1. The map and the start tiles. The map is copied, so the new state
  //    shares nothing with whatever the generator may keep or hand out again.
  const generated = generate(setup.seed, setup.settings.mapSize, setup.players.length);
  const map = cloneJson(generated.map);
  const starts = generated.starts;
  if (starts.length !== setup.players.length) {
    throw new Error(
      `createGame: the map generator returned ${starts.length} start tiles for ${setup.players.length} players`,
    );
  }
  for (const start of starts) {
    if (!isValidTile(start, map)) throw new Error(`createGame: start tile ${start} is not on the map`);
  }

  // 2. The players, in seat order.
  const players: PlayerState[] = setup.players.map((entry) => ({
    id: entry.id,
    name: entry.name,
    civ: entry.civ,
    endedTurn: false,
    citiesFounded: 0,
    idRng: seedRng(setup.seed, 'ids:' + entry.id),
    knowledge: { explored: new Array<number>(tileCount(map)).fill(0), remembered: {} },
  }));

  // 4. The rest of the state (built before the units, because a unit's id is
  //    drawn from its owner's id stream inside the state).
  const state: GameState = {
    schema: STATE_SCHEMA,
    seed: setup.seed,
    rng: seedRng(setup.seed, 'dice'),
    settings: { mapSize: setup.settings.mapSize, turnMode: setup.settings.turnMode },
    turn: 1,
    map,
    players,
    units: {},
    cities: {},
  };

  // 3. The starting units.
  players.forEach((player, seatIndex) => {
    for (const type of RULES.startingUnits) {
      const id = newUnitId(state, player.id);
      state.units[id] = { id, type, owner: player.id, tile: starts[seatIndex], movesLeft: UNITS[type].moves };
    }
  });

  // 5. Everybody has seen what their starting units can see.
  updateKnowledge(state);
  return state;
}

/** Throws for a setup the server should never have built (see the doc comment of createGame). */
function checkSetup(setup: GameSetup): void {
  if (typeof setup.seed !== 'string' || setup.seed.length === 0) {
    throw new Error('createGame: the seed must be a non-empty string');
  }
  if (setup.players.length < 1 || setup.players.length > RULES.maxSeats) {
    throw new Error(`createGame: a game needs 1 to ${RULES.maxSeats} players, got ${setup.players.length}`);
  }

  // Walking the seat names in order and requiring every player to come
  // later than the one before covers three rules at once: only seat names,
  // ascending order, no duplicates.
  let lastSeat = 0;
  for (const entry of setup.players) {
    let seat = 0;
    for (let candidate = 1; candidate <= RULES.maxSeats; candidate++) {
      if (playerIdForSeat(candidate) === entry.id) seat = candidate;
    }
    if (seat === 0) {
      throw new Error(
        `createGame: '${entry.id}' is not a seat name (expected ${playerIdForSeat(1)} to ${playerIdForSeat(RULES.maxSeats)})`,
      );
    }
    if (seat <= lastSeat) {
      throw new Error(
        `createGame: player ids must be in ascending seat order without repeats ('${entry.id}' is out of place)`,
      );
    }
    lastSeat = seat;
  }
}
