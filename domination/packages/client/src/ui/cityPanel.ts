/**
 * City panel (work package WP4): shown while one of the player's cities is
 * selected.
 */

import type { Controller } from '../game/controller';
import type { Store } from '../state/store';
import type { Unmount } from './dom';

/**
 * The panel (TEST_IDS.cityPanel) is hidden unless selectedCity(state) is an
 * own city. Everything it prints comes ready-made from city.own
 * (OwnCityDetail); the panel does no rule maths.
 *  - name (cityName) and population (cityPopulation);
 *  - food (cityFood): "Food 4/16 (+2 per turn)" with a progress bar;
 *  - production (cityProduction): "Warrior 6/18 (+3 per turn, 4 turns)" with
 *    a progress bar, or "Nothing chosen". If city.own.productionBlocked is
 *    set, add the reason in the same element, so a full bar that does not
 *    turn into a unit is explained: 'needsPopulation' -> "Waiting: the city
 *    needs 2 population" (1 + UNITS[type].populationCost), 'noRoom' ->
 *    "Waiting: no free tile for the unit";
 *  - the build menu: one button per city.own.buildOptions entry
 *    (`build-<unitTypeId>`) with name, cost and turns; the current choice is
 *    marked; a unit with UNITS[type].populationCost > 0 notes "uses 1
 *    population". Click: controller.setProduction(item). Disabled while busy.
 * Built once; updated in place (the build buttons are created once per unit
 * type and only their texts and marks change).
 *
 * The tiles the city works are not listed in the panel: they are marked on
 * the map while the city is selected (overlayFor fills MapOverlay.workedTiles).
 */
export function mountCityPanel(parent: HTMLElement, store: Store, controller: Controller): Unmount {
  throw new Error('not implemented: mountCityPanel');
}
