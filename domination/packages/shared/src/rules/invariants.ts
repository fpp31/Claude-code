/**
 * Health check for a game state (work package WP2).
 */

import type { GameState } from '../types';

/**
 * Looks for things that must never be true in a game state and returns one
 * plain-English sentence per problem found. An empty list means healthy.
 * Never throws and never changes the state.
 *
 * Used by tests after every action of the random-play tests, and by the
 * server when it loads a save (problems are logged as warnings).
 *
 * It checks at least:
 *  - schema is STATE_SCHEMA; turn is a whole number >= 1;
 *  - map.tiles.length is width * height; features only on allowed grounds;
 *  - at least 1 and at most RULES.maxSeats players, whose ids are seat names
 *    ('p1'..'p8') in ascending seat order, each at most once;
 *  - every unit: key equals id, known type, owner is a player, tile is on the
 *    map and passable, movesLeft is a whole number from 0 to its type's moves;
 *  - stacking: no tile holds two units of the same class, or units of two
 *    different players;
 *  - every city: key equals id, owner is a player, tile is on the map,
 *    population >= 1, foodStored >= 0, productionStored >= 0, the city
 *    tile's `cityId` is this city, no other player's unit on the city tile;
 *  - no two cities closer than RULES.minCityDistance;
 *  - every tile's `cityId` is null or the id of an existing city;
 *  - every player's knowledge.explored has one 0/1 entry per tile, and every
 *    tile currently visible to the player (computeVisible) is explored.
 */
export function checkInvariants(state: GameState): string[] {
  throw new Error('not implemented: checkInvariants');
}
