/**
 * The setCityFocus action: the "Grow first / Build first" choice of a city.
 * The rules are spelled out in the doc comment of applyAction.
 *
 * Internal: reached only through applyAction.
 */

import type { Action, ActionResult } from '../actions';
import { CITY_FOCUS } from '../data/cityFocus';
import type { CityFocusId } from '../data/cityFocus';
import { cloneJson } from '../json';
import type { GameState, PlayerId } from '../types';
import { updateKnowledge } from '../view/visibility';
import { accepted, noChange, rejected } from './results';
import { cityById } from './stateQueries';

/**
 * Sets how one of the player's cities places its citizens. Nothing else of
 * the city changes: not the food store, not the production store, not the
 * queue. Nothing is paid and no event is made; the next view and the next
 * turn resolution read the new focus (cityEconomy).
 */
export function setCityFocus(state: GameState, playerId: PlayerId, action: Extract<Action, { type: 'setCityFocus' }>): ActionResult {
  // "Not yours" and "does not exist" get the same answer, so ids cannot be probed.
  const city = cityById(state, action.cityId);
  if (city === null || city.owner !== playerId) return rejected('noSuchCity');

  // What a client sent: a string (applyAction has made sure of that), but
  // any string until it is found among the table's own keys.
  const focus: string = action.focus;
  if (!Object.hasOwn(CITY_FOCUS, focus)) return rejected('badAction');
  if (city.focus === focus) return noChange(state);

  const draft = cloneJson(state);
  draft.cities[city.id].focus = focus as CityFocusId;
  // Nothing anybody else sees has changed, but every changed state leaves
  // the engine with its fog-of-war memory brought up to date.
  updateKnowledge(draft);
  return accepted(draft, []);
}
