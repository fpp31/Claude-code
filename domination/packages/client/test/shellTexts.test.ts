import { describe, expect, it } from 'vitest';
import { MAP_SIZES, MAP_SIZE_IDS, UNITS } from '@domination/shared';
import type { OwnCityDetail, PlayerView } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import {
  buildOptionText,
  codeHintText,
  countOf,
  firstStepsText,
  foodText,
  ghostSeatWarning,
  homeIntroText,
  mapSizeNote,
  mapSizeText,
  movesText,
  nameList,
  populationText,
  productionBlockedText,
  productionText,
  progressFraction,
  signed,
  tabTitleText,
  todoHints,
  unitHintText,
  waitingForText,
} from '../src/ui/texts';
import { SAMPLE } from './shellKit';

/**
 * The sentences the panels print (ui/texts.ts). The doc comments of the
 * panels pin several of these formats down ("Moves 1/2", "Food 4/16 (+2 per
 * turn)", "Warrior 6/18 (+3 per turn, 4 turns)"), and the end-to-end test
 * reads some of them from the page, so they are checked word for word here.
 * Change the wording in texts.ts and in these expectations together.
 */

/** Rome's details from the sample view: food 4/16 (+2), a Warrior at 6/18 (+3, 4 turns). */
function rome(changes: Partial<OwnCityDetail> = {}): OwnCityDetail {
  const own = sampleView().cities.find((city) => city.id === SAMPLE.romeId)?.own;
  if (own == null) throw new Error('the sample view has no Rome');
  return { ...own, ...changes };
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
    expect(foodText(rome())).toBe('Food 4/16 (+2 per turn)');
    expect(foodText(rome({ foodPerTurn: 0 }))).toBe('Food 4/16 (+0 per turn)');
    expect(foodText(rome({ foodPerTurn: -1 }))).toBe('Food 4/16 (-1 per turn)');
  });

  it('productionText names the item, the progress, the rate and the turns left', () => {
    expect(productionText(rome())).toBe('Warrior 6/18 (+3 per turn, 4 turns)');
    expect(productionText(rome({ turnsLeft: 1 }))).toBe('Warrior 6/18 (+3 per turn, 1 turn)');
  });

  it('productionText says "Nothing chosen" when nothing is', () => {
    expect(productionText(rome({ production: null, productionCost: null, turnsLeft: null }))).toBe('Nothing chosen');
    expect(productionBlockedText(rome({ production: null, productionCost: null, turnsLeft: null }))).toBeNull();
  });

  it('productionText leaves the turns out when the city makes no production', () => {
    expect(productionText(rome({ productionPerTurn: 0, turnsLeft: null }))).toBe('Warrior 6/18 (+0 per turn)');
  });

  it('a blocked item is explained, and the turns are left out because they would mislead', () => {
    const settler = { kind: 'unit', unitType: 'settler' } as const;
    const waitingForPeople = rome({
      production: settler, productionStored: 30, productionCost: 30, turnsLeft: 0, productionBlocked: 'needsPopulation',
    });
    expect(productionText(waitingForPeople)).toBe('Settler 30/30 (+3 per turn)');
    // "needs 2 population": the city must keep one citizen after the Settler has taken one.
    expect(productionBlockedText(waitingForPeople)).toBe(`Waiting: the city needs ${1 + UNITS.settler.populationCost} population`);

    const noRoom = rome({ productionStored: 18, turnsLeft: 0, productionBlocked: 'noRoom' });
    expect(productionBlockedText(noRoom)).toBe('Waiting: no free tile for the unit');

    expect(productionBlockedText(rome())).toBeNull();
  });

  it('buildOptionText gives cost and turns, and notes a unit that takes a citizen', () => {
    const options = rome().buildOptions;
    const warrior = options.find((option) => option.item.unitType === 'warrior');
    const settler = options.find((option) => option.item.unitType === 'settler');
    if (warrior === undefined || settler === undefined) throw new Error('unexpected sample view');

    expect(buildOptionText(warrior)).toBe('18 production, 4 turns');
    expect(buildOptionText({ ...warrior, turns: 1 })).toBe('18 production, 1 turn');
    expect(buildOptionText({ ...warrior, turns: null })).toBe('18 production');
    expect(buildOptionText(settler)).toBe(`30 production, 8 turns, uses ${UNITS.settler.populationCost} population`);
  });
});

describe('End Turn and top bar texts (WP4)', () => {
  it('todoHints says what still needs the player, and nothing when nothing does', () => {
    const view = sampleView();
    expect(todoHints(view)).toEqual(['2 units can still move']);

    const settler = view.units.find((unit) => unit.id === SAMPLE.settlerId);
    const city = view.cities.find((candidate) => candidate.id === SAMPLE.romeId);
    if (settler?.own == null || city?.own == null) throw new Error('unexpected sample view');
    settler.own.movesLeft = 0;
    city.own.production = null;
    expect(todoHints(view)).toEqual(['1 unit can still move', '1 city has nothing to build']);

    for (const unit of view.units) if (unit.own !== null) unit.own.movesLeft = 0;
    city.own.production = { kind: 'unit', unitType: 'scout' };
    expect(todoHints(view)).toEqual([]);
  });

  it('todoHints counts cities in the plural too', () => {
    const view = sampleView();
    for (const unit of view.units) if (unit.own !== null) unit.own.movesLeft = 0;
    const city = view.cities.find((candidate) => candidate.id === SAMPLE.romeId);
    if (city?.own == null) throw new Error('unexpected sample view');
    city.own.production = null;
    view.cities.push({ ...city, id: 'c1_second', name: 'Ostia', tile: 5, own: { ...city.own } });
    expect(todoHints(view)).toEqual(['2 cities have nothing to build']);
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

describe('home screen texts', () => {
  const welcome = 'A strategy game to play with friends. Create a game and send them the link, or join theirs.';

  it('somebody who opened an invite link is told so, once the server has answered', () => {
    expect(homeIntroText('K7QXM', false, null)).toBe('You are invited to game K7QXM. Type your name and press Join.');
    expect(homeIntroText('K7QXM', true, null)).toBe(welcome); // still asking: no promise yet
    expect(homeIntroText(null, false, null)).toBe(welcome);
  });

  it('nobody is "invited" to a game that cannot be joined', () => {
    for (const problem of ['noSuchGame', 'gameAlreadyStarted', 'gameFull'] as const) {
      const text = homeIntroText('K7QXM', false, problem);
      expect(text).toBe(welcome);
      expect(text).not.toContain('invited');
    }
  });

  it('the line under the code field says why a game cannot be joined, each reason in its own words', () => {
    const usual = codeHintText(false, null);
    expect(usual).toBe('Your friend sees the code and a link when they create a game.');

    expect(codeHintText(false, 'noSuchGame')).toContain('no game with this code');
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

  it('ghostSeatWarning lists every absent player and asks before starting', () => {
    expect(ghostSeatWarning(['Ben'])).toBe('Ben is not connected. The game waits for every player each turn. Start anyway?');
    expect(ghostSeatWarning(['Ben', 'Cleo'])).toBe(
      'Ben and Cleo are not connected. The game waits for every player each turn. Start anyway?',
    );
  });
});
