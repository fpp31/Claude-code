import { describe, expect, it } from 'vitest';
import { CITY_FOCUS, IMPROVEMENTS, IMPROVEMENT_IDS, MAP_SIZES, MAP_SIZE_IDS, RULES, RULE_ERROR_MESSAGES, UNITS, UNIT_TYPE_IDS, cloneJson } from '@domination/shared';
import type { BuildOption, BuildWait, JobOption, OwnCityDetail, PlayerView, QueueEntryView, RuleErrorCode, UnitJobView, UnitTypeId } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import { improvementBonusText as bonusTextOfTileInfo } from '../src/game/tileInfo';
import {
  ADD_LINE_MAX,
  CITY_TILES_HINT,
  FOCUS_GROUP_LABEL,
  LOCAL_LINK_NOTE,
  NEEDS_WATER,
  REMOVE_HINT,
  STOP_ASK,
  STOP_LABEL,
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
  stopWarningText,
  tabTitleText,
  todoHints,
  unitHintParts,
  unitHintText,
  waitingForText,
} from '../src/ui/texts';
import { SAMPLE, SHORE, addOwnUnit, cityIn, ownOf, putToWork, romeOf, shoreView, unitIn } from './shellKit';

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
function hold(own: OwnCityDetail, why: 'needsPopulation' | 'noRoom', first: UnitTypeId = 'settler'): void {
  own.buildQueue = [entry(first, null, why), entry('warrior', null, 'earlier')];
  own.productionStored = 30;
  own.held = why;
}

/** An option of Rome's menu for this unit type, as the sample view lists it, with changes. */
function menuOption(unitType: UnitTypeId, changes: Partial<BuildOption> = {}): BuildOption {
  const found = rome().buildOptions.find((candidate) => candidate.item.unitType === unitType);
  if (found === undefined) throw new Error(`the sample menu has no ${unitType}`);
  return { ...found, ...changes };
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
    expect(foodText(rome({ foodStored: 0, foodToGrow: 10, foodPerTurn: 2 }))).toBe('Food 0/10 (+2 per turn)');
  });

  it('foodText says ": not growing" exactly when the surplus is 0 or less (at +2, +0 and -2), under either way of placing citizens', () => {
    expect(foodText(rome({ foodPerTurn: 2 }))).toBe('Food 4/16 (+2 per turn)');
    expect(foodText(rome({ foodPerTurn: 0 }))).toBe('Food 4/16 (+0 per turn): not growing');
    expect(foodText(rome({ foodPerTurn: -2 }))).toBe('Food 4/16 (-2 per turn): not growing');
    expect(foodText(rome({ foodPerTurn: 1 }))).toBe('Food 4/16 (+1 per turn)');
    expect(foodText(rome({ foodPerTurn: -1 }))).toBe('Food 4/16 (-1 per turn): not growing');
    // The specification's example of a press on "Build first": the line before and after.
    expect(foodText(rome({ foodStored: 6, foodToGrow: 22, foodPerTurn: 2, focus: 'grow' }))).toBe('Food 6/22 (+2 per turn)');
    expect(foodText(rome({ foodStored: 6, foodToGrow: 22, foodPerTurn: -2, focus: 'build' }))).toBe('Food 6/22 (-2 per turn): not growing');
    // It is about the surplus, not about the button: a city on Grow at the limit of its land says it too,
    // and a city on Build that its production tiles happen to feed does not.
    for (const focus of ['grow', 'build'] as const) {
      expect(foodText(rome({ foodPerTurn: 0, focus })), focus).toBe('Food 4/16 (+0 per turn): not growing');
      expect(foodText(rome({ foodPerTurn: 3, focus })), focus).toBe('Food 4/16 (+3 per turn)');
    }
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

    // An empty queue: what is saved, and what is lost, is the note's to say (productionNoteText). The
    // colon makes the two read as one sentence.
    expect(productionText(romeBuilding([], { productionStored: 0 }))).toBe('Nothing to build:');
    expect(productionText(romeBuilding([], { productionStored: 7 }))).toBe('Nothing to build:');

    // A boat is a current build like any other.
    expect(productionText(romeBuilding([entry('fishingBoat', 5)], { productionStored: 6 }))).toBe('Fishing Boat 6/20 (+3 per turn, 5 turns)');
    expect(productionText(romeBuilding([entry('scoutBoat', null, 'noRoom')], { productionStored: 24, held: 'noRoom' }))).toBe('Scout Boat 24/24 (+3 per turn)');
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
    expect(productionNoteText(romeBuilding([], { productionStored: 0 }))).toBe('production is lost.');
  });

  it('an idle city: productionText and productionNoteText read "Nothing to build: production is lost." together, ONE sentence on one line', () => {
    const idle = romeBuilding([], { productionStored: 0 });
    // The panel prints the two parts in one element, with a space between them.
    const printed = `${productionText(idle)} ${productionNoteText(idle)}`;
    expect(printed).toBe('Nothing to build: production is lost.');
    // One sentence: one full stop, at its end. (It was "Nothing to build. This city's production is lost
    // every turn.", two lines on a phone, with the heading of the build list under the panel's edge.)
    expect(printed.match(/\./g)).toHaveLength(1);
    expect(printed.length).toBeLessThanOrEqual(ADD_LINE_MAX);
    expect(printed).not.toMatch(/every turn|This city/);
  });

  it('an idle city with production saved says that it is kept, and that only what is made from now on is lost ("1 production is", "7 production are")', () => {
    expect(productionNoteText(romeBuilding([], { productionStored: 7 }))).toBe('7 production are saved for the next item; what the city makes meanwhile is lost.');
    expect(productionNoteText(romeBuilding([], { productionStored: 1 }))).toBe('1 production is saved for the next item; what the city makes meanwhile is lost.');
    expect(productionNoteText(romeBuilding([]))).toBe('6 production are saved for the next item; what the city makes meanwhile is lost.');
    // The panel prints the two parts in one element, with a space between them.
    const idle = romeBuilding([], { productionStored: 6 });
    expect(`${productionText(idle)} ${productionNoteText(idle)}`).toBe(
      'Nothing to build: 6 production are saved for the next item; what the city makes meanwhile is lost.',
    );
    const one = romeBuilding([], { productionStored: 1 });
    expect(`${productionText(one)} ${productionNoteText(one)}`).toBe(
      'Nothing to build: 1 production is saved for the next item; what the city makes meanwhile is lost.',
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
    for (const [wait, sentence] of Object.entries(sentences)) expect(buildWaitText(wait as BuildWait, 'warrior')).toBe(sentence);
    expect(buildWaitText('tooFar', 'warrior')).toBe('more than 50 turns');

    const before = RULES.forecastTurns;
    try {
      RULES.forecastTurns = 30;
      expect(buildWaitText('tooFar', 'settler')).toBe('more than 30 turns');
    } finally {
      RULES.forecastTurns = before;
    }
  });

  it('buildWaitText: "noRoom" for a boat is "no free water tile for the boat", for a land unit "no free tile for the unit"; no other reason depends on the unit', () => {
    for (const type of UNIT_TYPE_IDS) {
      const boat = UNITS[type].domain === 'sea';
      expect(buildWaitText('noRoom', type), type).toBe(boat ? 'no free water tile for the boat' : 'no free tile for the unit');
      for (const wait of ['needsPopulation', 'noProduction', 'tooFar', 'earlier'] as const) {
        expect(buildWaitText(wait, type), `${type} ${wait}`).toBe(buildWaitText(wait, 'warrior'));
      }
    }
    expect(buildWaitText('noRoom', 'fishingBoat')).toBe('no free water tile for the boat');
    expect(buildWaitText('noRoom', 'scoutBoat')).toBe('no free water tile for the boat');
    expect(buildWaitText('noRoom', 'worker')).toBe('no free tile for the unit');
  });

  it('a boat that is paid for and finds every water tile of its city taken: productionNoteText, queueRowText, buildOptionText and todoHints all say "no free water tile for the boat"', () => {
    // The production line of the panel.
    const waiting = romeBuilding([entry('fishingBoat', null, 'noRoom'), entry('warrior', null, 'earlier')], { productionStored: 20, held: 'noRoom' });
    expect(productionNoteText(waiting)).toBe('Waiting: no free water tile for the boat');
    expect(`${productionText(waiting)} ${productionNoteText(waiting)}`).toBe('Fishing Boat 20/20 (+3 per turn) Waiting: no free water tile for the boat');
    // The reason is about the FIRST entry, the one that waits: a boat further down changes nothing for a Warrior that waits.
    const landFirst = romeBuilding([entry('warrior', null, 'noRoom'), entry('scoutBoat', null, 'earlier')], { productionStored: 18, held: 'noRoom' });
    expect(productionNoteText(landFirst)).toBe('Waiting: no free tile for the unit');

    // The queue's rows: each says it for its own unit.
    expect(queueRowText(entry('fishingBoat', null, 'noRoom'), 0)).toBe('no free water tile for the boat');
    expect(queueRowText(entry('scoutBoat', null, 'noRoom'), 3)).toBe('no free water tile for the boat');
    expect(queueRowText(entry('settler', null, 'noRoom'), 0)).toBe('no free tile for the unit');
    expect(waiting.buildQueue.map(queueRowText)).toEqual(['no free water tile for the boat', 'after the item above']);

    // The add buttons: a passing reason, so the cost stays in the line.
    expect(buildOptionText(menuOption('fishingBoat', { turns: null, wait: 'noRoom', addError: null }))).toBe('costs 20 (no free water tile for the boat)');
    expect(buildOptionText(menuOption('scoutBoat', { turns: null, wait: 'noRoom', addError: null }))).toBe('costs 24 (no free water tile for the boat)');
    expect(buildOptionText(menuOption('worker', { turns: null, wait: 'noRoom' }))).toBe('costs 20 (no free tile for the unit)');

    // The End Turn hint.
    const view = shoreView();
    hold(romeOf(view), 'noRoom', 'fishingBoat');
    expect(todoHints(view)).toEqual(['Rome is waiting: no free water tile for the boat', '2 units can still move']);
    hold(romeOf(view), 'noRoom', 'warrior');
    expect(todoHints(view)).toEqual(['Rome is waiting: no free tile for the unit', '2 units can still move']);
    // Two cities that wait are counted, whatever they wait for.
    addOwnCity(view, 'c1_ostia', 'Ostia', (own) => hold(own, 'noRoom', 'scoutBoat'));
    expect(todoHints(view)).toEqual(['2 cities are waiting to finish a unit', '2 units can still move']);
  });

  it('buildOptionText gives cost ("costs 18"), turns ("ready in 1 turn", "ready in 4 turns") and population, and the reason in brackets where there is no number', () => {
    const options = rome().buildOptions;
    const warrior = menuOption('warrior');
    const settler = menuOption('settler');

    // The sample menu: when each would be done if added now, behind the Warrior and the Scout. Rome owns no
    // water in the sample view, so its two boats give their reason instead of a cost.
    expect(options.map(buildOptionText)).toEqual([
      'costs 18, ready in 12 turns',
      'costs 12, ready in 10 turns',
      'costs 30, ready in 14 turns, uses 1 population',
      'costs 20, ready in 12 turns',
      "needs water inside this city's borders",
      "needs water inside this city's borders",
    ]);
    expect(buildOptionText({ ...warrior, turns: 4 })).toBe('costs 18, ready in 4 turns');
    expect(buildOptionText({ ...warrior, turns: 1 })).toBe('costs 18, ready in 1 turn');
    expect(buildOptionText({ ...settler, turns: 18 })).toBe(`costs 30, ready in 18 turns, uses ${UNITS.settler.populationCost} population`);

    // No number: the reason in brackets, and then NOT "uses 1 population" (the Settler's third line says
    // "Takes one citizen."; with both, the line took two lines and the button grew under the finger)...
    expect(buildOptionText({ ...settler, turns: null, wait: 'needsPopulation' })).toBe('costs 30 (the city must grow first)');
    expect(buildOptionText({ ...settler, turns: null, wait: 'tooFar' })).toBe('costs 30 (more than 50 turns)');
    expect(buildOptionText({ ...settler, turns: null, wait: 'noRoom' })).toBe('costs 30 (no free tile for the unit)');
    expect(buildOptionText({ ...warrior, turns: null, wait: 'tooFar' })).toBe('costs 18 (more than 50 turns)');
    expect(buildOptionText({ ...warrior, turns: null, wait: 'noRoom' })).toBe('costs 18 (no free tile for the unit)');
    expect(buildOptionText({ ...warrior, turns: null, wait: 'noProduction' })).toBe('costs 18 (this city makes no production)');
    // ...except behind a queue that has no end: the rows above already say why.
    expect(buildOptionText({ ...warrior, turns: null, wait: 'earlier' })).toBe('costs 18');
    expect(buildOptionText({ ...settler, turns: null, wait: 'earlier' })).toBe('costs 30, uses 1 population');
    // A full queue changes nothing in this line: the head of the panel says it.
    expect(buildOptionText({ ...warrior, addError: 'queueFull' })).toBe('costs 18, ready in 12 turns');
  });

  it('buildOptionText for a boat: with water its cost and turns like any unit ("costs 20, ready in 9 turns"); in a city without water NEEDS_WATER alone, whatever else the option says', () => {
    // The specification's two buttons of a city that owns water.
    expect(buildOptionText(menuOption('fishingBoat', { turns: 9, wait: null, addError: null }))).toBe('costs 20, ready in 9 turns');
    expect(buildOptionText(menuOption('scoutBoat', { turns: 11, wait: null, addError: null }))).toBe('costs 24, ready in 11 turns');
    expect(shoreView().cities[0].own?.buildOptions.map(buildOptionText).slice(4)).toEqual(['costs 20, ready in 15 turns', 'costs 24, ready in 15 turns']);

    // No water inside the borders: the reason alone, without cost and turns.
    expect(NEEDS_WATER).toBe("needs water inside this city's borders");
    const dry = menuOption('fishingBoat');
    expect(dry).toMatchObject({ turns: null, wait: 'noRoom', addError: 'noWaterForBoat' });
    expect(buildOptionText(dry)).toBe(NEEDS_WATER);
    expect(buildOptionText(menuOption('scoutBoat'))).toBe(NEEDS_WATER);
    for (const wait of [null, 'needsPopulation', 'noRoom', 'noProduction', 'tooFar', 'earlier'] as const) {
      for (const turns of [null, 7]) {
        expect(buildOptionText({ ...dry, wait, turns }), `${wait} ${turns}`).toBe(NEEDS_WATER);
      }
    }
    expect(buildOptionText(dry)).not.toMatch(/costs|turn/);
    // It is not the sentence of the refusal: that one is for a message, this one for the middle line of a button.
    expect(NEEDS_WATER).not.toBe(RULE_ERROR_MESSAGES.noWaterForBoat);
    // A full queue in a city with water is not this reason.
    expect(buildOptionText(menuOption('fishingBoat', { turns: null, wait: 'earlier', addError: 'queueFull' }))).toBe('costs 20');
  });

  it('buildOptionText is ONE line: for every unit type and every wait, with and without a number of turns from 1 to 50, at most ADD_LINE_MAX (46) characters; with a reason in brackets it never says "uses 1 population"; with a number the Settler\'s still does', () => {
    expect(ADD_LINE_MAX).toBe(46);
    const waits: BuildWait[] = ['needsPopulation', 'noRoom', 'noProduction', 'tooFar', 'earlier'];
    const numbers: (number | null)[] = [null, ...Array.from({ length: RULES.forecastTurns }, (_unused, index) => index + 1)];
    expect(numbers).toHaveLength(51);
    let longest = '';
    let answers = 0;
    for (const unitType of UNIT_TYPE_IDS) {
      const base: BuildOption = { item: { kind: 'unit', unitType }, cost: UNITS[unitType].cost, turns: null, wait: null, addError: null };
      for (const wait of [null, ...waits]) {
        for (const turns of numbers) {
          for (const addError of [null, 'queueFull', 'noWaterForBoat'] as const) {
            const text = buildOptionText({ ...base, wait, turns, addError });
            answers += 1;
            const about = `${unitType} wait ${wait} turns ${turns} ${addError}`;
            expect(text.length, `${about}: "${text}"`).toBeLessThanOrEqual(ADD_LINE_MAX);
            expect(text, about).not.toMatch(/[\r\n]/);
            if (text.length > longest.length) longest = text;
            // A reason in brackets never stands beside "uses 1 population".
            if (text.includes('(')) expect(text, about).not.toContain('population');
            // With a number, the units that take a citizen still say so, and every line names the turn.
            if (turns !== null && addError !== 'noWaterForBoat') {
              expect(text, about).toContain(`ready in ${turns} turn`);
              expect(text.includes('uses 1 population'), about).toBe(UNITS[unitType].populationCost > 0);
            }
          }
        }
      }
    }
    expect(answers).toBe(6 * 6 * 51 * 3);
    // The longest answer there is fills the line to the last character: the Settler with a number of two digits.
    expect(longest).toBe('costs 30, ready in 10 turns, uses 1 population');
    expect(longest.length).toBe(ADD_LINE_MAX);
    expect(buildOptionText(menuOption('settler', { turns: 48 }))).toBe('costs 30, ready in 48 turns, uses 1 population');
    // What the Settler said in round 2, which took two lines in the narrow panel.
    expect('costs 30, uses 1 population (the city must grow first)'.length).toBeGreaterThan(ADD_LINE_MAX);
  });

  it('queueNoteText says why the city cannot be changed: no connection, turn ended, queue full', () => {
    expect(queueNoteText(rome(), null)).toBeNull();
    expect(queueNoteText(rome(), 'offline')).toBe('No connection: this city cannot be changed right now.');
    expect(queueNoteText(rome(), 'turnEnded')).toBe('You have ended your turn. Cancel that to change this city.');

    const full = rome();
    full.buildOptions = full.buildOptions.map((candidate) => ({ ...candidate, addError: 'queueFull' as const }));
    expect(queueNoteText(full, null)).toBe('The build queue is full.');
    expect(queueNoteText(full, null)).toBe(RULE_ERROR_MESSAGES.queueFull);
    // The lasting reasons come first: they stop every button, not only the add buttons.
    expect(queueNoteText(full, 'offline')).toBe('No connection: this city cannot be changed right now.');
    expect(queueNoteText(full, 'turnEnded')).toBe('You have ended your turn. Cancel that to change this city.');

    // An empty queue, and a city with nothing in its menu, have nothing to say here.
    expect(queueNoteText(romeBuilding([]), null)).toBeNull();
    expect(queueNoteText(rome({ buildOptions: [] }), null)).toBeNull();
  });

  it('queueNoteText never prints a boat\'s reason: a city without water and with room in its queue has no head line', () => {
    // The sample Rome is such a city: its two boats say noWaterForBoat, its four land units nothing.
    expect(rome().buildOptions.map((candidate) => candidate.addError)).toEqual([null, null, null, null, 'noWaterForBoat', 'noWaterForBoat']);
    expect(queueNoteText(rome(), null)).toBeNull();
    expect(queueNoteText(romeBuilding([]), null)).toBeNull();
    // Not even when the boats come first in the menu, or are all there is in it.
    const boatsFirst = rome();
    boatsFirst.buildOptions = [...boatsFirst.buildOptions].reverse();
    expect(queueNoteText(boatsFirst, null)).toBeNull();
    const boatsOnly = rome();
    boatsOnly.buildOptions = boatsOnly.buildOptions.filter((candidate) => candidate.addError === 'noWaterForBoat');
    expect(boatsOnly.buildOptions).toHaveLength(2);
    expect(queueNoteText(boatsOnly, null)).toBeNull();

    // A FULL queue in a city without water: the server names the full queue for the land units and
    // keeps the boats' lasting reason. The head says the one that is about the queue.
    const fullAndDry = rome();
    fullAndDry.buildOptions = fullAndDry.buildOptions.map((candidate) => (candidate.addError === null ? { ...candidate, addError: 'queueFull' as const } : candidate));
    expect(fullAndDry.buildOptions.map((candidate) => candidate.addError)).toEqual(['queueFull', 'queueFull', 'queueFull', 'queueFull', 'noWaterForBoat', 'noWaterForBoat']);
    expect(queueNoteText(fullAndDry, null)).toBe('The build queue is full.');
    // In no state does the head hold the boats' sentence, in either of its two wordings.
    for (const own of [rome(), boatsFirst, boatsOnly, fullAndDry]) {
      for (const closed of [null, 'offline', 'turnEnded'] as const) {
        const note = queueNoteText(own, closed) ?? '';
        expect(note).not.toContain('water');
        expect(note).not.toBe(RULE_ERROR_MESSAGES.noWaterForBoat);
      }
    }
  });

  it('the two sentences of the head while orders are closed are exactly as long as the ones they replace (53 and 58 characters), so the head takes the lines it took', () => {
    // The sentences of round 2 said "the queue"; the head now also speaks for the greyed Grow / Build buttons.
    expect(queueNoteText(rome(), 'offline')).toHaveLength('No connection: the queue cannot be changed right now.'.length);
    expect(queueNoteText(rome(), 'turnEnded')).toHaveLength('You have ended your turn. Cancel that to change the queue.'.length);
    expect(queueNoteText(rome(), 'offline')).toHaveLength(53);
    expect(queueNoteText(rome(), 'turnEnded')).toHaveLength(58);
  });

  it('the fixed words of the city panel: the label of the Grow / Build pair, the line about the gold tokens, the line about the x', () => {
    expect(FOCUS_GROUP_LABEL).toBe("What this city's citizens put first");
    expect(CITY_TILES_HINT).toBe("Gold tokens on the map mark the tiles this city's citizens gather from.");
    expect(REMOVE_HINT).toBe('× takes an item out. Saved production is kept.');
    // The words on the two buttons are the table's.
    expect(CITY_FOCUS.grow).toMatchObject({ name: 'Grow first', summary: 'growth before production' });
    expect(CITY_FOCUS.build).toMatchObject({ name: 'Build first', summary: 'most production, growth may stop' });
  });

  it('no sentence of the city panel about citizens says "work", "works" or "worked": citizens gather, units work', () => {
    const WORK = /\bwork(s|ed|ing)?\b/i;
    const idle = romeBuilding([], { productionStored: 0 });
    const saved = romeBuilding([]);
    const held = romeBuilding([entry('settler', null, 'needsPopulation')], { productionStored: 30, held: 'needsPopulation' });
    const sentences: string[] = [
      CITY_TILES_HINT,
      FOCUS_GROUP_LABEL,
      REMOVE_HINT,
      NEEDS_WATER,
      populationText(3),
      queueCountText(rome()),
      ...Object.values(CITY_FOCUS).flatMap((focus) => [focus.name, focus.summary, focus.description]),
    ];
    for (const own of [rome(), idle, saved, held, rome({ foodPerTurn: -2, focus: 'build' }), romeOf(shoreView())]) {
      sentences.push(foodText(own), productionText(own), productionNoteText(own) ?? '');
      sentences.push(...own.buildQueue.map(queueRowText), ...own.buildOptions.map(buildOptionText));
      for (const closed of [null, 'offline', 'turnEnded'] as const) sentences.push(queueNoteText(own, closed) ?? '');
    }
    expect(sentences.length).toBeGreaterThan(80);
    for (const sentence of sentences) expect(sentence).not.toMatch(WORK);
    // The old last line of the panel is what the search is for.
    expect('The marked tiles on the map are the ones this city works.').toMatch(WORK);
    // "Work" stays the word for a UNIT's job, and now only for that.
    expect(STOP_LABEL).toMatch(WORK);
    expect(unitHintParts(sampleView(), unitIn(sampleView(), SAMPLE.workerId), true).main).toMatch(WORK);
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

    expect(jobReasonText(option('farm', 'notYourLand'))).toBe('That can only be built inside your own borders.');
    expect(jobReasonText(option('mine', 'cityOnTile'))).toBe('Nothing can be built on the tile of a city.');
    expect(jobReasonText(option('farm', 'unitBusy'))).toBe('This unit is at work. Stop the work first.');
    const others: RuleErrorCode[] = ['notYourLand', 'cityOnTile', 'unitBusy', 'cannotImprove', 'noSuchUnit', 'badAction'];
    for (const code of others) {
      for (const id of IMPROVEMENT_IDS) expect(jobReasonText(option(id, code)), code).toBe(RULE_ERROR_MESSAGES[code]);
    }
  });

  it('jobsReasonText: the one sentence when every option has the same reason; null when the reasons differ, when one option is possible and for an empty list', () => {
    // Outside the borders, and on the tile of a city: one line for the whole block.
    expect(jobsReasonText([option('farm', 'notYourLand'), option('mine', 'notYourLand')])).toBe('That can only be built inside your own borders.');
    expect(jobsReasonText([option('farm', 'cityOnTile'), option('mine', 'cityOnTile')])).toBe('Nothing can be built on the tile of a city.');
    expect(jobsReasonText([option('farm', 'notYourLand')])).toBe('That can only be built inside your own borders.');

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
    expect(improvementBonusText('mine')).toBe('+3 production');
    expect(improvementBonusText('fishingNet')).toBe('+2 food');
    expect(improvementBonusText).toBe(bonusTextOfTileInfo);
  });

  it('the Fishing Boat\'s job: "Build Fishing Net (4 turns)" with "+2 food"; the three reasons over its one button; "Building a Fishing Net: 3 turns left"', () => {
    expect(jobButtonText(option('fishingNet', null))).toBe('Build Fishing Net (4 turns)');
    expect(jobButtonText(option('fishingNet', null, 1))).toBe('Build Fishing Net (1 turn)');

    // Where the boat stands, and the sentence: on ocean inside the borders, on a netted tile, outside the borders.
    expect(jobReasonText(option('fishingNet', 'badImprovementTile'))).toBe('A Fishing Net needs coast.');
    expect(jobReasonText(option('fishingNet', 'alreadyImproved'))).toBe('This tile already has a Fishing Net.');
    expect(jobReasonText(option('fishingNet', 'notYourLand'))).toBe('That can only be built inside your own borders.');
    expect(RULE_ERROR_MESSAGES.notYourLand).toBe('That can only be built inside your own borders.');
    // With one job, "every job impossible for one reason" is every case: the one sentence over the button.
    for (const code of ['badImprovementTile', 'alreadyImproved', 'notYourLand'] as const) {
      expect(jobsReasonText([option('fishingNet', code)]), code).toBe(jobReasonText(option('fishingNet', code)));
    }
    expect(jobsReasonText([option('fishingNet', null)])).toBeNull();

    expect(jobProgressText({ improvement: 'fishingNet', turnsWorked: 3, turnsTotal: 4, turnsLeft: 1 })).toBe('Building a Fishing Net: 1 turn left');
    expect(jobProgressText({ improvement: 'fishingNet', turnsWorked: 1, turnsTotal: 4, turnsLeft: 3 })).toBe('Building a Fishing Net: 3 turns left');

    // Every sentence shape that puts "a" before an improvement's name reads right for every name of the table.
    for (const id of IMPROVEMENT_IDS) {
      const name = IMPROVEMENTS[id].name;
      expect(jobReasonText(option(id, 'alreadyImproved')), id).toBe(`This tile already has a ${name}.`);
      expect(jobProgressText({ improvement: id, turnsWorked: 0, turnsTotal: 4, turnsLeft: 4 }), id).toBe(`Building a ${name}: 4 turns left`);
      expect(name, id).not.toMatch(/^[AEIOU]/); // "a Farm", never "a Orchard"
    }
  });

  it('stopWarningText, the small print beside "Stop work": "Stopping now loses nothing." before a turn is worked; "Stopping loses 1 turn of work." / "3 turns of work."; while asking "1 turn will be lost." / "3 turns will be lost."', () => {
    const job = (turnsWorked: number, improvement: UnitJobView['improvement'] = 'farm'): UnitJobView => ({
      improvement, turnsWorked, turnsTotal: IMPROVEMENTS[improvement].turns, turnsLeft: Math.max(1, IMPROVEMENTS[improvement].turns - turnsWorked),
    });
    expect(stopWarningText(job(0), false)).toBe('Stopping now loses nothing.');
    expect(stopWarningText(job(1), false)).toBe('Stopping loses 1 turn of work.');
    expect(stopWarningText(job(3), false)).toBe('Stopping loses 3 turns of work.');
    expect(stopWarningText(job(1), true)).toBe('1 turn will be lost.');
    expect(stopWarningText(job(3), true)).toBe('3 turns will be lost.');
    // The same words for a boat's net and for a mine: the sentence is about the turns, not about what is built.
    expect(stopWarningText(job(2, 'fishingNet'), false)).toBe('Stopping loses 2 turns of work.');
    expect(stopWarningText(job(4, 'mine'), true)).toBe('4 turns will be lost.');
    // A job with nothing worked is never asked about; were it, the line would still say what is true.
    expect(stopWarningText(job(0), true)).toBe('Stopping now loses nothing.');

    // The two wordings of the button. The asking one is short on purpose (the row must keep its height).
    expect(STOP_LABEL).toBe('Stop work');
    expect(STOP_ASK).toBe('Tap again to stop');
    // The small print of the asking state is the short one: beside the wide button the long one took three lines.
    for (const turns of [1, 2, 3, 4]) {
      expect(stopWarningText(job(turns), true).length).toBeLessThan(stopWarningText(job(turns), false).length);
      expect(stopWarningText(job(turns), true).length).toBeLessThanOrEqual('3 turns will be lost.'.length);
    }
  });

  it('the sentences of a selected boat: its moves, its tile and its hint are the Worker\'s words', () => {
    const view = shoreView((changed) => {
      addOwnUnit(changed, 'u1_f1sher', 'fishingBoat', SHORE.middle);
      const scout = addOwnUnit(changed, 'u1_sc0ut1', 'scoutBoat', SHORE.north);
      if (scout.own !== null) scout.own.movesLeft = 0;
    });
    expect(movesText(unitIn(view, 'u1_f1sher'))).toBe('Moves 2/2');
    expect(movesText(unitIn(view, 'u1_sc0ut1'))).toBe('Moves 0/4');
    expect(unitHintParts(view, unitIn(view, 'u1_f1sher'), true).main).toBe('Choose a highlighted tile to move there.');
    expect(unitHintParts(view, unitIn(view, 'u1_sc0ut1'), true).main).toBe('No moves left this turn.');
    putToWork(unitIn(view, 'u1_f1sher'), 1);
    expect(unitHintParts(view, unitIn(view, 'u1_f1sher'), true).main).toBe('At work here. Stop the work to move this unit.');
    // A boat is a unit that can still move: the End Turn hint counts it, and passes it by while it is at work.
    const before = todoHints(sampleView());
    expect(before).toEqual(['2 units can still move']);
    expect(todoHints(view)).toEqual(['2 units can still move']); // the Scout Boat has no moves left, the Fishing Boat is at work
    ownOf(view, 'u1_f1sher').job = null;
    expect(todoHints(view)).toEqual(['3 units can still move']);
    // The names and one-liners of the table, as the panel and the add list print them.
    expect([UNITS.fishingBoat.name, UNITS.fishingBoat.description]).toEqual(['Fishing Boat', 'Builds fishing nets inside the borders.']);
    expect([UNITS.scoutBoat.name, UNITS.scoutBoat.description]).toEqual(['Scout Boat', 'A fast boat that explores the sea.']);
    expect([IMPROVEMENTS.fishingNet.name, IMPROVEMENTS.fishingNet.description, IMPROVEMENTS.fishingNet.needs]).toEqual(['Fishing Net', 'Nets along the coast for more food.', 'coast']);
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

describe('sentences of the shared tables that the page prints as they are (round 3)', () => {
  it('the three sentences of a refusal that round 3 changed or added', () => {
    // A unit sent where it cannot go: the sentence no longer says "Land units", since boats came.
    expect(RULE_ERROR_MESSAGES.impassable).toBe('This unit cannot go there.');
    // Over the job buttons of a Worker or a Fishing Boat outside the borders ("on your own land" read oddly on water).
    expect(RULE_ERROR_MESSAGES.notYourLand).toBe('That can only be built inside your own borders.');
    // The answer to a boat queued for a city without water. The page never asks for one (the button is grey); the
    // sentence is a message's, and it is NOT what stands in the grey button or in the panel's head.
    expect(RULE_ERROR_MESSAGES.noWaterForBoat).toBe('This city has no water inside its borders, so it cannot build boats.');
    expect(RULE_ERROR_MESSAGES.queueFull).toBe('The build queue is full.');
  });

  it('the two ways of placing citizens: the words on the buttons, the small line in each, and the tooltip', () => {
    expect(CITY_FOCUS.grow).toEqual({
      name: 'Grow first',
      summary: 'growth before production',
      description: 'Citizens take the best tiles, and food before production whenever the city would stop growing.',
    });
    expect(CITY_FOCUS.build).toEqual({
      name: 'Build first',
      summary: 'most production, growth may stop',
      description: 'Citizens take the tiles with the most production. The city grows slowly or not at all; it never shrinks.',
    });
    // Each name says "first": neither reads as an order to the build queue ("Build" alone did, over "Nothing to build").
    for (const focus of Object.values(CITY_FOCUS)) expect(focus.name).toMatch(/ first$/);
  });
});
