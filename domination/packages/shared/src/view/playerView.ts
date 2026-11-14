/**
 * Building what one player is allowed to see (work package WP2).
 *
 * THE ONE FILTER. Everything a client is ever sent about a game comes out of
 * `buildPlayerView` (or is a diff of two of its results) and `filterEvents`.
 * If a secret leaks, the bug is in this file.
 */

import type { AddressedEvent, GameEvent } from '../actions';
import type { GameState, PlayerId } from '../types';
import type { PlayerView } from '../viewTypes';

/**
 * Builds the view of one player. See viewTypes.ts for what a view may and may not
 * contain. Pure; throws if `playerId` is not a player of the game.
 *
 * It expects `updateKnowledge` to have run on `state` (true for every state
 * returned by createGame, applyAction and resolveTurn).
 *
 * CONSTRUCTION RULE: build every output object field by field from scratch
 * (an allow-list). Never copy a state object with spread or by reference and
 * then delete fields: a forgotten copy is harmless, a forgotten delete is a
 * leak.
 *
 * Contents:
 *  - you, turn, width, height.
 *  - tiles[i]:
 *      * never explored                 -> null;
 *      * visible now (computeVisible)   -> terrain, feature, visible: true,
 *                                          owner = current owner of the tile;
 *      * explored but not visible       -> terrain, feature, visible: false,
 *                                          owner = knowledge.remembered[i]?.owner ?? null.
 *  - units, sorted by id (plain string comparison with < and >):
 *      * the viewer's own units, with own = { movesLeft, foundCityError };
 *      * other players' units standing on tiles visible now, with own = null.
 *  - cities, sorted by id:
 *      * the viewer's own cities: visible: true, own = OwnCityDetail computed
 *        with cityEconomy / foodToGrow / buildCost / buildOptions /
 *        productionBlocked;
 *      * other players' cities on tiles visible now: current public fields,
 *        visible: true, own = null;
 *      * cities in knowledge.remembered on tiles NOT visible now: the
 *        remembered public fields, visible: false, own = null.
 *  - players: id, name, civ, endedTurn for every player, in seat order.
 *
 * Property the tests must prove (non-interference): changing anything in the
 * state that this player cannot see (a hidden unit's position, terrain of a
 * never-seen tile, another city's food or production, another player's
 * knowledge or idRng, `seed`, `rng`) leaves the returned view deep-equal.
 */
export function buildPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  throw new Error('not implemented: buildPlayerView');
}

/**
 * The events one player may receive, in their original order, WITHOUT their
 * audience lists: the `event` of every entry whose `to` is 'all' or contains
 * `playerId`. Everything else is dropped. Returns a new array; pure.
 *
 * It looks only at `to`, never at the event's own fields: who may hear about
 * an event was decided by the engine when it made the event (AddressedEvent
 * in actions.ts). In phase 1 that means a player's own events plus
 * 'turnStarted'.
 */
export function filterEvents(events: AddressedEvent[], playerId: PlayerId): GameEvent[] {
  throw new Error('not implemented: filterEvents');
}
