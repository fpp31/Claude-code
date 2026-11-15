/**
 * Turn resolution (work package WP2).
 *
 * Turns are simultaneous: everybody acts, everybody presses End Turn, and
 * then the turn resolves in one go. Phase 3 will add other turn modes and
 * timers; they will call the same two functions.
 */

import type { AddressedEvent } from '../actions';
import { IMPROVEMENTS } from '../data/improvements';
import { UNITS } from '../data/units';
import { newUnitId } from '../ids';
import { cloneJson } from '../json';
import type { GameState } from '../types';
import { updateKnowledge } from '../view/visibility';
import { cityEconomy, findSpawnTile, runCityTurn } from './city';
import { improvementSiteError, siteOfTile } from './improvements';
import { citiesOfPlayer, cityById, unitsOfPlayer } from './stateQueries';

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
 * The body is a short list of calls to named step functions, so the order
 * can be read in one place and a later phase can add lines:
 *
 *  1. runCities      For each player in seat order, for each of their cities
 *                    in founding order (the order of `state.cities`):
 *       a. economy = cityEconomy(state, city), computed ONCE, before growth
 *          (citizens are placed as its doc comment says: best tiles first,
 *          then food before production while the city would not grow).
 *       b. and c. are runCityTurn(city, economy, spawnTile) in rules/city.ts:
 *          ONE function, which the city panel's forecast (buildPlan) calls
 *          too, so the panel can never promise what this step does not do.
 *       b. Food: foodStored += economy.foodSurplus, but never below 0 (a
 *          city never shrinks). Then, if foodStored >=
 *          foodToGrow(population): foodStored -= that threshold (the rest
 *          carries over), population += 1, event 'cityGrew'. A city grows
 *          by at most one per turn.
 *       c. Production. If the build queue is empty nothing is added: this
 *          turn's production is lost (what is already stored stays).
 *          Otherwise productionStored += economy.production. Then the FIRST
 *          entry of the queue, and only the first, is looked at: if
 *          productionStored >= buildCost(first entry), try to complete it:
 *            - a unit with populationCost > 0 needs population -
 *              populationCost >= 1 (checked AFTER step b, so a city that just
 *              grew to 2 can release its Settler in the same turn);
 *            - it needs a tile from findSpawnTile.
 *          If either is missing the first entry STAYS FIRST and the city
 *          waits: the stored production stays, and no later entry is looked
 *          at, even one that is paid for and that nothing blocks. (The player
 *          reorders the queue if they want something else first; the view
 *          says so in OwnCityDetail.held.)
 *          On completion: create the unit there (id from newUnitId, no job,
 *          moves as set by step 3), productionStored -= cost (the rest
 *          carries over to the next entry), population -= populationCost,
 *          and the entry is REMOVED from the queue, so the next entry, if
 *          any, is the current build from now on. Event 'unitBuilt', whose
 *          `queueEmpty` says whether that was the last entry. At most one
 *          completion per city per turn, however much is stored.
 *  2. runJobs        For each player in seat order, for each of their units
 *                    in creation order (the order of `state.units`) that has
 *                    a job:
 *       a. If improvementSiteError(siteOfTile(state, unit.owner, unit.tile),
 *          job.improvement) is not null, the improvement can no longer be
 *          built there: job = null, and nothing else happens. (Today's rules
 *          never bring that about. The rule that first can, such as land
 *          changing hands, adds an event for the owner here.)
 *       b. Otherwise job.turnsWorked += 1. If turnsWorked >=
 *          IMPROVEMENTS[job.improvement].turns: the tile's `improvement`
 *          becomes job.improvement (whatever it was), job = null, event
 *          'improvementBuilt' (it names the city on whose land the tile
 *          lies). The unit stays on the tile.
 *                    This step comes AFTER runCities: a city's economy for
 *                    this turn was read before any job of this turn is
 *                    finished, so an improvement first counts when the NEXT
 *                    turn resolves (the same rule as 1a for a new citizen),
 *                    and a city gets exactly what its panel showed.
 *  3. refreshUnits   Every unit: movesLeft = UNITS[type].moves. A unit at
 *                    work gets them too and cannot use them (moveUnit).
 *  4. beginNextTurn  turn += 1; every player's endedTurn = false;
 *                    event 'turnStarted' (the last event).
 *  5. updateKnowledge(state) for all players.
 *
 * Events are returned with their audience (AddressedEvent in actions.ts):
 * 'cityGrew' and 'unitBuilt' to the city's owner only, 'improvementBuilt' to
 * the unit's owner only, 'turnStarted' to 'all'.
 *
 * The returned state passes checkInvariants.
 */
export function resolveTurn(state: GameState): { state: GameState; events: AddressedEvent[] } {
  const next = cloneJson(state);
  const events: AddressedEvent[] = [];

  runCities(next, events);
  runJobs(next, events);
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
      // 1b and 1c. The city's own part: the function the forecast uses too.
      const turn = runCityTurn(city, economy, (unitType) => findSpawnTile(state, city, unitType));
      if (turn.grew) {
        // The news names the size the city grew TO (step 1b). A unit that
        // was completed in the same turn may have taken citizens along since
        // (step 1c: a Settler); they are counted back in here, or a city
        // that grew to 2 and let its Settler go would be said to have
        // "grown to 1".
        const taken = turn.completed === null ? 0 : UNITS[turn.completed.unitType].populationCost;
        events.push({
          to: [city.owner],
          event: { type: 'cityGrew', playerId: city.owner, cityId: city.id, name: city.name, population: city.population + taken },
        });
      }
      if (turn.completed === null) continue;
      const { unitType, tile } = turn.completed;
      const unitId = newUnitId(state, city.owner);
      state.units[unitId] = { id: unitId, type: unitType, owner: city.owner, tile, movesLeft: UNITS[unitType].moves, job: null };
      events.push({
        to: [city.owner],
        event: {
          type: 'unitBuilt', playerId: city.owner, cityId: city.id, cityName: city.name, unitId, unitType,
          queueEmpty: city.buildQueue.length === 0,
        },
      });
    }
  }
}

/** Step 2: every unit at work does one turn of it; a finished job puts its improvement on the tile. */
function runJobs(state: GameState, events: AddressedEvent[]): void {
  for (const player of state.players) {
    for (const unit of unitsOfPlayer(state, player.id)) {
      const job = unit.job;
      if (job === null) continue;
      // 2a. The site is judged again every turn (see the doc comment of resolveTurn).
      if (improvementSiteError(siteOfTile(state, unit.owner, unit.tile), job.improvement) !== null) {
        unit.job = null;
        continue;
      }
      // 2b. One more turn of work; done when the table's number is reached.
      job.turnsWorked += 1;
      if (job.turnsWorked < IMPROVEMENTS[job.improvement].turns) continue;
      const tile = state.map.tiles[unit.tile];
      // The site check has just found the tile to be the owner's land, so it
      // belongs to one of the owner's cities; '' only keeps the types honest.
      const city = tile.cityId === null ? null : cityById(state, tile.cityId);
      tile.improvement = job.improvement;
      unit.job = null;
      events.push({
        to: [unit.owner],
        event: {
          type: 'improvementBuilt', playerId: unit.owner, unitId: unit.id, improvement: job.improvement, tile: unit.tile,
          cityName: city === null ? '' : city.name,
        },
      });
    }
  }
}

/** Step 3: every unit gets its full movement points back. A unit at work gets them too and cannot use them. */
function refreshUnits(state: GameState): void {
  for (const unit of Object.values(state.units)) unit.movesLeft = UNITS[unit.type].moves;
}

/** Step 4: the next turn begins for everybody. */
function beginNextTurn(state: GameState, events: AddressedEvent[]): void {
  state.turn += 1;
  for (const player of state.players) player.endedTurn = false;
  events.push({ to: 'all', event: { type: 'turnStarted', turn: state.turn } });
}
