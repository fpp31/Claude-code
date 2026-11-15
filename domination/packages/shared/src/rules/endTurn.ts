/**
 * The endTurn and cancelEndTurn actions (work package WP2). The rules are
 * spelled out in the doc comment of applyAction.
 *
 * Internal: reached only through applyAction.
 */

import type { ActionResult } from '../actions';
import { getPlayer } from '../ids';
import { cloneJson } from '../json';
import type { GameState, PlayerId } from '../types';
import { updateKnowledge } from '../view/visibility';
import { accepted, noChange } from './results';
import { isTurnComplete, resolveTurn } from './turn';

/**
 * "I am done for this turn." If that makes everybody ready, the turn
 * resolves in this same call, so the server saves and sends one change.
 * (applyAction has already answered the case "ended before" as a no-op.)
 */
export function endTurn(state: GameState, playerId: PlayerId): ActionResult {
  const draft = cloneJson(state);
  getPlayer(draft, playerId).endedTurn = true;

  if (isTurnComplete(draft)) {
    const resolved = resolveTurn(draft);
    return accepted(resolved.state, resolved.events);
  }

  updateKnowledge(draft); // see setBuildQueue: every changed state leaves with fresh memory
  return accepted(draft, []);
}

/** Takes End Turn back. Only possible while the turn has not resolved, that is, while somebody is still playing. */
export function cancelEndTurn(state: GameState, playerId: PlayerId): ActionResult {
  if (!getPlayer(state, playerId).endedTurn) return noChange(state);

  const draft = cloneJson(state);
  getPlayer(draft, playerId).endedTurn = false;
  updateKnowledge(draft);
  return accepted(draft, []);
}
