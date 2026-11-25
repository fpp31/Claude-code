import { describe, expect, it } from 'vitest';
import { CITY_FOCUS, CITY_FOCUS_IDS, RULES, RULE_ERROR_MESSAGES, UNITS, UNIT_TYPE_IDS } from '@domination/shared';
import type { BuildOption, CityFocusId, OwnCityDetail, PlayerView, QueueEntryView, RuleErrorCode, UnitJobView, UnitTypeId } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import type { OrdersClosed } from '../src/game/selectors';
import { cityPanelButtons, unitPanelButtons } from '../src/ui/panelButtons';
import type { JobBlock } from '../src/ui/panelButtons';
import {
  NEEDS_WATER,
  REMOVE_HINT,
  STOP_ASK,
  STOP_LABEL,
  addButtonTitleText,
  buildOptionText,
  ordersClosedText,
  productionNoteText,
  productionText,
  stopTitleText,
  stopWarningText,
  turnsLostByStopping,
} from '../src/ui/texts';
import { SAMPLE, SHORE, addOwnUnit, ownOf, putToWork, romeOf, shoreView, unitIn } from './shellKit';

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

/**
 * Rome's details from the sample view (a Warrior and a Scout in the queue;
 * six add buttons), with changes. The sample Rome owns no water: its two
 * boats say 'noWaterForBoat', which greys their buttons for good.
 */
function rome(changes: Partial<OwnCityDetail> = {}): OwnCityDetail {
  return { ...romeOf(sampleView()), ...changes };
}

/** Rome as it would be with coast inside its borders (shoreView): all six options can be added. */
function romeBySea(changes: Partial<OwnCityDetail> = {}): OwnCityDetail {
  return { ...romeOf(shoreView()), ...changes };
}

const EIGHT = ['warrior', 'scout', 'settler', 'worker', 'warrior', 'scout', 'settler', 'worker'] as const;

/**
 * A city with a queue of eight, as the server's view says it: every option
 * that could otherwise be added says 'queueFull'; a boat in a city without
 * water keeps its own, lasting reason.
 */
function full(own: OwnCityDetail): OwnCityDetail {
  return {
    ...own,
    buildQueue: queueOf(...EIGHT),
    buildOptions: own.buildOptions.map((option): BuildOption => (option.addError === 'noWaterForBoat' ? option : { ...option, turns: null, wait: 'earlier', addError: 'queueFull' })),
  };
}

/** Rome by the sea with a queue of eight: every option of its menu says "queueFull". */
function fullRome(): OwnCityDetail {
  return full(romeBySea());
}

/** Is each of the add buttons greyed, in the menu's order? */
function greyed(own: OwnCityDetail, closed: OrdersClosed | null = null): boolean[] {
  return cityPanelButtons(own, closed).adds.map((add) => add.disabled);
}

const SIX_OPEN = [false, false, false, false, false, false];
const SIX_GREY = [true, true, true, true, true, true];
/** The four land units open, the two boats greyed: a city without water. */
const BOATS_GREY = [false, false, false, false, true, true];

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
    const buttons = cityPanelButtons(romeBySea({ buildQueue: queueOf('warrior', 'scout', 'settler') }), null);
    expect(buttons.note).toBeNull();
    expect(buttons.rows).toEqual([
      { upDisabled: true, downDisabled: false, removeDisabled: false },
      { upDisabled: false, downDisabled: false, removeDisabled: false },
      { upDisabled: false, downDisabled: true, removeDisabled: false },
    ]);
    expect(buttons.hasQueue).toBe(true);
    expect(buttons.clearDisabled).toBe(false);
    expect(buttons.adds.map(({ unitType, disabled }) => ({ unitType, disabled }))).toEqual(UNIT_TYPE_IDS.map((unitType) => ({ unitType, disabled: false })));
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
      expect(buttons.adds.map((add) => add.disabled), closed).toEqual(SIX_GREY);
      expect(buttons.focus.map((focus) => focus.disabled), closed).toEqual([true, true]);
      // With water or without: closed orders grey everything.
      expect(greyed(romeBySea(), closed), closed).toEqual(SIX_GREY);
    }
    expect(cityPanelButtons(rome(), 'turnEnded').note).toBe('You have ended your turn. Cancel that to change this city.');
    expect(cityPanelButtons(rome(), 'offline').note).toBe('No connection: this city cannot be changed right now.');
  });

  it('a full queue greys every add button and says "The build queue is full."; its rows and "Empty the queue" can still be pressed', () => {
    const buttons = cityPanelButtons(fullRome(), null);
    expect(buttons.rows).toHaveLength(RULES.maxQueueLength);
    expect(buttons.adds.map((add) => add.disabled)).toEqual(SIX_GREY);
    expect(buttons.note).toBe(RULE_ERROR_MESSAGES.queueFull);
    expect(buttons.note).toBe('The build queue is full.');
    expect(buttons.rows[3]).toEqual({ upDisabled: false, downDisabled: false, removeDisabled: false });
    expect(buttons.rows[7]).toEqual({ upDisabled: false, downDisabled: true, removeDisabled: false });
    expect(buttons.clearDisabled).toBe(false);

    // A lasting reason comes first: it stops the rows too.
    const ended = cityPanelButtons(fullRome(), 'turnEnded');
    expect(ended.note).toBe('You have ended your turn. Cancel that to change this city.');
    expect(ended.rows.every((row) => row.upDisabled && row.downDisabled && row.removeDisabled)).toBe(true);
  });

  it('an add button is greyed by its OWN option only: one option with an error greys one button', () => {
    const own = romeBySea();
    own.buildOptions = own.buildOptions.map((option): BuildOption => (option.item.unitType === 'settler' ? { ...option, addError: 'queueFull' } : option));
    expect(cityPanelButtons(own, null).adds.map(({ unitType, disabled }) => ({ unitType, disabled }))).toEqual([
      { unitType: 'warrior', disabled: false },
      { unitType: 'scout', disabled: false },
      { unitType: 'settler', disabled: true },
      { unitType: 'worker', disabled: false },
      { unitType: 'fishingBoat', disabled: false },
      { unitType: 'scoutBoat', disabled: false },
    ]);
  });

  it('every add button carries its three lines as one sentence for its tooltip (addButtonTitleText), whatever is greyed', () => {
    // A line of an add button is one line in every font and is cut where a font is too wide: the tooltip has every word.
    for (const own of [rome(), romeBySea(), rome({ buildQueue: [] }), fullRome()]) {
      for (const closed of [null, ...CLOSED]) {
        const adds = cityPanelButtons(own, closed).adds;
        expect(adds).toHaveLength(own.buildOptions.length);
        adds.forEach((add, index) => {
          const option = own.buildOptions[index];
          expect(add.unitType).toBe(option.item.unitType);
          expect(add.title, `${add.unitType} ${closed}`).toBe(addButtonTitleText(option));
          expect(add.title, `${add.unitType} ${closed}`).toBe(`${UNITS[add.unitType].name}: ${buildOptionText(option)}. ${UNITS[add.unitType].description}`);
        });
      }
    }
    const titles = cityPanelButtons(rome(), null).adds.map((add) => add.title);
    expect(titles[2]).toBe('Settler: costs 30 + 1 citizen, ready in 14 turns. Founds a new city. Takes one citizen.');
    expect(titles[4]).toBe("Fishing Boat: needs water inside this city's borders. Builds fishing nets inside the borders.");
  });

  it('an empty queue has no rows, no "Empty the queue" and nothing about the queue to print; the add buttons follow the same rule', () => {
    const idle = cityPanelButtons(romeBySea({ buildQueue: [] }), null);
    expect(idle.rows).toEqual([]);
    expect(idle.hasQueue).toBe(false);
    expect(idle.note).toBeNull();
    expect(idle.adds.map((add) => add.disabled)).toEqual(SIX_OPEN);

    const ended = cityPanelButtons(romeBySea({ buildQueue: [] }), 'turnEnded');
    expect(ended.hasQueue).toBe(false);
    expect(ended.adds.map((add) => add.disabled)).toEqual(SIX_GREY);
    // The sentence is there although the queue is empty: the add buttons are grey and somebody has to say why.
    expect(ended.note).toBe('You have ended your turn. Cancel that to change this city.');
  });

  it('an idle city: hasQueue is false, which is what hides the production bar; the words over it are one sentence', () => {
    // The bar is shown exactly when the queue holds an entry: under "Nothing to build: production is lost." it could only be empty.
    const idle = rome({ buildQueue: [], productionStored: 0 });
    expect(cityPanelButtons(idle, null).hasQueue).toBe(false);
    expect(`${productionText(idle)} ${productionNoteText(idle)}`).toBe('Nothing to build: production is lost.');
    const saved = rome({ buildQueue: [], productionStored: 6 });
    expect(cityPanelButtons(saved, null).hasQueue).toBe(false);
    expect(`${productionText(saved)} ${productionNoteText(saved)}`).toBe(
      'Nothing to build: 6 production are saved for the next item; what the city makes meanwhile is lost.',
    );
    // Closed orders do not bring the bar back, and one entry does, whatever its state.
    for (const closed of CLOSED) expect(cityPanelButtons(idle, closed).hasQueue, closed).toBe(false);
    expect(cityPanelButtons(rome({ buildQueue: queueOf('warrior') }), null).hasQueue).toBe(true);
    expect(cityPanelButtons(rome({ buildQueue: [{ item: { kind: 'unit', unitType: 'fishingBoat' }, cost: 20, turns: null, wait: 'noRoom' }], held: 'noRoom' }), null).hasQueue).toBe(true);
    expect(cityPanelButtons(fullRome(), 'turnEnded').hasQueue).toBe(true);
  });

  it('the add buttons are the options of the view, in its order: a city with a shorter menu shows fewer', () => {
    const own = rome();
    own.buildOptions = own.buildOptions.filter((option) => option.item.unitType !== 'scout');
    expect(cityPanelButtons(own, null).adds.map((add) => add.unitType)).toEqual(['warrior', 'settler', 'worker', 'fishingBoat', 'scoutBoat']);
  });

  it('six add buttons in every city, the boats last; in a city without water the two boats are greyed and their middle line is the reason alone; with water they are not', () => {
    for (const own of [rome(), romeBySea(), rome({ buildQueue: [] }), fullRome(), full(rome())]) {
      for (const closed of [null, ...CLOSED]) {
        expect(cityPanelButtons(own, closed).adds.map((add) => add.unitType)).toEqual(UNIT_TYPE_IDS);
      }
    }
    expect(UNIT_TYPE_IDS).toEqual(['warrior', 'scout', 'settler', 'worker', 'fishingBoat', 'scoutBoat']);

    // Without water (the sample Rome): the four land units as ever, the pair of boats grey.
    expect(greyed(rome())).toEqual(BOATS_GREY);
    expect(greyed(rome({ buildQueue: [] }))).toEqual(BOATS_GREY);
    const dryBoats = rome().buildOptions.filter((option) => UNITS[option.item.unitType].domain === 'sea');
    expect(dryBoats.map((option) => option.item.unitType)).toEqual(['fishingBoat', 'scoutBoat']);
    for (const option of dryBoats) {
      expect(option.addError).toBe('noWaterForBoat');
      // The reason stands INSIDE the button, alone: no cost, no turns. It is in view whenever the button is.
      expect(buildOptionText(option)).toBe(NEEDS_WATER);
      expect(buildOptionText(option)).toBe("needs water inside this city's borders");
    }
    // ...and the head of the panel stays empty: the reason is not one for the whole panel.
    expect(cityPanelButtons(rome(), null).note).toBeNull();
    expect(cityPanelButtons(rome({ buildQueue: [] }), null).note).toBeNull();

    // With water: all six can be pressed, and the boats' lines are a cost and a number like any other.
    expect(greyed(romeBySea())).toEqual(SIX_OPEN);
    for (const option of romeBySea().buildOptions) expect(buildOptionText(option), option.item.unitType).toMatch(/^costs \d+( \+ 1 citizen)?, ready in \d+ turns$/);
    expect(cityPanelButtons(romeBySea(), null).note).toBeNull();
  });

  it('a full queue in a city without water greys all six and the head says "The build queue is full."', () => {
    const own = full(rome());
    expect(own.buildOptions.map((option) => option.addError)).toEqual(['queueFull', 'queueFull', 'queueFull', 'queueFull', 'noWaterForBoat', 'noWaterForBoat']);
    const buttons = cityPanelButtons(own, null);
    expect(buttons.adds.map((add) => add.disabled)).toEqual(SIX_GREY);
    expect(buttons.note).toBe('The build queue is full.');
    // The boats keep their own reason in their own buttons.
    expect(own.buildOptions.slice(4).map(buildOptionText)).toEqual([NEEDS_WATER, NEEDS_WATER]);
    // One entry less, and the land units are back while the boats stay grey.
    const roomAgain = rome({ buildQueue: queueOf(...EIGHT.slice(1)) });
    expect(greyed(roomAgain)).toEqual(BOATS_GREY);
    expect(cityPanelButtons(roomAgain, null).note).toBeNull();
  });

  it('the two focus buttons carry the table\'s name, summary and description, in the table\'s order; the chosen one is marked and NOT greyed', () => {
    const onGrow = cityPanelButtons(rome(), null).focus;
    expect(onGrow).toEqual([
      {
        focus: 'grow',
        label: 'Grow first',
        summary: 'growth before production',
        title: 'Citizens take the best tiles, and food before production whenever the city would stop growing.',
        chosen: true,
        disabled: false,
      },
      {
        focus: 'build',
        label: 'Build first',
        summary: 'most production, growth may stop',
        title: 'Citizens take the tiles with the most production. The city grows slowly or not at all; it never shrinks.',
        chosen: false,
        disabled: false,
      },
    ]);
    expect(onGrow.map((button) => button.focus)).toEqual(CITY_FOCUS_IDS);
    for (const button of onGrow) {
      expect([button.label, button.summary, button.title]).toEqual([CITY_FOCUS[button.focus].name, CITY_FOCUS[button.focus].summary, CITY_FOCUS[button.focus].description]);
    }

    // The other choice: the mark moves, and nothing else about the two buttons changes.
    const onBuild = cityPanelButtons(rome({ focus: 'build' }), null).focus;
    expect(onBuild.map((button) => button.chosen)).toEqual([false, true]);
    expect(onBuild.map((button) => ({ ...button, chosen: false }))).toEqual(onGrow.map((button) => ({ ...button, chosen: false })));
    // Exactly one is chosen, whatever else is true of the city.
    for (const focus of CITY_FOCUS_IDS) {
      for (const own of [rome({ focus }), romeBySea({ focus }), rome({ focus, buildQueue: [] }), { ...fullRome(), focus }]) {
        for (const closed of [null, ...CLOSED]) {
          const chosen = cityPanelButtons(own, closed).focus.filter((button) => button.chosen);
          expect(chosen.map((button) => button.focus)).toEqual([focus]);
        }
      }
    }
  });

  it('both focus buttons are greyed exactly while orders are closed: a full queue greys neither, an empty queue greys neither, a city without water greys neither', () => {
    const cities: [string, OwnCityDetail][] = [
      ['the sample Rome', rome()],
      ['by the sea', romeBySea()],
      ['an empty queue', rome({ buildQueue: [] })],
      ['a full queue', fullRome()],
      ['a full queue without water', full(rome())],
      ['held', rome({ buildQueue: [{ item: { kind: 'unit', unitType: 'settler' }, cost: 30, turns: null, wait: 'needsPopulation' }], held: 'needsPopulation' })],
    ];
    for (const [name, own] of cities) {
      for (const focus of CITY_FOCUS_IDS) {
        const city: OwnCityDetail = { ...own, focus };
        expect(cityPanelButtons(city, null).focus.map((button) => button.disabled), `${name} on ${focus}`).toEqual([false, false]);
        for (const closed of CLOSED) {
          const buttons = cityPanelButtons(city, closed).focus;
          expect(buttons.map((button) => button.disabled), `${name} on ${focus}, ${closed}`).toEqual([true, true]);
          // The chosen one keeps its mark while it is grey, so that it can still be told from the other.
          expect(buttons.map((button) => button.chosen), `${name} on ${focus}, ${closed}`).toEqual(CITY_FOCUS_IDS.map((id: CityFocusId) => id === focus));
        }
      }
    }
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
      // What the tile allows is not said meanwhile: the block has ONE sentence while orders are closed (the tests further down).
      expect(buttons?.jobs?.start.map((job) => job.reason), closed).toEqual([null, null]);
      expect(buttons?.hint.main, closed).toBe('');
    }
    expect(ordersClosedText('turnEnded')).toBe('You have ended your turn. Cancel that to give orders.');
    expect(ordersClosedText('offline')).toBe('No connection: orders have to wait.');
  });

  it('when every job is impossible for one reason, ONE sentence says it for all and no button repeats it', () => {
    const view = viewWith((changed) => {
      const own = ownOf(changed, SAMPLE.workerId);
      own.job = null;
      own.jobOptions = UNITS.worker.improvements.map((improvement) => ({ improvement, turns: 4, error: 'cityOnTile' as const }));
    });
    const worker = unitIn(view, SAMPLE.workerId);
    const jobs = unitPanelButtons(view, worker, null)?.jobs;
    expect(jobs?.reason).toBe(RULE_ERROR_MESSAGES.cityOnTile);
    expect(jobs?.start.map((job) => [job.disabled, job.reason])).toEqual([[true, null], [true, null]]);

    // Closed orders take that sentence's place: one sentence over the buttons, never two.
    const ended = unitPanelButtons(view, worker, 'turnEnded')?.jobs;
    expect(ended?.closed).toBe('You have ended your turn. Cancel that to give orders.');
    expect(ended?.reason).toBeNull();
    expect(ended?.start.map((job) => [job.disabled, job.reason])).toEqual([[true, null], [true, null]]);
  });

  it('a Worker at work: no job buttons and no title; "Stop work" can be pressed, with the small print beside it saying what a press would lose', () => {
    const view = sampleView();
    expect(ownOf(view, SAMPLE.workerId).job?.turnsWorked).toBe(1);
    const jobs = unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null)?.jobs;
    expect(jobs).toEqual({
      closed: null,
      reason: null,
      showTitle: false,
      start: [],
      stop: { disabled: false, label: 'Stop work', asking: false, warning: 'Stopping loses 1 turn of work.', title: 'Stop this work (1 turn of work is lost)' },
    });
    expect(unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null)?.hint.main).toBe('At work here. Stop the work to move this unit.');
    // The fourth argument left out is "not asking".
    expect(unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null, false)).toEqual(unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null));
  });

  it('a Worker at work after End Turn or without a connection: "Stop work" is greyed, the warning about stopping is NOT printed (nothing can be stopped, and nothing is lost), and the sentence that says why stands at the top of the block', () => {
    for (const closed of CLOSED) {
      const view = viewWith((changed) => (changed.players[0].endedTurn = closed === 'turnEnded'));
      const buttons = unitPanelButtons(view, unitIn(view, SAMPLE.workerId), closed);
      expect(buttons?.jobs?.stop, closed).toEqual({ disabled: true, label: 'Stop work', asking: false, warning: null, title: 'Stop this work (1 turn of work is lost)' });
      expect(buttons?.jobs?.closed, closed).toBe(ordersClosedText(closed));
      expect(buttons?.jobs?.start, closed).toEqual([]);
      expect(buttons?.hint.main, closed).toBe('');
    }
  });

  describe('"Stop work" asks once: the stop row in its six states', () => {
    /** The stop row of the sample Worker with this many turns of its farm worked. */
    function stopRow(turnsWorked: number, asking: boolean, closed: OrdersClosed | null = null): NonNullable<JobBlock['stop']> | null {
      const view = viewWith((changed) => {
        putToWork(unitIn(changed, SAMPLE.workerId), turnsWorked);
        changed.players[0].endedTurn = closed === 'turnEnded';
      });
      return unitPanelButtons(view, unitIn(view, SAMPLE.workerId), closed, asking)?.jobs?.stop ?? null;
    }

    it('no turn worked yet: "Stop work", "Stopping now loses nothing.", and the tooltip says the same: "nothing is lost yet"', () => {
      expect(stopRow(0, false)).toEqual({
        disabled: false, label: 'Stop work', asking: false, warning: 'Stopping now loses nothing.', title: 'Stop this work (nothing is lost yet)',
      });
    });

    it('1 turn worked: "Stop work", "Stopping loses 1 turn of work."', () => {
      expect(stopRow(1, false)).toEqual({
        disabled: false, label: 'Stop work', asking: false, warning: 'Stopping loses 1 turn of work.', title: 'Stop this work (1 turn of work is lost)',
      });
    });

    it('3 turns worked: "Stop work", "Stopping loses 3 turns of work."', () => {
      expect(stopRow(3, false)).toEqual({
        disabled: false, label: 'Stop work', asking: false, warning: 'Stopping loses 3 turns of work.', title: 'Stop this work (3 turns of work are lost)',
      });
    });

    it('after the first press, 1 turn worked: "Tap again to stop", "1 turn will be lost."', () => {
      expect(stopRow(1, true)).toEqual({
        disabled: false, label: 'Tap again to stop', asking: true, warning: '1 turn will be lost.', title: 'Stop this work (1 turn of work is lost)',
      });
    });

    it('after the first press, 3 turns worked: "Tap again to stop", "3 turns will be lost."', () => {
      expect(stopRow(3, true)).toEqual({
        disabled: false, label: 'Tap again to stop', asking: true, warning: '3 turns will be lost.', title: 'Stop this work (3 turns of work are lost)',
      });
    });

    it('the tooltip never says more than the small print: both come from one number, in every state of the row', () => {
      // (Until the review of round 3 the tooltip was one fixed sentence, "the turns worked are lost", also
      // beside "Stopping now loses nothing.")
      const view = sampleView();
      for (const turns of [0, 1, 2, 3]) {
        for (const asking of [false, true]) {
          for (const closed of [null, ...CLOSED]) {
            const row = stopRow(turns, asking, closed);
            const job = { ...ownOf(view, SAMPLE.workerId).job, turnsWorked: turns } as UnitJobView;
            const about = `${turns} ${asking} ${closed}`;
            expect(row?.title, about).toBe(stopTitleText(job));
            expect(turnsLostByStopping(job), about).toBe(turns);
            // "nothing" stands in both or in neither.
            expect(row?.title.includes('nothing'), about).toBe(turns === 0);
            if (row?.warning != null) expect(row.warning.includes('nothing'), about).toBe(turns === 0);
            // With turns to lose, both name the same count.
            if (turns > 0) expect(row?.title, about).toContain(`${turns} turn`);
            if (turns > 0 && row?.warning != null) expect(row.warning, about).toContain(`${turns} turn`);
          }
        }
      }
    });

    it('orders closed: "Stop work", greyed, no small print, and never asking, whatever the controller says', () => {
      for (const closed of CLOSED) {
        for (const turns of [0, 1, 3]) {
          for (const asking of [false, true]) {
            // (The tooltip stays: it says what stopping costs, and follows the turns worked like the small print did.)
            expect(stopRow(turns, asking, closed), `${closed} ${turns} ${asking}`).toEqual({
              disabled: true,
              label: 'Stop work',
              asking: false,
              warning: null,
              title: turns === 0 ? 'Stop this work (nothing is lost yet)' : turns === 1 ? 'Stop this work (1 turn of work is lost)' : 'Stop this work (3 turns of work are lost)',
            });
          }
        }
      }
    });

    it('the label and the small print are the sentences of ui/texts.ts; a job with no turn worked is never shown asking', () => {
      expect(stopRow(2, false)?.label).toBe(STOP_LABEL);
      expect(stopRow(2, true)?.label).toBe(STOP_ASK);
      const view = sampleView();
      const job = ownOf(view, SAMPLE.workerId).job;
      if (job === null) throw new Error('the sample Worker has no job');
      expect(unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null, false)?.jobs?.stop?.warning).toBe(stopWarningText(job, false));
      expect(unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null, true)?.jobs?.stop?.warning).toBe(stopWarningText(job, true));
      // Nothing would be lost, so nothing is asked: the row stays as it is.
      expect(stopRow(0, true)).toEqual(stopRow(0, false));
      // Asking changes the stop row and nothing else of the panel.
      const calm = unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null, false);
      const asked = unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null, true);
      expect({ ...asked, jobs: { ...asked?.jobs, stop: null } }).toEqual({ ...calm, jobs: { ...calm?.jobs, stop: null } });
      // A unit without a job has no stop row to ask with.
      const idle = viewWith(idleWorker);
      expect(unitPanelButtons(idle, unitIn(idle, SAMPLE.workerId), null, true)?.jobs?.stop).toBeNull();
    });

    it('the same row for a Fishing Boat at work on its net', () => {
      const view = shoreView((changed) => putToWork(addOwnUnit(changed, 'u1_f1sher', 'fishingBoat', SHORE.middle), 3));
      const boat = unitIn(view, 'u1_f1sher');
      expect(unitPanelButtons(view, boat, null)?.jobs).toEqual({
        closed: null,
        reason: null,
        showTitle: false,
        start: [],
        stop: { disabled: false, label: 'Stop work', asking: false, warning: 'Stopping loses 3 turns of work.', title: 'Stop this work (3 turns of work are lost)' },
      });
      const title = 'Stop this work (3 turns of work are lost)';
      expect(unitPanelButtons(view, boat, null, true)?.jobs?.stop).toEqual({ disabled: false, label: 'Tap again to stop', asking: true, warning: '3 turns will be lost.', title });
      expect(unitPanelButtons(view, boat, 'turnEnded', true)?.jobs?.stop).toEqual({ disabled: true, label: 'Stop work', asking: false, warning: null, title });
    });
  });

  it('a Fishing Boat on its coast has ONE job button, a Worker two, the other units none: the panel prints the options the server sends', () => {
    const view = shoreView((changed) => {
      idleWorker(changed);
      addOwnUnit(changed, 'u1_f1sher', 'fishingBoat', SHORE.middle);
      addOwnUnit(changed, 'u1_sc0ut1', 'scoutBoat', SHORE.north);
    });
    const boat = unitPanelButtons(view, unitIn(view, 'u1_f1sher'), null);
    expect(boat?.found).toBeNull();
    expect(boat?.jobs).toEqual({
      closed: null,
      reason: null,
      showTitle: true,
      start: [{ improvement: 'fishingNet', label: 'Build Fishing Net (4 turns)', disabled: false, reason: null }],
      stop: null,
    });
    expect(boat?.hint.main).toBe('Choose a highlighted tile to move there.');

    expect(unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null)?.jobs?.start.map((job) => job.improvement)).toEqual(['farm', 'mine']);
    // A Worker is never offered a net, a boat never a farm.
    expect(unitPanelButtons(view, unitIn(view, SAMPLE.workerId), null)?.jobs?.start.map((job) => job.label).join()).not.toContain('Net');
    expect(boat?.jobs?.start.map((job) => job.label).join()).not.toMatch(/Farm|Mine/);
    // A Scout Boat builds nothing: no job block, as for a Warrior.
    expect(unitPanelButtons(view, unitIn(view, 'u1_sc0ut1'), null)).toEqual({
      found: null,
      jobs: null,
      hint: { main: 'Choose a highlighted tile to move there.', more: '' },
    });
    expect(unitPanelButtons(view, unitIn(view, SAMPLE.warriorId), null)?.jobs).toBeNull();
  });

  it('a Fishing Boat whose one button is grey: the ONE sentence over it says why (outside the borders, on ocean, on a netted tile), and closed orders take its place', () => {
    const cases: [RuleErrorCode, string][] = [
      ['notYourLand', 'That can only be built inside your own borders.'],
      ['badImprovementTile', 'A Fishing Net needs coast.'],
      ['alreadyImproved', 'This tile already has a Fishing Net.'],
    ];
    for (const [code, sentence] of cases) {
      const view = shoreView((changed) => {
        addOwnUnit(changed, 'u1_f1sher', 'fishingBoat', SHORE.free, code);
      });
      const boat = unitIn(view, 'u1_f1sher');
      const jobs = unitPanelButtons(view, boat, null)?.jobs;
      // With one job, "every job impossible for one reason" is every case: the sentence stands over the button, not under it.
      expect(jobs?.reason, code).toBe(sentence);
      expect(jobs?.start, code).toEqual([{ improvement: 'fishingNet', label: 'Build Fishing Net (4 turns)', disabled: true, reason: null }]);
      for (const closed of CLOSED) {
        const shut = unitPanelButtons(view, boat, closed)?.jobs;
        expect(shut?.closed, `${code} ${closed}`).toBe(ordersClosedText(closed));
        expect(shut?.reason, `${code} ${closed}`).toBeNull();
        expect(shut?.start, `${code} ${closed}`).toEqual([{ improvement: 'fishingNet', label: 'Build Fishing Net (4 turns)', disabled: true, reason: null }]);
      }
    }
  });

  describe('while orders are closed the job block says ONLY that: the lines that say why a job cannot be built here wait until orders are open again', () => {
    const WHY_CLOSED = { offline: 'No connection: orders have to wait.', turnEnded: 'You have ended your turn. Cancel that to give orders.' };

    /** The job block of the sample Worker without a job, each of its two jobs with the error given (null: the tile allows it). */
    function jobBlock(farm: RuleErrorCode | null, mine: RuleErrorCode | null, closed: OrdersClosed | null): JobBlock | null {
      const view = viewWith((changed) => {
        const own = ownOf(changed, SAMPLE.workerId);
        own.job = null;
        own.jobOptions = [
          { improvement: 'farm', turns: 4, error: farm },
          { improvement: 'mine', turns: 5, error: mine },
        ];
        changed.players[0].endedTurn = closed === 'turnEnded';
      });
      return unitPanelButtons(view, unitIn(view, SAMPLE.workerId), closed)?.jobs ?? null;
    }

    /** The lines of a job block that are sentences, top to bottom as the panel prints them (the labels of the buttons are not among them). */
    function sentences(block: JobBlock | null): string[] {
      if (block === null) return [];
      return [block.closed, block.reason, ...block.start.map((job) => job.reason)].filter((line): line is string => line !== null);
    }

    it('closed, on own land where both jobs fit: the one sentence, and two greyed buttons', () => {
      for (const closed of CLOSED) {
        const block = jobBlock(null, null, closed);
        expect(sentences(block), closed).toEqual([WHY_CLOSED[closed]]);
        expect(block?.start.map((job) => [job.improvement, job.disabled]), closed).toEqual([['farm', true], ['mine', true]]);
        expect(block?.showTitle, closed).toBe(true);
      }
    });

    it('closed, outside own land: the sentence over the buttons ("That can only be built inside your own borders.") is NOT printed as a second one', () => {
      // Two sentences over the buttons pushed the Mine button under the panel's edge on a phone.
      expect(sentences(jobBlock('notYourLand', 'notYourLand', null))).toEqual(['That can only be built inside your own borders.']);
      for (const closed of CLOSED) {
        const block = jobBlock('notYourLand', 'notYourLand', closed);
        expect(sentences(block), closed).toEqual([WHY_CLOSED[closed]]);
        expect(block?.reason, closed).toBeNull();
        expect(block?.start.map((job) => [job.improvement, job.disabled, job.reason]), closed).toEqual([['farm', true, null], ['mine', true, null]]);
      }
    });

    it('closed, with one job impossible: no line under that button either', () => {
      expect(sentences(jobBlock(null, 'badImprovementTile', null))).toEqual(['A Mine needs hills.']);
      expect(sentences(jobBlock('alreadyImproved', null, null))).toEqual(['This tile already has a Farm.']);
      for (const closed of CLOSED) {
        expect(sentences(jobBlock(null, 'badImprovementTile', closed)), closed).toEqual([WHY_CLOSED[closed]]);
        expect(sentences(jobBlock('alreadyImproved', null, closed)), closed).toEqual([WHY_CLOSED[closed]]);
        // Two different reasons, one under each button: both wait.
        expect(sentences(jobBlock('alreadyImproved', 'badImprovementTile', closed)), closed).toEqual([WHY_CLOSED[closed]]);
      }
    });

    it('open again: the reasons are back exactly as before, and the sentence about closed orders is gone', () => {
      const cases: [RuleErrorCode | null, RuleErrorCode | null][] = [
        [null, null],
        ['notYourLand', 'notYourLand'],
        [null, 'badImprovementTile'],
        ['alreadyImproved', 'badImprovementTile'],
      ];
      for (const [farm, mine] of cases) {
        const before = jobBlock(farm, mine, null);
        const ended = jobBlock(farm, mine, 'turnEnded');
        const again = jobBlock(farm, mine, null);
        expect(again).toEqual(before);
        expect(again?.closed).toBeNull();
        // Closing the orders changed the sentences and the greying, nothing else: the same buttons with the same words.
        expect(ended?.start.map((job) => [job.improvement, job.label])).toEqual(before?.start.map((job) => [job.improvement, job.label]));
      }
      expect(jobBlock('notYourLand', 'notYourLand', null)?.reason).toBe(RULE_ERROR_MESSAGES.notYourLand);
      expect(jobBlock(null, 'badImprovementTile', null)?.start.map((job) => [job.disabled, job.reason])).toEqual([[false, null], [true, 'A Mine needs hills.']]);
    });
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
