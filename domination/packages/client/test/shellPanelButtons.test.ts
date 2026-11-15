import { describe, expect, it } from 'vitest';
import { IMPROVEMENT_IDS, RULES, RULE_ERROR_MESSAGES, UNIT_TYPE_IDS } from '@domination/shared';
import type { BuildOption, OwnCityDetail, PlayerView, QueueEntryView, UnitTypeId } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import type { OrdersClosed } from '../src/game/selectors';
import { cityPanelButtons, unitPanelButtons } from '../src/ui/panelButtons';
import { REMOVE_HINT, STOP_WARNING, ordersClosedText } from '../src/ui/texts';
import { SAMPLE, ownOf, romeOf, unitIn } from './shellKit';

/**
 * What the two panels grey out and which sentence says why
 * (ui/panelButtons.ts). The panels only print what these functions answer,
 * so a button that stays bright when it must be grey, or a missing "why",
 * fails here, in plain Node.
 */

const CLOSED: OrdersClosed[] = ['offline', 'turnEnded'];

/** A queue of unit types, as the view lists it (the turns do not matter here). */
function queueOf(...types: UnitTypeId[]): QueueEntryView[] {
  return types.map((unitType) => ({ item: { kind: 'unit', unitType }, cost: 10, turns: 3, wait: null }));
}

/** Rome's details from the sample view (a Warrior and a Scout in the queue; four add buttons), with changes. */
function rome(changes: Partial<OwnCityDetail> = {}): OwnCityDetail {
  return { ...romeOf(sampleView()), ...changes };
}

/** Rome with a queue of eight: every option of its menu says "queueFull". */
function fullRome(): OwnCityDetail {
  const own = rome({ buildQueue: queueOf('warrior', 'scout', 'settler', 'worker', 'warrior', 'scout', 'settler', 'worker') });
  own.buildOptions = own.buildOptions.map((option): BuildOption => ({ ...option, addError: 'queueFull' }));
  return own;
}

/** The sample view with the player's turn ended or not. */
function viewWith(change: (view: PlayerView) => void = () => {}): PlayerView {
  const view = sampleView();
  change(view);
  return view;
}

/** The Worker of the sample view without its job, standing where a Farm fits and a Mine does not. */
function idleWorker(view: PlayerView): void {
  const own = ownOf(view, SAMPLE.workerId);
  own.job = null;
  own.jobOptions = [
    { improvement: 'farm', turns: 4, error: null },
    { improvement: 'mine', turns: 5, error: 'badImprovementTile' },
  ];
}

describe('the city panel: what is greyed out and why (cityPanelButtons)', () => {
  it('while orders are open: every row button can be pressed but "up" on the first row and "down" on the last; every add button can; there is nothing to explain', () => {
    const buttons = cityPanelButtons(rome({ buildQueue: queueOf('warrior', 'scout', 'settler') }), null);
    expect(buttons.note).toBeNull();
    expect(buttons.rows).toEqual([
      { upDisabled: true, downDisabled: false, removeDisabled: false },
      { upDisabled: false, downDisabled: false, removeDisabled: false },
      { upDisabled: false, downDisabled: true, removeDisabled: false },
    ]);
    expect(buttons.hasQueue).toBe(true);
    expect(buttons.clearDisabled).toBe(false);
    expect(buttons.adds).toEqual(UNIT_TYPE_IDS.map((unitType) => ({ unitType, disabled: false })));
  });

  it('a queue of one: its row can go neither up nor down, and it can be removed', () => {
    expect(cityPanelButtons(rome({ buildQueue: queueOf('warrior') }), null).rows).toEqual([{ upDisabled: true, downDisabled: true, removeDisabled: false }]);
  });

  it('after End Turn and without a connection EVERY button that gives an order is greyed out, and the sentence says which of the two it is', () => {
    for (const closed of CLOSED) {
      const buttons = cityPanelButtons(rome({ buildQueue: queueOf('warrior', 'scout', 'settler') }), closed);
      expect(buttons.rows, closed).toHaveLength(3);
      for (const row of buttons.rows) expect(row, closed).toEqual({ upDisabled: true, downDisabled: true, removeDisabled: true });
      expect(buttons.clearDisabled, closed).toBe(true);
      expect(buttons.adds.map((add) => add.disabled), closed).toEqual([true, true, true, true]);
    }
    expect(cityPanelButtons(rome(), 'turnEnded').note).toBe('You have ended your turn. Cancel that to change the queue.');
    expect(cityPanelButtons(rome(), 'offline').note).toBe('No connection: the queue cannot be changed right now.');
  });

  it('a full queue greys every add button and says "The build queue is full."; its rows and "Empty the queue" can still be pressed', () => {
    const buttons = cityPanelButtons(fullRome(), null);
    expect(buttons.rows).toHaveLength(RULES.maxQueueLength);
    expect(buttons.adds.map((add) => add.disabled)).toEqual([true, true, true, true]);
    expect(buttons.note).toBe(RULE_ERROR_MESSAGES.queueFull);
    expect(buttons.note).toBe('The build queue is full.');
    expect(buttons.rows[3]).toEqual({ upDisabled: false, downDisabled: false, removeDisabled: false });
    expect(buttons.rows[7]).toEqual({ upDisabled: false, downDisabled: true, removeDisabled: false });
    expect(buttons.clearDisabled).toBe(false);

    // A lasting reason comes first: it stops the rows too.
    const ended = cityPanelButtons(fullRome(), 'turnEnded');
    expect(ended.note).toBe('You have ended your turn. Cancel that to change the queue.');
    expect(ended.rows.every((row) => row.upDisabled && row.downDisabled && row.removeDisabled)).toBe(true);
  });

  it('an add button is greyed by its OWN option only: one option with an error greys one button', () => {
    const own = rome();
    own.buildOptions = own.buildOptions.map((option): BuildOption => (option.item.unitType === 'settler' ? { ...option, addError: 'queueFull' } : option));
    expect(cityPanelButtons(own, null).adds).toEqual([
      { unitType: 'warrior', disabled: false },
      { unitType: 'scout', disabled: false },
      { unitType: 'settler', disabled: true },
      { unitType: 'worker', disabled: false },
    ]);
  });

  it('an empty queue has no rows, no "Empty the queue" and nothing about the queue to print; the add buttons follow the same rule', () => {
    const idle = cityPanelButtons(rome({ buildQueue: [] }), null);
    expect(idle.rows).toEqual([]);
    expect(idle.hasQueue).toBe(false);
    expect(idle.note).toBeNull();
    expect(idle.adds.map((add) => add.disabled)).toEqual([false, false, false, false]);

    const ended = cityPanelButtons(rome({ buildQueue: [] }), 'turnEnded');
    expect(ended.hasQueue).toBe(false);
    expect(ended.adds.map((add) => add.disabled)).toEqual([true, true, true, true]);
    // The sentence is there although the queue is empty: the add buttons are grey and somebody has to say why.
    expect(ended.note).toBe('You have ended your turn. Cancel that to change the queue.');
  });

  it('the add buttons are the options of the view, in its order: a city with a shorter menu shows fewer', () => {
    const own = rome();
    own.buildOptions = own.buildOptions.filter((option) => option.item.unitType !== 'scout');
    expect(cityPanelButtons(own, null).adds.map((add) => add.unitType)).toEqual(['warrior', 'settler', 'worker']);
  });

  it('the line about the x has at most 60 characters, and says that what was saved is kept', () => {
    expect(REMOVE_HINT).toBe('× takes an item out. Saved production is kept.');
    expect(REMOVE_HINT.length).toBeLessThanOrEqual(60);
    expect(REMOVE_HINT.startsWith('×')).toBe(true); // the sign that is printed on the button
  });
});

describe('the unit panel: what is greyed out and why (unitPanelButtons)', () => {
  it('a unit that is not the player\'s own has no panel', () => {
    const view = sampleView();
    expect(unitPanelButtons(view, unitIn(view, SAMPLE.foreignWarriorId), null)).toBeNull();
  });

  it('a Warrior has no Found City button and no job block; the hint at the bottom says what to do, or why nothing can be done', () => {
    const view = sampleView();
    const warrior = unitIn(view, SAMPLE.warriorId);
    expect(unitPanelButtons(view, warrior, null)).toEqual({
      found: null,
      jobs: null,
      hint: { main: 'Choose a highlighted tile to move there.', more: '' },
    });
    const ended = viewWith((changed) => (changed.players[0].endedTurn = true));
    expect(unitPanelButtons(ended, unitIn(ended, SAMPLE.warriorId), 'turnEnded')?.hint.main).toBe('You have ended your turn. Cancel that to give orders.');
    expect(unitPanelButtons(view, warrior, 'offline')?.hint.main).toBe('No connection: orders have to wait.');
  });

  it('Found City: pressable when the Settler may found here and orders are open; greyed by its own reason (printed beside it) or by closed orders', () => {
    const view = sampleView();
    const settler = unitIn(view, SAMPLE.settlerId);
    expect(unitPanelButtons(view, settler, null)?.found).toEqual({ disabled: false, reason: null });
    for (const closed of CLOSED) expect(unitPanelButtons(view, settler, closed)?.found, closed).toEqual({ disabled: true, reason: null });

    ownOf(view, SAMPLE.settlerId).foundCityError = 'tooCloseToCity';
    expect(unitPanelButtons(view, settler, null)?.found).toEqual({ disabled: true, reason: RULE_ERROR_MESSAGES.tooCloseToCity });
    expect(unitPanelButtons(view, settler, 'turnEnded')?.found).toEqual({ disabled: true, reason: RULE_ERROR_MESSAGES.tooCloseToCity });
    expect(unitPanelButtons(view, settler, null)?.jobs).toBeNull();
  });

  it('a Worker without a job: a button per improvement, greyed by its own reason, which stands under it', () => {
    const view = viewWith(idleWorker);
    const buttons = unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null);
    expect(buttons?.found).toBeNull();
    expect(buttons?.jobs).toEqual({
      closed: null,
      reason: null,
      showTitle: true,
      start: [
        { improvement: 'farm', label: 'Build Farm (4 turns)', disabled: false, reason: null },
        { improvement: 'mine', label: 'Build Mine (5 turns)', disabled: true, reason: 'A Mine needs hills.' },
      ],
      stop: null,
    });
    expect(buttons?.hint.main).toBe('Choose a highlighted tile to move there.');
  });

  it('a Worker without a job after End Turn or without a connection: every job button is greyed, the sentence that says why stands at the TOP of the block, and it is not printed a second time at the bottom', () => {
    for (const closed of CLOSED) {
      const view = viewWith((changed) => {
        idleWorker(changed);
        changed.players[0].endedTurn = closed === 'turnEnded';
      });
      const buttons = unitPanelButtons(view, unitIn(view, SAMPLE.workerId), closed);
      expect(buttons?.jobs?.closed, closed).toBe(ordersClosedText(closed));
      expect(buttons?.jobs?.start.map((job) => job.disabled), closed).toEqual([true, true]);
      // What the tile allows is still said: a player plans the next turn while waiting.
      expect(buttons?.jobs?.start.map((job) => job.reason), closed).toEqual([null, 'A Mine needs hills.']);
      expect(buttons?.hint.main, closed).toBe('');
    }
    expect(ordersClosedText('turnEnded')).toBe('You have ended your turn. Cancel that to give orders.');
    expect(ordersClosedText('offline')).toBe('No connection: orders have to wait.');
  });

  it('when every job is impossible for one reason, ONE sentence says it for all and no button repeats it', () => {
    const view = viewWith((changed) => {
      const own = ownOf(changed, SAMPLE.workerId);
      own.job = null;
      own.jobOptions = IMPROVEMENT_IDS.map((improvement) => ({ improvement, turns: 4, error: 'cityOnTile' as const }));
    });
    const worker = unitIn(view, SAMPLE.workerId);
    const jobs = unitPanelButtons(view, worker, null)?.jobs;
    expect(jobs?.reason).toBe(RULE_ERROR_MESSAGES.cityOnTile);
    expect(jobs?.start.map((job) => [job.disabled, job.reason])).toEqual([[true, null], [true, null]]);

    // Closed orders are one more sentence, above that one.
    const ended = unitPanelButtons(view, worker, 'turnEnded')?.jobs;
    expect(ended?.closed).toBe('You have ended your turn. Cancel that to give orders.');
    expect(ended?.reason).toBe(RULE_ERROR_MESSAGES.cityOnTile);
  });

  it('a Worker at work: no job buttons and no title; "Stop work" can be pressed, with the warning beside it', () => {
    const view = sampleView();
    const jobs = unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null)?.jobs;
    expect(jobs).toEqual({ closed: null, reason: null, showTitle: false, start: [], stop: { disabled: false, warning: STOP_WARNING } });
    expect(STOP_WARNING).toBe('Stopping loses the work done so far.');
    expect(unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null)?.hint.main).toBe('At work here. Stop the work to move this unit.');
  });

  it('a Worker at work after End Turn or without a connection: "Stop work" is greyed, the warning about stopping is NOT printed (nothing can be stopped, and nothing is lost), and the sentence that says why stands at the top of the block', () => {
    for (const closed of CLOSED) {
      const view = viewWith((changed) => (changed.players[0].endedTurn = closed === 'turnEnded'));
      const buttons = unitPanelButtons(view, unitIn(view, SAMPLE.workerId), closed);
      expect(buttons?.jobs?.stop, closed).toEqual({ disabled: true, warning: null });
      expect(buttons?.jobs?.closed, closed).toBe(ordersClosedText(closed));
      expect(buttons?.jobs?.start, closed).toEqual([]);
      expect(buttons?.hint.main, closed).toBe('');
    }
  });

  it('the second sentence of the hint (how to select what else stands on the tile) stays, whatever is greyed', () => {
    const view = viewWith((changed) => {
      idleWorker(changed);
      // The Worker stands in Rome: a second tap selects the city.
      unitIn(changed, SAMPLE.workerId).tile = SAMPLE.romeTile;
      changed.players[0].endedTurn = true;
    });
    const buttons = unitPanelButtons(view, unitIn(view, SAMPLE.workerId), 'turnEnded');
    expect(buttons?.hint).toEqual({ main: '', more: 'Tap the same tile again to select Rome.' });
  });
});
