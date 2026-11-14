/**
 * Unit panel (work package WP4): shown while one of the player's units is
 * selected.
 */

import { RULE_ERROR_MESSAGES, UNITS } from '@domination/shared';
import type { Controller } from '../game/controller';
import { myPlayer, selectedUnit } from '../game/selectors';
import type { AppState, Store } from '../state/store';
import { setCivColors } from './civColors';
import { h, setDisabled, setHidden, setText } from './dom';
import type { Unmount } from './dom';
import { TEST_IDS } from './testIds';
import { movesText, unitHintText } from './texts';

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
 *
 * It also carries a line that says what can be done with the unit right
 * now ("Choose a highlighted tile to move there.") and, when something else
 * of the player's stands on the same tile, how to select that (unitHintText
 * in texts.ts), and a close button for touch screens, which have no Escape
 * key.
 */
export function mountUnitPanel(parent: HTMLElement, store: Store, controller: Controller): Unmount {
  const swatch = h('span', { className: 'swatch' });
  const name = h('h2', { className: 'panel-title', testId: TEST_IDS.unitName });
  const closeButton = h('button', {
    className: 'button panel-close',
    text: '\u00d7', // the multiplication sign: a cross that every font has
    attributes: { 'aria-label': 'Close', title: 'Close (Esc)' },
    onClick: () => controller.deselect(),
  });
  const moves = h('div', { className: 'panel-stat', testId: TEST_IDS.unitMoves });
  const hint = h('p', { className: 'panel-hint' });

  const foundButton = h('button', {
    className: 'button primary',
    text: 'Found City',
    testId: TEST_IDS.foundCityButton,
    attributes: { title: 'Found a city here (F)' },
    onClick: () => controller.foundCity(),
  });
  const foundReason = h('p', { className: 'panel-reason' });
  const foundRow = h('div', { className: 'found-row' }, foundButton, foundReason);

  const panel = h(
    'div',
    { className: 'panel unit-panel', testId: TEST_IDS.unitPanel },
    h('div', { className: 'panel-head' }, swatch, name, closeButton),
    moves,
    hint,
    foundRow,
  );
  panel.hidden = true;
  parent.append(panel);

  function update(state: AppState): void {
    const unit = selectedUnit(state);
    const view = state.game?.view ?? null;
    if (unit === null || view === null || unit.own === null || unit.owner !== view.you) {
      setHidden(panel, true);
      return;
    }
    setHidden(panel, false);

    setCivColors(swatch, myPlayer(view).civ);
    setText(name, UNITS[unit.type].name);
    setText(moves, movesText(unit));
    setText(hint, unitHintText(view, unit, state.connection === 'online'));

    const canFound = UNITS[unit.type].canFoundCity;
    setHidden(foundRow, !canFound);
    if (canFound) {
      const error = unit.own.foundCityError;
      setDisabled(foundButton, error !== null || state.busy);
      setText(foundReason, error === null ? '' : RULE_ERROR_MESSAGES[error]);
      setHidden(foundReason, error === null);
    }
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    panel.remove();
  };
}
