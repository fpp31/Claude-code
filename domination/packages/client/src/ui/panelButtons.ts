/**
 * What the buttons of the city panel and of the unit panel may do right
 * now, and the sentence that says why not (round 2, the repair after its
 * review). Plain functions of the view, tested in plain Node
 * (test/shellPanelButtons.test.ts): the panels only print what these
 * answer.
 *
 * ONE RULE for every button that gives an order: it is greyed out while the
 * player cannot give orders for a lasting reason (ordersClosed in
 * game/selectors.ts: no connection, turn ended), or when its own reason
 * says so (the view's addError, foundCityError, a job option's error; the
 * first row cannot go up, the last cannot go down). Never for the blink of
 * a round trip. And wherever a button is greyed, a sentence that says why
 * is on the screen with it: in the head of the city panel, over the job
 * buttons, or, for a boat in a city without water, inside the add button
 * itself (buildOptionText in ui/texts.ts).
 *
 * Round 3 added the two buttons "Grow first" / "Build first" of the city
 * panel, and the two wordings of "Stop work", which asks once.
 */

import { CITY_FOCUS, CITY_FOCUS_IDS, RULE_ERROR_MESSAGES, UNITS } from '@domination/shared';
import type { CityFocusId, ImprovementId, OwnCityDetail, PlayerView, UnitTypeId, UnitView } from '@domination/shared';
import type { OrdersClosed } from '../game/selectors';
import {
  STOP_ASK,
  STOP_LABEL,
  jobButtonText,
  jobReasonText,
  jobsReasonText,
  ordersClosedText,
  queueNoteText,
  stopWarningText,
  unitHintParts,
} from './texts';

// ---------------------------------------------------------------------------
// City panel
// ---------------------------------------------------------------------------

/** The three buttons of one queue row: is each greyed out? */
export interface QueueRowButtons {
  upDisabled: boolean;
  downDisabled: boolean;
  removeDisabled: boolean;
}

/**
 * One button of the add list. A button is greyed while orders are closed
 * and by its own option's addError: a full queue ('queueFull'), or, for a
 * boat, a city that owns no water ('noWaterForBoat'; the button's middle
 * line then gives the reason, buildOptionText).
 */
export interface AddButton {
  unitType: UnitTypeId;
  disabled: boolean;
}

/** One of the two buttons "Grow first" / "Build first": how the city's citizens are placed. */
export interface FocusButton {
  focus: CityFocusId;
  /** CITY_FOCUS[focus].name: 'Grow first', 'Build first'. */
  label: string;
  /** CITY_FOCUS[focus].summary: the small line inside the button. */
  summary: string;
  /** CITY_FOCUS[focus].description: the tooltip. */
  title: string;
  /**
   * Is this the city's choice? The button is then marked (sunk), not
   * greyed: pressing it again does nothing (Controller.setCityFocus).
   */
  chosen: boolean;
  /** Greyed exactly while orders are closed. A full queue greys neither button: the choice is not about the queue. */
  disabled: boolean;
}

/** The buttons of the city panel. */
export interface CityPanelButtons {
  /**
   * The line in the panel's head (queueNoteText), or null: no connection,
   * turn ended, queue full. Never a boat's "needs water", which stands
   * inside the boat's own button.
   */
  note: string | null;
  /**
   * Does the queue have entries? Its title, the line about the x
   * (REMOVE_HINT) and "Empty the queue" are shown exactly then. So is the
   * production BAR (round 3): under "Nothing to build: production is
   * lost." it could only be empty, and without it the heading of the build
   * list is in view on a small phone.
   */
  hasQueue: boolean;
  /** One per entry of the queue, in its order. */
  rows: QueueRowButtons[];
  /** "Empty the queue" (shown while hasQueue). */
  clearDisabled: boolean;
  /**
   * The two ways of placing citizens, in CITY_FOCUS_IDS order ("Grow
   * first", then "Build first"). Shown for every own city, in every state
   * of the queue.
   */
  focus: FocusButton[];
  /** The add buttons that are shown: one per option of the view, in its order (six in every city, the two boats last). */
  adds: AddButton[];
}

/**
 * The city panel's buttons for an own city.
 *
 * @param own     what the view says about the city (its queue, its menu and its focus)
 * @param closed  ordersClosed(state): why no order can be given, or null
 */
export function cityPanelButtons(own: OwnCityDetail, closed: OrdersClosed | null): CityPanelButtons {
  const shut = closed !== null;
  const last = own.buildQueue.length - 1;
  return {
    note: queueNoteText(own, closed),
    hasQueue: own.buildQueue.length > 0,
    rows: own.buildQueue.map((_entry, index) => ({
      upDisabled: shut || index === 0,
      downDisabled: shut || index === last,
      removeDisabled: shut,
    })),
    clearDisabled: shut,
    focus: CITY_FOCUS_IDS.map((focus) => ({
      focus,
      label: CITY_FOCUS[focus].name,
      summary: CITY_FOCUS[focus].summary,
      title: CITY_FOCUS[focus].description,
      chosen: own.focus === focus,
      disabled: shut,
    })),
    adds: own.buildOptions.map((option) => ({ unitType: option.item.unitType, disabled: shut || option.addError !== null })),
  };
}

// ---------------------------------------------------------------------------
// Unit panel
// ---------------------------------------------------------------------------

/** One button that starts a job. A Worker has two (Farm, Mine), a Fishing Boat one (Fishing Net): one per job option the server sends. */
export interface JobButton {
  improvement: ImprovementId;
  /** "Build Farm (4 turns)". */
  label: string;
  disabled: boolean;
  /**
   * Its own reason, printed under it; null when it has none, when one
   * sentence says it for all (JobBlock.reason), and while orders are closed
   * (JobBlock.closed is then the only sentence of the block).
   */
  reason: string | null;
}

/** The job block of a unit that builds improvements. */
export interface JobBlock {
  /**
   * Why no button of the block can be pressed for now (ordersClosedText),
   * or null. The first line of the block: in a low window the hint at the
   * panel's bottom is out of sight while the buttons are in sight. While it
   * is there it is the ONLY sentence of the block: `reason` and every
   * button's own reason are null until orders are open again. They say what
   * the tile allows, which changes nothing while no job can be ordered, and
   * with them the last job button did not fit into a phone's panel.
   */
  closed: string | null;
  /**
   * The ONE sentence when every job is impossible for the same reason
   * (jobsReasonText), or null; null also while orders are closed.
   */
  reason: string | null;
  /** The heading "Work on this tile": over the job buttons, not over a job in progress. */
  showTitle: boolean;
  /** The buttons that start a job; none while the unit is at work. */
  start: JobButton[];
  /**
   * "Stop work", for a unit at work; null without a job. The button asks
   * once before it throws work away (Controller.stopJob):
   *  - `asking`: is it waiting for its second press? Never while greyed,
   *    and never for a job with no turn worked yet (nothing would be lost,
   *    so nothing is asked);
   *  - `label`: 'Stop work', or 'Tap again to stop' (STOP_ASK) while asking;
   *  - `warning`: the small print beside it, stopWarningText(job, asking);
   *    null while the button is greyed: beside a button that cannot be
   *    pressed it would only read as bad news.
   */
  stop: { disabled: boolean; label: string; asking: boolean; warning: string | null } | null;
}

/** The buttons of the unit panel, and its hint. */
export interface UnitPanelButtons {
  /**
   * "Found City"; null for a unit that cannot found cities (no button).
   * `reason` is the unit's own reason, printed beside the button
   * (RULE_ERROR_MESSAGES[foundCityError]), or null.
   */
  found: { disabled: boolean; reason: string | null } | null;
  /** The job block; null for a unit that has neither job options nor a job. */
  jobs: JobBlock | null;
  /**
   * The hint at the panel's bottom (unitHintParts). `main` is '' when the
   * job block already says why nothing can be ordered: one sentence, once.
   */
  hint: { main: string; more: string };
}

/**
 * The unit panel's buttons for an own unit; null for anybody else's (the
 * panel is hidden).
 *
 * @param closed        ordersClosed(state): why no order can be given, or null
 * @param askingToStop  controller.askingToStop(): is "Stop work" waiting for
 *                      its second press? Left out: it is not
 */
export function unitPanelButtons(
  view: PlayerView,
  unit: UnitView,
  closed: OrdersClosed | null,
  askingToStop = false,
): UnitPanelButtons | null {
  const own = unit.own;
  if (own === null || unit.owner !== view.you) return null;
  const shut = closed !== null;

  const found = UNITS[unit.type].canFoundCity
    ? { disabled: shut || own.foundCityError !== null, reason: own.foundCityError === null ? null : RULE_ERROR_MESSAGES[own.foundCityError] }
    : null;

  let jobs: JobBlock | null = null;
  if (own.job !== null) {
    // The question is only ever about work that would be lost, and only
    // while the button can be pressed.
    const asking = askingToStop && !shut && own.job.turnsWorked >= 1;
    jobs = {
      closed: closed === null ? null : ordersClosedText(closed),
      reason: null,
      showTitle: false,
      start: [],
      stop: {
        disabled: shut,
        label: asking ? STOP_ASK : STOP_LABEL,
        asking,
        warning: shut ? null : stopWarningText(own.job, asking),
      },
    };
  } else if (own.jobOptions.length > 0) {
    // While orders are closed the block says only that: the lines about
    // what the tile allows wait until a job can be ordered again. With them
    // two or three sentences stood over and between the grey buttons, and
    // on a phone the last button lay under the panel's edge.
    const oneReason = shut ? null : jobsReasonText(own.jobOptions);
    jobs = {
      closed: closed === null ? null : ordersClosedText(closed),
      reason: oneReason,
      showTitle: true,
      start: own.jobOptions.map((option) => ({
        improvement: option.improvement,
        label: jobButtonText(option),
        disabled: shut || option.error !== null,
        reason: shut || oneReason !== null ? null : jobReasonText(option),
      })),
      stop: null,
    };
  }

  const hint = unitHintParts(view, unit, closed !== 'offline');
  return { found, jobs, hint: jobs !== null && shut ? { main: '', more: hint.more } : hint };
}
