/**
 * The End Turn button (work package WP4).
 */

import type { Controller } from '../game/controller';
import type { Store } from '../state/store';
import type { Unmount } from './dom';

/**
 * One button (TEST_IDS.endTurnButton, attribute data-ended="true|false"):
 *  - not ended: label "End Turn"; a small hint underneath when something is
 *    still to do ("2 units can still move", "1 city has nothing to build"),
 *    from idleUnits / citiesWithoutProduction. The hint never blocks ending.
 *  - ended: label "Waiting for others - tap to cancel".
 *  - click: controller.toggleEndTurn(). The button does no guarding of its
 *    own: the controller ignores presses for END_TURN_GUARD_MS (0.6 s) after
 *    the button's meaning has changed, which is what makes a double-click
 *    harmless (see Controller.toggleEndTurn). The end-to-end script must
 *    therefore wait that long between two presses of this button.
 *  - disabled while `busy` or while the connection is not 'online'.
 */
export function mountEndTurnButton(parent: HTMLElement, store: Store, controller: Controller): Unmount {
  throw new Error('not implemented: mountEndTurnButton');
}
