/**
 * Turn resolution (work package WP2).
 *
 * Turns are simultaneous: everybody acts, everybody presses End Turn, and
 * then the turn resolves in one go. Phase 3 will add other turn modes and
 * timers; they will call the same two functions.
 */

import type { AddressedEvent } from '../actions';
import type { GameState } from '../types';

/** True when every player has `endedTurn` set. (A game always has at least one player.) */
export function isTurnComplete(state: GameState): boolean {
  throw new Error('not implemented: isTurnComplete');
}

/**
 * Ends the current turn and starts the next one. PURE: works on a copy and
 * returns it; `state` is not modified. Deterministic.
 *
 * It does not check isTurnComplete (applyAction does, before calling it; a
 * phase 3 timer may force a resolution).
 *
 * Write the body as a short list of calls to named step functions, so the
 * order can be read in one place and phase 2 can add lines:
 *
 *  1. runCities      For each player in seat order, for each of their cities
 *                    in founding order (the order of `state.cities`):
 *       a. economy = cityEconomy(state, city), computed ONCE, before growth.
 *       b. Food: foodStored += economy.foodSurplus, but never below 0 (a
 *          city never shrinks in phase 1). Then, if foodStored >=
 *          foodToGrow(population): foodStored -= that threshold (the rest
 *          carries over), population += 1, event 'cityGrew'. A city grows
 *          by at most one per turn.
 *       c. Production: if `production` is null nothing is added (that turn's
 *          production is lost). Otherwise productionStored +=
 *          economy.production; then, if productionStored >= buildCost(item),
 *          try to complete it:
 *            - a unit with populationCost > 0 needs population -
 *              populationCost >= 1 (checked AFTER step b, so a city that just
 *              grew to 2 can release its Settler in the same turn);
 *            - it needs a tile from findSpawnTile.
 *          Both checks are productionBlocked(state, city) (rules/city.ts),
 *          the same function the view uses to explain the wait to the player.
 *          If either is missing the city simply waits (stored production
 *          stays). On completion: create the unit there (id from newUnitId,
 *          moves as set by step 2), productionStored -= cost (the rest
 *          carries over), population -= populationCost, and `production`
 *          STAYS selected. Event 'unitBuilt'. At most one completion per city
 *          per turn.
 *  2. refreshUnits   Every unit: movesLeft = UNITS[type].moves.
 *  3. beginNextTurn  turn += 1; every player's endedTurn = false;
 *                    event 'turnStarted' (the last event).
 *  4. updateKnowledge(state) for all players.
 *
 * Events are returned with their audience (AddressedEvent in actions.ts):
 * 'cityGrew' and 'unitBuilt' to the city's owner only, 'turnStarted' to 'all'.
 *
 * The returned state passes checkInvariants.
 */
export function resolveTurn(state: GameState): { state: GameState; events: AddressedEvent[] } {
  throw new Error('not implemented: resolveTurn');
}
