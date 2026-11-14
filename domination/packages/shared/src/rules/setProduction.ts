/**
 * The setProduction action (work package WP2). The rules are spelled out in
 * the doc comment of applyAction.
 *
 * Internal: reached only through applyAction.
 */

import type { Action, ActionResult } from '../actions';
import { UNITS } from '../data/units';
import type { UnitTypeId } from '../data/units';
import { cloneJson } from '../json';
import type { GameState, PlayerId } from '../types';
import { updateKnowledge } from '../view/visibility';
import { accepted, noChange, rejected } from './results';
import { cityById } from './stateQueries';

type SetProductionAction = Extract<Action, { type: 'setProduction' }>;

/** Chooses what one of the player's cities builds. Production already stored is kept. */
export function setProduction(state: GameState, playerId: PlayerId, action: SetProductionAction): ActionResult {
  const city = cityById(state, action.cityId);
  if (city === null || city.owner !== playerId) return rejected('noSuchCity');

  const unitType = buildableUnitType(action.item);
  if (unitType === null) return rejected('cannotBuild');

  if (city.production !== null && city.production.unitType === unitType) return noChange(state);

  const draft = cloneJson(state);
  // A fresh object with exactly the known fields: whatever else a client may
  // have put into `item` must never be stored (it would come back in views).
  draft.cities[city.id].production = { kind: 'unit', unitType };
  // Nothing anybody sees has moved, but every changed state leaves the
  // engine with its fog-of-war memory brought up to date.
  updateKnowledge(draft);
  return accepted(draft, []);
}

/**
 * The unit type the item asks for, or null if a city cannot build it.
 * Phase 1: `kind` must be 'unit' and `unitType` a key of the UNITS table
 * (a real key: 'constructor' and the like are not unit types).
 */
function buildableUnitType(item: SetProductionAction['item']): UnitTypeId | null {
  const fields: { kind?: unknown; unitType?: unknown } = item;
  if (fields.kind !== 'unit') return null;
  if (typeof fields.unitType !== 'string' || !Object.hasOwn(UNITS, fields.unitType)) return null;
  return fields.unitType as UnitTypeId;
}
