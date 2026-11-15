/**
 * The startJob and stopJob actions. The rules are spelled out in the doc
 * comment of applyAction; whether a job may be started at all is decided by
 * startJobError in improvements.ts.
 *
 * Internal: reached only through applyAction.
 */

import type { Action, ActionResult } from '../actions';
import { cloneJson } from '../json';
import type { GameState, PlayerId } from '../types';
import { updateKnowledge } from '../view/visibility';
import { startJobError } from './improvements';
import { accepted, noChange, rejected } from './results';
import { unitById } from './stateQueries';

/** Sets one of the player's units to work on its tile. The rules are spelled out in the doc comment of applyAction. */
export function startJob(state: GameState, playerId: PlayerId, action: Extract<Action, { type: 'startJob' }>): ActionResult {
  // "Not yours" and "does not exist" get the same answer, so ids cannot be probed.
  const unit = unitById(state, action.unitId);
  if (unit === null || unit.owner !== playerId) return rejected('noSuchUnit');

  // What a client sent: a string (applyAction has made sure of that), but
  // any string until startJobError has found it among the table's own keys.
  const improvement = action.improvement;
  if (unit.job !== null && unit.job.improvement === improvement) return noChange(state);

  const refusal = startJobError(state, unit, improvement);
  if (refusal !== null) return rejected(refusal);

  const draft = cloneJson(state);
  // A fresh object with exactly the known fields: the one thing taken from
  // the client is that string.
  draft.units[unit.id].job = { improvement, turnsWorked: 0 };
  // Nothing anybody sees has moved, but every changed state leaves the
  // engine with its fog-of-war memory brought up to date.
  updateKnowledge(draft);
  return accepted(draft, []);
}

/** Ends the job of one of the player's units. */
export function stopJob(state: GameState, playerId: PlayerId, action: Extract<Action, { type: 'stopJob' }>): ActionResult {
  const unit = unitById(state, action.unitId);
  if (unit === null || unit.owner !== playerId) return rejected('noSuchUnit');

  if (unit.job === null) return noChange(state);

  const draft = cloneJson(state);
  draft.units[unit.id].job = null; // the turns worked are gone with it
  updateKnowledge(draft);
  return accepted(draft, []);
}
