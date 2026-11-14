/**
 * The single gate through which players change a game (work package WP2).
 *
 * A game state changes in exactly two ways: `applyAction` (a player did
 * something) and `resolveTurn` (the turn ended; see turn.ts). The server, the
 * tests, and later AI seats, timers and queued orders all go through these.
 */

import type { Action, ActionResult } from '../actions';
import type { GameState, PlayerId } from '../types';
import { cancelEndTurn, endTurn } from './endTurn';
import { foundCity } from './foundCity';
import { moveUnit } from './moveUnit';
import { noChange, rejected } from './results';
import { setProduction } from './setProduction';

/**
 * Validates one action of one player and, if it is legal, returns the state
 * after it.
 *
 * PURE: never changes `state`. On success it works on a copy (cloneJson) and
 * returns that copy; on failure or for a no-op it returns no new state at all.
 * Deterministic: no clock, no built-in random function.
 *
 * @param state     the current game state (not modified)
 * @param playerId  who is acting. The SERVER supplies this from the seat the
 *                  socket is attached to; it is never taken from a message.
 * @param turn      the turn number the player was looking at when acting
 * @param action    what they want to do (already shape-checked by the server)
 *
 * Checks, in this order (first failure wins):
 *  1. `playerId` is not a player of this game, the action type is unknown,
 *     or a field of the action is of the wrong basic kind (`unitId` or
 *     `cityId` is not a string, `path` is not a list, `item` is not an
 *     object) -> 'badAction'. Fields of the right kind with a wrong VALUE
 *     get the code of their own check further down ('badPath',
 *     'noSuchUnit', 'cannotBuild', ...).
 *  2. `turn !== state.turn` -> 'staleTurn'. (A late End Turn must never end
 *     the following turn.)
 *  3. The player has already ended their turn:
 *       - 'endTurn'        -> accepted no-op (changed: false);
 *       - 'cancelEndTurn'  -> allowed, see below;
 *       - anything else    -> 'turnAlreadyEnded'.
 *  4. The checks of the action itself.
 *
 * Accepted no-ops return `{ ok: true, state: <the input object>, events: [],
 * changed: false }`: endTurn when already ended, cancelEndTurn when not
 * ended, setProduction to the item the city is already building.
 *
 * moveUnit { unitId, path }
 *  - Unit missing or not owned by the player -> 'noSuchUnit' (same code for
 *    both, so ids cannot be probed).
 *  - Path empty, longer than RULES.maxPathLength, containing a number that is
 *    not a tile of this map, or with a step that is not adjacent to the tile
 *    before it (the first step is measured from the unit's tile) -> 'badPath'.
 *    This is pure geometry and is checked for the whole path up front.
 *  - Unit has 0 moves left -> 'noMovesLeft'.
 *  - Then the path is WALKED on the true state, one step at a time:
 *      * stop if the unit has no moves left;
 *      * stop if canEnterTile(boardFromState(draft), unit, nextTile) reports
 *        an error (water, mountains, another player's unit or city, own unit
 *        of the same class). Every step must be a tile the unit could stop
 *        on; there is no passing through anything;
 *      * otherwise move: movesLeft = max(0, movesLeft - tileMoveCost(tile)).
 *        A unit with any moves left may always enter a passable tile;
 *      * call updateKnowledge after EVERY step, so units explore along the
 *        way and the next step is judged with fresh sight.
 *    (Phase 1 limit, on purpose: other players' views are built only at the
 *    end of the action, so a unit that passes through somebody's sight and
 *    ends outside it is never shown to them. This loop is the one place that
 *    knows who sees the mover at each step: phase 2 collects those players
 *    here and adds them to the event's audience. The same holds the other
 *    way round: the mover explores every tile it passes, but a foreign unit
 *    it saw only on the way, out of sight from where the walk ends, is not
 *    in the mover's view afterwards, because units are never remembered.)
 *  - If not even the first step could be taken, the result is that step's
 *    error ('impassable' or 'blocked') and nothing changes.
 *  - If at least one step was taken the action SUCCEEDS, even when the walk
 *    stopped early. One 'unitMoved' event: `from` = the old tile, `path` =
 *    the steps actually taken, `stoppedEarly` = the walk did not reach the
 *    end of the requested path.
 *  - Why the server walks instead of path-finding: the server knows hidden
 *    things, and a route it chose could give them away. Every refusal here
 *    concerns a tile next to the unit, which the player can see anyway
 *    (all units have sight >= 1).
 *
 * foundCity { unitId }
 *  - Unit missing or not owned -> 'noSuchUnit'.
 *  - foundCityError(state, unit) (rules/city.ts) is not null -> that code.
 *  - Otherwise, in this order: make the city (id from newCityId, name from
 *    cityNameFor(civ, citiesFounded), population 1, foodStored 0, production
 *    null, productionStored 0) on the unit's tile; set the city tile's
 *    `cityId` to the new city (even if another of the player's own cities
 *    owned it); set `cityId` on every tile within RULES.cityClaimRadius whose
 *    `cityId` is null (water and mountains included); delete the unit;
 *    citiesFounded += 1; updateKnowledge. One 'cityFounded' event.
 *
 * setProduction { cityId, item }
 *  - City missing or not owned -> 'noSuchCity'.
 *  - `item` is not something the city can build (phase 1: `kind` must be
 *    'unit' and `unitType` a key of UNITS) -> 'cannotBuild'.
 *  - Same item as now -> no-op. Otherwise set it; productionStored is kept.
 *    No event.
 *
 * endTurn
 *  - Sets endedTurn. If every player has now ended (isTurnComplete), the turn
 *    is resolved in the same call with the turn-resolution steps of turn.ts,
 *    and the events include its events (ending with 'turnStarted'). A game
 *    with one player therefore resolves on every End Turn.
 *
 * cancelEndTurn
 *  - Clears endedTurn (no-op if it was not set). No event.
 *
 * Events are returned with their audience (AddressedEvent in actions.ts):
 * 'unitMoved' and 'cityFounded' as `{ to: [playerId], event }`; the events
 * of a turn resolution as resolveTurn returns them.
 *
 * After any change `updateKnowledge` has been run, so the returned state is
 * ready for buildPlayerView. A returned state always passes checkInvariants.
 */
export function applyAction(state: GameState, playerId: PlayerId, turn: number, action: Action): ActionResult {
  // 1. Somebody who is not in this game, or something that is not an action.
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (player === undefined || !isWellFormedAction(action)) return rejected('badAction');

  // 2. An action from a turn that is over (or has not begun).
  if (turn !== state.turn) return rejected('staleTurn');

  // 3. A player who has ended their turn may only take that back.
  if (player.endedTurn) {
    if (action.type === 'endTurn') return noChange(state);
    if (action.type !== 'cancelEndTurn') return rejected('turnAlreadyEnded');
  }

  // 4. The action itself.
  switch (action.type) {
    case 'moveUnit':
      return moveUnit(state, playerId, action);
    case 'foundCity':
      return foundCity(state, playerId, action);
    case 'setProduction':
      return setProduction(state, playerId, action);
    case 'endTurn':
      return endTurn(state, playerId);
    case 'cancelEndTurn':
      return cancelEndTurn(state, playerId);
    default: {
      // If a new action type is added to `Action` and not handled above,
      // this line stops compiling.
      const unhandled: never = action;
      return unhandled;
    }
  }
}

/**
 * Is this one of the known actions, with fields of the right basic kind (an
 * id is a string, a path is a list, an item is an object)?
 *
 * The server checks the shape of every message before it gets here; this is
 * the engine's own safety net, so that nothing malformed can reach the
 * handlers whoever calls them (tests, later AI seats and queued orders).
 * What the VALUES mean (is there such a unit, is that tile on the map, can a
 * city build that) is judged later, by the action's own checks and codes.
 */
function isWellFormedAction(action: Action): boolean {
  const candidate: unknown = action;
  if (typeof candidate !== 'object' || candidate === null) return false;
  const fields = candidate as Record<string, unknown>;

  switch (fields.type) {
    case 'moveUnit':
      return typeof fields.unitId === 'string' && Array.isArray(fields.path);
    case 'foundCity':
      return typeof fields.unitId === 'string';
    case 'setProduction':
      return typeof fields.cityId === 'string' && typeof fields.item === 'object' && fields.item !== null;
    case 'endTurn':
    case 'cancelEndTurn':
      return true;
    default:
      return false;
  }
}
