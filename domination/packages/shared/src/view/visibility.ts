/**
 * Fog of war (work package WP2): what a player sees now, and what they
 * remember.
 */

import { RULES } from '../data/rules';
import { UNITS } from '../data/units';
import { tileCount, tilesInRange } from '../hex';
import { getPlayer } from '../ids';
import { citiesByTile, cityPublic, tileOwner } from '../rules/stateQueries';
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
  getPlayer(state, playerId); // throws for somebody who is not in this game

  const map = state.map;
  const visible: boolean[] = new Array<boolean>(tileCount(map)).fill(false);

  for (const unit of Object.values(state.units)) {
    if (unit.owner !== playerId) continue;
    for (const tile of tilesInRange(unit.tile, UNITS[unit.type].sight, map)) visible[tile] = true;
  }

  for (let tile = 0; tile < map.tiles.length; tile++) {
    if (tileOwner(state, tile) !== playerId) continue;
    for (const near of tilesInRange(tile, RULES.territorySightMargin, map)) visible[near] = true;
  }

  return visible;
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
  // Which city stands on which tile, looked up once for all players.
  const cityOnTile = citiesByTile(state);

  for (const player of state.players) {
    const visible = computeVisible(state, player.id);
    const knowledge = player.knowledge;
    for (let tile = 0; tile < visible.length; tile++) {
      if (!visible[tile]) continue;
      knowledge.explored[tile] = 1;

      const owner = tileOwner(state, tile);
      const city = cityOnTile.get(tile);
      if (owner !== null || city !== undefined) {
        knowledge.remembered[tile] = { owner, city: city === undefined ? null : cityPublic(city) };
      } else {
        delete knowledge.remembered[tile];
      }
    }
  }
}
