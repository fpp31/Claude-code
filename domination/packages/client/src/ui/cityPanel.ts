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
import { cityPanelButtons } from './panelButtons';
import { createKeyedPressGuard } from './pressGuard';
import {
  CLEAR_ASKS_FOR_MS,
  QUEUE_ROW_GUARD_MS,
  createAskOnce,
  createChangeWatch,
  createQuietTime,
  createRowHold,
  placeCorrection,
} from './queuePresses';
import type { KeptPart } from './queuePresses';
import { TEST_IDS } from './testIds';
import {
  REMOVE_HINT,
  buildOptionText,
  foodText,
  populationText,
  productionNoteText,
  productionText,
  progressFraction,
  queueCountText,
  queueRowText,
} from './texts';

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

/** A box on the screen, in CSS pixels. */
interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The panel (TEST_IDS.cityPanel) is hidden unless selectedCity(state) is an
 * own city. Everything it prints comes ready-made from city.own
 * (OwnCityDetail) through ui/texts.ts; the panel does no rule maths. Top
 * to bottom:
 *  - the head, which stays in sight while the panel scrolls: name
 *    (cityName), close button, under them population (cityPopulation) and
 *    "Queue 2 of 8" (queueCount), and, when the queue cannot be changed,
 *    the sentence that says why (queueNote): no connection, turn ended,
 *    queue full. It stands in the head so that it is on the screen
 *    whenever a greyed button is, however far the panel is scrolled;
 *  - food (cityFood): "Food 4/16 (+2 per turn)" with a progress bar;
 *  - the current build (cityProduction): the first entry of the queue,
 *    "Warrior 6/18 (+3 per turn, 4 turns)" with a progress bar, or "Nothing
 *    to build." (productionText). What follows it stands in the same
 *    element (productionNoteText): that an empty queue loses the
 *    production, or why a paid-for entry is held ("Waiting: the city must
 *    grow first");
 *  - the queue (cityQueue): one row per entry (`queue-row-N`) with its
 *    place, its name and when it will be ready (queueRowText), and three
 *    buttons: up (`queue-up-N`), down (`queue-down-N`) and, a little apart,
 *    remove (`queue-remove-N`). Above the rows one small line says what
 *    the x does and that it costs nothing (queueHint, REMOVE_HINT): a
 *    touch screen never shows the buttons' tooltips. Under the rows,
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
 *
 * A SECOND PRESS ON THE SAME SPOT never does what the player did not
 * choose. The rules are plain functions with a clock (ui/pressGuard.ts,
 * ui/queuePresses.ts); the panel only calls them:
 *  - A panel that has just opened: for half a second after the selection
 *    went to another city, no button of the queue does anything (the
 *    controller's selection guard, Controller.foundCity): the panel may
 *    have come up under the finger that selected the city.
 *  - Row buttons: a press is ignored only within QUEUE_ROW_GUARD_MS of a
 *    press on the SAME button of the SAME row place (a double-click: the
 *    entry that slid under the pointer is safe). That time starts again
 *    when the change shows on the screen (createChangeWatch): on a slow
 *    link the next entry is under the pointer only then. A press on
 *    another row's button counts at once, so "up on row 6, row 5, row 4"
 *    carries one entry to the top at any pace.
 *    While an answer is on its way a row press is ignored (the rows on the
 *    screen are one answer behind), so an entry cannot be walked up faster
 *    than the link answers.
 *  - AFTER A REMOVAL THE ROWS ABOVE STAY WHERE THEY ARE, so that the entry
 *    that followed comes under the pointer, as in any list. The panel is
 *    fixed at its bottom edge and would shrink at its top (or, scrolled to
 *    its end, slide its content down). It keeps its height instead, with a
 *    spacer where the removed row was, and lets go when the mouse has left
 *    the queue, or, for a finger and the keyboard, when a press has landed
 *    outside the rows and has been handled (so that nothing moves between
 *    its down and its up), and at the latest ROW_HOLD_MS after the last
 *    press (createRowHold). Taps on one x two seconds apart therefore take
 *    neighbours, as quick ones do. A removal that empties the queue holds
 *    nothing: no row is left that could slide.
 *  - After a removal (one entry, or "Empty the queue") the add buttons and
 *    "Empty the queue" ignore presses for the same 0.6 s: in a panel that
 *    is scrolled, one of them has moved to where the pressed button was.
 *    Nothing else starts that time, so two quick taps on "Warrior" are two
 *    Warriors. (On a slow link the second tap waits for the first one's
 *    answer: Controller.addToQueue.)
 *  - "Empty the queue" asks once (createAskOnce): the first press only
 *    turns it into "Tap again to empty the queue". It goes back to asking
 *    after four seconds, when the queue changes, and when the panel shows
 *    another city or is hidden.
 *  - KEYBOARD: when the row whose button has the focus goes away, the
 *    focus moves to the remove button of the new last row, or to the close
 *    button when the queue is empty. Left on the page, the next Enter would
 *    end the turn. The button the focus moves to is covered by the guard of
 *    the press that removed the row.
 *
 *  - When an item has arrived in the queue, the add button that was
 *    pressed says "Added to the queue" for a moment: on a phone the new row
 *    may be out of sight above the button.
 *  - GREYING: which button is greyed out, and the sentence that says why,
 *    is the answer of one plain function (cityPanelButtons in
 *    ui/panelButtons.ts); the panel prints it. Every row button, "Empty the
 *    queue" and every add button is disabled while the player cannot give
 *    orders for a lasting reason (ordersClosed: no connection, turn ended;
 *    queueNote says which), an add button also while its option's addError
 *    says so (a full queue). Nothing is disabled for the blink of a round
 *    trip (`busy`): a press in that blink is ignored by the controller. The
 *    close button and the scrolling are never disabled.
 *  - THE ADD LIST KEEPS ITS PLACE ON SCREEN WHEN THE QUEUE GROWS. A row
 *    that appears above the add list in a panel that cannot grow any more
 *    would push the add buttons down, away from under the finger. The panel
 *    then scrolls itself by as much as the list moved, so a second tap on
 *    "Warrior" lands on "Warrior". It looks once more a frame later, when
 *    every other part of the screen has taken the new view in: the End Turn
 *    button's hint can change the room the panel has. (When the queue gets
 *    shorter the add list is NOT kept in place: see the rows, above.)
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
  /** Why the queue cannot be changed. It is part of the head (see the panel below). */
  const queueNote = h('p', { className: 'panel-reason', testId: TEST_IDS.queueNote });
  const queueHint = h('p', { className: 'queue-hint', text: REMOVE_HINT, testId: TEST_IDS.queueHint });
  const queueList = h('div', { className: 'queue-list', testId: TEST_IDS.cityQueue });
  const queueRows: QueueRow[] = [];
  const rowGuard = createKeyedPressGuard(QUEUE_ROW_GUARD_MS);
  /** Tells when the change a press on a row button asked for has shown: the row guard's time starts again then. */
  const rowPressWatch = createChangeWatch();

  /** Notes a press on a row button that went out, and hands `sent` on. */
  function rowPressWentOut(sent: boolean): boolean {
    if (sent) rowPressWatch.sent(queueKey(store.get()));
    return sent;
  }

  // ---- After a removal ----
  /** The add buttons and "Empty the queue" keep quiet while this runs (see "A SECOND PRESS ON THE SAME SPOT"). */
  const afterRemoval = createQuietTime(QUEUE_ROW_GUARD_MS);
  /** A press that removes something has gone out: the city, and how long its queue was then. */
  let sentRemoval: { cityId: CityId; queueLength: number } | null = null;
  /** Did the last press in the panel come from a mouse? (A finger and the keyboard do not rest on the queue afterwards.) */
  let lastPressByMouse = false;

  /** Notes a removal that went out, and hands `sent` on. */
  function removalWentOut(sent: boolean): boolean {
    const city = selectedCity(store.get());
    if (!sent || city === null || city.own === null) return sent;
    sentRemoval = { cityId: city.id, queueLength: city.own.buildQueue.length };
    afterRemoval.start();
    return true;
  }

  function makeRow(index: number): QueueRow {
    const rowName = h('span', { className: 'queue-name' });
    const when = h('span', { className: 'queue-when' });
    const up = h('button', {
      className: 'button queue-button queue-up',
      testId: TEST_IDS.queueUp + index,
      attributes: { 'aria-label': 'Move up', title: 'Move up' },
      onClick: () => rowGuard.press(`up:${index}`, () => rowPressWentOut(controller.moveInQueue(index, -1))),
    });
    const down = h('button', {
      className: 'button queue-button queue-down',
      testId: TEST_IDS.queueDown + index,
      attributes: { 'aria-label': 'Move down', title: 'Move down' },
      onClick: () => rowGuard.press(`down:${index}`, () => rowPressWentOut(controller.moveInQueue(index, 1))),
    });
    // Removing the first row stops what the city is building; say that it costs nothing.
    const removeWords = index === 0 ? 'Stop building this (what the city has saved is kept)' : 'Remove from the queue';
    const remove = h('button', {
      className: 'button queue-button queue-remove',
      text: '×', // the multiplication sign, like the close button
      testId: TEST_IDS.queueRemove + index,
      attributes: { 'aria-label': removeWords, title: removeWords },
      onClick: () => rowGuard.press(`remove:${index}`, () => rowPressWentOut(removalWentOut(controller.removeFromQueue(index)))),
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
  const askToClear = createAskOnce();
  /** Brings the button's words back when the question has run out of time. */
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  function stopAskingToClear(): void {
    askToClear.reset();
    if (clearTimer !== null) clearTimeout(clearTimer);
    clearTimer = null;
  }

  const clearButton = h('button', {
    className: 'button queue-clear',
    testId: TEST_IDS.queueClear,
    onClick: () => {
      if (afterRemoval.running()) return; // it has just moved up to where a removed row's button was
      const press = askToClear.press(queueKey(store.get()));
      if (press === 'ask') {
        if (clearTimer !== null) clearTimeout(clearTimer);
        clearTimer = setTimeout(() => {
          clearTimer = null;
          update(store.get());
        }, CLEAR_ASKS_FOR_MS);
      } else if (press === 'empty' && removalWentOut(controller.clearQueue())) {
        stopAskingToClear();
      }
      update(store.get());
    },
  });

  // ---- The add list ----
  /** The add button whose press was taken last (sent, or kept to be sent after the answer that is on its way): its item is on its way. */
  let sentAdd: { cityId: CityId; unitType: UnitTypeId } | null = null;
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
          if (afterRemoval.running()) return; // it has just moved up to where a removed row's button was
          const city = selectedCity(store.get());
          if (city === null || city.own === null) return;
          // Remembered only for a press that was taken: an ignored one adds nothing.
          if (controller.addToQueue({ kind: 'unit', unitType })) sentAdd = { cityId: city.id, unitType };
        },
      },
      h('span', { className: 'build-name', text: UNITS[unitType].name }),
      detail,
      h('span', { className: 'build-about', text: UNITS[unitType].description }),
    );
    buildButtons.set(unitType, { button, detail });
    buildMenu.append(button);
  }

  /**
   * Gives the panel back the height a removal took from it (see "AFTER A
   * REMOVAL THE ROWS ABOVE STAY"). It stands right under the rows, where
   * the removed row was: what is under it ("Empty the queue", the add
   * list) then stays where it is in a panel that is not scrolled. Empty
   * most of the time.
   */
  const spacer = h('div', { className: 'queue-spacer' });
  spacer.hidden = true;

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
      queueNote,
    ),
    food,
    h('div', { className: 'bar' }, foodFill),
    production,
    h('div', { className: 'bar' }, productionFill),
    queueTitle,
    queueHint,
    queueList,
    spacer,
    clearButton,
    addTitle,
    buildMenu,
    h('p', { className: 'panel-hint', text: 'The marked tiles on the map are the ones this city works.' }),
  );
  panel.hidden = true;
  parent.append(panel);

  /**
   * What is looked at once more at the next frame (see keepInPlace): the
   * part, where its top was before the view changed, and how far the panel
   * was scrolled then (by anybody, and by itself).
   */
  let lookAgain: { part: KeptPart; top: number; scrollTop: number; ownScroll: number } | null = null;
  let lookAgainFrame: number | null = null;
  /** How far the panel has scrolled ITSELF, all in all (putBack). What it is scrolled beyond that, the player did. */
  let ownScroll = 0;

  // ---- The rows keep their place after a removal ----
  const rowHold = createRowHold();
  /** How tall the spacer is, in CSS pixels. */
  let spacerHeight = 0;
  /**
   * Where the queue was on the screen when the hold began: a mouse that
   * moves out of this box has left the queue, and a finger that goes down
   * outside it has pressed outside the rows.
   */
  let holdArea: ScreenBox | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** The press that is going on while the rows are held went down inside this panel: it is handled when its click has run. */
  let pressInPanel = false;

  function setSpacer(height: number): void {
    spacerHeight = height;
    spacer.style.height = `${height}px`;
    setHidden(spacer, height === 0);
  }

  /** Lets go of the panel's height if the hold is over; if not, looks again when time alone can end it. */
  function letGoWhenOver(): void {
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    if (rowHold.holds()) {
      const wait = rowHold.checkIn();
      if (wait !== null) holdTimer = setTimeout(letGoWhenOver, wait);
      return;
    }
    if (holdArea !== null) stopWatchingThePage();
    holdArea = null;
    if (lookAgain !== null && lookAgain.part === 'rows') lookAgain = null; // nothing is held in place any more
    if (spacerHeight === 0) return;
    // Letting go moves the ROWS (down, to where the panel wants them), never
    // what is under them: the pointer has left the rows and may be on its
    // way to "Empty the queue" or to an add button.
    const addListWas = panel.hidden ? null : addTitle.getBoundingClientRect().top;
    setSpacer(0);
    if (addListWas !== null) putBack('addList', addListWas);
  }

  /** Is this point of the screen inside the box the queue had when the hold began? */
  function inHoldArea(x: number, y: number): boolean {
    return holdArea !== null && x >= holdArea.left && x <= holdArea.right && y >= holdArea.top && y <= holdArea.bottom;
  }

  // The five listeners below are on the whole page, and only while the rows
  // are held (startWatchingThePage, stopWatchingThePage): the hold ends by
  // what happens outside the rows.

  /** Has the mouse left the queue? */
  function onPointerMoveWhileHeld(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || holdArea === null || inHoldArea(event.clientX, event.clientY)) return;
    rowHold.mouseLeft();
    letGoWhenOver();
  }

  /** A pointer went down somewhere on the page: on the rows, or outside them? The hold's time starts again. */
  function onPointerDownWhileHeld(event: PointerEvent): void {
    rowHold.pressed(event.pointerType === 'mouse', inHoldArea(event.clientX, event.clientY));
    pressInPanel = event.target instanceof Node && panel.contains(event.target);
    letGoWhenOver();
  }

  /** Enter or Space on a button is a press too: on a button of the rows, or of something else? */
  function onKeyDownWhileHeld(event: KeyboardEvent): void {
    if ((event.key !== 'Enter' && event.key !== ' ') || !(event.target instanceof HTMLButtonElement)) return;
    rowHold.pressed(false, queueList.contains(event.target));
    pressInPanel = true; // a key's press is handled when its click has run, wherever the button stands
    letGoWhenOver();
  }

  /**
   * A click has run through the page: the press that made it is handled.
   * (This listener is on the document, so every button's own handler has
   * run before it.) Only now may the rows move.
   */
  function onClickWhileHeld(): void {
    rowHold.pressHandled();
    letGoWhenOver();
  }

  /**
   * A pointer is up. A press that went down outside this panel is handled
   * by now: the map takes its taps at this very event, and gets no click
   * from a finger. A press inside the panel waits for its click, so that no
   * button of the panel moves between a finger's down and its click.
   */
  function onPointerUpWhileHeld(): void {
    if (!pressInPanel) onClickWhileHeld();
  }

  function startWatchingThePage(): void {
    document.addEventListener('pointermove', onPointerMoveWhileHeld);
    document.addEventListener('pointerdown', onPointerDownWhileHeld, true);
    document.addEventListener('keydown', onKeyDownWhileHeld, true);
    document.addEventListener('click', onClickWhileHeld);
    document.addEventListener('pointerup', onPointerUpWhileHeld);
  }

  function stopWatchingThePage(): void {
    document.removeEventListener('pointermove', onPointerMoveWhileHeld);
    document.removeEventListener('pointerdown', onPointerDownWhileHeld, true);
    document.removeEventListener('keydown', onKeyDownWhileHeld, true);
    document.removeEventListener('click', onClickWhileHeld);
    document.removeEventListener('pointerup', onPointerUpWhileHeld);
  }

  // Who pressed last in this panel: a mouse, which then rests on the queue, or a finger or the keyboard?
  panel.addEventListener('pointerdown', (event) => {
    lastPressByMouse = event.pointerType === 'mouse';
  }, true);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') lastPressByMouse = false;
  }, true);

  // ---- Keeping a part of the panel in its place on the screen ----
  /** Puts the part back where it was (its top at `top`), as far as scrolling and the spacer can. */
  function putBack(part: KeptPart, top: number): void {
    const element = part === 'addList' ? addTitle : queueList;
    let step = placeCorrection(part, element.getBoundingClientRect().top - top);
    if (step.spacerBy !== 0) {
      setSpacer(spacerHeight + step.spacerBy);
      step = placeCorrection(part, element.getBoundingClientRect().top - top, true);
    }
    if (step.scrollBy === 0) return;
    const scrolledWas = panel.scrollTop;
    panel.scrollTop += step.scrollBy; // the browser keeps the value within what can be scrolled
    ownScroll += panel.scrollTop - scrolledWas;
  }

  /**
   * Puts the part back now, and once more at the next frame: by then every
   * other subscriber of the store has run (the End Turn button, whose hint
   * can change the room the panel has), and the places are compared as
   * they are on the screen. Of several changes within one frame the place
   * before the first one counts. What the PLAYER scrolled in the meantime
   * is not undone: the part is put where it would be with that scrolling.
   */
  function keepInPlace(part: KeptPart, top: number): void {
    putBack(part, top);
    if (lookAgain === null || lookAgain.part !== part) lookAgain = { part, top, scrollTop: panel.scrollTop, ownScroll };
    if (lookAgainFrame !== null) return;
    lookAgainFrame = requestAnimationFrame(() => {
      lookAgainFrame = null;
      const again = lookAgain;
      lookAgain = null;
      if (again === null || panel.hidden) return;
      const scrolledByThePlayer = panel.scrollTop - again.scrollTop - (ownScroll - again.ownScroll);
      putBack(again.part, again.top - scrolledByThePlayer);
    });
  }

  /** Forgets everything that was about the city shown until now. */
  function forgetSubject(): void {
    sentAdd = null;
    sentRemoval = null;
    rowPressWatch.forget();
    stopAskingToClear();
    stopAddedNote();
    rowHold.release();
    letGoWhenOver();
    lookAgain = null;
  }

  /** The city the panel showed at its last update; null while it is hidden. */
  let shownCity: CityId | null = null;
  /** How long that city's queue was at the last update. */
  let shownLength = 0;

  function update(state: AppState): void {
    const city = selectedCity(state);
    const view = state.game?.view ?? null;
    if (city === null || view === null || city.own === null || city.owner !== view.you) {
      setHidden(panel, true);
      shownCity = null;
      forgetSubject();
      return;
    }
    const own = city.own;
    const newSubject = city.id !== shownCity;
    if (newSubject) forgetSubject();
    // Where the add list and the rows are on screen before anything changes (see "KEEPS ITS PLACE" and "THE ROWS ABOVE STAY").
    const before = newSubject ? null : { addList: addTitle.getBoundingClientRect().top, rows: queueList.getBoundingClientRect() };
    setHidden(panel, false);

    const closed = ordersClosed(state);
    /** What is greyed out and why: the panel only prints it. */
    const buttons = cityPanelButtons(own, closed);
    const length = own.buildQueue.length;
    const idle = length === 0;

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
    setText(queueNote, buttons.note ?? '');
    setHidden(queueNote, buttons.note === null);
    // A title with nothing under it would only be noise: an empty queue is said in gold right above.
    setHidden(queueTitle, !buttons.hasQueue);
    setHidden(queueHint, !buttons.hasQueue);

    while (queueRows.length < length) {
      const made = makeRow(queueRows.length);
      queueRows.push(made);
      queueList.append(made.row);
    }
    const last = length - 1;
    // The change a press on a row button asked for shows now: that button's guard time starts again (see "Row buttons").
    if (rowPressWatch.shown(queueKey(state), state.busy)) rowGuard.changeShown();
    // The keyboard focus is on a button of a row that is about to go (see "KEYBOARD").
    const focused = document.activeElement;
    const focusGoes = queueRows.some((parts, index) => index > last && !parts.row.hidden && parts.row.contains(focused));
    queueRows.forEach((parts, index) => {
      const entry = own.buildQueue[index];
      const greyed = buttons.rows[index];
      setHidden(parts.row, entry === undefined || greyed === undefined);
      if (entry === undefined || greyed === undefined) return;
      setText(parts.name, UNITS[entry.item.unitType].name);
      setText(parts.when, queueRowText(entry, index));
      setDisabled(parts.up, greyed.upDisabled);
      setDisabled(parts.down, greyed.downDisabled);
      setDisabled(parts.remove, greyed.removeDisabled);
    });
    if (focusGoes) {
      const next = last >= 0 && closed === null ? queueRows[last].remove : closeButton;
      if (next !== closeButton) rowGuard.carryOver(`remove:${last}`);
      next.focus();
    }

    // "Empty the queue": it stops waiting for its second press when it can
    // no longer be pressed. (A queue that changed, or another city, is
    // another question: askToClear.asking says no to it by itself.)
    if (closed !== null) stopAskingToClear();
    const asking = askToClear.asking(queueKey(state));
    setHidden(clearButton, !buttons.hasQueue);
    setText(clearButton, asking ? 'Tap again to empty the queue' : 'Empty the queue');
    setClass(clearButton, 'armed', asking);
    setDisabled(clearButton, buttons.clearDisabled);

    // ---- The add list ----
    // "Added to the queue": the queue has grown, and its newest entry is what the button that was pressed last adds.
    // (Of two quick presses on different buttons the first arrives first: the note waits for the second.)
    if (sentAdd !== null && sentAdd.cityId === city.id) {
      if (before !== null && length > shownLength && own.buildQueue[last].item.unitType === sentAdd.unitType) {
        stopAddedNote();
        addedNote = sentAdd.unitType;
        addedTimer = setTimeout(() => {
          stopAddedNote();
          update(store.get());
        }, ADDED_NOTE_MS);
      }
      if (!state.busy) sentAdd = null; // every answer has come: nothing more is on its way
    }
    // An empty build queue is the one thing in this panel that needs the player: say so.
    setText(addTitle, idle ? 'Choose what to build:' : 'Add to the queue:');
    setClass(addTitle, 'attention', idle);
    for (const [unitType, parts] of buildButtons) {
      const option = own.buildOptions.find((candidate) => candidate.item.unitType === unitType);
      const add = buttons.adds.find((candidate) => candidate.unitType === unitType);
      setHidden(parts.button, option === undefined || add === undefined);
      if (option === undefined || add === undefined) continue;
      const justAdded = addedNote === unitType;
      setText(parts.detail, justAdded ? 'Added to the queue' : buildOptionText(option));
      setClass(parts.button, 'added', justAdded);
      setDisabled(parts.button, add.disabled);
    }

    // ---- Has a removal the player pressed shown? ----
    let removalShown = false;
    if (sentRemoval !== null && sentRemoval.cityId === city.id) {
      if (length < sentRemoval.queueLength) {
        removalShown = true;
        sentRemoval = null;
      } else if (!state.busy) {
        sentRemoval = null; // the answer has come and the queue is no shorter: nothing was removed
      }
    }

    // ---- What must not move on the screen ----
    if (before === null) {
      panel.scrollTop = 0; // a new subject starts at the top
    } else if (length > shownLength) {
      keepInPlace('addList', before.addList);
    } else if (removalShown) {
      // The button that came up under the pointer is there from this moment: its quiet time counts from now.
      afterRemoval.start();
      if (length === 0) {
        // No row is left that could slide under the pointer: the panel takes its own size again.
        rowHold.release();
        letGoWhenOver();
      } else {
        if (!rowHold.holds()) {
          holdArea = { left: before.rows.left, top: before.rows.top, right: before.rows.right, bottom: before.rows.bottom };
          startWatchingThePage();
        }
        rowHold.begin(lastPressByMouse);
        letGoWhenOver(); // (starts the timer of a hold by time)
        keepInPlace('rows', before.rows.top);
      }
    }
    shownCity = city.id;
    shownLength = length;
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    forgetSubject();
    if (lookAgainFrame !== null) cancelAnimationFrame(lookAgainFrame);
    panel.remove();
  };
}

/**
 * The selected city and its queue as one string, to tell whether "Empty the
 * queue" is still about the queue it asked for. '' without an own city.
 */
function queueKey(state: AppState): string {
  const city = selectedCity(state);
  const own = city?.own ?? null;
  return city === null || own === null ? '' : `${city.id}:${JSON.stringify(own.buildQueue.map((entry) => entry.item))}`;
}
