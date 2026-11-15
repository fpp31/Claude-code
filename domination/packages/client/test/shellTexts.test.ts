import { describe, expect, it } from 'vitest';
import { IMPROVEMENTS, IMPROVEMENT_IDS, MAP_SIZES, MAP_SIZE_IDS, RULES, RULE_ERROR_MESSAGES, UNITS, cloneJson } from '@domination/shared';
import type { BuildWait, JobOption, OwnCityDetail, PlayerView, QueueEntryView, RuleErrorCode, UnitJobView } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import { improvementBonusText as bonusTextOfTileInfo } from '../src/game/tileInfo';
import {
  LOCAL_LINK_NOTE,
  buildOptionText,
  buildWaitText,
  codeHintText,
  countOf,
  firstStepsText,
  foodText,
  ghostSeatWarning,
  homeIntroText,
  improvementBonusText,
  jobButtonText,
  jobProgressText,
  jobReasonText,
  jobsReasonText,
  mapSizeNote,
  mapSizeText,
  movesText,
  nameList,
  populationText,
  productionNoteText,
  productionText,
  progressFraction,
  queueCountText,
  queueNoteText,
  queueRowText,
  signed,
  tabTitleText,
  todoHints,
  unitHintParts,
  unitHintText,
  waitingForText,
} from '../src/ui/texts';
import { SAMPLE, cityIn, ownOf, romeOf, unitIn } from './shellKit';

/**
 * The sentences the panels print (ui/texts.ts). The doc comments of the
 * panels pin several of these formats down ("Moves 1/2", "Food 4/16 (+3 per
 * turn)", "Warrior 6/18 (+3 per turn, 4 turns)"), and the end-to-end test
 * reads some of them from the page, so they are checked word for word here.
 * Change the wording in texts.ts and in these expectations together.
 */

/** Rome's details from the sample view: food 4/16 (+3); a Warrior at 6/18 (+3, 4 turns), then a Scout (in 7 turns). */
function rome(changes: Partial<OwnCityDetail> = {}): OwnCityDetail {
  const own = sampleView().cities.find((city) => city.id === SAMPLE.romeId)?.own;
  if (own == null) throw new Error('the sample view has no Rome');
  return { ...own, ...changes };
}

/** One row of a build queue. */
function entry(unitType: QueueEntryView['item']['unitType'], turns: number | null, wait: BuildWait | null = null): QueueEntryView {
  return { item: { kind: 'unit', unitType }, cost: UNITS[unitType].cost, turns, wait };
}

/** Rome with this queue. */
function romeBuilding(queue: QueueEntryView[], changes: Partial<OwnCityDetail> = {}): OwnCityDetail {
  return rome({ buildQueue: queue, ...changes });
}

/** Adds a second city of the player's to a view: a copy of Rome under another id, with a change applied. */
function addOwnCity(view: PlayerView, id: string, name: string, change: (own: OwnCityDetail) => void): void {
  const city = { ...cloneJson(cityIn(view, SAMPLE.romeId)), id, name, tile: SAMPLE.romeTile + 28 };
  if (city.own === null) throw new Error('unexpected sample view');
  change(city.own);
  view.cities.push(city);
}

/** What a view says about a first entry that is paid for and cannot be completed, with no end in sight. */
function hold(own: OwnCityDetail, why: 'needsPopulation' | 'noRoom'): void {
  own.buildQueue = [entry('settler', null, why), entry('warrior', null, 'earlier')];
  own.productionStored = 30;
  own.held = why;
}

/** A job option of a Worker. */
function option(improvement: JobOption['improvement'], error: RuleErrorCode | null, turns = IMPROVEMENTS[improvement].turns): JobOption {
  return { improvement, turns, error };
}

/** The sample view with the given players having ended their turn, and nobody else. */
function viewWithEnded(...ended: string[]): PlayerView {
  const view = sampleView();
  view.players.push({ id: 'p3', name: 'Cleo', civ: 'china', endedTurn: false });
  for (const player of view.players) player.endedTurn = ended.includes(player.id);
  return view;
}

describe('small helpers (WP4)', () => {
  it('countOf picks the singular or the plural', () => {
    expect(countOf(1, 'turn', 'turns')).toBe('1 turn');
    expect(countOf(2, 'turn', 'turns')).toBe('2 turns');
    expect(countOf(0, 'turn', 'turns')).toBe('0 turns');
  });

  it('signed always shows the sign', () => {
    expect(signed(2)).toBe('+2');
    expect(signed(0)).toBe('+0');
    expect(signed(-1)).toBe('-1');
  });

  it('nameList joins names the way a sentence would, and shortens long lists', () => {
    expect(nameList([])).toBe('');
    expect(nameList(['Ben'])).toBe('Ben');
    expect(nameList(['Ben', 'Cleo'])).toBe('Ben and Cleo');
    expect(nameList(['Ben', 'Cleo', 'Dan'])).toBe('Ben, Cleo and Dan');
    expect(nameList(['Ben', 'Cleo', 'Dan', 'Eve', 'Finn'])).toBe('Ben, Cleo and 3 others');
  });

  it('progressFraction stays between 0 and 1 and copes with "nothing chosen"', () => {
    expect(progressFraction(6, 18)).toBeCloseTo(1 / 3);
    expect(progressFraction(30, 18)).toBe(1); // more than needed: a full bar, not an overflowing one
    expect(progressFraction(-2, 18)).toBe(0);
    expect(progressFraction(5, null)).toBe(0);
    expect(progressFraction(5, 0)).toBe(0);
  });
});

describe('unit panel texts (WP4)', () => {
  it('movesText is "Moves left/total" for an own unit and empty for anybody else\'s', () => {
    const view = sampleView();
    const warrior = view.units.find((unit) => unit.id === SAMPLE.warriorId);
    const foreign = view.units.find((unit) => unit.id === SAMPLE.foreignWarriorId);
    if (warrior === undefined || warrior.own === null || foreign === undefined) throw new Error('unexpected sample view');

    expect(movesText(warrior)).toBe(`Moves 2/${UNITS.warrior.moves}`);
    warrior.own.movesLeft = 1;
    expect(movesText(warrior)).toBe(`Moves 1/${UNITS.warrior.moves}`);
    expect(movesText(foreign)).toBe('');
  });
});

describe('city panel texts (WP4)', () => {
  it('populationText and foodText print the numbers of the view as they are', () => {
    expect(populationText(2)).toBe('Population 2');
    expect(foodText(rome())).toBe('Food 4/16 (+3 per turn)');
    expect(foodText(rome({ foodPerTurn: 0 }))).toBe('Food 4/16 (+0 per turn)');
    expect(foodText(rome({ foodPerTurn: -1 }))).toBe('Food 4/16 (-1 per turn)');
  });

  it('productionText names the current build ("4 turns", "1 turn", no turns without a number), or says there is nothing to build', () => {
    expect(productionText(rome())).toBe('Warrior 6/18 (+3 per turn, 4 turns)');
    expect(productionText(romeBuilding([entry('warrior', 1)], { productionStored: 15 }))).toBe('Warrior 15/18 (+3 per turn, 1 turn)');
    // Only the first entry is the current build, whatever follows it.
    expect(productionText(romeBuilding([entry('scout', 2), entry('warrior', 8), entry('settler', 20)]))).toBe('Scout 6/12 (+3 per turn, 2 turns)');

    // No number: a city that makes no production, and a paid-for Settler that is held.
    expect(productionText(romeBuilding([entry('warrior', null, 'noProduction')], { productionPerTurn: 0 }))).toBe('Warrior 6/18 (+0 per turn)');
    expect(productionText(romeBuilding([entry('settler', null, 'needsPopulation')], { productionStored: 30, productionPerTurn: 2, held: 'needsPopulation' }))).toBe(
      'Settler 30/30 (+2 per turn)',
    );
    // Held, and the forecast sees the end of the wait: the number says when.
    expect(productionText(romeBuilding([entry('settler', 2)], { productionStored: 30, productionPerTurn: 2, held: 'needsPopulation' }))).toBe(
      'Settler 30/30 (+2 per turn, 2 turns)',
    );
    // The store can hold more than the first entry costs while it waits.
    expect(productionText(romeBuilding([entry('warrior', null, 'noRoom')], { productionStored: 30, held: 'noRoom' }))).toBe('Warrior 30/18 (+3 per turn)');

    // An empty queue: what is saved, and what is lost, is the note's to say (productionNoteText).
    expect(productionText(romeBuilding([], { productionStored: 0 }))).toBe('Nothing to build.');
    expect(productionText(romeBuilding([], { productionStored: 7 }))).toBe('Nothing to build.');
  });

  it('productionNoteText says "Waiting: ..." exactly when held is set, warns about an idle city, and is null for a first entry that has no number but is not paid for', () => {
    expect(productionNoteText(rome())).toBeNull();

    expect(productionNoteText(romeBuilding([entry('settler', null, 'needsPopulation')], { productionStored: 30, held: 'needsPopulation' }))).toBe(
      'Waiting: the city must grow first',
    );
    expect(productionNoteText(romeBuilding([entry('warrior', null, 'noRoom')], { productionStored: 18, held: 'noRoom' }))).toBe(
      'Waiting: no free tile for the unit',
    );
    // Held with the end in sight: still waiting right now.
    expect(productionNoteText(romeBuilding([entry('settler', 2)], { productionStored: 30, held: 'needsPopulation' }))).toBe('Waiting: the city must grow first');

    // No number, but nothing is held: the entry is simply not paid for yet. Nothing waits.
    expect(productionNoteText(romeBuilding([entry('warrior', null, 'noProduction')], { productionPerTurn: 0 }))).toBeNull();
    expect(productionNoteText(romeBuilding([entry('settler', null, 'tooFar')]))).toBeNull();
    expect(productionNoteText(romeBuilding([entry('settler', null, 'needsPopulation')], { productionStored: 12 }))).toBeNull();

    // An idle city. (The sample Rome has 6 production saved: the next test is about the sentence for that.)
    expect(productionNoteText(romeBuilding([], { productionStored: 0 }))).toBe("This city's production is lost every turn.");
  });

  it('an idle city with production saved says that it is kept, and that only what is made from now on is lost ("1 production is", "7 production are")', () => {
    expect(productionNoteText(romeBuilding([], { productionStored: 7 }))).toBe('7 production are saved for the next item; what the city makes meanwhile is lost.');
    expect(productionNoteText(romeBuilding([], { productionStored: 1 }))).toBe('1 production is saved for the next item; what the city makes meanwhile is lost.');
    expect(productionNoteText(romeBuilding([]))).toBe('6 production are saved for the next item; what the city makes meanwhile is lost.');
    // The panel prints the two parts in one element, with a space between them.
    const idle = romeBuilding([], { productionStored: 6 });
    expect(`${productionText(idle)} ${productionNoteText(idle)}`).toBe(
      'Nothing to build. 6 production are saved for the next item; what the city makes meanwhile is lost.',
    );
    // "Saved" is never said of a city that is building something: its first row has the numbers.
    expect(productionNoteText(rome({ productionStored: 7 }))).toBeNull();
  });

  it('queueRowText: "building now, ready in 4 turns", "building now, ready in 1 turn", "ready in 8 turns", and the reason where there is no number, for the first row too', () => {
    expect(queueRowText(entry('warrior', 4), 0)).toBe('building now, ready in 4 turns');
    expect(queueRowText(entry('warrior', 1), 0)).toBe('building now, ready in 1 turn');
    expect(queueRowText(entry('scout', 8), 1)).toBe('ready in 8 turns');
    expect(queueRowText(entry('scout', 1), 1)).toBe('ready in 1 turn');
    expect(queueRowText(entry('scout', 21), 7)).toBe('ready in 21 turns');

    expect(queueRowText(entry('settler', null, 'needsPopulation'), 0)).toBe('the city must grow first');
    expect(queueRowText(entry('warrior', null, 'noRoom'), 0)).toBe('no free tile for the unit');
    expect(queueRowText(entry('warrior', null, 'noProduction'), 0)).toBe('this city makes no production');
    expect(queueRowText(entry('settler', null, 'tooFar'), 0)).toBe('more than 50 turns');
    expect(queueRowText(entry('settler', null, 'tooFar'), 2)).toBe('more than 50 turns');
    expect(queueRowText(entry('warrior', null, 'earlier'), 1)).toBe('after the item above');

    // The sample queue, as the panel prints it.
    expect(rome().buildQueue.map(queueRowText)).toEqual(['building now, ready in 4 turns', 'ready in 7 turns']);

    // A row with neither a number nor a reason (the server never sends one) still says something true.
    expect(queueRowText(entry('warrior', null, null), 0)).toBe('building now');
    expect(queueRowText(entry('warrior', null, null), 3)).toBe('after the item above');
  });

  it('buildWaitText has a sentence for each of the five reasons; "more than 50 turns" reads the table', () => {
    const sentences: Record<BuildWait, string> = {
      needsPopulation: 'the city must grow first',
      noRoom: 'no free tile for the unit',
      noProduction: 'this city makes no production',
      tooFar: `more than ${RULES.forecastTurns} turns`,
      earlier: 'after the item above',
    };
    for (const [wait, sentence] of Object.entries(sentences)) expect(buildWaitText(wait as BuildWait)).toBe(sentence);
    expect(buildWaitText('tooFar')).toBe('more than 50 turns');

    const before = RULES.forecastTurns;
    try {
      RULES.forecastTurns = 30;
      expect(buildWaitText('tooFar')).toBe('more than 30 turns');
    } finally {
      RULES.forecastTurns = before;
    }
  });

  it('buildOptionText gives cost ("costs 18"), turns ("ready in 1 turn", "ready in 4 turns") and population, and the reason in brackets where there is no number', () => {
    const options = rome().buildOptions;
    const warrior = options.find((candidate) => candidate.item.unitType === 'warrior');
    const settler = options.find((candidate) => candidate.item.unitType === 'settler');
    if (warrior === undefined || settler === undefined) throw new Error('unexpected sample view');

    // The sample menu: when each would be done if added now, behind the Warrior and the Scout.
    expect(options.map(buildOptionText)).toEqual([
      'costs 18, ready in 12 turns',
      'costs 12, ready in 10 turns',
      'costs 30, ready in 14 turns, uses 1 population',
      'costs 20, ready in 12 turns',
    ]);
    expect(buildOptionText({ ...warrior, turns: 4 })).toBe('costs 18, ready in 4 turns');
    expect(buildOptionText({ ...warrior, turns: 1 })).toBe('costs 18, ready in 1 turn');
    expect(buildOptionText({ ...settler, turns: 18 })).toBe(`costs 30, ready in 18 turns, uses ${UNITS.settler.populationCost} population`);

    // No number: the reason in brackets...
    expect(buildOptionText({ ...settler, turns: null, wait: 'needsPopulation' })).toBe('costs 30, uses 1 population (the city must grow first)');
    expect(buildOptionText({ ...warrior, turns: null, wait: 'tooFar' })).toBe('costs 18 (more than 50 turns)');
    expect(buildOptionText({ ...warrior, turns: null, wait: 'noRoom' })).toBe('costs 18 (no free tile for the unit)');
    expect(buildOptionText({ ...warrior, turns: null, wait: 'noProduction' })).toBe('costs 18 (this city makes no production)');
    // ...except behind a queue that has no end: the rows above already say why.
    expect(buildOptionText({ ...warrior, turns: null, wait: 'earlier' })).toBe('costs 18');
    expect(buildOptionText({ ...settler, turns: null, wait: 'earlier' })).toBe('costs 30, uses 1 population');
    // A full queue changes nothing in this line: the note under the queue title says it.
    expect(buildOptionText({ ...warrior, addError: 'queueFull' })).toBe('costs 18, ready in 12 turns');
  });

  it('queueNoteText says why the queue cannot be changed: no connection, turn ended, queue full', () => {
    expect(queueNoteText(rome(), null)).toBeNull();
    expect(queueNoteText(rome(), 'offline')).toBe('No connection: the queue cannot be changed right now.');
    expect(queueNoteText(rome(), 'turnEnded')).toBe('You have ended your turn. Cancel that to change the queue.');

    const full = rome();
    full.buildOptions = full.buildOptions.map((candidate) => ({ ...candidate, addError: 'queueFull' as const }));
    expect(queueNoteText(full, null)).toBe('The build queue is full.');
    expect(queueNoteText(full, null)).toBe(RULE_ERROR_MESSAGES.queueFull);
    // The lasting reasons come first: they stop every button, not only the add buttons.
    expect(queueNoteText(full, 'offline')).toBe('No connection: the queue cannot be changed right now.');
    expect(queueNoteText(full, 'turnEnded')).toBe('You have ended your turn. Cancel that to change the queue.');

    // An empty queue, and a city with nothing in its menu, have nothing to say here.
    expect(queueNoteText(romeBuilding([]), null)).toBeNull();
    expect(queueNoteText(rome({ buildOptions: [] }), null)).toBeNull();
  });

  it('queueCountText is "Queue 2 of 8" for the sample city', () => {
    expect(queueCountText(rome())).toBe('Queue 2 of 8');
    expect(queueCountText(romeBuilding([]))).toBe(`Queue 0 of ${RULES.maxQueueLength}`);
    expect(queueCountText(romeBuilding(Array.from({ length: RULES.maxQueueLength }, () => entry('warrior', null, 'earlier'))))).toBe('Queue 8 of 8');
  });
});

describe('End Turn and top bar texts (WP4)', () => {
  it('todoHints says what still needs the player, and nothing when nothing does', () => {
    const view = sampleView();
    expect(todoHints(view)).toEqual(['2 units can still move']);

    ownOf(view, SAMPLE.settlerId).movesLeft = 0;
    romeOf(view).buildQueue = [];
    expect(todoHints(view)).toEqual(['Rome has nothing to build', '1 unit can still move']);

    for (const unit of view.units) if (unit.own !== null) unit.own.movesLeft = 0;
    romeOf(view).buildQueue = [entry('scout', 2)];
    expect(todoHints(view)).toEqual([]);
  });

  it('todoHints counts cities in the plural too', () => {
    const view = sampleView();
    for (const unit of view.units) if (unit.own !== null) unit.own.movesLeft = 0;
    romeOf(view).buildQueue = [];
    addOwnCity(view, 'c1_second', 'Ostia', (own) => {
      own.buildQueue = [];
    });
    expect(todoHints(view)).toEqual(['2 cities have nothing to build']);
  });

  it('todoHints: idle cities first (named when there is one), then waiting cities ("Rome is waiting: the city must grow first"; "2 cities are waiting to finish a unit"), then units; a unit at work is not counted', () => {
    // The sample view: three own units, one of them at work.
    const sample = sampleView();
    expect(sample.units.filter((unit) => unit.owner === sample.you)).toHaveLength(3);
    expect(todoHints(sample)).toEqual(['2 units can still move']);
    ownOf(sample, SAMPLE.workerId).job = null;
    expect(todoHints(sample)).toEqual(['3 units can still move']);

    // One city waits with no end in sight: its name and why.
    const waiting = sampleView();
    hold(romeOf(waiting), 'needsPopulation');
    expect(todoHints(waiting)).toEqual(['Rome is waiting: the city must grow first', '2 units can still move']);
    hold(romeOf(waiting), 'noRoom');
    expect(todoHints(waiting)).toEqual(['Rome is waiting: no free tile for the unit', '2 units can still move']);

    // Held, but the first row has a number (the wait will be over): the panel says it, the hint does not.
    romeOf(waiting).buildQueue[0].turns = 2;
    romeOf(waiting).buildQueue[0].wait = null;
    expect(todoHints(waiting)).toEqual(['2 units can still move']);

    // An idle city and a waiting one: the idle one first.
    const both = sampleView();
    hold(romeOf(both), 'needsPopulation');
    addOwnCity(both, 'c1_zzzzzz', 'Capua', (own) => {
      own.buildQueue = [];
    });
    expect(todoHints(both)).toEqual(['Capua has nothing to build', 'Rome is waiting: the city must grow first', '2 units can still move']);

    // Two of each: counted, not named.
    addOwnCity(both, 'c1_aaaaaa', 'Ostia', (own) => {
      own.buildQueue = [];
    });
    addOwnCity(both, 'c1_bbbbbb', 'Antium', (own) => hold(own, 'noRoom'));
    for (const unit of both.units) if (unit.own !== null) unit.own.movesLeft = 0;
    expect(todoHints(both)).toEqual(['2 cities have nothing to build', '2 cities are waiting to finish a unit']);
  });

  it('waitingForText names who has not ended the turn yet, "you" first', () => {
    const everybody = ['p1', 'p2', 'p3'];
    expect(waitingForText(viewWithEnded(), everybody)).toBe('Waiting for you, Ben and Cleo');
    expect(waitingForText(viewWithEnded('p2'), everybody)).toBe('Waiting for you and Cleo');
    expect(waitingForText(viewWithEnded('p1'), everybody)).toBe('Waiting for Ben and Cleo');
    expect(waitingForText(viewWithEnded('p1', 'p3'), everybody)).toBe('Waiting for Ben');
  });

  it('waitingForText says so plainly when only this player is left', () => {
    expect(waitingForText(viewWithEnded('p2', 'p3'), ['p1', 'p2', 'p3'])).toBe('Everyone is waiting for you');
  });

  it('waitingForText marks players who are waited for but not connected', () => {
    expect(waitingForText(viewWithEnded('p1'), ['p1', 'p3'])).toBe('Waiting for Ben (offline) and Cleo');
  });

  it('tabTitleText says whose move it is and which turn', () => {
    const view = sampleView();
    expect(tabTitleText(view)).toBe('Your move - Turn 7 - Domination');
    view.players[0].endedTurn = true;
    view.turn = 8;
    expect(tabTitleText(view)).toBe('Waiting for others - Turn 8 - Domination');
  });

  it('waitingForText is empty in a game with one player', () => {
    const alone = sampleView();
    alone.players = alone.players.filter((player) => player.id === alone.you);
    expect(waitingForText(alone, ['p1'])).toBe('');
  });
});

describe('unit hint and first steps', () => {
  /** The sample view with a change applied to a copy of it. */
  function viewWith(change: (view: PlayerView) => void): PlayerView {
    const view = sampleView();
    change(view);
    return view;
  }
  const unitOf = (view: PlayerView, id: string): PlayerView['units'][number] => {
    const unit = view.units.find((candidate) => candidate.id === id);
    if (unit === undefined) throw new Error(`the view has no unit ${id}`);
    return unit;
  };

  it('says what the selected unit can do right now', () => {
    const view = sampleView();
    const warrior = unitOf(view, SAMPLE.warriorId);
    expect(unitHintText(view, warrior, true)).toBe('Choose a highlighted tile to move there.');
    expect(unitHintText(view, warrior, false)).toBe('No connection: orders have to wait.');

    const spent = viewWith((changed) => {
      const own = unitOf(changed, SAMPLE.warriorId).own;
      if (own !== null) own.movesLeft = 0;
    });
    expect(unitHintText(spent, unitOf(spent, SAMPLE.warriorId), true)).toBe('No moves left this turn.');

    const ended = viewWithEnded('p1');
    expect(unitHintText(ended, unitOf(ended, SAMPLE.warriorId), true)).toBe('You have ended your turn. Cancel that to give orders.');
  });

  it('has nothing to say about somebody else\'s unit', () => {
    const view = sampleView();
    expect(unitHintText(view, unitOf(view, SAMPLE.foreignWarriorId), true)).toBe('');
    expect(unitHintParts(view, unitOf(view, SAMPLE.foreignWarriorId), true)).toEqual({ main: '', more: '' });
  });

  it('unitHintParts: "At work here ..." for a unit with a job, after "No connection" and "You have ended your turn"; the second sentence apart; unitHintText is the two joined', () => {
    const view = sampleView();
    const worker = unitIn(view, SAMPLE.workerId);
    expect(unitHintParts(view, worker, true)).toEqual({ main: 'At work here. Stop the work to move this unit.', more: '' });
    expect(unitHintText(view, worker, true)).toBe('At work here. Stop the work to move this unit.');

    // The lasting reasons come first: with them, "Stop work" cannot be pressed either.
    expect(unitHintParts(view, worker, false).main).toBe('No connection: orders have to wait.');
    const ended = viewWithEnded('p1');
    expect(unitHintParts(ended, unitIn(ended, SAMPLE.workerId), true).main).toBe('You have ended your turn. Cancel that to give orders.');
    expect(unitHintParts(ended, unitIn(ended, SAMPLE.workerId), false).main).toBe('No connection: orders have to wait.');

    // A unit at work that has no moves left is still "at work": that is what keeps it here.
    const tired = viewWith((changed) => {
      ownOf(changed, SAMPLE.workerId).movesLeft = 0;
    });
    expect(unitHintParts(tired, unitIn(tired, SAMPLE.workerId), true).main).toBe('At work here. Stop the work to move this unit.');
    // Without a job it is a unit like any other.
    const idle = viewWith((changed) => {
      ownOf(changed, SAMPLE.workerId).job = null;
    });
    expect(unitHintParts(idle, unitIn(idle, SAMPLE.workerId), true).main).toBe('Choose a highlighted tile to move there.');
    ownOf(idle, SAMPLE.workerId).movesLeft = 0;
    expect(unitHintParts(idle, unitIn(idle, SAMPLE.workerId), true).main).toBe('No moves left this turn.');

    // The second sentence, apart: the Warrior shares the Worker's tile.
    const stacked = viewWith((changed) => {
      unitIn(changed, SAMPLE.warriorId).tile = SAMPLE.workerTile;
    });
    expect(unitHintParts(stacked, unitIn(stacked, SAMPLE.workerId), true)).toEqual({
      main: 'At work here. Stop the work to move this unit.',
      more: 'Tap the same tile again to select the Warrior.',
    });
    expect(unitHintParts(stacked, unitIn(stacked, SAMPLE.warriorId), true)).toEqual({
      main: 'Choose a highlighted tile to move there.',
      more: 'Tap the same tile again to select the Worker.',
    });
    expect(unitHintText(stacked, unitIn(stacked, SAMPLE.workerId), true)).toBe(
      'At work here. Stop the work to move this unit. Tap the same tile again to select the Warrior.',
    );
    // The second sentence is there whatever the first one says.
    expect(unitHintParts(stacked, unitIn(stacked, SAMPLE.workerId), false)).toEqual({
      main: 'No connection: orders have to wait.',
      more: 'Tap the same tile again to select the Warrior.',
    });

    // For every own unit of the sample view, in every state: the one string is the two parts joined.
    for (const candidate of [view, stacked, tired, idle, ended]) {
      for (const unit of candidate.units) {
        for (const online of [true, false]) {
          const { main, more } = unitHintParts(candidate, unit, online);
          expect(unitHintText(candidate, unit, online)).toBe(more === '' ? main : `${main} ${more}`);
        }
      }
    }
  });

  it('when two own units share a tile, says how to get at the other one (as at the start of every game)', () => {
    const stacked = viewWith((view) => {
      unitOf(view, SAMPLE.settlerId).tile = SAMPLE.warriorTile;
    });
    expect(unitHintText(stacked, unitOf(stacked, SAMPLE.warriorId), true)).toBe(
      'Choose a highlighted tile to move there. Tap the same tile again to select the Settler.',
    );
    expect(unitHintText(stacked, unitOf(stacked, SAMPLE.settlerId), true)).toBe(
      'Choose a highlighted tile to move there. Tap the same tile again to select the Warrior.',
    );
  });

  it('a unit standing in an own city says how to get at the city, by its name', () => {
    const inRome = viewWith((view) => {
      unitOf(view, SAMPLE.warriorId).tile = SAMPLE.romeTile;
    });
    expect(unitHintText(inRome, unitOf(inRome, SAMPLE.warriorId), true)).toBe(
      'Choose a highlighted tile to move there. Tap the same tile again to select Rome.',
    );
  });

  it('a foreign unit or city on the tile is not offered: a tap cannot select it', () => {
    const view = viewWith((changed) => {
      unitOf(changed, SAMPLE.foreignWarriorId).tile = SAMPLE.settlerTile; // cannot happen by the rules; the text must not care
    });
    expect(unitHintText(view, unitOf(view, SAMPLE.settlerId), true)).toBe('Choose a highlighted tile to move there.');
  });

  it('firstStepsText speaks only until the first city is founded', () => {
    const start = viewWith((view) => {
      view.cities = view.cities.filter((city) => city.owner !== view.you);
    });
    expect(firstStepsText(start)).toBe('Tap one of your units on the map to select it. Your Settler can found your first city.');

    // With a city of one's own there is nothing left to explain...
    expect(firstStepsText(sampleView())).toBeNull();
    // ...and without a Settler the advice would be wrong.
    const noSettler = viewWith((view) => {
      view.cities = view.cities.filter((city) => city.owner !== view.you);
      view.units = view.units.filter((unit) => unit.type !== 'settler');
    });
    expect(firstStepsText(noSettler)).toBeNull();
    // Somebody else's Settler does not count.
    const foreignSettler = viewWith((view) => {
      view.cities = [];
      view.units = [{ id: 'u2_zzzzzz', type: 'settler', owner: 'p2', tile: SAMPLE.emptyTile, own: null }];
    });
    expect(firstStepsText(foreignSettler)).toBeNull();
  });
});

describe('job texts (the unit panel of a Worker)', () => {
  it('jobButtonText ("Build Farm (4 turns)", "Build Farm (1 turn)") and jobProgressText (one turn / several turns)', () => {
    expect(jobButtonText(option('farm', null))).toBe('Build Farm (4 turns)');
    expect(jobButtonText(option('mine', null))).toBe('Build Mine (5 turns)');
    expect(jobButtonText(option('farm', null, 1))).toBe('Build Farm (1 turn)');
    // The button says the same whether it can be pressed or not; the reason is a line of its own.
    expect(jobButtonText(option('farm', 'notYourLand'))).toBe('Build Farm (4 turns)');
    // The sample Worker's options, as its panel would print them.
    expect(ownOf(sampleView(), SAMPLE.workerId).jobOptions.map(jobButtonText)).toEqual(['Build Farm (4 turns)', 'Build Mine (5 turns)']);

    const job: UnitJobView = { improvement: 'farm', turnsWorked: 1, turnsTotal: 4, turnsLeft: 3 };
    expect(jobProgressText(job)).toBe('Building a Farm: 3 turns left');
    expect(jobProgressText({ improvement: 'mine', turnsWorked: 4, turnsTotal: 5, turnsLeft: 1 })).toBe('Building a Mine: 1 turn left');
    expect(jobProgressText({ improvement: 'farm', turnsWorked: 0, turnsTotal: 4, turnsLeft: 4 })).toBe('Building a Farm: 4 turns left');
  });

  it('jobReasonText: null without an error; the table\'s "needs" phrase for badImprovementTile; the improvement\'s name for alreadyImproved; the standard sentence for every other code', () => {
    expect(jobReasonText(option('farm', null))).toBeNull();
    expect(jobReasonText(option('mine', null))).toBeNull();

    expect(jobReasonText(option('farm', 'badImprovementTile'))).toBe('A Farm needs open grassland, plains or desert.');
    expect(jobReasonText(option('mine', 'badImprovementTile'))).toBe('A Mine needs hills.');
    expect(jobReasonText(option('farm', 'alreadyImproved'))).toBe('This tile already has a Farm.');
    expect(jobReasonText(option('mine', 'alreadyImproved'))).toBe('This tile already has a Mine.');
    for (const id of IMPROVEMENT_IDS) {
      expect(jobReasonText(option(id, 'badImprovementTile'))).toBe(`A ${IMPROVEMENTS[id].name} needs ${IMPROVEMENTS[id].needs}.`);
    }

    expect(jobReasonText(option('farm', 'notYourLand'))).toBe('That can only be built on your own land.');
    expect(jobReasonText(option('mine', 'cityOnTile'))).toBe('Nothing can be built on the tile of a city.');
    expect(jobReasonText(option('farm', 'unitBusy'))).toBe('This unit is at work. Stop the work first.');
    const others: RuleErrorCode[] = ['notYourLand', 'cityOnTile', 'unitBusy', 'cannotImprove', 'noSuchUnit', 'badAction'];
    for (const code of others) {
      for (const id of IMPROVEMENT_IDS) expect(jobReasonText(option(id, code)), code).toBe(RULE_ERROR_MESSAGES[code]);
    }
  });

  it('jobsReasonText: the one sentence when every option has the same reason; null when the reasons differ, when one option is possible and for an empty list', () => {
    // Outside the borders, and on the tile of a city: one line for the whole block.
    expect(jobsReasonText([option('farm', 'notYourLand'), option('mine', 'notYourLand')])).toBe('That can only be built on your own land.');
    expect(jobsReasonText([option('farm', 'cityOnTile'), option('mine', 'cityOnTile')])).toBe('Nothing can be built on the tile of a city.');
    expect(jobsReasonText([option('farm', 'notYourLand')])).toBe('That can only be built on your own land.');

    // On forest both are impossible, each for its own reason: the same code, two sentences.
    expect(jobsReasonText([option('farm', 'badImprovementTile'), option('mine', 'badImprovementTile')])).toBeNull();
    // On a finished farm: one already stands, the other does not fit.
    expect(jobsReasonText([option('farm', 'alreadyImproved'), option('mine', 'badImprovementTile')])).toBeNull();
    expect(jobsReasonText([option('farm', 'notYourLand'), option('mine', 'cityOnTile')])).toBeNull();

    // One of them can be started: each button speaks for itself.
    expect(jobsReasonText([option('farm', null), option('mine', 'badImprovementTile')])).toBeNull();
    expect(jobsReasonText([option('farm', 'badImprovementTile'), option('mine', null)])).toBeNull();
    expect(jobsReasonText([option('farm', null), option('mine', null)])).toBeNull();

    // A unit that builds nothing has no block and no sentence.
    expect(jobsReasonText([])).toBeNull();
    expect(jobsReasonText(ownOf(sampleView(), SAMPLE.warriorId).jobOptions)).toBeNull();
  });

  it('what a job adds is said in the words of the tile information ("+1 food")', () => {
    expect(improvementBonusText('farm')).toBe('+1 food');
    expect(improvementBonusText('mine')).toBe('+2 production');
    expect(improvementBonusText).toBe(bonusTextOfTileInfo);
  });
});

describe('home screen texts', () => {
  const welcome = 'A strategy game to play with friends. Create a game and send them the link, or join theirs.';

  it('somebody who opened an invite link is told so, once the server has answered', () => {
    expect(homeIntroText('K7QXM', false, null)).toBe('You are invited to game K7QXM. Type your name and press Join.');
    expect(homeIntroText('K7QXM', true, null)).toBe(welcome); // still asking: no promise yet
    expect(homeIntroText(null, false, null)).toBe(welcome);
  });

  it('nobody is "invited" to a game that cannot be joined', () => {
    for (const problem of ['noSuchGame', 'gameNotLoaded', 'gameAlreadyStarted', 'gameFull'] as const) {
      const text = homeIntroText('K7QXM', false, problem);
      expect(text).toBe(welcome);
      expect(text).not.toContain('invited');
    }
  });

  it('the line under the code field says why a game cannot be joined, each reason in its own words', () => {
    const usual = codeHintText(false, null);
    expect(usual).toBe('Your friend sees the code and a link when they create a game.');

    expect(codeHintText(false, 'noSuchGame')).toContain('no game with this code');
    // A game the server has on disk but could not load is NOT "no game": the player is sent to
    // the person who can repair it, and told how to get back afterwards.
    expect(codeHintText(false, 'gameNotLoaded')).toBe(
      'This game is on the server but could not be opened. Ask the person who runs the server. When they have put it right, reload this page.',
    );
    expect(codeHintText(false, 'gameNotLoaded')).not.toContain('new game');
    expect(codeHintText(false, 'gameAlreadyStarted')).toContain('already started');
    expect(codeHintText(false, 'gameFull')).toContain('full');
    for (const problem of ['gameAlreadyStarted', 'gameFull'] as const) {
      // Joining is over; the way on is a game of one's own.
      expect(codeHintText(false, problem)).toContain('start a new game');
    }
  });

  it('a code that is too short to be one is explained first: no game was asked about yet', () => {
    expect(codeHintText(true, null)).toContain('5 letters or digits');
    expect(codeHintText(true, 'gameFull')).toBe(codeHintText(true, null));
  });

  it('a link whose code is no code is called damaged, without repeating what it held', () => {
    const damaged = codeHintText(false, null, true);
    expect(damaged).toContain('damaged');
    expect(damaged).toContain('5 letters or digits');
    expect(damaged).not.toBe(codeHintText(false, null));
    // Nobody is invited through such a link: the address held no code as far as the page is concerned.
    expect(homeIntroText(null, false, null)).not.toContain('invited');
    // Once a code was typed and the server has spoken about it, that is what counts.
    expect(codeHintText(false, 'noSuchGame', true)).toBe(codeHintText(false, 'noSuchGame'));
    expect(codeHintText(true, null, true)).toBe(codeHintText(true, null));
  });
});

describe('lobby texts (WP4)', () => {
  it('mapSizeText shows the name and how many players the size is best for', () => {
    for (const id of MAP_SIZE_IDS) {
      const size = MAP_SIZES[id];
      const text = mapSizeText(id);
      expect(text).toContain(size.name);
      expect(text).toContain(`best for up to ${size.recommendedPlayers} players`);
    }
  });

  it('a line of the map size menu is short enough for a phone, which cuts off what does not fit', () => {
    // The closed menu on a 390-pixel-wide phone has room for about 34
    // characters. "Medium (44 x 28), best for up to 5 players" had 42, and
    // was shown as "...best for up to 5 play".
    for (const id of MAP_SIZE_IDS) expect(mapSizeText(id).length).toBeLessThanOrEqual(34);
  });

  it('mapSizeNote gives the size in tiles, and says who chooses', () => {
    for (const id of MAP_SIZE_IDS) {
      const size = MAP_SIZES[id];
      expect(mapSizeNote(id, null)).toBe(`${size.width} x ${size.height} tiles. A bigger map makes a longer game.`);
      expect(mapSizeNote(id, 'Ada')).toBe(`${size.width} x ${size.height} tiles. Ada chooses the map.`);
    }
  });

  it('the note about a link that only works on this computer says why, and what to do', () => {
    expect(LOCAL_LINK_NOTE).toContain('only works on this computer');
    expect(LOCAL_LINK_NOTE).toContain('localhost');
    expect(LOCAL_LINK_NOTE).toContain('README');
  });

  it('ghostSeatWarning lists every absent player and asks before starting', () => {
    expect(ghostSeatWarning(['Ben'])).toBe('Ben is not connected. The game waits for every player each turn. Start anyway?');
    expect(ghostSeatWarning(['Ben', 'Cleo'])).toBe(
      'Ben and Cleo are not connected. The game waits for every player each turn. Start anyway?',
    );
  });
});
