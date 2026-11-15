/**
 * City panel (work package WP4): shown while one of the player's cities is
 * selected. Its main part is the build queue: what the city builds, in
 * which order, and the buttons that change that.
 */

import { UNITS, UNIT_TYPE_IDS } from '@domination/shared';
import type { CityId, UnitTypeId } from '@domination/shared';
import type { Controller } from '../game/controller';
import { myPlayer, ordersClosed, selectedCity } from '../game/selectors';
import type { AppState, Store } from '../state/store';
import { setCivColors } from './civColors';
import { h, setBar, setClass, setDisabled, setHidden, setText } from './dom';
import type { Unmount } from './dom';
import { createPressGuard } from './pressGuard';
import { TEST_IDS } from './testIds';
import {
  buildOptionText,
  foodText,
  populationText,
  productionNoteText,
  productionText,
  progressFraction,
  queueCountText,
  queueNoteText,
  queueRowText,
} from './texts';

/**
 * For this long after a press of a queue ROW button (up, down, remove) went
 * out, every row button of the panel ignores presses. A double-click then
 * removes one entry, not two, and an arrow does not undo itself. "Empty the
 * queue" counts its second press only after the same time.
 */
export const QUEUE_ROW_GUARD_MS = 600;

/** How long "Empty the queue" waits for its second press before it goes back to asking. */
const CLEAR_ASKS_FOR_MS = 4000;
/** How long an add button says "Added to the queue" after its item has arrived in the queue. */
const ADDED_NOTE_MS = 1200;

/** The parts of one row of the queue. */
interface QueueRow {
  row: HTMLElement;
  name: HTMLElement;
  when: HTMLElement;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
  remove: HTMLButtonElement;
}

/** The parts of one button of the add list. */
interface BuildButton {
  button: HTMLButtonElement;
  detail: HTMLElement;
}

/**
 * The panel (TEST_IDS.cityPanel) is hidden unless selectedCity(state) is an
 * own city. Everything it prints comes ready-made from city.own
 * (OwnCityDetail) through ui/texts.ts; the panel does no rule maths. Top
 * to bottom:
 *  - the head, which stays in sight while the panel scrolls: name
 *    (cityName), close button, and under them population (cityPopulation)
 *    and "Queue 2 of 8" (queueCount);
 *  - food (cityFood): "Food 4/16 (+2 per turn)" with a progress bar;
 *  - the current build (cityProduction): the first entry of the queue,
 *    "Warrior 6/18 (+3 per turn, 4 turns)" with a progress bar, or "Nothing
 *    to build." (productionText). What follows it stands in the same
 *    element (productionNoteText): that an empty queue loses the
 *    production, or why a paid-for entry is held ("Waiting: the city must
 *    grow first");
 *  - the queue (cityQueue): one row per entry (`queue-row-N`) with its
 *    place, its name and when it will be done (queueRowText), and three
 *    buttons: up (`queue-up-N`), down (`queue-down-N`) and, a little apart,
 *    remove (`queue-remove-N`). Above the rows a line says why the queue
 *    cannot be changed, when it cannot (queueNote). Under the rows,
 *    "Empty the queue" (queueClear);
 *  - the add list: one button per city.own.buildOptions entry
 *    (`build-<unitTypeId>`) with name, cost and when it would be done
 *    (buildOptionText), and the unit's description. A press puts the item
 *    at the END of the queue.
 *
 * HOW THE BUTTONS BEHAVE
 *  - Nothing is shown at a press. The panel sends what the player wants
 *    (controller.addToQueue, removeFromQueue, moveInQueue, clearQueue) and
 *    changes only when the server's view comes back.
 *  - A row's buttons always mean "entry N of the queue as the view shows it
 *    at the moment of the press". Row N is made the first time the queue
 *    has N + 1 entries and is never removed or rebuilt afterwards; a
 *    shorter queue hides the rows beyond its end. Up on the first row and
 *    down on the last are greyed out, never hidden.
 *  - ONE guard for all row buttons (QUEUE_ROW_GUARD_MS): after a removal
 *    another row's button lies under the finger, so a guard per button
 *    would not do. The add buttons have no guard: two quick taps on
 *    "Warrior" are two Warriors.
 *  - "Empty the queue" asks once: the first press only turns it into "Tap
 *    again to empty the queue". It goes back to asking after four seconds,
 *    when the queue changes, and when the panel shows another city or is
 *    hidden.
 *  - When an item has arrived in the queue, the add button that was
 *    pressed says "Added to the queue" for a moment: on a phone the new row
 *    may be out of sight above the button.
 *  - GREYING: every row button, "Empty the queue" and every add button is
 *    disabled while the player cannot give orders for a lasting reason
 *    (ordersClosed: no connection, turn ended; queueNote says which), an
 *    add button also while its option's addError says so (a full queue).
 *    Nothing is disabled for the blink of a round trip (`busy`): a press in
 *    that blink is ignored by the controller. The close button and the
 *    scrolling are never disabled.
 *  - THE ADD LIST KEEPS ITS PLACE ON SCREEN. A row that appears above the
 *    add list in a panel that cannot grow any more would push the add
 *    buttons down, away from under the finger. The panel then scrolls
 *    itself by as much as the list moved, so a second tap on "Warrior"
 *    lands on "Warrior".
 *
 * Built once; updated in place. When the panel shows another city than at
 * its last update, or was hidden before, it starts at its top again.
 *
 * The tiles the city works are not listed in the panel: they are marked on
 * the map while the city is selected (overlayFor fills MapOverlay.workedTiles).
 */
export function mountCityPanel(parent: HTMLElement, store: Store, controller: Controller): Unmount {
  const swatch = h('span', { className: 'swatch' });
  const name = h('h2', { className: 'panel-title', testId: TEST_IDS.cityName });
  const population = h('span', { className: 'panel-subtitle', testId: TEST_IDS.cityPopulation });
  const queueCount = h('span', { className: 'panel-subtitle', testId: TEST_IDS.queueCount });
  const closeButton = h('button', {
    className: 'button panel-close',
    text: '×', // the multiplication sign: a cross that every font has
    attributes: { 'aria-label': 'Close', title: 'Close (Esc)' },
    onClick: () => controller.deselect(),
  });

  const food = h('div', { className: 'panel-stat', testId: TEST_IDS.cityFood });
  const foodFill = h('div', { className: 'bar-fill food' });

  // The progress text and the "Waiting: ..." reason are two parts of ONE
  // element, so that reading the element gives the whole explanation.
  const productionMain = h('span');
  const productionNote = h('span', { className: 'blocked' });
  const production = h('div', { className: 'panel-stat', testId: TEST_IDS.cityProduction }, productionMain, productionNote);
  const productionFill = h('div', { className: 'bar-fill production' });

  // ---- The queue ----
  const queueTitle = h('h3', { className: 'build-title', text: 'Build queue' });
  const queueNote = h('p', { className: 'panel-reason', testId: TEST_IDS.queueNote });
  const queueList = h('div', { className: 'queue-list', testId: TEST_IDS.cityQueue });
  const queueRows: QueueRow[] = [];
  const rowGuard = createPressGuard(QUEUE_ROW_GUARD_MS);

  function makeRow(index: number): QueueRow {
    const rowName = h('span', { className: 'queue-name' });
    const when = h('span', { className: 'queue-when' });
    const up = h('button', {
      className: 'button queue-button queue-up',
      testId: TEST_IDS.queueUp + index,
      attributes: { 'aria-label': 'Move up', title: 'Move up' },
      onClick: () => rowGuard.press(() => controller.moveInQueue(index, -1)),
    });
    const down = h('button', {
      className: 'button queue-button queue-down',
      testId: TEST_IDS.queueDown + index,
      attributes: { 'aria-label': 'Move down', title: 'Move down' },
      onClick: () => rowGuard.press(() => controller.moveInQueue(index, 1)),
    });
    // Removing the first row stops what the city is building; say that it costs nothing.
    const removeWords = index === 0 ? 'Stop building this (what the city has saved is kept)' : 'Remove from the queue';
    const remove = h('button', {
      className: 'button queue-button queue-remove',
      text: '×', // the multiplication sign, like the close button
      testId: TEST_IDS.queueRemove + index,
      attributes: { 'aria-label': removeWords, title: removeWords },
      onClick: () => rowGuard.press(() => controller.removeFromQueue(index)),
    });
    const row = h(
      'div',
      { className: 'queue-row', testId: TEST_IDS.queueRow + index },
      h('span', { className: 'queue-position', text: String(index + 1) }),
      rowName,
      when,
      up,
      down,
      remove,
    );
    return { row, name: rowName, when, up, down, remove };
  }

  // ---- "Empty the queue" asks once ----
  /** When the first press came (Date.now()), or null while the button is not waiting for its second press. */
  let clearAskedAt: number | null = null;
  /** The queue as it was at the first press: a queue that changed meanwhile is not the one the player meant. */
  let clearAskedFor = '';
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  function stopAskingToClear(): void {
    clearAskedAt = null;
    if (clearTimer !== null) clearTimeout(clearTimer);
    clearTimer = null;
  }

  const clearButton = h('button', {
    className: 'button queue-clear',
    testId: TEST_IDS.queueClear,
    onClick: () => {
      if (clearAskedAt === null) {
        clearAskedAt = Date.now();
        clearAskedFor = queueKey(store.get());
        clearTimer = setTimeout(() => {
          stopAskingToClear();
          update(store.get());
        }, CLEAR_ASKS_FOR_MS);
      } else {
        // The second click of a double-click comes too soon to count as an answer.
        if (Date.now() - clearAskedAt < QUEUE_ROW_GUARD_MS) return;
        if (controller.clearQueue()) stopAskingToClear();
      }
      update(store.get());
    },
  });

  // ---- The add list ----
  /** The add button whose press went out last, and how long the queue was then: its item is on its way. */
  let sentAdd: { cityId: CityId; unitType: UnitTypeId; queueLength: number } | null = null;
  /** The add button that says "Added to the queue" right now. */
  let addedNote: UnitTypeId | null = null;
  let addedTimer: ReturnType<typeof setTimeout> | null = null;

  function stopAddedNote(): void {
    addedNote = null;
    if (addedTimer !== null) clearTimeout(addedTimer);
    addedTimer = null;
  }

  const addTitle = h('h3', { className: 'build-title' });
  const buildMenu = h('div', { className: 'build-menu' });
  const buildButtons = new Map<UnitTypeId, BuildButton>();
  for (const unitType of UNIT_TYPE_IDS) {
    const detail = h('span', { className: 'build-detail' });
    const button = h(
      'button',
      {
        className: 'button build-button',
        testId: TEST_IDS.buildOption + unitType,
        onClick: () => {
          const city = selectedCity(store.get());
          if (city === null || city.own === null) return;
          const queueLength = city.own.buildQueue.length;
          // Remembered only for a press that really went out: an ignored one adds nothing.
          if (controller.addToQueue({ kind: 'unit', unitType })) sentAdd = { cityId: city.id, unitType, queueLength };
        },
      },
      h('span', { className: 'build-name', text: UNITS[unitType].name }),
      detail,
      h('span', { className: 'build-about', text: UNITS[unitType].description }),
    );
    buildButtons.set(unitType, { button, detail });
    buildMenu.append(button);
  }

  const panel = h(
    'div',
    { className: 'panel city-panel', testId: TEST_IDS.cityPanel },
    h(
      'div',
      { className: 'panel-head' },
      swatch,
      name,
      closeButton,
      h('div', { className: 'panel-facts' }, population, queueCount),
    ),
    food,
    h('div', { className: 'bar' }, foodFill),
    production,
    h('div', { className: 'bar' }, productionFill),
    queueTitle,
    queueNote,
    queueList,
    clearButton,
    addTitle,
    buildMenu,
    h('p', { className: 'panel-hint', text: 'The marked tiles on the map are the ones this city works.' }),
  );
  panel.hidden = true;
  parent.append(panel);

  /** The city the panel showed at its last update; null while it is hidden. */
  let shownCity: CityId | null = null;

  function update(state: AppState): void {
    const city = selectedCity(state);
    const view = state.game?.view ?? null;
    if (city === null || view === null || city.own === null || city.owner !== view.you) {
      setHidden(panel, true);
      shownCity = null;
      sentAdd = null;
      stopAskingToClear();
      stopAddedNote();
      return;
    }
    const own = city.own;
    const newSubject = city.id !== shownCity;
    if (newSubject) {
      sentAdd = null;
      stopAskingToClear();
      stopAddedNote();
    }
    // Where the add list is on screen before anything changes (see "THE ADD LIST KEEPS ITS PLACE").
    const addListWas = newSubject ? null : addTitle.getBoundingClientRect().top;
    setHidden(panel, false);

    const closed = ordersClosed(state);
    const idle = own.buildQueue.length === 0;

    setCivColors(swatch, myPlayer(view).civ);
    setText(name, city.name);
    setText(population, populationText(city.population));
    setText(queueCount, queueCountText(own));

    setText(food, foodText(own));
    setBar(foodFill, progressFraction(own.foodStored, own.foodToGrow));

    const note = productionNoteText(own);
    setText(productionMain, productionText(own));
    setText(productionNote, note === null ? '' : ` ${note}`);
    setClass(production, 'attention', idle);
    setBar(productionFill, progressFraction(own.productionStored, own.buildQueue[0]?.cost ?? null));

    // ---- The queue ----
    const whyNot = queueNoteText(own, closed);
    setText(queueNote, whyNot ?? '');
    setHidden(queueNote, whyNot === null);
    // A title with nothing under it would only be noise: an empty queue is said in gold right above.
    setHidden(queueTitle, idle && whyNot === null);

    while (queueRows.length < own.buildQueue.length) {
      const made = makeRow(queueRows.length);
      queueRows.push(made);
      queueList.append(made.row);
    }
    const last = own.buildQueue.length - 1;
    queueRows.forEach((parts, index) => {
      const entry = own.buildQueue[index];
      setHidden(parts.row, entry === undefined);
      if (entry === undefined) return;
      setText(parts.name, UNITS[entry.item.unitType].name);
      setText(parts.when, queueRowText(entry, index));
      setDisabled(parts.up, closed !== null || index === 0);
      setDisabled(parts.down, closed !== null || index === last);
      setDisabled(parts.remove, closed !== null);
    });

    // "Empty the queue": it stops waiting for its second press when it is
    // no longer about the same queue, or can no longer be pressed.
    if (clearAskedAt !== null && (closed !== null || clearAskedFor !== queueKey(state))) stopAskingToClear();
    setHidden(clearButton, idle);
    setText(clearButton, clearAskedAt === null ? 'Empty the queue' : 'Tap again to empty the queue');
    setClass(clearButton, 'armed', clearAskedAt !== null);
    setDisabled(clearButton, closed !== null);

    // ---- The add list ----
    if (sentAdd !== null && sentAdd.cityId === city.id) {
      if (own.buildQueue.length > sentAdd.queueLength) {
        stopAddedNote();
        addedNote = sentAdd.unitType;
        addedTimer = setTimeout(() => {
          stopAddedNote();
          update(store.get());
        }, ADDED_NOTE_MS);
        sentAdd = null;
      } else if (!state.busy) {
        sentAdd = null; // the answer has come and the queue is no longer: nothing was added
      }
    }
    // An empty build queue is the one thing in this panel that needs the player: say so.
    setText(addTitle, idle ? 'Choose what to build:' : 'Add to the queue:');
    setClass(addTitle, 'attention', idle);
    for (const [unitType, parts] of buildButtons) {
      const option = own.buildOptions.find((candidate) => candidate.item.unitType === unitType);
      setHidden(parts.button, option === undefined);
      if (option === undefined) continue;
      const justAdded = addedNote === unitType;
      setText(parts.detail, justAdded ? 'Added to the queue' : buildOptionText(option));
      setClass(parts.button, 'added', justAdded);
      setDisabled(parts.button, closed !== null || option.addError !== null);
    }

    if (addListWas === null) {
      panel.scrollTop = 0; // a new subject starts at the top
    } else {
      const moved = addTitle.getBoundingClientRect().top - addListWas;
      if (moved !== 0) panel.scrollTop += moved; // the browser keeps the value within what can be scrolled
    }
    shownCity = city.id;
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    stopAskingToClear();
    stopAddedNote();
    panel.remove();
  };
}

/** The selected city's queue as one string, to tell whether it is still the queue it was. '' without an own city. */
function queueKey(state: AppState): string {
  const own = selectedCity(state)?.own ?? null;
  return own === null ? '' : JSON.stringify(own.buildQueue.map((entry) => entry.item));
}
