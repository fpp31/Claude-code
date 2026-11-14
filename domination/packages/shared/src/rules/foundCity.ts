/**
 * The foundCity action (work package WP2). The rules are spelled out in the
 * doc comment of applyAction; whether founding is allowed at all is decided
 * by foundCityError in city.ts.
 *
 * Internal: reached only through applyAction.
 */

import type { Action, ActionResult } from '../actions';
import { cityNameFor } from '../data/civs';
import { RULES } from '../data/rules';
import { tilesInRange } from '../hex';
import { getPlayer, newCityId } from '../ids';
import { cloneJson } from '../json';
import type { GameState, PlayerId } from '../types';
import { updateKnowledge } from '../view/visibility';
import { foundCityError } from './city';
import { accepted, rejected } from './results';
import { unitById } from './stateQueries';

type FoundCityAction = Extract<Action, { type: 'foundCity' }>;

/** Turns one of the player's settlers into a city on the tile it stands on. */
export function foundCity(state: GameState, playerId: PlayerId, action: FoundCityAction): ActionResult {
  const unit = unitById(state, action.unitId);
  if (unit === null || unit.owner !== playerId) return rejected('noSuchUnit');

  const refusal = foundCityError(state, unit);
  if (refusal !== null) return rejected(refusal);

  const draft = cloneJson(state);
  const player = getPlayer(draft, playerId);
  const tile = unit.tile;

  // The city itself.
  const cityId = newCityId(draft, playerId);
  const name = cityNameFor(player.civ, player.citiesFounded);
  draft.cities[cityId] = {
    id: cityId,
    owner: playerId,
    name,
    tile,
    population: 1,
    foodStored: 0,
    production: null,
    productionStored: 0,
  };

  // Its land: the centre always (even if another of the player's own cities
  // owned it), and around it only what nobody owns yet.
  draft.map.tiles[tile].cityId = cityId;
  for (const near of tilesInRange(tile, RULES.cityClaimRadius, draft.map)) {
    if (draft.map.tiles[near].cityId === null) draft.map.tiles[near].cityId = cityId;
  }

  // The settlers have moved in.
  delete draft.units[unit.id];
  player.citiesFounded += 1;
  updateKnowledge(draft);

  return accepted(draft, [
    { to: [playerId], event: { type: 'cityFounded', playerId, cityId, name, tile } },
  ]);
}
