/**
 * Ready-made situations for the fog-of-war tests (work package WP2).
 * Not a test file.
 */

import type { City, GameState } from '../src/index';
import { MEADOW, act, arrange, at, cityOn, endTurnForAll, newGame, placeUnit, stepFrom, unitOf } from './rulesKit';
import { EAST, WEST } from './rulesKit';

/** Two players on the meadow: p1 at (3,5), p2 at (12,5), nine tiles apart and out of each other's sight. */
export function meadowGame(): GameState {
  return newGame(MEADOW, [[3, 5], [12, 5]]);
}

export interface BorderScene {
  state: GameState;
  /** p1's city at (3,5). */
  rome: City;
  /** p2's city at (12,5). */
  thebes: City;
  /** p1's scout. */
  scoutId: string;
}

/**
 * The scene most fog tests play in:
 *  - p1 has founded Rome at (3,5); its warrior stands in the city;
 *  - p2 has founded Thebes at (12,5); its warrior stands in the city;
 *  - p1 has a scout at (8,5): Thebes is 4 tiles east of it, just out of its
 *    sight (3), but the western edge of Thebes' land is in sight.
 */
export function borderScene(): BorderScene {
  const start = meadowGame();
  let state = act(start, 'p1', { type: 'foundCity', unitId: unitOf(start, 'p1', 'settler').id });
  state = act(state, 'p2', { type: 'foundCity', unitId: unitOf(state, 'p2', 'settler').id });
  let scoutId = '';
  state = arrange(state, (draft) => {
    scoutId = placeUnit(draft, 'p1', 'scout', at(draft.map, 8, 5)).id;
  });
  return { state, rome: cityOn(state, at(state.map, 3, 5)), thebes: cityOn(state, at(state.map, 12, 5)), scoutId };
}

/** Walks p1's scout `steps` tiles in a direction, one move action per tile. */
export function scoutSteps(state: GameState, scoutId: string, direction: number, steps: number): GameState {
  let current = state;
  for (let i = 0; i < steps; i++) {
    const next = stepFrom(current.map, current.units[scoutId].tile, direction);
    current = act(current, 'p1', { type: 'moveUnit', unitId: scoutId, path: [next] });
  }
  return current;
}

/**
 * The border scene one turn later: p1's scout has walked up to Thebes,
 * looked at it, and gone back west to (6,5). For p1, Thebes and the
 * western part of its land are now FOGGED (seen once, not in sight), the
 * land east of Thebes has NEVER been seen, and p2's warrior inside Thebes
 * is a hidden unit.
 */
export function fogScene(): BorderScene {
  const scene = borderScene();
  const near = scoutSteps(scene.state, scene.scoutId, EAST, 1);
  const state = scoutSteps(endTurnForAll(near).state, scene.scoutId, WEST, 3);
  return { ...scene, state, rome: state.cities[scene.rome.id], thebes: state.cities[scene.thebes.id] };
}
