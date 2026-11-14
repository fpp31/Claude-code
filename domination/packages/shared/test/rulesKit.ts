/**
 * Helpers for the rules and visibility tests (work package WP2).
 *
 * They build small hand-drawn worlds, push actions through the real
 * `applyAction`, and make two promises on every call so that no single test
 * can forget them:
 *  - the state handed to the engine is DEEP-FROZEN first, so an engine that
 *    edited its input would crash the test on the spot (purity);
 *  - every state that comes back passes `checkInvariants`.
 *
 * This is not a test file (its name does not end in .test.ts).
 */

import { expect } from 'vitest';
import {
  UNITS,
  applyAction,
  checkInvariants,
  cloneJson,
  createGame,
  neighborInDirection,
  tileIndex,
  updateKnowledge,
} from '../src/index';
import type {
  Action,
  ActionResult,
  AddressedEvent,
  City,
  CivId,
  GameSetup,
  GameState,
  GridSize,
  MapGenerator,
  PlayerId,
  RuleErrorCode,
  TileIndex,
  Unit,
  UnitTypeId,
} from '../src/index';
import { mapFromAscii } from '../src/testing';

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

/**
 * A plain meadow, 16 x 11, with water all around. Odd rows are drawn one
 * space to the right, as they sit on the real hex map.
 */
export const MEADOW: readonly string[] = [
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ' ~ g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g ~',
  '~ g g g g g g g g g g g g g g ~',
  ' ~ g g g g g g g g g g g g g g ~',
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
];

/** The tile in column `x` of row `y` (both counted from 0, as in the drawings). */
export function at(size: GridSize, x: number, y: number): TileIndex {
  return tileIndex({ x, y }, size);
}

/** The six directions by name (the numbers are the direction indexes of hex.ts). */
export const EAST = 0;
export const SOUTH_EAST = 1;
export const SOUTH_WEST = 2;
export const WEST = 3;
export const NORTH_WEST = 4;
export const NORTH_EAST = 5;

/** The tile one step from `tile` in a direction. Throws if that is off the map, so a test cannot walk off by accident. */
export function stepFrom(size: GridSize, tile: TileIndex, direction: number): TileIndex {
  const next = neighborInDirection(tile, direction, size);
  if (next === null) throw new Error(`stepFrom: tile ${tile} has no neighbor in direction ${direction}`);
  return next;
}

// ---------------------------------------------------------------------------
// Creating games on hand-drawn maps
// ---------------------------------------------------------------------------

/** Up to six players, in seat order, each with another civilization. */
export const SIX_PLAYERS: readonly { id: PlayerId; name: string; civ: CivId }[] = [
  { id: 'p1', name: 'Ada', civ: 'rome' },
  { id: 'p2', name: 'Ben', civ: 'egypt' },
  { id: 'p3', name: 'Cleo', civ: 'china' },
  { id: 'p4', name: 'Dana', civ: 'mali' },
  { id: 'p5', name: 'Emil', civ: 'maya' },
  { id: 'p6', name: 'Freya', civ: 'norse' },
];

/** A map generator that ignores its arguments and returns the drawn map with the given start tiles. */
export function fixedMapGenerator(rows: readonly string[], starts: readonly [x: number, y: number][]): MapGenerator {
  return () => {
    const map = mapFromAscii(rows);
    return { map, starts: starts.map(([x, y]) => at(map, x, y)) };
  };
}

/** The setup for the first `playerCount` of SIX_PLAYERS. */
export function setupFor(playerCount: number, seed = 'test-seed'): GameSetup {
  return {
    seed,
    settings: { mapSize: 'small', turnMode: 'simultaneous' },
    players: SIX_PLAYERS.slice(0, playerCount).map((player) => ({ ...player })),
  };
}

/**
 * A new game on a drawn map: one player per start tile (p1, p2, ... in the
 * order of `starts`), each with the usual Settler and Warrior there.
 */
export function newGame(
  rows: readonly string[],
  starts: readonly [x: number, y: number][],
  seed = 'test-seed',
): GameState {
  const state = createGame(setupFor(starts.length, seed), fixedMapGenerator(rows, starts));
  expect(checkInvariants(state)).toEqual([]);
  return state;
}

// ---------------------------------------------------------------------------
// Freezing (the purity check)
// ---------------------------------------------------------------------------

/**
 * Freezes a JSON value and everything inside it, and returns it. Writing to
 * a frozen object throws a TypeError in module code, so code that edits a
 * frozen state fails loudly instead of quietly.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const inner of Object.values(value)) deepFreeze(inner);
  return value;
}

// ---------------------------------------------------------------------------
// Sending actions
// ---------------------------------------------------------------------------

/**
 * Sends one action through the real engine, in the state's current turn.
 * The input is deep-frozen first. A returned state must pass the invariants.
 */
export function send(state: GameState, playerId: PlayerId, action: Action, turn: number = state.turn): ActionResult {
  const result = applyAction(deepFreeze(state), playerId, turn, action);
  if (result.ok) expect(checkInvariants(result.state)).toEqual([]);
  return result;
}

/** Sends an action that the test expects to be ACCEPTED, and returns the new state. */
export function act(state: GameState, playerId: PlayerId, action: Action): GameState {
  return actWithEvents(state, playerId, action).state;
}

/** Like `act`, and also hands back the events (with their audiences). */
export function actWithEvents(
  state: GameState,
  playerId: PlayerId,
  action: Action,
): { state: GameState; events: AddressedEvent[]; changed: boolean } {
  const result = send(state, playerId, action);
  if (!result.ok) throw new Error(`expected ${action.type} of ${playerId} to be accepted, got ${result.error.code}`);
  return { state: result.state, events: result.events, changed: result.changed };
}

/** The error code of a rejected action, or null if it was accepted. Tests compare codes, never messages. */
export function codeOf(result: ActionResult): RuleErrorCode | null {
  return result.ok ? null : result.error.code;
}

/** Sends an action and returns only its error code (null = accepted). */
export function refusal(state: GameState, playerId: PlayerId, action: Action): RuleErrorCode | null {
  return codeOf(send(state, playerId, action));
}

/** Every player who has not ended the turn does so, in seat order; the last one resolves the turn. */
export function endTurnForAll(state: GameState): { state: GameState; events: AddressedEvent[] } {
  let current = state;
  let events: AddressedEvent[] = [];
  for (const player of state.players) {
    if (player.endedTurn) continue;
    const step = actWithEvents(current, player.id, { type: 'endTurn' });
    current = step.state;
    events = step.events;
  }
  expect(current.turn).toBe(state.turn + 1);
  return { state: current, events };
}

// ---------------------------------------------------------------------------
// Looking things up
// ---------------------------------------------------------------------------

/** The player's units of one type, in creation order. */
export function unitsOf(state: GameState, playerId: PlayerId, type?: UnitTypeId): Unit[] {
  return Object.values(state.units).filter(
    (unit) => unit.owner === playerId && (type === undefined || unit.type === type),
  );
}

/** The player's only unit of that type. Throws if there is none or more than one, so a test cannot pick the wrong one. */
export function unitOf(state: GameState, playerId: PlayerId, type: UnitTypeId): Unit {
  const found = unitsOf(state, playerId, type);
  if (found.length !== 1) throw new Error(`expected exactly one ${type} of ${playerId}, found ${found.length}`);
  return found[0];
}

/** The player's cities, in founding order. */
export function citiesOf(state: GameState, playerId: PlayerId): City[] {
  return Object.values(state.cities).filter((city) => city.owner === playerId);
}

/** The city standing on a tile. Throws if there is none. */
export function cityOn(state: GameState, tile: TileIndex): City {
  const found = Object.values(state.cities).find((city) => city.tile === tile);
  if (found === undefined) throw new Error(`expected a city on tile ${tile}`);
  return found;
}

// ---------------------------------------------------------------------------
// Arranging a situation (the test's back door)
// ---------------------------------------------------------------------------

/**
 * A changed copy of a state, for arranging a situation that would take many
 * turns to reach by playing. The change is made directly on a copy; then the
 * fog-of-war memory is brought up to date and the result must be a healthy
 * state, so a test can never continue from something the game could not be in.
 */
export function arrange(state: GameState, change: (draft: GameState) => void): GameState {
  const draft = cloneJson(state);
  change(draft);
  updateKnowledge(draft);
  expect(checkInvariants(draft)).toEqual([]);
  return draft;
}

/**
 * A changed copy with NOTHING else done to it: no memory update, no health
 * check. For the no-leak tests, which change hidden things on purpose and
 * then ask whether a view noticed.
 */
export function tamper(state: GameState, change: (draft: GameState) => void): GameState {
  const draft = cloneJson(state);
  change(draft);
  return draft;
}

/**
 * Puts an extra unit on the map, with full moves unless told otherwise.
 * Use inside `arrange`. The id is made up by the test ('u2_extra1'): it has
 * the right prefix for its owner and can never clash with an engine id,
 * whose random part is exactly six characters long.
 */
export function placeUnit(
  draft: GameState,
  owner: PlayerId,
  type: UnitTypeId,
  tile: TileIndex,
  movesLeft: number = UNITS[type].moves,
): Unit {
  let number = 1;
  while (`u${owner.slice(1)}_extra${number}` in draft.units) number += 1;
  const id = `u${owner.slice(1)}_extra${number}`;
  const unit: Unit = { id, type, owner, tile, movesLeft };
  draft.units[id] = unit;
  return unit;
}

/**
 * Founds a city for `owner` on `tile` with the REAL foundCity action: a
 * settler is placed there by the back door and then asked to settle. All
 * founding rules therefore apply (ground, distance, ownership).
 */
export function foundCityAt(state: GameState, owner: PlayerId, tile: TileIndex): GameState {
  let settlerId = '';
  const ready = arrange(state, (draft) => {
    settlerId = placeUnit(draft, owner, 'settler', tile).id;
  });
  return act(ready, owner, { type: 'foundCity', unitId: settlerId });
}
