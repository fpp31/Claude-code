/**
 * Bringing a saved game state of an older layout up to STATE_SCHEMA.
 *
 * Pure, like everything in this package. The server's storage calls
 * migrateGameState when it loads a save whose `schema` is not STATE_SCHEMA
 * (server/src/storage.ts). A step is keyed by the layout it starts FROM and
 * raises the layout by exactly one, so a save that is several versions old
 * walks through every step in turn.
 */

import { cloneJson } from './json';
import { STATE_SCHEMA } from './types';
import type { GameState } from './types';

/** A saved game state of any layout: only `schema` is known for sure. */
type SavedState = { schema: number } & Record<string, unknown>;

/** Keyed by the layout a step starts FROM (the pattern of ROOM_FILE_MIGRATIONS in server/src/storage.ts). */
const STATE_MIGRATIONS: Record<number, (older: SavedState) => SavedState> = {
  1: fromLayout1,
};

/**
 * @param saved  the `game` of a room file, straight from JSON.parse. It has
 *               not been checked: treat every field as unknown.
 * @returns the state at STATE_SCHEMA, as a NEW object (`saved` is not
 *          modified); `saved` itself is not returned even if it is already
 *          at STATE_SCHEMA. null if this code knows no way from the state's
 *          layout to STATE_SCHEMA: a newer layout, a layout older than the
 *          oldest step, or no whole-number `schema` at all.
 * @throws an Error if the state claims a layout this code can convert but
 *         does not have that layout's shape (the save is damaged). The text
 *         is for the server log only.
 */
export function migrateGameState(saved: unknown): GameState | null {
  if (!isRecord(saved) || typeof saved.schema !== 'number' || !Number.isInteger(saved.schema)) return null;
  let state = cloneJson(saved) as SavedState; // the caller's object is never edited
  while (state.schema !== STATE_SCHEMA) {
    const from = state.schema;
    if (!Object.hasOwn(STATE_MIGRATIONS, from)) return null; // newer than this code, or older than its oldest step
    state = STATE_MIGRATIONS[from](state);
    if (state.schema !== from + 1) {
      throw new Error(`migrateGameState: the step from layout ${from} did not give layout ${from + 1}`);
    }
  }
  return state as unknown as GameState;
}

/** Layout 1 (phase 1) -> layout 2. Two parts, in this order; each touches only its own fields. */
function fromLayout1(state: SavedState): SavedState {
  queueFromProduction(state); // the build queue
  addWorkerFields(state); // tiles, units, remembered tiles
  state.schema = 2;
  return state;
}

/**
 * Every city: `production` (one item or null) becomes `buildQueue` (a list
 * with that one item, or an empty list). The city is rebuilt field by field,
 * so nothing but the known fields of layout 2 is carried over.
 */
function queueFromProduction(state: SavedState): void {
  const cities = recordOf(state.cities, 'cities');
  for (const [id, value] of Object.entries(cities)) {
    const city = recordOf(value, `city ${id}`);
    const production = city.production;
    let buildQueue: unknown[];
    if (production === null || production === undefined) buildQueue = [];
    else {
      const item = recordOf(production, `the production of city ${id}`);
      buildQueue = [{ kind: item.kind, unitType: item.unitType }];
    }
    cities[id] = {
      id: city.id,
      owner: city.owner,
      name: city.name,
      tile: city.tile,
      population: city.population,
      foodStored: city.foodStored,
      buildQueue,
      productionStored: city.productionStored,
    };
  }
}

/**
 * A phase 1 game has no improvements and no jobs, so every new field starts
 * as null: every tile gets `improvement: null`, every unit `job: null`,
 * every remembered tile `improvement: null`. Each object is rebuilt field by
 * field, so nothing but the known fields of layout 2 is carried over.
 */
function addWorkerFields(state: SavedState): void {
  const map = recordOf(state.map, 'the map');
  const tiles = listOf(map.tiles, 'the tiles of the map');
  tiles.forEach((value, index) => {
    const tile = recordOf(value, `tile ${index}`);
    tiles[index] = { terrain: tile.terrain, feature: tile.feature, improvement: null, cityId: tile.cityId };
  });

  const units = recordOf(state.units, 'units');
  for (const [id, value] of Object.entries(units)) {
    const unit = recordOf(value, `unit ${id}`);
    units[id] = { id: unit.id, type: unit.type, owner: unit.owner, tile: unit.tile, movesLeft: unit.movesLeft, job: null };
  }

  for (const value of listOf(state.players, 'the players')) {
    const player = recordOf(value, 'a player');
    const knowledge = recordOf(player.knowledge, `what ${String(player.id)} knows`);
    const remembered = recordOf(knowledge.remembered, `what ${String(player.id)} remembers`);
    for (const [key, entry] of Object.entries(remembered)) {
      const seen = recordOf(entry, `remembered tile ${key}`);
      remembered[key] = { owner: seen.owner, city: seen.city, improvement: null };
    }
  }
}

/** True for a plain object (not null, not a list). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `value` as a plain object; throws `migrateGameState: <what> is not an object` otherwise. */
function recordOf(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`migrateGameState: ${what} is not an object`);
  return value;
}

/** `value` as a list; throws `migrateGameState: <what> is not a list` otherwise. */
function listOf(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`migrateGameState: ${what} is not a list`);
  return value;
}
