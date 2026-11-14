/**
 * City panel (work package WP4): shown while one of the player's cities is
 * selected.
 */

import { UNITS, UNIT_TYPE_IDS, jsonEqual } from '@domination/shared';
import type { UnitTypeId } from '@domination/shared';
import type { Controller } from '../game/controller';
import { myPlayer, selectedCity } from '../game/selectors';
import type { AppState, Store } from '../state/store';
import { setCivColors } from './civColors';
import { h, setAttribute, setClass, setDisabled, setHidden, setText } from './dom';
import type { Unmount } from './dom';
import { TEST_IDS } from './testIds';
import {
  buildOptionText,
  foodText,
  populationText,
  productionBlockedText,
  productionText,
  progressFraction,
} from './texts';

/** The parts of one button of the build menu. */
interface BuildButton {
  button: HTMLButtonElement;
  detail: HTMLElement;
  mark: HTMLElement;
}

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
  const swatch = h('span', { className: 'swatch' });
  const name = h('h2', { className: 'panel-title', testId: TEST_IDS.cityName });
  const population = h('span', { className: 'panel-subtitle', testId: TEST_IDS.cityPopulation });
  const closeButton = h('button', {
    className: 'button panel-close',
    text: '\u00d7', // the multiplication sign: a cross that every font has
    attributes: { 'aria-label': 'Close', title: 'Close (Esc)' },
    onClick: () => controller.deselect(),
  });

  const food = h('div', { className: 'panel-stat', testId: TEST_IDS.cityFood });
  const foodFill = h('div', { className: 'bar-fill food' });

  // The progress text and the "Waiting: ..." reason are two parts of ONE
  // element, so that reading the element gives the whole explanation.
  const productionMain = h('span');
  const productionBlocked = h('span', { className: 'blocked' });
  const production = h('div', { className: 'panel-stat', testId: TEST_IDS.cityProduction }, productionMain, productionBlocked);
  const productionFill = h('div', { className: 'bar-fill production' });

  const buildTitle = h('h3', { className: 'build-title' });
  const buildMenu = h('div', { className: 'build-menu' });
  const buildButtons = new Map<UnitTypeId, BuildButton>();
  for (const unitType of UNIT_TYPE_IDS) {
    const detail = h('span', { className: 'build-detail' });
    const mark = h('span', { className: 'build-mark', text: 'Building' });
    const button = h(
      'button',
      {
        className: 'button build-button',
        testId: TEST_IDS.buildOption + unitType,
        onClick: () => controller.setProduction({ kind: 'unit', unitType }),
      },
      h('span', { className: 'build-name', text: UNITS[unitType].name }),
      detail,
      mark,
    );
    buildButtons.set(unitType, { button, detail, mark });
    buildMenu.append(button);
  }

  const panel = h(
    'div',
    { className: 'panel city-panel', testId: TEST_IDS.cityPanel },
    h('div', { className: 'panel-head' }, swatch, name, population, closeButton),
    food,
    h('div', { className: 'bar' }, foodFill),
    production,
    h('div', { className: 'bar' }, productionFill),
    buildTitle,
    buildMenu,
    h('p', { className: 'panel-hint', text: 'The marked tiles on the map are the ones this city works.' }),
  );
  panel.hidden = true;
  parent.append(panel);

  function update(state: AppState): void {
    const city = selectedCity(state);
    const view = state.game?.view ?? null;
    if (city === null || view === null || city.own === null || city.owner !== view.you) {
      setHidden(panel, true);
      return;
    }
    setHidden(panel, false);
    const own = city.own;

    setCivColors(swatch, myPlayer(view).civ);
    setText(name, city.name);
    setText(population, populationText(city.population));

    setText(food, foodText(own));
    setBar(foodFill, progressFraction(own.foodStored, own.foodToGrow));

    const blocked = productionBlockedText(own);
    setText(productionMain, productionText(own));
    setText(productionBlocked, blocked === null ? '' : ` ${blocked}`);
    setClass(production, 'attention', own.production === null);
    setBar(productionFill, progressFraction(own.productionStored, own.productionCost));

    // An empty build queue is the one thing in this panel that needs the player: say so.
    setText(buildTitle, own.production === null ? 'Choose what to build:' : 'Build:');
    setClass(buildTitle, 'attention', own.production === null);

    for (const [unitType, parts] of buildButtons) {
      const option = own.buildOptions.find((candidate) => candidate.item.unitType === unitType);
      setHidden(parts.button, option === undefined);
      if (option === undefined) continue;
      const current = own.production !== null && jsonEqual(own.production, option.item);
      setText(parts.detail, buildOptionText(option));
      setHidden(parts.mark, !current);
      setClass(parts.button, 'chosen', current);
      setAttribute(parts.button, 'aria-pressed', current ? 'true' : 'false');
      setDisabled(parts.button, state.busy);
    }
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    panel.remove();
  };
}

/** Fills a progress bar to a fraction from 0 to 1. */
function setBar(fill: HTMLElement, fraction: number): void {
  const width = `${Math.round(fraction * 100)}%`;
  if (fill.style.width !== width) fill.style.width = width;
}
