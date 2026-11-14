/**
 * Movement rules (work package WP2).
 *
 * There is ONE implementation of "may this unit enter that tile" and "which
 * tiles can it reach". It reads the world through the small `Board`
 * interface, which can be built from the true state (the server, when it
 * walks a path) or from one player's view (the client, to highlight
 * reachable tiles). The highlight therefore matches what the server accepts,
 * except where the truth holds something the player cannot see. With today's
 * units that never happens within one move: every unit sees at least as far
 * as it can walk in a turn (a table test guards this), so the server stops a
 * move early only if the world changed after the player's view was made.
 */

import type { RuleErrorCode } from '../actions';
import { tileMoveCost } from '../data/terrain';
import type { Ground } from '../data/terrain';
import { UNITS } from '../data/units';
import type { UnitClass, UnitTypeId } from '../data/units';
import { neighbors } from '../hex';
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
  // Nothing is indexed up front, on purpose: the engine moves a unit on its
  // working copy and asks again, and must get the fresh answer.
  return {
    width: state.map.width,
    height: state.map.height,
    ground(tile) {
      const found = state.map.tiles[tile];
      return found === undefined ? null : { terrain: found.terrain, feature: found.feature };
    },
    unitsAt(tile) {
      const found: { owner: PlayerId; unitClass: UnitClass }[] = [];
      for (const unit of Object.values(state.units)) {
        if (unit.tile === tile) found.push({ owner: unit.owner, unitClass: UNITS[unit.type].unitClass });
      }
      return found;
    },
    cityOwnerAt(tile) {
      for (const city of Object.values(state.cities)) {
        if (city.tile === tile) return city.owner;
      }
      return null;
    },
  };
}

/**
 * One player's knowledge, for the client.
 *  - `ground` is null for never-seen tiles.
 *  - `unitsAt` and `cityOwnerAt` report what the view contains: units on
 *    tiles in sight, cities in sight or remembered.
 *
 * Unlike boardFromState this is a SNAPSHOT: the units and cities of the view
 * are sorted by tile once, here. That is right for views, which are never
 * edited in place (a changed game means a new view object, and a new board).
 */
export function boardFromView(view: PlayerView): Board {
  // A view is never edited in place (a new one replaces it), so it is safe
  // to sort its units and cities by tile once. The reachable-tile search asks
  // about the same tiles many times.
  const unitsByTile = new Map<TileIndex, { owner: PlayerId; unitClass: UnitClass }[]>();
  for (const unit of view.units) {
    const here = unitsByTile.get(unit.tile) ?? [];
    here.push({ owner: unit.owner, unitClass: UNITS[unit.type].unitClass });
    unitsByTile.set(unit.tile, here);
  }
  const cityOwnerByTile = new Map<TileIndex, PlayerId>();
  for (const city of view.cities) cityOwnerByTile.set(city.tile, city.owner);

  return {
    width: view.width,
    height: view.height,
    ground(tile) {
      const found = view.tiles[tile];
      return found === undefined || found === null ? null : { terrain: found.terrain, feature: found.feature };
    },
    unitsAt(tile) {
      return (unitsByTile.get(tile) ?? []).slice();
    },
    cityOwnerAt(tile) {
      return cityOwnerByTile.get(tile) ?? null;
    },
  };
}

/** Movement points needed to enter a tile of this board; null if it is unknown to the board or cannot be entered. */
function moveCostAt(board: Board, tile: TileIndex): number | null {
  const ground = board.ground(tile);
  return ground === null ? null : tileMoveCost(ground);
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
  if (moveCostAt(board, tile) === null) return 'impassable';

  const cityOwner = board.cityOwnerAt(tile);
  if (cityOwner !== null && cityOwner !== mover.owner) return 'blocked';

  const moverClass = UNITS[mover.type].unitClass;
  for (const other of board.unitsAt(tile)) {
    if (other.owner !== mover.owner) return 'blocked';
    if (other.unitClass === moverClass) return 'blocked';
  }
  return null;
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
  const reach = new Map<TileIndex, ReachStep>();
  if (unit.movesLeft <= 0) return reach;

  // Tiles whose neighbors have not been looked at yet. Entering a tile always
  // costs at least 1, so a tile reached later never has more moves left than
  // the one being expanded now: once a tile is expanded its entry is final.
  const waiting: { tile: TileIndex; movesLeft: number }[] = [{ tile: unit.tile, movesLeft: unit.movesLeft }];
  const expanded = new Set<TileIndex>();

  while (waiting.length > 0) {
    const current = takeBest(waiting);
    if (expanded.has(current.tile)) continue; // an older, worse entry of a tile already done
    expanded.add(current.tile);
    if (current.movesLeft <= 0) continue; // arrived exhausted: cannot go on from here

    for (const next of neighbors(current.tile, board)) {
      if (next === unit.tile) continue; // the unit's own tile is never part of the answer
      if (expanded.has(next)) continue;
      if (canEnterTile(board, unit, next) !== null) continue;
      const cost = moveCostAt(board, next);
      if (cost === null) continue; // canEnterTile has ruled this out already; it keeps the types honest

      const movesLeft = Math.max(0, current.movesLeft - cost);
      const known = reach.get(next);
      // Strictly better only: a tile keeps the FIRST route that gives it the most moves.
      if (known !== undefined && known.movesLeft >= movesLeft) continue;
      reach.set(next, { movesLeft, previous: current.tile });
      waiting.push({ tile: next, movesLeft });
    }
  }
  return reach;
}

/** Removes and returns the waiting entry with the most moves left; ties go to the lower tile index. */
function takeBest(waiting: { tile: TileIndex; movesLeft: number }[]): { tile: TileIndex; movesLeft: number } {
  let best = 0;
  for (let i = 1; i < waiting.length; i++) {
    const candidate = waiting[i];
    const leader = waiting[best];
    if (
      candidate.movesLeft > leader.movesLeft ||
      (candidate.movesLeft === leader.movesLeft && candidate.tile < leader.tile)
    ) {
      best = i;
    }
  }
  return waiting.splice(best, 1)[0];
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
 * It only reads the reach map, so the client's tests can hand it a map made
 * by hand.
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
