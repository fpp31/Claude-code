/**
 * Top bar of the game screen (work package WP4).
 */

import type { Store } from '../state/store';
import type { Unmount } from './dom';

/**
 * Shows, left to right:
 *  - the turn number (TEST_IDS.topTurn, "Turn 7");
 *  - the player's own civilization (topCiv) as a colour badge with its name;
 *  - one chip per player in seat order (`top-player-<playerId>`, attribute
 *    data-ended): name in the civ's colours, a tick when they have ended
 *    their turn, greyed when they are not connected (game.connected);
 *  - the connection status (topConnection): the exact text "online",
 *    "connecting" or "reconnecting".
 * Built once; updated in place on store changes.
 */
export function mountTopBar(parent: HTMLElement, store: Store): Unmount {
  throw new Error('not implemented: mountTopBar');
}
