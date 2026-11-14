/**
 * Ids for players, units and cities.
 *
 * Player ids are seat names: 'p1' for the first seat up to 'p8'.
 *
 * Unit and city ids look like 'u3_k7m2qd' and 'c3_p9xw3a': a letter for the
 * kind, the seat number of the player who created it, an underscore and six
 * random characters drawn from THAT PLAYER'S private id stream
 * (PlayerState.idRng). They are random and per player on purpose:
 *  - a counter shared by everybody would tell you how much the others built;
 *  - a random stream shared by everybody would make your next id depend on
 *    what the others did out of your sight.
 * With one stream per player and the seat number in the id, the ids a player
 * receives depend on nothing but that player's own actions.
 */

import { nextInt } from './rng';
import type { CityId, GameState, PlayerId, PlayerState, UnitId } from './types';

/** Characters used in the random part of an id (lower case, no look-alikes such as l/1 or o/0). */
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const ID_RANDOM_LENGTH = 6;

/** Seat number (1..8) -> player id ('p1'..'p8'). */
export function playerIdForSeat(seat: number): PlayerId {
  return `p${seat}`;
}

/**
 * Player id ('p1'..'p8') -> seat number (1..8).
 *
 * Throws for anything that is not 'p' followed by a seat number (for example
 * 'alice' in a test fixture). Without this check such an id would quietly
 * produce unit ids like 'uNaN_k7m2qd'.
 */
export function seatOfPlayer(playerId: PlayerId): number {
  if (!/^p[1-9][0-9]*$/.test(playerId)) {
    throw new Error(`seatOfPlayer: '${playerId}' is not a player id (expected 'p1', 'p2', ...)`);
  }
  return Number(playerId.slice(1));
}

/** Finds a player in the state. Throws if there is no such player (that is a programming error). */
export function getPlayer(state: GameState, playerId: PlayerId): PlayerState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`getPlayer: no player ${playerId} in this game`);
  return player;
}

/** Draws the six random characters from the player's id stream (advancing it). */
function randomPart(player: PlayerState): string {
  let text = '';
  for (let i = 0; i < ID_RANDOM_LENGTH; i++) {
    text += ID_ALPHABET[nextInt(player.idRng, ID_ALPHABET.length)];
  }
  return text;
}

/**
 * Makes the id for a new unit created by `playerId`. Advances that player's
 * id stream, so call it only on the engine's working copy of the state. The
 * caller adds the unit to `state.units` under the returned id.
 */
export function newUnitId(state: GameState, playerId: PlayerId): UnitId {
  const player = getPlayer(state, playerId);
  const prefix = `u${seatOfPlayer(playerId)}_`;
  let id = prefix + randomPart(player);
  // A repeat within one player's own ids is almost impossible, but cheap to rule out.
  while (id in state.units) id = prefix + randomPart(player);
  return id;
}

/**
 * Makes the id for a new city founded by `playerId`. Same rules as newUnitId;
 * the caller adds the city to `state.cities` under the returned id.
 */
export function newCityId(state: GameState, playerId: PlayerId): CityId {
  const player = getPlayer(state, playerId);
  const prefix = `c${seatOfPlayer(playerId)}_`;
  let id = prefix + randomPart(player);
  while (id in state.cities) id = prefix + randomPart(player);
  return id;
}
