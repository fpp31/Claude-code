/**
 * A second, independent fog of war, for the no-leak tests (work package
 * WP2). Not a test file.
 *
 * The oracle follows a game from the outside and keeps its own books on
 * what every player has seen. `viewProblems` then compares a view with
 * those books, item by item. It is written by hand from the description in
 * viewTypes.ts and shares no code with src/view/: it does not call
 * computeVisible, updateKnowledge or buildPlayerView, and it does not read
 * the players' stored knowledge. Sight is found by a different method, too:
 * it spreads outwards step by step from every unit and every owned tile
 * (the engine measures distances instead).
 *
 * If the engine and this oracle agree after every step of long random
 * games, a view contains exactly what its player is entitled to: nothing
 * about tiles never seen, no units out of sight, nothing newer than "last
 * seen" on fogged tiles.
 */

import { RULES, UNITS, jsonEqual, neighbors } from '../src/index';
import type {
  AddressedEvent,
  CityPublic,
  GameState,
  ImprovementId,
  PlayerId,
  PlayerView,
  TileIndex,
  TileView,
  UnitTypeId,
} from '../src/index';

/** What stood on a tile when a player last had it in sight. */
interface SeenTile {
  owner: PlayerId | null;
  city: CityPublic | null;
  improvement: ImprovementId | null;
}

export interface Oracle {
  /** Per player: has the tile ever been in sight? */
  everSeen: Map<PlayerId, boolean[]>;
  /** Per player and tile: owner, city and improvement as they were when the tile was last in sight. */
  lastSeen: Map<PlayerId, Map<TileIndex, SeenTile>>;
}

/** Every tile within `radius` steps of the `sources`, found by spreading out one step at a time. */
function spread(state: GameState, sources: TileIndex[], radius: number, into: boolean[]): void {
  let frontier = sources;
  const reached = new Set<TileIndex>(sources);
  for (const tile of sources) into[tile] = true;
  for (let step = 0; step < radius; step++) {
    const next: TileIndex[] = [];
    for (const tile of frontier) {
      for (const neighbor of neighbors(tile, state.map)) {
        if (reached.has(neighbor)) continue;
        reached.add(neighbor);
        into[neighbor] = true;
        next.push(neighbor);
      }
    }
    frontier = next;
  }
}

/** The owner of a tile, the city on it and what is built on it, read straight from the truth. */
function truthOn(state: GameState, tile: TileIndex): SeenTile {
  const cityId = state.map.tiles[tile].cityId;
  const owner = cityId === null ? null : state.cities[cityId].owner;
  const standing = Object.values(state.cities).find((city) => city.tile === tile);
  const city =
    standing === undefined
      ? null
      : { id: standing.id, owner: standing.owner, name: standing.name, tile: standing.tile, population: standing.population };
  return { owner, city, improvement: state.map.tiles[tile].improvement };
}

/** Which tiles the player has in sight right now, according to the oracle. */
export function inSight(state: GameState, playerId: PlayerId): boolean[] {
  const visible: boolean[] = state.map.tiles.map(() => false);
  for (const unit of Object.values(state.units)) {
    if (unit.owner === playerId) spread(state, [unit.tile], UNITS[unit.type].sight, visible);
  }
  const ownLand: TileIndex[] = [];
  state.map.tiles.forEach((_, tile) => {
    if (truthOn(state, tile).owner === playerId) ownLand.push(tile);
  });
  spread(state, ownLand, RULES.territorySightMargin, visible);
  return visible;
}

/** Books for a game that starts in `state` (normally the result of createGame). */
export function startOracle(state: GameState): Oracle {
  const oracle: Oracle = { everSeen: new Map(), lastSeen: new Map() };
  for (const player of state.players) {
    oracle.everSeen.set(player.id, state.map.tiles.map(() => false));
    oracle.lastSeen.set(player.id, new Map());
  }
  observe(oracle, state, []);
  return oracle;
}

function note(oracle: Oracle, state: GameState, playerId: PlayerId, visible: boolean[]): void {
  const seen = oracle.everSeen.get(playerId) as boolean[];
  const memory = oracle.lastSeen.get(playerId) as Map<TileIndex, SeenTile>;
  visible.forEach((isVisible, tile) => {
    if (!isVisible) return;
    seen[tile] = true;
    memory.set(tile, truthOn(state, tile));
  });
}

/**
 * Brings the books up to date after an accepted action. `after` is the new
 * state and `events` what the engine reported (with audiences: the oracle
 * stands on the server's side).
 *
 * A unit also sees from every tile it passes. Those tiles are in the
 * 'unitMoved' event; owners, cities and improvements do not change during a
 * move, so what the unit saw on the way is what `after` shows there.
 */
export function observe(oracle: Oracle, after: GameState, events: AddressedEvent[]): void {
  for (const { event } of events) {
    if (event.type !== 'unitMoved') continue;
    const type: UnitTypeId = after.units[event.unitId].type;
    const passed: boolean[] = after.map.tiles.map(() => false);
    for (const tile of event.path) spread(after, [tile], UNITS[type].sight, passed);
    note(oracle, after, event.playerId, passed);
  }
  for (const player of after.players) note(oracle, after, player.id, inSight(after, player.id));
}

/**
 * Everything that is wrong with `view` as the view of `playerId` on `state`,
 * one sentence per finding. An empty list means the view shows exactly what
 * the oracle's books allow, no more and no less.
 */
export function viewProblems(oracle: Oracle, state: GameState, playerId: PlayerId, view: PlayerView): string[] {
  const problems: string[] = [];
  const visible = inSight(state, playerId);
  const seen = oracle.everSeen.get(playerId) as boolean[];
  const memory = oracle.lastSeen.get(playerId) as Map<TileIndex, SeenTile>;
  const expectEqual = (what: string, actual: unknown, expected: unknown): void => {
    if (!jsonEqual(actual, expected)) {
      problems.push(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  expectEqual('you', view.you, playerId);
  expectEqual('turn', view.turn, state.turn);
  expectEqual('size', [view.width, view.height, view.tiles.length], [state.map.width, state.map.height, state.map.tiles.length]);

  // Tiles: unknown, in sight (the truth), or fogged (as last seen).
  state.map.tiles.forEach((tile, index) => {
    let expected: TileView | null = null;
    if (seen[index]) {
      // In sight: the truth. Fogged: what the books say was there when the tile was last in sight.
      const shown = visible[index] ? truthOn(state, index) : memory.get(index);
      expected = {
        terrain: tile.terrain,
        feature: tile.feature,
        improvement: shown === undefined ? null : shown.improvement,
        owner: shown === undefined ? null : shown.owner,
        visible: visible[index],
      };
    }
    expectEqual(`tile ${index}`, view.tiles[index], expected);
  });

  // Units: the player's own, and other players' units on tiles in sight. Nothing else.
  const expectedUnits = Object.values(state.units)
    .filter((unit) => unit.owner === playerId || visible[unit.tile])
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  expectEqual('unit ids', view.units.map((unit) => unit.id), expectedUnits.map((unit) => unit.id));
  for (const unit of expectedUnits) {
    const shown = view.units.find((candidate) => candidate.id === unit.id);
    if (shown === undefined) continue; // reported above
    if (unit.owner === playerId) {
      expectEqual(`own unit ${unit.id}`, { ...shown, own: null }, { id: unit.id, type: unit.type, owner: unit.owner, tile: unit.tile, own: null });
      expectEqual(`moves of own unit ${unit.id}`, shown.own?.movesLeft, unit.movesLeft);
      // The owner is told what the unit is building and how far it has got.
      const job = shown.own === null || shown.own.job === null ? null : shown.own.job;
      expectEqual(
        `job of own unit ${unit.id}`,
        job === null ? null : { improvement: job.improvement, turnsWorked: job.turnsWorked },
        unit.job,
      );
    } else {
      expectEqual(`foreign unit ${unit.id}`, shown, { id: unit.id, type: unit.type, owner: unit.owner, tile: unit.tile, own: null });
    }
  }

  // Cities: the player's own, others in sight (the truth), others on fogged tiles (as last seen).
  const expectedCities: { id: string; own: boolean; public: unknown }[] = [];
  for (const city of Object.values(state.cities)) {
    const facts = truthOn(state, city.tile).city;
    if (city.owner === playerId) expectedCities.push({ id: city.id, own: true, public: { ...facts, visible: true, own: null } });
    else if (visible[city.tile]) expectedCities.push({ id: city.id, own: false, public: { ...facts, visible: true, own: null } });
  }
  for (const [tile, remembered] of memory) {
    if (visible[tile] || remembered.city === null) continue;
    expectedCities.push({ id: remembered.city.id, own: false, public: { ...remembered.city, visible: false, own: null } });
  }
  expectedCities.sort((a, b) => (a.id < b.id ? -1 : 1));
  expectEqual('city ids', view.cities.map((city) => city.id), expectedCities.map((city) => city.id));
  for (const expected of expectedCities) {
    const shown = view.cities.find((candidate) => candidate.id === expected.id);
    if (shown === undefined) continue; // reported above
    if (expected.own) {
      expectEqual(`own city ${expected.id}`, { ...shown, own: null }, expected.public);
      if (shown.own === null) problems.push(`own city ${expected.id} has no details`);
    } else {
      expectEqual(`foreign city ${expected.id}`, shown, expected.public);
    }
  }

  // Players: the public four fields, in seat order.
  expectEqual(
    'players',
    view.players,
    state.players.map((player) => ({ id: player.id, name: player.name, civ: player.civ, endedTurn: player.endedTurn })),
  );

  return problems;
}
