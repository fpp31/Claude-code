/**
 * Fog of war (work package WP2): what a player sees now, and what they
 * remember.
 */

import type { GameState, PlayerId } from '../types';

/**
 * Which tiles are in the player's sight right now: one boolean per tile.
 * Derived from the state every time; never stored.
 *
 * A tile is visible if at least one of these holds:
 *  - it is within UNITS[type].sight tiles of one of the player's units
 *    (plain hex distance; nothing blocks sight in phase 1);
 *  - it belongs to one of the player's cities (`cityId`), or is within
 *    RULES.territorySightMargin tiles of such a tile. So a player always
 *    sees everything they own plus one ring around it.
 *
 * Pure. Throws if `playerId` is not a player of the game.
 */
export function computeVisible(state: GameState, playerId: PlayerId): boolean[] {
  throw new Error('not implemented: computeVisible');
}

/**
 * Brings every player's memory up to date with what they can see now.
 * MUTATES `state` (it is called by the engine on its working copy): after
 * every step of a move, after every other change, and at the end of turn
 * resolution.
 *
 * For each player and each tile visible to them (computeVisible):
 *  - knowledge.explored[tile] = 1;
 *  - if the tile has an owner or a city on it, knowledge.remembered[tile] =
 *    { owner: the tile's current owner (player id, or null),
 *      city: the CityPublic of the city standing on the tile, or null };
 *  - otherwise delete knowledge.remembered[tile].
 * Tiles that are not visible are left alone: that is exactly "as last seen".
 * Units are never remembered.
 */
export function updateKnowledge(state: GameState): void {
  throw new Error('not implemented: updateKnowledge');
}
