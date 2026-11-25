/**
 * Health check for a game state (work package WP2).
 */

import { CITY_FOCUS } from '../data/cityFocus';
import { IMPROVEMENTS, improvementFits } from '../data/improvements';
import { RULES } from '../data/rules';
import { FEATURES, TERRAIN, tileMoveCost } from '../data/terrain';
import { UNITS } from '../data/units';
import { distance, isValidTile } from '../hex';
import { playerIdForSeat } from '../ids';
import { STATE_SCHEMA } from '../types';
import type { City, GameState, PlayerId, Unit } from '../types';
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
 *    a tile's `improvement` is null or a known improvement on ground that
 *    suits it (improvementFits);
 *  - at least 1 and at most RULES.maxSeats players, whose ids are seat names
 *    ('p1'..'p8') in ascending seat order, each at most once;
 *  - every unit: key equals id, known type, owner is a player, tile is on the
 *    map and one its domain can enter (a land unit on land, a boat on
 *    water), movesLeft is a whole number from 0 to its type's moves;
 *    `job` is there, and is null or a job for a known improvement with a
 *    whole number of 0 or more turns worked, and for an improvement the
 *    unit's type builds (UNITS[type].improvements);
 *  - stacking: no tile holds two units of the same class, or units of two
 *    different players;
 *  - every city: key equals id, owner is a player, tile is on the map,
 *    population >= 1, foodStored >= 0, productionStored >= 0, the city
 *    tile's `cityId` is this city and the tile carries no improvement, no
 *    other player's unit on the city tile; `focus` is there and is a key of
 *    CITY_FOCUS;
 *  - every city's `buildQueue` is a list of at most RULES.maxQueueLength
 *    entries, each an object with exactly the two fields `kind` ('unit') and
 *    `unitType` (a key of UNITS); no city still carries the field
 *    `production` of layout 1;
 *  - no two cities closer than RULES.minCityDistance;
 *  - every tile's `cityId` is null or the id of an existing city;
 *  - every player's knowledge.explored has one 0/1 entry per tile, and every
 *    tile currently visible to the player (computeVisible) is explored.
 * And a little more: terrain and feature ids are known ones, and every
 * remembered tile is an explored tile of the map whose remembered
 * improvement is null or a known one.
 *
 * NOT checked, on purpose: that the first entry of a queue is affordable;
 * that a queue holds no boat in a city that cannot build one (setBuildQueue
 * keeps it out; in a save edited by hand the entry waits and the player
 * removes it); that a boat's water leads anywhere;
 * that a job's tile is its owner's land (resolveTurn drops such a job, step
 * runJobs); that `turnsWorked` is less than the table's `turns` (the table
 * may be tuned under a running game).
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
    } else if (tile.improvement === undefined) {
      problems.push(`Tile ${index} has no field "improvement".`);
    } else if (tile.improvement !== null && !hasKey(IMPROVEMENTS, tile.improvement)) {
      problems.push(`Tile ${index} has the unknown improvement '${tile.improvement}'.`);
    } else if (tile.improvement !== null && !improvementFits(tile.improvement, tile)) {
      problems.push(`Tile ${index} has a ${tile.improvement} on ground that does not suit it.`);
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
    } else if (hasKey(UNITS, unit.type) && tileMoveCost(state.map.tiles[unit.tile], UNITS[unit.type].domain) === null) {
      problems.push(`Unit ${key} stands on tile ${unit.tile}, which a ${UNITS[unit.type].domain} unit cannot enter.`);
    }

    if (!hasKey(UNITS, unit.type)) {
      problems.push(`Unit ${key} has the unknown type '${unit.type}'.`);
    } else if (!isWholeNumber(unit.movesLeft) || unit.movesLeft < 0 || unit.movesLeft > UNITS[unit.type].moves) {
      problems.push(`Unit ${key} has ${unit.movesLeft} moves left, expected 0 to ${UNITS[unit.type].moves}.`);
    }

    checkJob(key, unit, problems);
  }
}

/** The unit's `job`: there, and null or a job this unit can have (see Unit.job in types.ts). */
function checkJob(key: string, unit: Unit, problems: string[]): void {
  // A state of an older layout, or a hand-edited one, can hold anything here.
  const job: unknown = unit.job;
  if (job === undefined) {
    problems.push(`Unit ${key} has no field "job".`);
    return;
  }
  if (job === null) return;
  if (typeof job !== 'object' || Array.isArray(job)) {
    problems.push(`Unit ${key} has a job that is not an object.`);
    return;
  }
  const fields = job as Record<string, unknown>;
  if (!hasKey(IMPROVEMENTS, fields.improvement)) {
    problems.push(`Unit ${key} has a job for the unknown improvement '${String(fields.improvement)}'.`);
  }
  if (!isWholeNumber(fields.turnsWorked) || fields.turnsWorked < 0) {
    problems.push(`Unit ${key} has worked ${String(fields.turnsWorked)} turns on its job, expected a whole number of 0 or more.`);
  }
  if (hasKey(UNITS, unit.type) && hasKey(IMPROVEMENTS, fields.improvement) && !UNITS[unit.type].improvements.some((id) => id === fields.improvement)) {
    problems.push(`Unit ${key} has a job for a ${String(fields.improvement)}, which a unit of the type '${unit.type}' cannot build.`);
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
    checkBuildQueue(key, city, problems);
    if (!hasKey(CITY_FOCUS, city.focus)) problems.push(`City ${key} has the unknown focus '${String(city.focus)}'.`);

    if (!isValidTile(city.tile, state.map)) {
      problems.push(`City ${key} stands on ${city.tile}, which is not a tile of the map.`);
      continue;
    }
    const center = state.map.tiles[city.tile];
    if (center.cityId !== key) problems.push(`The tile under city ${key} does not belong to it.`);
    if (center.improvement !== null && center.improvement !== undefined) {
      problems.push(`The tile under city ${key} carries an improvement.`);
    }
    for (const unit of Object.values(state.units)) {
      if (unit.tile === city.tile && unit.owner !== city.owner) {
        problems.push(`Unit ${unit.id} of ${unit.owner} stands in city ${key} of ${city.owner}.`);
      }
    }
  }
}

/**
 * The city's build queue (see City.buildQueue in types.ts). Entries are
 * counted from 1 in the sentences, as the city panel numbers its rows.
 */
function checkBuildQueue(key: string, city: City, problems: string[]): void {
  // A state of an older layout, or a hand-edited one, can hold anything here.
  const queue: unknown = city.buildQueue;
  if (!Array.isArray(queue)) {
    problems.push(`City ${key} has a build queue that is not a list.`);
  } else {
    if (queue.length > RULES.maxQueueLength) {
      problems.push(`City ${key} has ${queue.length} entries in its build queue, expected at most ${RULES.maxQueueLength}.`);
    }
    queue.forEach((entry: unknown, index) => {
      if (!isBuildItem(entry)) {
        problems.push(`City ${key} has something in its build queue that does not exist (entry ${index + 1}).`);
      } else if (Object.keys(entry).length !== 2) {
        problems.push(`City ${key} has extra fields on entry ${index + 1} of its build queue.`);
      }
    });
  }
  if (Object.hasOwn(city, 'production')) {
    problems.push(`City ${key} still has the field "production" of an older layout.`);
  }
}

/** Is this something a city can build: an object whose `kind` is 'unit' and whose `unitType` is a real key of UNITS? */
function isBuildItem(entry: unknown): entry is object {
  if (typeof entry !== 'object' || entry === null) return false;
  const fields = entry as Record<string, unknown>;
  return fields.kind === 'unit' && hasKey(UNITS, fields.unitType);
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
    for (const [key, remembered] of Object.entries(player.knowledge.remembered)) {
      const tile = Number(key);
      if (!isValidTile(tile, state.map) || explored[tile] !== 1) {
        problems.push(`Player ${player.id} remembers tile '${key}' without having explored it.`);
      }
      if (remembered.improvement === undefined) {
        problems.push(`Player ${player.id} remembers tile '${key}' without the field "improvement".`);
      } else if (remembered.improvement !== null && !hasKey(IMPROVEMENTS, remembered.improvement)) {
        problems.push(`Player ${player.id} remembers the unknown improvement '${remembered.improvement}' on tile '${key}'.`);
      }
    }
  }
}
