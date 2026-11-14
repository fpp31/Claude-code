/**
 * Turn resolution (work package WP2).
 *
 * Turns are simultaneous: everybody acts, everybody presses End Turn, and
 * then the turn resolves in one go. Phase 3 will add other turn modes and
 * timers; they will call the same two functions.
 */

import type { AddressedEvent } from '../actions';
import { foodToGrow } from '../data/rules';
import { UNITS } from '../data/units';
import { newUnitId } from '../ids';
import { cloneJson } from '../json';
import type { City, GameState } from '../types';
import { updateKnowledge } from '../view/visibility';
import { buildCost, cityEconomy, findSpawnTile, productionBlocked } from './city';
import { citiesOfPlayer } from './stateQueries';

/** True when every player has `endedTurn` set. (A game always has at least one player.) */
export function isTurnComplete(state: GameState): boolean {
  return state.players.every((player) => player.endedTurn);
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
  const next = cloneJson(state);
  const events: AddressedEvent[] = [];

  runCities(next, events);
  refreshUnits(next);
  beginNextTurn(next, events);
  updateKnowledge(next);

  return { state: next, events };
}

// ---------------------------------------------------------------------------
// The steps. Each one edits `state`, which is resolveTurn's own working copy.
// ---------------------------------------------------------------------------

/** Step 1: every city eats, grows and builds. Players in seat order, their cities in founding order. */
function runCities(state: GameState, events: AddressedEvent[]): void {
  for (const player of state.players) {
    for (const city of citiesOfPlayer(state, player.id)) {
      // 1a. One reading of the economy for the whole turn, taken before the
      //     city grows: the new citizen starts working next turn.
      const economy = cityEconomy(state, city);
      growCity(city, economy.foodSurplus, events);
      buildInCity(state, city, economy.production, events);
    }
  }
}

/** Step 1b: store the food surplus and grow by at most one citizen. */
function growCity(city: City, foodSurplus: number, events: AddressedEvent[]): void {
  // A shortage empties the store but never removes a citizen (phase 1).
  city.foodStored = Math.max(0, city.foodStored + foodSurplus);

  const needed = foodToGrow(city.population);
  if (city.foodStored < needed) return;
  city.foodStored -= needed;
  city.population += 1;
  events.push({
    to: [city.owner],
    event: { type: 'cityGrew', playerId: city.owner, cityId: city.id, name: city.name, population: city.population },
  });
}

/** Step 1c: add this turn's production and complete the current item if it is paid for and nothing blocks it. */
function buildInCity(state: GameState, city: City, production: number, events: AddressedEvent[]): void {
  // Nothing chosen: this turn's production is lost.
  if (city.production === null) return;

  city.productionStored += production;
  const cost = buildCost(city.production);
  if (city.productionStored < cost) return;

  // Paid for. The city waits (and keeps what it stored) while it lacks the
  // citizen the item takes or a free tile for the new unit.
  if (productionBlocked(state, city) !== null) return;
  const unitType = city.production.unitType;
  const tile = findSpawnTile(state, city, unitType);
  if (tile === null) return; // productionBlocked has just said there is room; this keeps the types honest

  const unitId = newUnitId(state, city.owner);
  state.units[unitId] = { id: unitId, type: unitType, owner: city.owner, tile, movesLeft: UNITS[unitType].moves };
  city.productionStored -= cost;
  city.population -= UNITS[unitType].populationCost;
  // city.production stays selected: the city starts on the next one of the same kind.
  events.push({
    to: [city.owner],
    event: { type: 'unitBuilt', playerId: city.owner, cityId: city.id, cityName: city.name, unitId, unitType },
  });
}

/** Step 2: every unit gets its full movement points back. */
function refreshUnits(state: GameState): void {
  for (const unit of Object.values(state.units)) unit.movesLeft = UNITS[unit.type].moves;
}

/** Step 3: the next turn begins for everybody. */
function beginNextTurn(state: GameState, events: AddressedEvent[]): void {
  state.turn += 1;
  for (const player of state.players) player.endedTurn = false;
  events.push({ to: 'all', event: { type: 'turnStarted', turn: state.turn } });
}
