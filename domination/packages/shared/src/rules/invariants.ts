/**
 * Health check for a game state (work package WP2).
 */

import { RULES } from '../data/rules';
import { FEATURES, TERRAIN, tileMoveCost } from '../data/terrain';
import { UNITS } from '../data/units';
import { distance, isValidTile } from '../hex';
import { playerIdForSeat } from '../ids';
import { STATE_SCHEMA } from '../types';
import type { GameState, PlayerId } from '../types';
import { computeVisible } from '../view/visibility';

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
 * And a little more: terrain and feature ids are known ones, a city's
 * production item exists, and every remembered tile is an explored tile of
 * the map.
 *
 * A state can be so damaged that a group of checks cannot even be carried
 * out. That is reported as one more sentence ("The state is too damaged to
 * check ...") instead of an exception.
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  for (const check of CHECKS) {
    // A state can be so damaged (a hand-edited save, say) that a check
    // itself trips over it. That is reported as one more problem, because
    // this function promises never to throw.
    try {
      check.run(state, problems);
    } catch {
      problems.push(`The state is too damaged to check ${check.about}.`);
    }
  }
  return problems;
}

/** One group of checks: `run` adds a sentence to `problems` for everything it finds wrong. */
interface Check {
  /** What the group looks at, for the sentence above ("... too damaged to check the units."). */
  about: string;
  run(state: GameState, problems: string[]): void;
}

/** In the order of the list in the doc comment of checkInvariants. */
const CHECKS: readonly Check[] = [
  { about: 'the schema and the turn', run: checkHeader },
  { about: 'the map', run: checkMap },
  { about: 'the players', run: checkPlayers },
  { about: 'the units', run: checkUnits },
  { about: 'how units share tiles', run: checkStacking },
  { about: 'the cities', run: checkCities },
  { about: 'the distances between cities', run: checkCityDistances },
  { about: 'the territory', run: checkTerritory },
  { about: 'what the players have explored', run: checkKnowledge },
];

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** True for a real key of a table or record (and not, say, 'constructor', which every object inherits). */
function hasKey(record: object, key: unknown): boolean {
  return typeof key === 'string' && Object.hasOwn(record, key);
}

function isPlayer(state: GameState, id: unknown): boolean {
  return state.players.some((player) => player.id === id);
}

function checkHeader(state: GameState, problems: string[]): void {
  if (state.schema !== STATE_SCHEMA) problems.push(`The schema is ${state.schema}, expected ${STATE_SCHEMA}.`);
  if (!isWholeNumber(state.turn) || state.turn < 1) {
    problems.push(`The turn is ${state.turn}, expected a whole number of at least 1.`);
  }
}

function checkMap(state: GameState, problems: string[]): void {
  const map = state.map;
  if (map.tiles.length !== map.width * map.height) {
    problems.push(`The map has ${map.tiles.length} tiles, expected ${map.width} x ${map.height}.`);
  }
  map.tiles.forEach((tile, index) => {
    if (!hasKey(TERRAIN, tile.terrain)) {
      problems.push(`Tile ${index} has the unknown terrain '${tile.terrain}'.`);
    } else if (tile.feature !== null && !hasKey(FEATURES, tile.feature)) {
      problems.push(`Tile ${index} has the unknown feature '${tile.feature}'.`);
    } else if (tile.feature !== null && !FEATURES[tile.feature].allowedOn.includes(tile.terrain)) {
      problems.push(`Tile ${index} has ${tile.feature} on ${tile.terrain}, which is not allowed.`);
    }
  });
}

function checkPlayers(state: GameState, problems: string[]): void {
  const count = state.players.length;
  if (count < 1 || count > RULES.maxSeats) {
    problems.push(`The game has ${count} players, expected 1 to ${RULES.maxSeats}.`);
  }

  // Each player must sit on a later seat than the one before: that covers
  // "seat names only", "ascending order" and "each at most once" together.
  let lastSeat = 0;
  for (const player of state.players) {
    let seat = 0;
    for (let candidate = 1; candidate <= RULES.maxSeats; candidate++) {
      if (playerIdForSeat(candidate) === player.id) seat = candidate;
    }
    if (seat === 0) problems.push(`Player id '${player.id}' is not a seat name.`);
    else if (seat <= lastSeat) problems.push(`Player ${player.id} is out of seat order or listed twice.`);
    if (seat > lastSeat) lastSeat = seat;
  }
}

function checkUnits(state: GameState, problems: string[]): void {
  for (const [key, unit] of Object.entries(state.units)) {
    if (unit.id !== key) problems.push(`Unit '${key}' carries the id '${unit.id}'.`);
    if (!isPlayer(state, unit.owner)) problems.push(`Unit ${key} belongs to '${unit.owner}', who is not a player.`);

    if (!isValidTile(unit.tile, state.map)) {
      problems.push(`Unit ${key} stands on ${unit.tile}, which is not a tile of the map.`);
    } else if (tileMoveCost(state.map.tiles[unit.tile]) === null) {
      problems.push(`Unit ${key} stands on tile ${unit.tile}, which land units cannot enter.`);
    }

    if (!hasKey(UNITS, unit.type)) {
      problems.push(`Unit ${key} has the unknown type '${unit.type}'.`);
    } else if (!isWholeNumber(unit.movesLeft) || unit.movesLeft < 0 || unit.movesLeft > UNITS[unit.type].moves) {
      problems.push(`Unit ${key} has ${unit.movesLeft} moves left, expected 0 to ${UNITS[unit.type].moves}.`);
    }
  }
}

function checkStacking(state: GameState, problems: string[]): void {
  // What already stands on each tile: whose units, and of which classes.
  const seen = new Map<number, { owner: PlayerId; classes: Set<string> }>();
  for (const unit of Object.values(state.units)) {
    if (!hasKey(UNITS, unit.type)) continue; // reported by checkUnits
    const unitClass = UNITS[unit.type].unitClass;
    const here = seen.get(unit.tile);
    if (here === undefined) {
      seen.set(unit.tile, { owner: unit.owner, classes: new Set([unitClass]) });
      continue;
    }
    if (here.owner !== unit.owner) problems.push(`Tile ${unit.tile} holds units of two players.`);
    if (here.classes.has(unitClass)) problems.push(`Tile ${unit.tile} holds two ${unitClass} units.`);
    here.classes.add(unitClass);
  }
}

function checkCities(state: GameState, problems: string[]): void {
  for (const [key, city] of Object.entries(state.cities)) {
    if (city.id !== key) problems.push(`City '${key}' carries the id '${city.id}'.`);
    if (!isPlayer(state, city.owner)) problems.push(`City ${key} belongs to '${city.owner}', who is not a player.`);
    if (!isWholeNumber(city.population) || city.population < 1) {
      problems.push(`City ${key} has population ${city.population}, expected at least 1.`);
    }
    if (!isWholeNumber(city.foodStored) || city.foodStored < 0) {
      problems.push(`City ${key} has ${city.foodStored} food stored, expected 0 or more.`);
    }
    if (!isWholeNumber(city.productionStored) || city.productionStored < 0) {
      problems.push(`City ${key} has ${city.productionStored} production stored, expected 0 or more.`);
    }
    if (city.production !== null && (city.production.kind !== 'unit' || !hasKey(UNITS, city.production.unitType))) {
      problems.push(`City ${key} is building something that does not exist.`);
    }

    if (!isValidTile(city.tile, state.map)) {
      problems.push(`City ${key} stands on ${city.tile}, which is not a tile of the map.`);
      continue;
    }
    if (state.map.tiles[city.tile].cityId !== key) problems.push(`The tile under city ${key} does not belong to it.`);
    for (const unit of Object.values(state.units)) {
      if (unit.tile === city.tile && unit.owner !== city.owner) {
        problems.push(`Unit ${unit.id} of ${unit.owner} stands in city ${key} of ${city.owner}.`);
      }
    }
  }
}

function checkCityDistances(state: GameState, problems: string[]): void {
  const cities = Object.values(state.cities).filter((city) => isValidTile(city.tile, state.map));
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const apart = distance(cities[i].tile, cities[j].tile, state.map);
      if (apart < RULES.minCityDistance) {
        problems.push(
          `Cities ${cities[i].id} and ${cities[j].id} are ${apart} tiles apart, expected at least ${RULES.minCityDistance}.`,
        );
      }
    }
  }
}

function checkTerritory(state: GameState, problems: string[]): void {
  state.map.tiles.forEach((tile, index) => {
    if (tile.cityId !== null && !hasKey(state.cities, tile.cityId)) {
      problems.push(`Tile ${index} belongs to city '${tile.cityId}', which does not exist.`);
    }
  });
}

function checkKnowledge(state: GameState, problems: string[]): void {
  const tileTotal = state.map.tiles.length;
  for (const player of state.players) {
    const explored = player.knowledge.explored;
    if (explored.length !== tileTotal) {
      problems.push(`Player ${player.id} has ${explored.length} explored entries for ${tileTotal} tiles.`);
      continue;
    }
    if (explored.some((entry) => entry !== 0 && entry !== 1)) {
      problems.push(`Player ${player.id} has an explored entry that is neither 0 nor 1.`);
    }
    const visible = computeVisible(state, player.id);
    const unexplored = visible.filter((inSight, tile) => inSight && explored[tile] !== 1).length;
    if (unexplored > 0) {
      problems.push(`Player ${player.id} can see ${unexplored} tiles that are not marked as explored.`);
    }
    // A memory of a tile the player has never seen would be a contradiction.
    for (const key of Object.keys(player.knowledge.remembered)) {
      const tile = Number(key);
      if (!isValidTile(tile, state.map) || explored[tile] !== 1) {
        problems.push(`Player ${player.id} remembers tile '${key}' without having explored it.`);
      }
    }
  }
}
