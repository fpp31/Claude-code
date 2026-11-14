/**
 * The three possible answers of applyAction, as small constructors so that
 * every action handler spells them the same way (work package WP2).
 *
 * Internal: not part of the package's public exports.
 */

import { ruleError } from '../actions';
import type { ActionResult, AddressedEvent, RuleErrorCode } from '../actions';
import type { GameState } from '../types';

/** "No": the action broke a rule. Nothing was changed. */
export function rejected(code: RuleErrorCode): ActionResult {
  return { ok: false, error: ruleError(code) };
}

/**
 * "Yes, and nothing to do": an accepted action that changes nothing. Hands
 * back the very state object it was given, which is how the server knows it
 * need not save or broadcast.
 */
export function noChange(state: GameState): ActionResult {
  return { ok: true, state, events: [], changed: false };
}

/** "Yes": `draft` is the engine's edited copy of the state, `events` what happened, in order. */
export function accepted(draft: GameState, events: AddressedEvent[]): ActionResult {
  return { ok: true, state: draft, events, changed: true };
}
