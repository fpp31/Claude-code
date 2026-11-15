/**
 * The moveUnit action (work package WP2). The rules are spelled out in the
 * doc comment of applyAction; this file follows it line by line.
 *
 * Internal: reached only through applyAction.
 */

import type { Action, ActionResult } from '../actions';
import { RULES } from '../data/rules';
import { tileMoveCost } from '../data/terrain';
import { areAdjacent, isValidTile } from '../hex';
import { cloneJson } from '../json';
import type { GameState, PlayerId, TileIndex, Unit } from '../types';
import { updateKnowledge } from '../view/visibility';
import { boardFromState, canEnterTile } from './movement';
import { accepted, rejected } from './results';
import { unitById } from './stateQueries';

type MoveUnitAction = Extract<Action, { type: 'moveUnit' }>;

/** Moves one of the player's units along the path the client chose, as far as the truth allows. */
export function moveUnit(state: GameState, playerId: PlayerId, action: MoveUnitAction): ActionResult {
  // "Not yours" and "does not exist" get the same answer, so ids cannot be probed.
  const unit = unitById(state, action.unitId);
  if (unit === null || unit.owner !== playerId) return rejected('noSuchUnit');

  if (!isPathShapeValid(state, unit.tile, action.path)) return rejected('badPath');
  // A unit at work stays where it is until the job is finished or stopped:
  // a stray tap must never throw away turns of work.
  if (unit.job !== null) return rejected('unitBusy');
  if (unit.movesLeft <= 0) return rejected('noMovesLeft');

  // The first step decides between "rejected" and "accepted". It is judged
  // here, on the untouched state, so a refused move never needs a copy.
  const firstStepError = canEnterTile(boardFromState(state), unit, action.path[0]);
  if (firstStepError !== null) return rejected(firstStepError);

  const draft = cloneJson(state);
  const from = unit.tile;
  const taken = walk(draft, draft.units[unit.id], action.path);

  return accepted(draft, [
    {
      to: [playerId],
      event: {
        type: 'unitMoved',
        playerId,
        unitId: unit.id,
        from,
        path: taken,
        stoppedEarly: taken.length < action.path.length,
      },
    },
  ]);
}

/**
 * Pure geometry, checked for the whole path before anything moves: not
 * empty, not too long, every entry a tile of this map, every step to a
 * neighbor of the tile before it (the first step from the unit's tile).
 * It looks at nothing a player could not know, so it cannot leak anything.
 */
function isPathShapeValid(state: GameState, from: TileIndex, path: TileIndex[]): boolean {
  if (path.length === 0 || path.length > RULES.maxPathLength) return false;
  let previous = from;
  for (const tile of path) {
    if (!isValidTile(tile, state.map)) return false;
    if (!areAdjacent(previous, tile, state.map)) return false;
    previous = tile;
  }
  return true;
}

/**
 * Walks `unit` (an object inside `draft`) along the path, one step at a
 * time, and returns the steps actually taken. Stops before the first step
 * that is not legal, and when the movement points run out.
 *
 * Sight is refreshed after EVERY step: the unit explores along the way, and
 * whatever stops it on the next step is on a tile next to it, which its
 * owner can see by then.
 *
 * (Phase 2: this loop is the one place that knows who sees the mover at each
 * step; collect those players here for the event's audience.)
 */
function walk(draft: GameState, unit: Unit, path: TileIndex[]): TileIndex[] {
  const board = boardFromState(draft); // reads the draft live, so it sees every step
  const taken: TileIndex[] = [];

  for (const next of path) {
    if (unit.movesLeft <= 0) break;
    if (canEnterTile(board, unit, next) !== null) break;
    const cost = tileMoveCost(draft.map.tiles[next]);
    if (cost === null) break; // canEnterTile has ruled this out already; it keeps the types honest

    unit.tile = next;
    // A unit with any moves left may always enter a passable tile: the cost is capped at what it has.
    unit.movesLeft = Math.max(0, unit.movesLeft - cost);
    taken.push(next);
    updateKnowledge(draft);
  }
  return taken;
}
