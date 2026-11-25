/**
 * The setBuildQueue action. The rules are spelled out in the doc comment of
 * applyAction.
 *
 * Internal: reached only through applyAction.
 */

import type { Action, ActionResult } from '../actions';
import { RULES } from '../data/rules';
import { UNITS } from '../data/units';
import type { UnitTypeId } from '../data/units';
import { cloneJson, jsonEqual } from '../json';
import type { BuildItem, GameState, PlayerId } from '../types';
import { updateKnowledge } from '../view/visibility';
import { buildItemError } from './city';
import { accepted, noChange, rejected } from './results';
import { cityById } from './stateQueries';

type SetBuildQueueAction = Extract<Action, { type: 'setBuildQueue' }>;

/** Replaces the build queue of one of the player's cities. Production already stored is kept. */
export function setBuildQueue(state: GameState, playerId: PlayerId, action: SetBuildQueueAction): ActionResult {
  const city = cityById(state, action.cityId);
  if (city === null || city.owner !== playerId) return rejected('noSuchCity');

  // What a client sent: a list (applyAction has made sure of that) of anything.
  const wanted: readonly unknown[] = action.queue;
  if (wanted.length > RULES.maxQueueLength) return rejected('queueFull');

  // Fresh objects with exactly the known fields: whatever else a client may
  // have put into an entry must never be stored (it would come back in views).
  const queue: BuildItem[] = [];
  for (const entry of wanted) {
    const unitType = buildableUnitType(entry);
    if (unitType === null) return rejected('cannotBuild');
    queue.push({ kind: 'unit', unitType });
  }
  // Every entry must be something THIS city can ever build (a boat needs
  // water in the city's land). Asked only after ALL entries were rebuilt:
  // a queue with an entry that is no item is 'cannotBuild' wherever a boat
  // stands in it. A stored queue that already holds such a boat (a save
  // edited by hand) is refused too when it is sent again unchanged.
  for (const item of queue) {
    const refusal = buildItemError(state, city, item);
    if (refusal !== null) return rejected(refusal);
  }

  if (jsonEqual(queue, city.buildQueue)) return noChange(state);

  const draft = cloneJson(state);
  draft.cities[city.id].buildQueue = queue;
  // Nothing anybody sees has moved, but every changed state leaves the
  // engine with its fog-of-war memory brought up to date.
  updateKnowledge(draft);
  return accepted(draft, []);
}

/**
 * The unit type an entry asks for, or null if a city cannot build it: the
 * entry must be an object whose `kind` is 'unit' and whose `unitType` is a
 * key of the UNITS table (a real key: 'constructor' and the like are not
 * unit types).
 */
function buildableUnitType(entry: unknown): UnitTypeId | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const fields: { kind?: unknown; unitType?: unknown } = entry;
  if (fields.kind !== 'unit') return null;
  if (typeof fields.unitType !== 'string' || !Object.hasOwn(UNITS, fields.unitType)) return null;
  return fields.unitType as UnitTypeId;
}
