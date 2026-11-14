/**
 * Movement rules (work package WP2).
 *
 * There is ONE implementation of "may this unit enter that tile" and "which
 * tiles can it reach". It reads the world through the small `Board`
 * interface, which can be built from the true state (the server, when it
 * walks a path) or from one player's view (the client, to highlight
 * reachable tiles). The highlight therefore matches what the server accepts,
 * except where the truth holds something the player cannot see.
 */

import type { RuleErrorCode } from '../actions';
import type { Ground } from '../data/terrain';
import type { UnitClass, UnitTypeId } from '../data/units';
import type { GameState, PlayerId, TileIndex } from '../types';
import type { PlayerView } from '../viewTypes';

/** What the movement rules need to know about the world. */
export interface Board {
  width: number;
  height: number;
  /** Terrain and feature of a tile, or null if this board does not know the tile (never seen). */
  ground(tile: TileIndex): Ground | null;
  /** The units standing on a tile, as far as this board knows (0, 1 or 2). */
  unitsAt(tile: TileIndex): { owner: PlayerId; unitClass: UnitClass }[];
  /** The owner of the city standing on a tile, or null if there is no (known) city. */
  cityOwnerAt(tile: TileIndex): PlayerId | null;
}

/** The facts about a unit that movement needs. A `Unit` fits; for a `UnitView` pass `own.movesLeft`. */
export interface MovingUnit {
  owner: PlayerId;
  type: UnitTypeId;
  tile: TileIndex;
  movesLeft: number;
}

/** How a reachable tile is reached. */
export interface ReachStep {
  /** Movement points the unit has left on arriving there. */
  movesLeft: number;
  /** The tile it comes from on the best route (the unit's own tile for a first step). */
  previous: TileIndex;
}

/** The truth, for the server. Reads `state` live: it sees later edits to the same object. */
export function boardFromState(state: GameState): Board {
  throw new Error('not implemented: boardFromState');
}

/**
 * One player's knowledge, for the client.
 *  - `ground` is null for never-seen tiles.
 *  - `unitsAt` and `cityOwnerAt` report what the view contains: units on
 *    tiles in sight, cities in sight or remembered.
 */
export function boardFromView(view: PlayerView): Board {
  throw new Error('not implemented: boardFromView');
}

/**
 * May a unit of this owner and type END A STEP on `tile`? Returns null if
 * yes, otherwise the reason:
 *  - 'impassable': the tile is unknown to the board, or tileMoveCost is null
 *    (water, mountains);
 *  - 'blocked': a unit of another player is there; or a city of another
 *    player; or one of the mover's own units of the same class (a tile holds
 *    at most one military and one civilian unit).
 * Own cities and own units of the other class do not block. Adjacency and
 * movement points are NOT checked here.
 */
export function canEnterTile(
  board: Board,
  mover: { owner: PlayerId; type: UnitTypeId },
  tile: TileIndex,
): RuleErrorCode | null {
  throw new Error('not implemented: canEnterTile');
}

/**
 * Every tile the unit can reach this turn, with how it gets there. The
 * unit's own tile is not included. Empty if the unit has no moves left.
 *
 * Movement rule: from a tile with m > 0 moves left the unit may step to any
 * adjacent tile for which canEnterTile is null; it arrives with
 * max(0, m - tileMoveCost(tile)) moves. Every tile on a route must itself be
 * enterable (no passing through).
 *
 * Deterministic: tiles are expanded most-moves-left first, ties by lower tile
 * index, and neighbors in direction order (hex.ts); a tile keeps the first
 * route that gives it the most moves left.
 */
export function reachableTiles(board: Board, unit: MovingUnit): Map<TileIndex, ReachStep> {
  throw new Error('not implemented: reachableTiles');
}

/**
 * The route to `target` found by reachableTiles, as the `path` of a moveUnit
 * action: the tiles to enter in order, start tile excluded, `target` last.
 * Returns null if `target` is not in `reach`.
 *
 * It walks backwards from the target along `previous` until it arrives at a
 * tile that is not in `reach`: that is the unit's own tile, which
 * reachableTiles never includes.
 *
 * (Implemented in the scaffold, unlike the rest of this file: the client's
 * controller (WP4) needs it to test "tap a reachable tile" with a hand-made
 * reach map before WP2's reachableTiles exists.)
 */
export function pathTo(reach: Map<TileIndex, ReachStep>, target: TileIndex): TileIndex[] | null {
  if (!reach.has(target)) return null;
  const path: TileIndex[] = [];
  let tile = target;
  let step = reach.get(tile);
  while (step !== undefined) {
    path.push(tile);
    // A route can never be longer than the number of reachable tiles; more
    // steps than that means the map points back at itself (a programming error).
    if (path.length > reach.size) throw new Error('pathTo: the reach map contains a loop');
    tile = step.previous;
    step = reach.get(tile);
  }
  return path.reverse();
}
