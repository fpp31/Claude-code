/**
 * Unit panel (work package WP4): shown while one of the player's units is
 * selected.
 */

import type { Controller } from '../game/controller';
import type { Store } from '../state/store';
import type { Unmount } from './dom';

/**
 * The panel (TEST_IDS.unitPanel) is hidden unless selectedUnit(state) is an
 * own unit. It shows:
 *  - the unit's name from UNITS[type].name (unitName);
 *  - moves left as "Moves 1/2" (unitMoves);
 *  - for units that can found cities (UNITS[type].canFoundCity): a
 *    "Found City" button (foundCityButton), enabled exactly when
 *    unit.own.foundCityError is null and the app is not busy; when disabled,
 *    the reason (RULE_ERROR_MESSAGES[foundCityError]) is shown next to it.
 *    Click: controller.foundCity().
 * Built once; updated in place.
 */
export function mountUnitPanel(parent: HTMLElement, store: Store, controller: Controller): Unmount {
  throw new Error('not implemented: mountUnitPanel');
}
