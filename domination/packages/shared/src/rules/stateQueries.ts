/**
 * Small read-only questions about a game state that several files of the
 * rules engine and the view builder ask (work package WP2).
 *
 * Internal: this file is not part of the package's public exports
 * (index.ts), so the server and the client cannot come to depend on it.
 * Nothing here changes the state.
 */

import type { City, CityId, CityPublic, GameState, PlayerId, TileIndex, Unit, UnitId } from '../types';

/**
 * The player whose city owns the tile, or null if nobody does. Also null
 * for a `cityId` that names no city: a damaged save must not crash the fog
 * of war (checkInvariants reports it instead).
 */
export function tileOwner(state: GameState, tile: TileIndex): PlayerId | null {
  const cityId = state.map.tiles[tile].cityId;
  if (cityId === null) return null;
  const city = cityById(state, cityId);
  return city === null ? null : city.owner;
}

/** Every tile that belongs to the city (`cityId`), its centre included, in ascending tile order. */
export function tilesOfCity(state: GameState, cityId: CityId): TileIndex[] {
  const owned: TileIndex[] = [];
  for (let tile = 0; tile < state.map.tiles.length; tile++) {
    if (state.map.tiles[tile].cityId === cityId) owned.push(tile);
  }
  return owned;
}

/** Which city stands on which tile (the city centres only), for callers that look at many tiles. */
export function citiesByTile(state: GameState): Map<TileIndex, City> {
  const byTile = new Map<TileIndex, City>();
  for (const city of Object.values(state.cities)) byTile.set(city.tile, city);
  return byTile;
}

/**
 * The facts about a city that anybody who sees it may know, as a fresh
 * object built field by field. Never a copy of the City, which also holds
 * its owner's private numbers.
 */
export function cityPublic(city: City): CityPublic {
  return { id: city.id, owner: city.owner, name: city.name, tile: city.tile, population: city.population };
}

/**
 * The unit with this id, or null. Ids arrive from clients, so the lookup
 * only accepts the state's own keys: a made-up id such as 'constructor'
 * finds nothing instead of something inherited from every JavaScript object.
 */
export function unitById(state: GameState, unitId: UnitId): Unit | null {
  return Object.hasOwn(state.units, unitId) ? state.units[unitId] : null;
}

/** The city with this id, or null. Same care as unitById. */
export function cityById(state: GameState, cityId: CityId): City | null {
  return Object.hasOwn(state.cities, cityId) ? state.cities[cityId] : null;
}

/** The player's units, in creation order. */
export function unitsOfPlayer(state: GameState, playerId: PlayerId): Unit[] {
  return Object.values(state.units).filter((unit) => unit.owner === playerId);
}

/** The player's cities, in founding order. */
export function citiesOfPlayer(state: GameState, playerId: PlayerId): City[] {
  return Object.values(state.cities).filter((city) => city.owner === playerId);
}
