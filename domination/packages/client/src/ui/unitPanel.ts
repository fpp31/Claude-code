/**
 * Unit panel (work package WP4): shown while one of the player's units is
 * selected.
 */

import { IMPROVEMENT_IDS, UNITS } from '@domination/shared';
import type { ImprovementId, UnitId } from '@domination/shared';
import type { Controller } from '../game/controller';
import { myPlayer, ordersClosed, selectedUnit } from '../game/selectors';
import { unitTileText } from '../game/tileInfo';
import type { AppState, Store } from '../state/store';
import { setCivColors } from './civColors';
import { h, setAttribute, setBar, setClass, setDisabled, setHidden, setText } from './dom';
import type { Unmount } from './dom';
import { unitPanelButtons } from './panelButtons';
import { ASKS_FOR_MS } from './queuePresses';
import { TEST_IDS } from './testIds';
import { improvementBonusText, jobProgressText, movesText, progressFraction } from './texts';

/** The parts of one job row: the button that starts the job and the line that says why it cannot be started. */
interface JobRow {
  row: HTMLElement;
  button: HTMLButtonElement;
  name: HTMLElement;
  reason: HTMLElement;
}

/**
 * The panel (TEST_IDS.unitPanel) is hidden unless selectedUnit(state) is an
 * own unit. Top to bottom, the things to press before the things to read,
 * so that a low window shows the buttons without scrolling:
 *  - the head: the unit's name from UNITS[type].name (unitName) and a close
 *    button for touch screens, which have no Escape key. It stays in sight
 *    while the panel scrolls;
 *  - what this kind of unit is for, UNITS[type].description
 *    (unitDescription; left out in a low window);
 *  - moves left as "Moves 1/2" (unitMoves);
 *  - for units that can found cities (UNITS[type].canFoundCity): a
 *    "Found City" button (foundCityButton), enabled exactly when
 *    unit.own.foundCityError is null and the player may give orders; when
 *    the unit's own reason disables it, that reason
 *    (RULE_ERROR_MESSAGES[foundCityError]) is shown next to it.
 *    Click: controller.foundCity();
 *  - for units that can build improvements (unit.own.jobOptions is not
 *    empty, or the unit has a job): the job block (unitJobs). Its first
 *    line, while no order can be given at all, says why (unitJobsClosed:
 *    no connection, turn ended). Without a job it holds one button per
 *    improvement the unit's type builds (`job-start-<id>`: "Build Farm (4
 *    turns)" and what it adds; a Worker has two, a Fishing Boat one: the
 *    rows are built for every improvement there is and shown for the job
 *    options the server sends) with the reason under a button that is
 *    greyed out
 *    (`job-reason-<id>`), or ONE sentence over the buttons when all of
 *    them are impossible for the same reason (unitJobsReason). While the
 *    first line says that no order can be given, these reasons are left
 *    out: one sentence over two grey buttons, which is what fits into a
 *    phone's panel without scrolling.
 *    Click: controller.startJob(id). With a job it holds the progress
 *    ("Building a Farm: 3 turns left", unitJob), a bar, and "Stop work"
 *    (jobStop) with, while it can be pressed, the small print that says
 *    what stopping loses ("Stopping loses 3 turns of work.",
 *    jobStopWarning). The button's tooltip says the same, from the same
 *    number ("Stop this work (3 turns of work are lost)").
 *    Click: controller.stopJob();
 *  - one line about the tile the unit stands on (unitTile; unitTileText in
 *    game/tileInfo.ts, the words of the tile card);
 *  - what can be done with the unit right now ("Choose a highlighted tile
 *    to move there.") and, when something else of the player's stands on
 *    the same tile, how to select that (unitHintParts in texts.ts; the
 *    second sentence is left out in a low window). The first sentence is
 *    left out when the job block has already said why nothing can be
 *    ordered.
 *
 * A PANEL THAT HAS JUST OPENED: for half a second after the selection went
 * to another unit, Found City, the job buttons and "Stop work" do nothing
 * (the controller's selection guard, Controller.foundCity). The panel comes
 * up where the map was, on a phone where the tapped unit itself stood, and
 * the second tap of a double tap would land on one of them. Nothing is
 * greyed for that half second.
 *
 * "STOP WORK" ASKS ONCE before it throws turns of work away (round 3). The
 * rule is the controller's (Controller.stopJob, with the clock and the
 * guards); the panel prints what unitPanelButtons answers for
 * controller.askingToStop(): after the first press the button reads "Tap
 * again to stop" in the gold of a button that asks (the class `armed`,
 * data-asking="true") and the small print "3 turns will be lost.". The
 * button keeps its top and its right edge and grows to the left only, so
 * the second press lands on it. The question ends after four seconds
 * without anything in the store changing, so the panel keeps one timer that
 * prints it again then. A job with no turn worked yet is stopped by one
 * press: nothing would be lost.
 *
 * GREYING (one rule for every button that gives an order): which button
 * is greyed out, and the sentence that says why, is the answer of one plain
 * function (unitPanelButtons in ui/panelButtons.ts); the panel prints it.
 * A button is disabled when the player cannot give orders for a lasting
 * reason (ordersClosed: no connection, turn ended; the first line of the
 * job block says which, or the hint for a unit without one) or when its
 * own reason says so. It is never disabled for the blink of a round trip
 * (`busy`): a press in that blink is ignored by the controller.
 *
 * Built once; updated in place. When the panel shows another unit than at
 * its last update, or was hidden before, it starts at its top again.
 */
export function mountUnitPanel(parent: HTMLElement, store: Store, controller: Controller): Unmount {
  const swatch = h('span', { className: 'swatch' });
  const name = h('h2', { className: 'panel-title', testId: TEST_IDS.unitName });
  const closeButton = h('button', {
    className: 'button panel-close',
    text: '×', // the multiplication sign: a cross that every font has
    attributes: { 'aria-label': 'Close', title: 'Close (Esc)' },
    onClick: () => controller.deselect(),
  });
  const description = h('p', { className: 'panel-description', testId: TEST_IDS.unitDescription });
  const moves = h('div', { className: 'panel-stat', testId: TEST_IDS.unitMoves });

  const foundButton = h('button', {
    className: 'button primary',
    text: 'Found City',
    testId: TEST_IDS.foundCityButton,
    attributes: { title: 'Found a city here (F)' },
    onClick: () => controller.foundCity(),
  });
  const foundReason = h('p', { className: 'panel-reason' });
  const foundRow = h('div', { className: 'found-row' }, foundButton, foundReason);

  // ---- The job block: the buttons that start a job, or the job in progress ----
  const jobsTitle = h('h3', { className: 'build-title', text: 'Work on this tile' });
  const jobsClosed = h('p', { className: 'panel-reason', testId: TEST_IDS.unitJobsClosed });
  const jobsReason = h('p', { className: 'panel-reason', testId: TEST_IDS.unitJobsReason });
  const jobRows = new Map<ImprovementId, JobRow>();
  for (const improvement of IMPROVEMENT_IDS) {
    const jobName = h('span', { className: 'job-name' });
    const button = h(
      'button',
      {
        className: 'button job-button',
        testId: TEST_IDS.jobStart + improvement,
        attributes: { title: 'Start this work' },
        onClick: () => controller.startJob(improvement),
      },
      jobName,
      h('span', { className: 'job-about', text: improvementBonusText(improvement) }),
    );
    const reason = h('p', { className: 'panel-reason', testId: TEST_IDS.jobReason + improvement });
    jobRows.set(improvement, { row: h('div', { className: 'job-row' }, button, reason), button, name: jobName, reason });
  }
  const jobProgress = h('div', { className: 'panel-stat', testId: TEST_IDS.unitJob });
  const jobFill = h('div', { className: 'bar-fill production' });
  const jobBar = h('div', { className: 'bar' }, jobFill);

  // ---- "Stop work" asks once ----
  /** Runs while the button asks: it brings the button's words back when the question has run out of time. */
  let askTimer: ReturnType<typeof setTimeout> | null = null;

  function stopAskTimer(): void {
    if (askTimer !== null) clearTimeout(askTimer);
    askTimer = null;
  }

  /**
   * Prints the panel again after `wait` milliseconds. The question ends by
   * time alone, without any change of the store, so nothing else would
   * take "Tap again to stop" off the button.
   */
  function printWhenAskingEnds(wait: number): void {
    stopAskTimer();
    askTimer = setTimeout(() => {
      askTimer = null;
      update(store.get());
      // A browser's timer may run a moment early by the controller's clock: the button then still asks. Look again shortly.
      if (controller.askingToStop()) printWhenAskingEnds(50);
    }, wait);
  }

  const stopButton = h('button', {
    className: 'button job-stop',
    testId: TEST_IDS.jobStop,
    attributes: { 'data-asking': 'false' }, // its tooltip is printed with its words (update, below)
    onClick: () => {
      // A press that was sent shows when the server's view comes back, and an ignored one never. Only the
      // question changes the panel without the store: print it now, and again when its four seconds are over.
      if (controller.stopJob() !== 'asked') return;
      printWhenAskingEnds(ASKS_FOR_MS);
      update(store.get());
    },
  });
  const stopWarning = h('p', { className: 'panel-hint', testId: TEST_IDS.jobStopWarning });
  const stopRow = h('div', { className: 'job-stop-row' }, stopWarning, stopButton);
  const jobs = h(
    'div',
    { className: 'unit-jobs', testId: TEST_IDS.unitJobs },
    jobsTitle,
    jobsClosed,
    jobsReason,
    ...[...jobRows.values()].map((parts) => parts.row),
    jobProgress,
    jobBar,
    stopRow,
  );

  const tileLine = h('div', { className: 'panel-stat', testId: TEST_IDS.unitTile });
  const hintMain = h('span', { className: 'hint-main' });
  const hintMore = h('span', { className: 'hint-more' });
  const hint = h('p', { className: 'panel-hint' }, hintMain, hintMore);

  const panel = h(
    'div',
    { className: 'panel unit-panel', testId: TEST_IDS.unitPanel },
    h('div', { className: 'panel-head' }, swatch, name, closeButton),
    description,
    moves,
    foundRow,
    jobs,
    tileLine,
    hint,
  );
  panel.hidden = true;
  parent.append(panel);

  /** The unit the panel showed at its last update; null while it is hidden. */
  let shownUnit: UnitId | null = null;

  function update(state: AppState): void {
    const unit = selectedUnit(state);
    const view = state.game?.view ?? null;
    /** What is greyed out and why: the panel only prints it. Null for a unit that is not the player's own. */
    const buttons =
      unit === null || view === null ? null : unitPanelButtons(view, unit, ordersClosed(state), controller.askingToStop());
    // The question is over (answered, taken back, another unit, no panel): nothing is left to wait for.
    if (buttons?.jobs?.stop?.asking !== true) stopAskTimer();
    if (unit === null || view === null || unit.own === null || buttons === null) {
      setHidden(panel, true);
      shownUnit = null;
      return;
    }
    setHidden(panel, false);

    setCivColors(swatch, myPlayer(view).civ);
    setText(name, UNITS[unit.type].name);
    setText(description, UNITS[unit.type].description);
    setText(moves, movesText(unit));

    setHidden(foundRow, buttons.found === null);
    if (buttons.found !== null) {
      setDisabled(foundButton, buttons.found.disabled);
      setText(foundReason, buttons.found.reason ?? '');
      setHidden(foundReason, buttons.found.reason === null);
    }

    const block = buttons.jobs;
    setHidden(jobs, block === null);
    if (block !== null) {
      setHidden(jobsTitle, !block.showTitle);
      setText(jobsClosed, block.closed ?? '');
      setHidden(jobsClosed, block.closed === null);
      setText(jobsReason, block.reason ?? '');
      setHidden(jobsReason, block.reason === null);

      // Without a job: the buttons, each with its reason, or one reason for them all.
      for (const [improvement, parts] of jobRows) {
        const start = block.start.find((candidate) => candidate.improvement === improvement);
        setHidden(parts.row, start === undefined);
        if (start === undefined) continue;
        setText(parts.name, start.label);
        setDisabled(parts.button, start.disabled);
        setText(parts.reason, start.reason ?? '');
        setHidden(parts.reason, start.reason === null);
      }

      // With a job: how far it is, and the way out.
      const job = unit.own.job;
      setHidden(jobProgress, job === null);
      setHidden(jobBar, job === null);
      setHidden(stopRow, block.stop === null);
      if (job !== null) {
        setText(jobProgress, jobProgressText(job));
        setBar(jobFill, progressFraction(job.turnsWorked, job.turnsTotal));
      }
      if (block.stop !== null) {
        setText(stopButton, block.stop.label);
        setAttribute(stopButton, 'title', block.stop.title);
        setClass(stopButton, 'armed', block.stop.asking);
        setAttribute(stopButton, 'data-asking', block.stop.asking ? 'true' : 'false');
        setDisabled(stopButton, block.stop.disabled);
        setText(stopWarning, block.stop.warning ?? '');
        setHidden(stopWarning, block.stop.warning === null);
      }
    }

    setText(tileLine, unitTileText(view, unit));
    setText(hintMain, buttons.hint.main);
    setText(hintMore, buttons.hint.more === '' ? '' : `${buttons.hint.main === '' ? '' : ' '}${buttons.hint.more}`);
    setHidden(hintMore, buttons.hint.more === '');
    setHidden(hint, buttons.hint.main === '' && buttons.hint.more === '');

    // A new subject starts at the top.
    if (unit.id !== shownUnit) panel.scrollTop = 0;
    shownUnit = unit.id;
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    stopAskTimer();
    panel.remove();
  };
}
