/**
 * Unit panel (work package WP4): shown while one of the player's units is
 * selected.
 */

import { IMPROVEMENT_IDS, RULE_ERROR_MESSAGES, UNITS } from '@domination/shared';
import type { ImprovementId, UnitId } from '@domination/shared';
import type { Controller } from '../game/controller';
import { myPlayer, ordersClosed, selectedUnit } from '../game/selectors';
import { unitTileText } from '../game/tileInfo';
import type { AppState, Store } from '../state/store';
import { setCivColors } from './civColors';
import { h, setBar, setDisabled, setHidden, setText } from './dom';
import type { Unmount } from './dom';
import { TEST_IDS } from './testIds';
import {
  improvementBonusText,
  jobButtonText,
  jobProgressText,
  jobReasonText,
  jobsReasonText,
  movesText,
  progressFraction,
  unitHintParts,
} from './texts';

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
 *    empty, or the unit has a job): the job block (unitJobs). Without a job
 *    it holds one button per improvement (`job-start-<id>`: "Build Farm
 *    (4 turns)" and what it adds) with the reason under a button that is
 *    greyed out (`job-reason-<id>`), or ONE sentence over the buttons when
 *    all of them are impossible for the same reason (unitJobsReason).
 *    Click: controller.startJob(id). With a job it holds the progress
 *    ("Building a Farm: 3 turns left", unitJob), a bar, and "Stop work"
 *    (jobStop) with the warning that the work done is lost.
 *    Click: controller.stopJob();
 *  - one line about the tile the unit stands on (unitTile; unitTileText in
 *    game/tileInfo.ts, the words of the tile card);
 *  - what can be done with the unit right now ("Choose a highlighted tile
 *    to move there.") and, when something else of the player's stands on
 *    the same tile, how to select that (unitHintParts in texts.ts; the
 *    second sentence is left out in a low window).
 *
 * GREYING (one rule for every button that gives an order): a button is
 * disabled when the player cannot give orders for a lasting reason
 * (ordersClosed: no connection, turn ended; the hint says which) or when
 * its own reason says so. It is never disabled for the blink of a round
 * trip (`busy`): a press in that blink is ignored by the controller.
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
  const stopButton = h('button', {
    className: 'button',
    text: 'Stop work',
    testId: TEST_IDS.jobStop,
    attributes: { title: 'Stop this work (what was done so far is lost)' },
    onClick: () => controller.stopJob(),
  });
  const stopRow = h(
    'div',
    { className: 'job-stop-row' },
    h('p', { className: 'panel-hint', text: 'The work done so far is lost.' }),
    stopButton,
  );
  const jobs = h(
    'div',
    { className: 'unit-jobs', testId: TEST_IDS.unitJobs },
    jobsTitle,
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
    if (unit === null || view === null || unit.own === null || unit.owner !== view.you) {
      setHidden(panel, true);
      shownUnit = null;
      return;
    }
    setHidden(panel, false);
    const own = unit.own;
    const closed = ordersClosed(state) !== null;

    setCivColors(swatch, myPlayer(view).civ);
    setText(name, UNITS[unit.type].name);
    setText(description, UNITS[unit.type].description);
    setText(moves, movesText(unit));

    const canFound = UNITS[unit.type].canFoundCity;
    setHidden(foundRow, !canFound);
    if (canFound) {
      const error = own.foundCityError;
      setDisabled(foundButton, error !== null || closed);
      setText(foundReason, error === null ? '' : RULE_ERROR_MESSAGES[error]);
      setHidden(foundReason, error === null);
    }

    const job = own.job;
    const atWork = job !== null;
    setHidden(jobs, own.jobOptions.length === 0 && !atWork);

    // Without a job: the buttons, each with its reason, or one reason for them all.
    const oneReason = atWork ? null : jobsReasonText(own.jobOptions);
    setHidden(jobsTitle, atWork);
    setText(jobsReason, oneReason ?? '');
    setHidden(jobsReason, oneReason === null);
    for (const [improvement, parts] of jobRows) {
      const option = own.jobOptions.find((candidate) => candidate.improvement === improvement);
      setHidden(parts.row, atWork || option === undefined);
      if (option === undefined) continue;
      setText(parts.name, jobButtonText(option));
      setDisabled(parts.button, option.error !== null || closed);
      // Its own reason, unless one sentence says it for all, or the unit is at work (the block then shows the work).
      const reason = atWork || oneReason !== null ? null : jobReasonText(option);
      setText(parts.reason, reason ?? '');
      setHidden(parts.reason, reason === null);
    }

    // With a job: how far it is, and the way out.
    setHidden(jobProgress, !atWork);
    setHidden(jobBar, !atWork);
    setHidden(stopRow, !atWork);
    if (job !== null) {
      setText(jobProgress, jobProgressText(job));
      setBar(jobFill, progressFraction(job.turnsWorked, job.turnsTotal));
      setDisabled(stopButton, closed);
    }

    setText(tileLine, unitTileText(view, unit));
    const parts = unitHintParts(view, unit, state.connection === 'online');
    setText(hintMain, parts.main);
    setText(hintMore, parts.more === '' ? '' : ` ${parts.more}`);
    setHidden(hintMore, parts.more === '');

    // A new subject starts at the top.
    if (unit.id !== shownUnit) panel.scrollTop = 0;
    shownUnit = unit.id;
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    panel.remove();
  };
}
