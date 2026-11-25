import { describe, expect, it } from 'vitest';
import { CITY_FOCUS, IMPROVEMENTS, IMPROVEMENT_IDS, UNITS, cloneJson, improvementBuilder } from '@domination/shared';
import type { PlayerView } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import { describeTile, improvementBonusText, unitTileText } from '../src/game/tileInfo';
import type { TileInfo, TileInfoLine, TileInfoLineKind } from '../src/game/tileInfo';
import { SAMPLE, SHORE, addOwnUnit, at, cityIn, ownOf, putToWork, romeOf, seenTile, shoreView, unitIn } from './shellKit';

/**
 * What the hover box, the tile card and the unit panel's "Tile:" line say
 * about a tile (game/tileInfo.ts), on the sample view: Ada plays Rome and
 * sees Ben's Egypt. The example table of the round 2 spec (section 2A) is
 * pinned here word for word, with the words of round 3: citizens GATHER a
 * tile's yields (units work and build), the line about what can be built
 * names the builder, and the cost to enter names whom it is about. Change
 * the wording in tileInfo.ts and in these expectations together.
 */

/** Tiles of the sample map that the cases below look at (x, y; the map is 14 wide). */
const TILES = {
  /** Never seen. */
  unseen: at(0, 0),
  /** Hills in sight, nobody's. */
  freeHills: at(6, 3),
  /** Own grassland, worked by a citizen of Rome. */
  ownWorked: at(4, 4),
  /** Own grassland nobody works. */
  ownUnworked: at(2, 6),
  /** Own forest. */
  ownForest: at(2, 4),
  /** Mountains in sight, nobody's. */
  mountains: at(6, 5),
  /** Mountains on Egypt's land, out of sight. */
  rememberedMountains: at(11, 3),
  /** Coast in sight. */
  coast: at(1, 1),
  /** Ocean in sight. */
  ocean: at(6, 9),
  /** Plains on Egypt's land, in sight. */
  foreignLand: at(9, 3),
  /** Plains on Egypt's land, out of sight. */
  rememberedLand: at(11, 2),
} as const;

/** The texts of a description's lines, top to bottom. */
function texts(info: TileInfo): string[] {
  return info.lines.map((line) => line.text);
}

/** The kinds of a description's lines, top to bottom. */
function kinds(info: TileInfo): TileInfoLineKind[] {
  return info.lines.map((line) => line.kind);
}

/** The lines of one kind. */
function linesOf(info: TileInfo, kind: TileInfoLineKind): TileInfoLine[] {
  return info.lines.filter((line) => line.kind === kind);
}

/** The one line of a kind; throws if there is none or more than one. */
function lineOf(info: TileInfo, kind: TileInfoLineKind): TileInfoLine {
  const found = linesOf(info, kind);
  if (found.length !== 1) throw new Error(`expected one "${kind}" line, found ${found.length}`);
  return found[0];
}

/** The sample view with a change applied. */
function viewWith(change: (view: PlayerView) => void): PlayerView {
  const view = sampleView();
  change(view);
  return view;
}

/** Freezes a value and everything in it, so that an edit throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** The order of A-D11, with the line of round 3 about an own city on Build right after what it builds. */
const KIND_ORDER: TileInfoLineKind[] = ['remembered', 'city', 'building', 'focus', 'unit', 'improvement', 'yields', 'worked', 'canBuild', 'movement', 'owner'];

describe('describeTile: the land', () => {
  it('a never-seen tile is "Unexplored" and has no lines', () => {
    const view = sampleView();
    expect(view.tiles[TILES.unseen]).toBeNull();
    expect(describeTile(view, TILES.unseen)).toEqual({ tile: TILES.unseen, knowledge: 'unexplored', title: 'Unexplored', lines: [] });

    // Whatever else the view may hold for that number: a unit and a city listed there are not told.
    const haunted = viewWith((changed) => {
      unitIn(changed, SAMPLE.foreignWarriorId).tile = TILES.unseen;
      cityIn(changed, SAMPLE.thebesId).tile = TILES.unseen;
    });
    expect(describeTile(haunted, TILES.unseen)).toEqual({ tile: TILES.unseen, knowledge: 'unexplored', title: 'Unexplored', lines: [] });
  });

  it('a tile number that is off the map (negative, too large, not whole) is "Unexplored" and does not throw', () => {
    const view = sampleView();
    for (const tile of [-1, view.tiles.length, view.tiles.length + 500, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(describeTile(view, tile), String(tile)).toEqual({ tile, knowledge: 'unexplored', title: 'Unexplored', lines: [] });
    }
    // A view whose list of tiles has a hole in it is read the same way.
    const holed = sampleView();
    holed.tiles.length = TILES.ownWorked;
    expect(describeTile(holed, TILES.ownWorked).title).toBe('Unexplored');
  });

  it('plain land in sight that is nobody\'s: the title, then yields, cost and owner, in that order and nothing else', () => {
    const info = describeTile(sampleView(), TILES.freeHills);
    expect(info).toEqual({
      tile: TILES.freeHills,
      knowledge: 'visible',
      title: 'Hills on Grassland',
      lines: [
        { kind: 'yields', text: 'Yields 0 food, 2 production', civ: null },
        { kind: 'movement', text: 'Land units: costs 2 moves to enter', civ: null },
        { kind: 'owner', text: 'Belongs to nobody', civ: null },
      ],
    });
  });

  it('a feature is named with its ground ("Forest on Grassland") and its numbers replace the ground\'s', () => {
    const info = describeTile(sampleView(), TILES.ownForest);
    expect(info.title).toBe('Forest on Grassland');
    // Grassland alone gives 2 food and 1 production and costs 1 move; the forest's numbers stand in for them.
    expect(lineOf(info, 'yields').text).toBe('Yields 1 food, 1 production');
    expect(lineOf(info, 'movement').text).toBe('Land units: costs 2 moves to enter');

    expect(describeTile(sampleView(), SAMPLE.rememberedMineTile).title).toBe('Hills on Desert');
    expect(describeTile(sampleView(), SAMPLE.emptyTile).title).toBe('Grassland');
  });

  it('mountains: "Yields nothing: citizens cannot gather here" and "No unit can enter"', () => {
    const info = describeTile(sampleView(), TILES.mountains);
    expect(info.title).toBe('Mountains on Grassland');
    expect(texts(info)).toEqual(['Yields nothing: citizens cannot gather here', 'No unit can enter', 'Belongs to nobody']);

    // The spec's example: the same on a tile out of sight, on Egypt's land.
    const remembered = describeTile(sampleView(), TILES.rememberedMountains);
    expect(remembered.knowledge).toBe('remembered');
    expect(texts(remembered)).toEqual([
      'Out of sight: shown as you last saw it. Units are not shown.',
      'Yields nothing: citizens cannot gather here',
      'No unit can enter',
      'Belongs to Ben (Egypt)',
    ]);
  });

  it('water yields food and is for boats only', () => {
    const coast = describeTile(sampleView(), TILES.coast);
    expect(coast.title).toBe('Coast');
    expect(texts(coast)).toEqual(['Yields 2 food, 0 production', 'Boats only: costs 1 move to enter', 'Belongs to nobody']);

    const ocean = describeTile(sampleView(), TILES.ocean);
    expect(ocean.title).toBe('Ocean');
    expect(texts(ocean)).toEqual(['Yields 1 food, 0 production', 'Boats only: costs 1 move to enter', 'Belongs to nobody']);
  });

  it('"1 move" and "2 moves": the singular and the plural', () => {
    expect(lineOf(describeTile(sampleView(), SAMPLE.emptyTile), 'movement').text).toBe('Land units: costs 1 move to enter');
    expect(lineOf(describeTile(sampleView(), TILES.freeHills), 'movement').text).toBe('Land units: costs 2 moves to enter');
  });

  it('what it costs to enter names whom it is about: coast and ocean say "Boats only: costs 1 move to enter", mountains "No unit can enter", land "Land units: costs N moves to enter"; a foreign boat blocks', () => {
    const view = sampleView();
    const movement = (candidate: PlayerView, tile: number): string => lineOf(describeTile(candidate, tile), 'movement').text;

    // Water: the answer to a land unit that was sent onto the sea is in the line itself.
    for (const tile of [TILES.coast, TILES.ocean, SHORE.north, SHORE.middle, SHORE.south, SHORE.free]) {
      expect(movement(view, tile), String(tile)).toBe('Boats only: costs 1 move to enter');
    }
    // Mountains, on any ground, in sight or remembered, whoever owns them.
    for (const tile of [TILES.mountains, TILES.rememberedMountains]) expect(movement(view, tile), String(tile)).toBe('No unit can enter');
    // Land: open ground 1, forest and hills 2. Without "only": every player has land units from the first turn.
    expect(movement(view, SAMPLE.emptyTile)).toBe('Land units: costs 1 move to enter');
    expect(movement(view, TILES.ownForest)).toBe('Land units: costs 2 moves to enter');
    expect(movement(view, TILES.freeHills)).toBe('Land units: costs 2 moves to enter');
    expect(movement(view, TILES.foreignLand)).toBe('Land units: costs 1 move to enter');

    // Every explored tile of the sample view says exactly one of the four sentences.
    const said = new Set<string>();
    for (let tile = 0; tile < view.tiles.length; tile++) {
      if (view.tiles[tile] !== null) said.add(movement(view, tile));
    }
    expect([...said].sort()).toEqual([
      'Blocked: another player\'s unit or city is here',
      'Boats only: costs 1 move to enter',
      'Land units: costs 1 move to enter',
      'Land units: costs 2 moves to enter',
      'No unit can enter',
    ]);

    // Another player's boat blocks its water tile, as a foreign Warrior blocks land.
    const foreignBoat = viewWith((changed) => {
      changed.units.push({ id: 'u2_b0at01', type: 'fishingBoat', owner: SAMPLE.other, tile: SHORE.free, own: null });
    });
    expect(movement(foreignBoat, SHORE.free)).toBe('Blocked: another player\'s unit or city is here');
    // The viewer's own boat does not: the line is about who may enter, and the viewer's other boat class may.
    const ownBoat = viewWith((changed) => {
      addOwnUnit(changed, 'u1_b0at01', 'scoutBoat', SHORE.free);
    });
    expect(movement(ownBoat, SHORE.free)).toBe('Boats only: costs 1 move to enter');
    // "No unit can enter" comes before "Blocked": a unit the view lists on mountains (the server never does) changes nothing.
    const onPeak = viewWith((changed) => {
      unitIn(changed, SAMPLE.foreignWarriorId).tile = TILES.mountains;
    });
    expect(movement(onPeak, TILES.mountains)).toBe('No unit can enter');
  });

  it('own land says "Belongs to you" with the viewer\'s colours; foreign land names the player and the civilization; nobody\'s land has no colour square', () => {
    const view = sampleView();
    expect(lineOf(describeTile(view, TILES.ownWorked), 'owner')).toEqual({ kind: 'owner', text: 'Belongs to you', civ: 'rome' });
    expect(lineOf(describeTile(view, TILES.foreignLand), 'owner')).toEqual({ kind: 'owner', text: 'Belongs to Ben (Egypt)', civ: 'egypt' });
    expect(lineOf(describeTile(view, TILES.rememberedLand), 'owner')).toEqual({ kind: 'owner', text: 'Belongs to Ben (Egypt)', civ: 'egypt' });
    expect(lineOf(describeTile(view, TILES.freeHills), 'owner')).toEqual({ kind: 'owner', text: 'Belongs to nobody', civ: null });
  });

  it('own land says who gathers its yields: "A citizen of Rome gathers these yields" on a tile a citizen is placed on, "No citizen gathers these yields" on another; foreign land, nobody\'s land, a city\'s own tile and mountains have no such line', () => {
    const view = sampleView();
    expect(romeOf(view).worked).toContain(TILES.ownWorked);
    expect(texts(describeTile(view, TILES.ownWorked))).toEqual([
      'Yields 2 food, 1 production',
      'A citizen of Rome gathers these yields',
      'A Worker can build a Farm here',
      'Land units: costs 1 move to enter',
      'Belongs to you',
    ]);
    expect(texts(describeTile(view, TILES.ownUnworked))).toEqual([
      'Yields 2 food, 1 production',
      'No citizen gathers these yields',
      'A Worker can build a Farm here',
      'Land units: costs 1 move to enter',
      'Belongs to you',
    ]);
    expect(lineOf(describeTile(view, TILES.ownWorked), 'worked').civ).toBeNull();

    expect(linesOf(describeTile(view, TILES.foreignLand), 'worked')).toEqual([]);
    expect(linesOf(describeTile(view, TILES.freeHills), 'worked')).toEqual([]);
    expect(linesOf(describeTile(view, SAMPLE.romeTile), 'worked')).toEqual([]);

    // Mountains on the viewer's own land: nothing to gather, and the yields line says so for the citizens.
    const ownPeak = viewWith((changed) => {
      seenTile(changed, TILES.ownUnworked).feature = 'mountains';
    });
    expect(texts(describeTile(ownPeak, TILES.ownUnworked))).toEqual(['Yields nothing: citizens cannot gather here', 'No unit can enter', 'Belongs to you']);

    // A tile a foreign city claims to gather from is none of the viewer's business:
    // only the viewer's own cities are asked, the first of them that lists the tile.
    const two = viewWith((changed) => {
      const rome = cityIn(changed, SAMPLE.romeId);
      changed.cities.push({ ...cloneJson(rome), id: 'c1_second', name: 'Ostia', tile: at(1, 3) });
      changed.cities.push({ ...cloneJson(rome), id: 'c2_liar', name: 'Memphis', owner: SAMPLE.other, tile: at(8, 7) });
      changed.cities.reverse(); // Memphis, Ostia, Rome, Thebes
    });
    expect(lineOf(describeTile(two, TILES.ownWorked), 'worked').text).toBe('A citizen of Ostia gathers these yields');
  });

  it('own land says what can be built, and by which unit: "A Worker can build a Farm here" on open grassland, "A Worker can build a Mine here" on hills, nothing on forest, on a city\'s tile, on a tile that has the improvement, and on the tile where the viewer\'s own Worker is building it; foreign land never has the line', () => {
    const view = sampleView();
    expect(linesOf(describeTile(view, TILES.ownUnworked), 'canBuild')).toEqual([{ kind: 'canBuild', text: 'A Worker can build a Farm here', civ: null }]);

    const ownHills = viewWith((changed) => {
      seenTile(changed, TILES.ownUnworked).feature = 'hills';
    });
    expect(linesOf(describeTile(ownHills, TILES.ownUnworked), 'canBuild').map((line) => line.text)).toEqual(['A Worker can build a Mine here']);

    expect(linesOf(describeTile(view, TILES.ownForest), 'canBuild')).toEqual([]);
    expect(linesOf(describeTile(view, SAMPLE.romeTile), 'canBuild')).toEqual([]);
    expect(linesOf(describeTile(view, SAMPLE.farmTile), 'canBuild')).toEqual([]);
    // The Worker stands on plains, which would take a farm: it is building that very farm.
    expect(ownOf(view, SAMPLE.workerId).job?.improvement).toBe('farm');
    expect(linesOf(describeTile(view, SAMPLE.workerTile), 'canBuild')).toEqual([]);

    // The same tile once the Worker has stopped, or walked on: the offer is back.
    const stopped = viewWith((changed) => {
      ownOf(changed, SAMPLE.workerId).job = null;
    });
    expect(linesOf(describeTile(stopped, SAMPLE.workerTile), 'canBuild').map((line) => line.text)).toEqual(['A Worker can build a Farm here']);

    // Open land of another player, in sight and remembered, and nobody's open land: never.
    for (const tile of [TILES.foreignLand, TILES.rememberedLand, SAMPLE.warriorTile]) {
      expect(seenTile(view, tile).feature, String(tile)).toBeNull();
      expect(linesOf(describeTile(view, tile), 'canBuild'), String(tile)).toEqual([]);
    }
  });
});

describe('describeTile: cities and units', () => {
  it('an own city: its line, "Building: Warrior, 4 turns" (with one turn "1 turn"; without a number only the name; with an empty queue "Builds nothing"), and the centre\'s yields with the minimum applied', () => {
    const info = describeTile(sampleView(), SAMPLE.romeTile);
    expect(info.title).toBe('Grassland');
    expect(info.lines).toEqual([
      { kind: 'city', text: 'Rome, population 2: your city', civ: 'rome' },
      { kind: 'building', text: 'Building: Warrior, 4 turns', civ: null },
      { kind: 'yields', text: 'City centre: 2 food, 1 production', civ: null },
      { kind: 'movement', text: 'Land units: costs 1 move to enter', civ: null },
      { kind: 'owner', text: 'Belongs to you', civ: 'rome' },
    ]);

    const soon = viewWith((view) => {
      romeOf(view).buildQueue[0].turns = 1;
    });
    expect(lineOf(describeTile(soon, SAMPLE.romeTile), 'building').text).toBe('Building: Warrior, 1 turn');

    const held = viewWith((view) => {
      const first = romeOf(view).buildQueue[0];
      first.item = { kind: 'unit', unitType: 'settler' };
      first.turns = null;
      first.wait = 'needsPopulation';
    });
    expect(lineOf(describeTile(held, SAMPLE.romeTile), 'building').text).toBe('Building: Settler');

    const idle = viewWith((view) => {
      romeOf(view).buildQueue = [];
    });
    expect(lineOf(describeTile(idle, SAMPLE.romeTile), 'building').text).toBe('Builds nothing');

    // A city on desert hills: the hills give 0 food and 2 production, the centre's minimum lifts the food to 2.
    const onHills = viewWith((view) => {
      const ground = seenTile(view, SAMPLE.romeTile);
      ground.terrain = 'desert';
      ground.feature = 'hills';
    });
    const hillCity = describeTile(onHills, SAMPLE.romeTile);
    expect(hillCity.title).toBe('Hills on Desert');
    expect(lineOf(hillCity, 'yields').text).toBe('City centre: 2 food, 2 production');
    expect(lineOf(hillCity, 'movement').text).toBe('Land units: costs 2 moves to enter');
  });

  it('a foreign city in sight: name, population and owner, "Blocked", and no "Building" line', () => {
    const inSight = viewWith((view) => {
      seenTile(view, SAMPLE.thebesTile).visible = true;
      cityIn(view, SAMPLE.thebesId).visible = true;
    });
    const info = describeTile(inSight, SAMPLE.thebesTile);
    expect(info.knowledge).toBe('visible');
    expect(info.lines).toEqual([
      { kind: 'city', text: 'Thebes, population 1: a city of Ben (Egypt)', civ: 'egypt' },
      { kind: 'yields', text: 'City centre: 2 food, 1 production', civ: null },
      { kind: 'movement', text: 'Blocked: another player\'s unit or city is here', civ: null },
      { kind: 'owner', text: 'Belongs to Ben (Egypt)', civ: 'egypt' },
    ]);
  });

  it('the remembered city (Thebes): the "Out of sight" line comes first; the rest is what the view remembers', () => {
    const info = describeTile(sampleView(), SAMPLE.thebesTile);
    expect(info.knowledge).toBe('remembered');
    expect(info.title).toBe('Grassland');
    expect(info.lines).toEqual([
      { kind: 'remembered', text: 'Out of sight: shown as you last saw it. Units are not shown.', civ: null },
      { kind: 'city', text: 'Thebes, population 1: a city of Ben (Egypt)', civ: 'egypt' },
      { kind: 'yields', text: 'City centre: 2 food, 1 production', civ: null },
      { kind: 'movement', text: 'Blocked: another player\'s unit or city is here', civ: null },
      { kind: 'owner', text: 'Belongs to Ben (Egypt)', civ: 'egypt' },
    ]);
  });

  it('a tile out of sight never lists a unit, even if the view is given one there', () => {
    // A view the server never makes: a foreign unit and an own one on a tile that is only remembered.
    const broken = viewWith((view) => {
      unitIn(view, SAMPLE.foreignWarriorId).tile = TILES.rememberedLand;
      unitIn(view, SAMPLE.settlerId).tile = TILES.rememberedLand;
    });
    const info = describeTile(broken, TILES.rememberedLand);
    expect(info.knowledge).toBe('remembered');
    expect(linesOf(info, 'unit')).toEqual([]);
    // Nor does the unit show through the back door of the cost line.
    expect(texts(info)).toEqual([
      'Out of sight: shown as you last saw it. Units are not shown.',
      'Yields 1 food, 2 production',
      'Land units: costs 1 move to enter',
      'Belongs to Ben (Egypt)',
    ]);
    expect(JSON.stringify(info)).not.toContain('Warrior');
  });

  it('an own unit: "Your Warrior, 2 of 2 moves left"; two own units on one tile: the soldier first', () => {
    const view = sampleView();
    expect(describeTile(view, SAMPLE.warriorTile).lines).toEqual([
      { kind: 'unit', text: 'Your Warrior, 2 of 2 moves left', civ: 'rome' },
      { kind: 'yields', text: 'Yields 2 food, 1 production', civ: null },
      { kind: 'movement', text: 'Land units: costs 1 move to enter', civ: null },
      { kind: 'owner', text: 'Belongs to nobody', civ: null },
    ]);

    const moved = viewWith((changed) => {
      ownOf(changed, SAMPLE.warriorId).movesLeft = 1;
    });
    expect(lineOf(describeTile(moved, SAMPLE.warriorTile), 'unit').text).toBe('Your Warrior, 1 of 2 moves left');

    // The Settler joins the Warrior, and the view lists the Settler first: the soldier is still named first.
    const stacked = viewWith((changed) => {
      unitIn(changed, SAMPLE.settlerId).tile = SAMPLE.warriorTile;
      changed.units.reverse();
    });
    expect(linesOf(describeTile(stacked, SAMPLE.warriorTile), 'unit').map((line) => line.text)).toEqual([
      'Your Warrior, 2 of 2 moves left',
      'Your Settler, 2 of 2 moves left',
    ]);

    // Within a class the order is by id, in plain character order ("Z" before "a"), whatever order the view lists them in.
    const sameClass = viewWith((changed) => {
      const warrior = unitIn(changed, SAMPLE.warriorId);
      changed.units.push({ ...cloneJson(warrior), id: 'u1_Zzzzzz', own: { movesLeft: 0, foundCityError: 'cannotFoundCity', job: null, jobOptions: [] } });
    });
    expect(linesOf(describeTile(sameClass, SAMPLE.warriorTile), 'unit').map((line) => line.text)).toEqual([
      'Your Warrior, 0 of 2 moves left',
      'Your Warrior, 2 of 2 moves left',
    ]);
  });

  it('a foreign unit: type, owner and the type\'s description ("Warrior of Ben (Egypt). A soldier who guards and blocks the way."); the line contains no digit; a foreign Worker reads the same whatever it is doing', () => {
    const view = sampleView();
    expect(describeTile(view, SAMPLE.foreignWarriorTile).lines).toEqual([
      { kind: 'unit', text: 'Warrior of Ben (Egypt). A soldier who guards and blocks the way.', civ: 'egypt' },
      { kind: 'yields', text: 'Yields 2 food, 1 production', civ: null },
      { kind: 'movement', text: 'Blocked: another player\'s unit or city is here', civ: null },
      { kind: 'owner', text: 'Belongs to nobody', civ: null },
    ]);
    expect(lineOf(describeTile(view, SAMPLE.foreignWarriorTile), 'unit').text).not.toMatch(/\d/);

    // A foreign Worker, as the server sends it: public fields only. On open
    // land where it could be farming, and on a city's doorstep where it could
    // not, the line is the same sentence and nothing else is said about it.
    const expected = 'Worker of Ben (Egypt). Builds farms and mines inside the borders.';
    for (const tile of [TILES.foreignLand, at(10, 4), SAMPLE.foreignWarriorTile]) {
      const withWorker = viewWith((changed) => {
        changed.units = changed.units.filter((unit) => unit.id !== SAMPLE.foreignWarriorId);
        changed.units.push({ id: 'u2_w0rk3r', type: 'worker', owner: SAMPLE.other, tile, own: null });
      });
      const info = describeTile(withWorker, tile);
      expect(linesOf(info, 'unit'), String(tile)).toEqual([{ kind: 'unit', text: expected, civ: 'egypt' }]);
      expect(expected).not.toMatch(/\d/);
      // Nothing else on the tile gives its work away: no offer, no word on citizens.
      expect(kinds(info), String(tile)).toEqual(['unit', 'yields', 'movement', 'owner']);
    }
  });

  it('a player id the view does not list becomes "another player" and nothing throws', () => {
    const stranger = viewWith((view) => {
      unitIn(view, SAMPLE.foreignWarriorId).owner = 'p9';
      cityIn(view, SAMPLE.thebesId).owner = 'p9';
      seenTile(view, SAMPLE.thebesTile).owner = 'p9';
    });
    expect(lineOf(describeTile(stranger, SAMPLE.foreignWarriorTile), 'unit')).toEqual({
      kind: 'unit', text: 'Warrior of another player. A soldier who guards and blocks the way.', civ: null,
    });
    const thebes = describeTile(stranger, SAMPLE.thebesTile);
    expect(lineOf(thebes, 'city')).toEqual({ kind: 'city', text: 'Thebes, population 1: a city of another player', civ: null });
    expect(lineOf(thebes, 'owner')).toEqual({ kind: 'owner', text: 'Belongs to another player', civ: null });
    expect(lineOf(thebes, 'movement').text).toBe('Blocked: another player\'s unit or city is here');

    // Even a view that does not list its own player is described, tile by tile, without a throw.
    const nobody = viewWith((view) => {
      view.players = [];
    });
    for (let tile = 0; tile < nobody.tiles.length; tile++) {
      expect(() => describeTile(nobody, tile), String(tile)).not.toThrow();
    }
    expect(lineOf(describeTile(nobody, SAMPLE.romeTile), 'city')).toEqual({ kind: 'city', text: 'Rome, population 2: your city', civ: null });
    expect(lineOf(describeTile(nobody, SAMPLE.romeTile), 'owner')).toEqual({ kind: 'owner', text: 'Belongs to you', civ: null });
  });

  it('a player called <b>Ben</b> appears letter for letter in the text', () => {
    const view = viewWith((changed) => {
      changed.players[1].name = '<b>Ben</b>';
    });
    expect(lineOf(describeTile(view, SAMPLE.foreignWarriorTile), 'unit').text).toBe(
      'Warrior of <b>Ben</b> (Egypt). A soldier who guards and blocks the way.',
    );
    expect(lineOf(describeTile(view, SAMPLE.thebesTile), 'city').text).toBe('Thebes, population 1: a city of <b>Ben</b> (Egypt)');
    expect(lineOf(describeTile(view, TILES.foreignLand), 'owner').text).toBe('Belongs to <b>Ben</b> (Egypt)');
  });
});

describe('describeTile: the whole map', () => {
  it('for every tile of the sample view: the kinds come in the fixed order, no text is empty, none has a line break, and an explored tile has exactly one yields, one movement and one owner line', () => {
    const view = sampleView();
    let explored = 0;
    for (let tile = 0; tile < view.tiles.length; tile++) {
      const info = describeTile(view, tile);
      expect(info.tile).toBe(tile);
      expect(info.title, String(tile)).not.toBe('');

      const order = kinds(info).map((kind) => KIND_ORDER.indexOf(kind));
      expect(order.every((rank) => rank >= 0), String(tile)).toBe(true);
      expect([...order].sort((a, b) => a - b), String(tile)).toEqual(order);
      for (const line of info.lines) {
        expect(line.text.trim(), String(tile)).not.toBe('');
        expect(line.text, String(tile)).not.toMatch(/[\r\n]/);
      }

      if (view.tiles[tile] === null) {
        expect(info).toEqual({ tile, knowledge: 'unexplored', title: 'Unexplored', lines: [] });
        continue;
      }
      explored += 1;
      expect(info.knowledge, String(tile)).toBe(seenTile(view, tile).visible ? 'visible' : 'remembered');
      expect(linesOf(info, 'remembered'), String(tile)).toHaveLength(seenTile(view, tile).visible ? 0 : 1);
      for (const kind of ['yields', 'movement', 'owner'] as const) expect(linesOf(info, kind), `${tile} ${kind}`).toHaveLength(1);
      for (const kind of ['city', 'building', 'focus', 'improvement', 'worked'] as const) expect(linesOf(info, kind).length, `${tile} ${kind}`).toBeLessThanOrEqual(1);
    }
    expect(explored).toBeGreaterThan(60); // the sample view really was walked through
  });

  it('a name that came with a line break in it is printed on one line', () => {
    const view = viewWith((changed) => {
      changed.players[1].name = 'Ben\nthe Second';
      cityIn(changed, SAMPLE.thebesId).name = 'Thebes\r\nthe Old';
    });
    expect(lineOf(describeTile(view, SAMPLE.thebesTile), 'city').text).toBe('Thebes the Old, population 1: a city of Ben the Second (Egypt)');
  });

  it('describeTile leaves the view untouched and gives equal results for equal views', () => {
    const view = sampleView();
    const before = cloneJson(view);
    const frozen = deepFreeze(sampleView());

    for (let tile = -1; tile <= view.tiles.length; tile++) {
      const first = describeTile(view, tile);
      // An equal view (another object), and a view that throws on any edit, give the same words.
      expect(describeTile(frozen, tile)).toEqual(first);
      // Asked twice, the answers are equal but not the same object: nobody can edit one through the other.
      const again = describeTile(view, tile);
      expect(again).toEqual(first);
      expect(again).not.toBe(first);
    }
    for (const unit of frozen.units) expect(() => unitTileText(frozen, unit)).not.toThrow();
    expect(view).toEqual(before);
  });
});

describe('describeTile: improvements and work', () => {
  it('the sample farm: "Farm (+1 food). Fields that give the tile more food.", "Yields 3 food, 1 production" and "A citizen of Rome gathers these yields"', () => {
    const info = describeTile(sampleView(), SAMPLE.farmTile);
    expect(info.title).toBe('Grassland');
    expect(info.lines).toEqual([
      { kind: 'improvement', text: 'Farm (+1 food). Fields that give the tile more food.', civ: null },
      { kind: 'yields', text: 'Yields 3 food, 1 production', civ: null },
      { kind: 'worked', text: 'A citizen of Rome gathers these yields', civ: null },
      { kind: 'movement', text: 'Land units: costs 1 move to enter', civ: null },
      { kind: 'owner', text: 'Belongs to you', civ: 'rome' },
    ]);
  });

  it('the remembered mine: the "Out of sight" line, then "Mine (+3 production). A pit in the hills for more production." and "Yields 0 food, 5 production"', () => {
    const info = describeTile(sampleView(), SAMPLE.rememberedMineTile);
    expect(info.knowledge).toBe('remembered');
    expect(info.title).toBe('Hills on Desert');
    expect(texts(info)).toEqual([
      'Out of sight: shown as you last saw it. Units are not shown.',
      'Mine (+3 production). A pit in the hills for more production.',
      'Yields 0 food, 5 production',
      'Land units: costs 2 moves to enter',
      'Belongs to Ben (Egypt)',
    ]);
  });

  it('the sample Worker at work: "Your Worker, building a Farm (3 turns left)"; with one turn left "1 turn left"', () => {
    const info = describeTile(sampleView(), SAMPLE.workerTile);
    expect(info.title).toBe('Plains');
    expect(info.lines).toEqual([
      { kind: 'unit', text: 'Your Worker, building a Farm (3 turns left)', civ: 'rome' },
      { kind: 'yields', text: 'Yields 1 food, 2 production', civ: null },
      { kind: 'worked', text: 'No citizen gathers these yields', civ: null },
      { kind: 'movement', text: 'Land units: costs 1 move to enter', civ: null },
      { kind: 'owner', text: 'Belongs to you', civ: 'rome' },
    ]);

    const nearlyDone = viewWith((view) => {
      const job = ownOf(view, SAMPLE.workerId).job;
      if (job === null) throw new Error('the sample Worker has no job');
      job.turnsWorked = 3;
      job.turnsLeft = 1;
    });
    expect(lineOf(describeTile(nearlyDone, SAMPLE.workerTile), 'unit').text).toBe('Your Worker, building a Farm (1 turn left)');

    // Without a job it is a unit like any other: its moves.
    const idle = viewWith((view) => {
      ownOf(view, SAMPLE.workerId).job = null;
    });
    expect(lineOf(describeTile(idle, SAMPLE.workerTile), 'unit').text).toBe('Your Worker, 2 of 2 moves left');
  });

  it('unitTileText is the title and the yields line of the unit\'s tile ("Tile: Grassland. Yields 2 food, 1 production."), names an improvement ("Tile: Grassland, Farm. ..."), and says "City centre: ..." for a unit in a city', () => {
    const view = sampleView();
    expect(unitTileText(view, unitIn(view, SAMPLE.warriorId))).toBe('Tile: Grassland. Yields 2 food, 1 production.');
    expect(unitTileText(view, unitIn(view, SAMPLE.workerId))).toBe('Tile: Plains. Yields 1 food, 2 production.');

    const onFarm = viewWith((changed) => {
      unitIn(changed, SAMPLE.workerId).tile = SAMPLE.farmTile;
    });
    expect(unitTileText(onFarm, unitIn(onFarm, SAMPLE.workerId))).toBe('Tile: Grassland, Farm. Yields 3 food, 1 production.');

    const onHills = viewWith((changed) => {
      unitIn(changed, SAMPLE.warriorId).tile = TILES.freeHills;
    });
    expect(unitTileText(onHills, unitIn(onHills, SAMPLE.warriorId))).toBe('Tile: Hills on Grassland. Yields 0 food, 2 production.');

    const inRome = viewWith((changed) => {
      unitIn(changed, SAMPLE.warriorId).tile = SAMPLE.romeTile;
    });
    expect(unitTileText(inRome, unitIn(inRome, SAMPLE.warriorId))).toBe('Tile: Grassland. City centre: 2 food, 1 production.');

    // The same words as the boxes: the title and the yields line of describeTile.
    for (const unit of view.units) {
      const info = describeTile(view, unit.tile);
      expect(unitTileText(view, unit)).toBe(`Tile: ${info.title}. ${lineOf(info, 'yields').text}.`);
    }
    // A unit the view puts on a tile it does not know (the server never does) still gets a sentence.
    const lost = viewWith((changed) => {
      unitIn(changed, SAMPLE.warriorId).tile = TILES.unseen;
    });
    expect(unitTileText(lost, unitIn(lost, SAMPLE.warriorId))).toBe('Tile: Unexplored.');
  });

  it('improvementBonusText reads the table: "+1 food", "+3 production"', () => {
    expect(improvementBonusText('farm')).toBe('+1 food');
    expect(improvementBonusText('mine')).toBe('+3 production');

    // Tuned numbers show at once: both yields, in the order food, production.
    const mine = IMPROVEMENTS.mine;
    const original = mine.yields;
    try {
      mine.yields = { food: 2, production: 1 };
      expect(improvementBonusText('mine')).toBe('+2 food, +1 production');
      expect(lineOf(describeTile(sampleView(), SAMPLE.rememberedMineTile), 'improvement').text).toBe(
        'Mine (+2 food, +1 production). A pit in the hills for more production.',
      );
    } finally {
      mine.yields = original;
    }
    expect(improvementBonusText('mine')).toBe('+3 production');
  });

  it('the descriptions the lines quote are one line each and hold no digit', () => {
    // The table tests of the shared package guard this; the foreign unit's line relies on it.
    for (const unit of Object.values(UNITS)) expect(unit.description).not.toMatch(/\d|\n/);
    for (const improvement of Object.values(IMPROVEMENTS)) expect(improvement.description).not.toMatch(/\d|\n/);
  });
});

describe('describeTile: citizens gather, units work (the twelve states of the line about citizens)', () => {
  /**
   * The owner's find after round 2: under a Worker that was building a
   * farm the box said "No citizen works this tile". Each case below is one
   * row of the specification's table (round 3, section 2.7 a): the whole
   * box, top to bottom, word for word.
   */

  /** Own grassland of Rome nobody gathers from, with nothing on it. */
  const FIELD = TILES.ownUnworked;
  const OWNER = 'Belongs to you';

  /** The sample view with its Worker moved to the field, with `turnsWorked` turns of its farm done (null: no job). */
  function workerOnField(turnsWorked: number | null, change: (view: PlayerView) => void = () => {}): PlayerView {
    return viewWith((view) => {
      const worker = unitIn(view, SAMPLE.workerId);
      worker.tile = FIELD;
      if (turnsWorked === null) ownOf(view, SAMPLE.workerId).job = null;
      else putToWork(worker, turnsWorked);
      change(view);
    });
  }

  it('1. open grassland, a Worker building a farm, no citizen (the owner\'s case): the Worker builds, no citizen gathers', () => {
    const info = describeTile(workerOnField(1), FIELD);
    expect(info.title).toBe('Grassland');
    expect(texts(info)).toEqual([
      'Your Worker, building a Farm (3 turns left)',
      'Yields 2 food, 1 production',
      'No citizen gathers these yields',
      'Land units: costs 1 move to enter',
      OWNER,
    ]);
    expect(kinds(info)).toEqual(['unit', 'yields', 'worked', 'movement', 'owner']);
  });

  it('2. the same tile with a citizen placed on it', () => {
    const view = workerOnField(3, (changed) => romeOf(changed).worked.push(FIELD));
    expect(texts(describeTile(view, FIELD))).toEqual([
      'Your Worker, building a Farm (1 turn left)',
      'Yields 2 food, 1 production',
      'A citizen of Rome gathers these yields',
      'Land units: costs 1 move to enter',
      OWNER,
    ]);
  });

  it('3. a finished farm, a citizen, no unit', () => {
    const info = describeTile(sampleView(), SAMPLE.farmTile);
    expect(info.title).toBe('Grassland');
    expect(texts(info)).toEqual([
      'Farm (+1 food). Fields that give the tile more food.',
      'Yields 3 food, 1 production',
      'A citizen of Rome gathers these yields',
      'Land units: costs 1 move to enter',
      OWNER,
    ]);
  });

  it('4. a finished farm, the Worker still standing on it with moves left, no citizen', () => {
    const view = workerOnField(null, (changed) => {
      seenTile(changed, FIELD).improvement = 'farm';
    });
    expect(texts(describeTile(view, FIELD))).toEqual([
      'Your Worker, 2 of 2 moves left',
      'Farm (+1 food). Fields that give the tile more food.',
      'Yields 3 food, 1 production',
      'No citizen gathers these yields',
      'Land units: costs 1 move to enter',
      OWNER,
    ]);
  });

  it('5. a mine nobody uses: the line that tells the player the mine stands idle', () => {
    const view = viewWith((changed) => {
      const hill = seenTile(changed, FIELD);
      hill.terrain = 'plains';
      hill.feature = 'hills';
      hill.improvement = 'mine';
    });
    const info = describeTile(view, FIELD);
    expect(info.title).toBe('Hills on Plains');
    expect(texts(info)).toEqual([
      'Mine (+3 production). A pit in the hills for more production.',
      'Yields 0 food, 5 production',
      'No citizen gathers these yields',
      'Land units: costs 2 moves to enter',
      OWNER,
    ]);
  });

  it('6. own coast, a Fishing Boat building a net, no citizen', () => {
    const view = shoreView((changed) => putToWork(addOwnUnit(changed, 'u1_f1sher', 'fishingBoat', SHORE.middle), 1));
    const info = describeTile(view, SHORE.middle);
    expect(info.title).toBe('Coast');
    expect(texts(info)).toEqual([
      'Your Fishing Boat, building a Fishing Net (3 turns left)',
      'Yields 2 food, 0 production',
      'No citizen gathers these yields',
      'Boats only: costs 1 move to enter',
      OWNER,
    ]);
  });

  it('7. own coast with a net, a citizen', () => {
    const view = shoreView((changed) => {
      seenTile(changed, SHORE.middle).improvement = 'fishingNet';
      romeOf(changed).worked.push(SHORE.middle);
    });
    expect(texts(describeTile(view, SHORE.middle))).toEqual([
      'Fishing Net (+2 food). Nets along the coast for more food.',
      'Yields 4 food, 0 production',
      'A citizen of Rome gathers these yields',
      'Boats only: costs 1 move to enter',
      OWNER,
    ]);
  });

  it('8. the same net, the city set to Build and too small to have a citizen left for it: it says why the net brings nothing now', () => {
    const view = shoreView((changed) => {
      seenTile(changed, SHORE.middle).improvement = 'fishingNet';
      romeOf(changed).focus = 'build';
    });
    expect(romeOf(view).worked).not.toContain(SHORE.middle);
    expect(texts(describeTile(view, SHORE.middle))).toEqual([
      'Fishing Net (+2 food). Nets along the coast for more food.',
      'Yields 4 food, 0 production',
      'No citizen gathers these yields',
      'Boats only: costs 1 move to enter',
      OWNER,
    ]);
  });

  it('9. own grassland with another player\'s Warrior on it, a citizen: a foreign unit does not stop the gathering, and the box says both', () => {
    const view = viewWith((changed) => {
      unitIn(changed, SAMPLE.foreignWarriorId).tile = TILES.ownWorked;
    });
    expect(romeOf(view).worked).toContain(TILES.ownWorked);
    expect(texts(describeTile(view, TILES.ownWorked))).toEqual([
      'Warrior of Ben (Egypt). A soldier who guards and blocks the way.',
      'Yields 2 food, 1 production',
      'A citizen of Rome gathers these yields',
      // (The specification's table leaves this line out of its ninth row. It is the rule
      // of the line itself: on the viewer's own land, whatever the shared rule allows.)
      'A Worker can build a Farm here',
      'Blocked: another player\'s unit or city is here',
      OWNER,
    ]);
  });

  it('10. an own tile with the player\'s Warrior and Worker on it: two unit lines, then the yields, then the line', () => {
    const view = workerOnField(1, (changed) => {
      unitIn(changed, SAMPLE.warriorId).tile = FIELD;
    });
    const info = describeTile(view, FIELD);
    expect(texts(info)).toEqual([
      'Your Warrior, 2 of 2 moves left',
      'Your Worker, building a Farm (3 turns left)',
      'Yields 2 food, 1 production',
      'No citizen gathers these yields',
      'Land units: costs 1 move to enter',
      OWNER,
    ]);
    expect(kinds(info)).toEqual(['unit', 'unit', 'yields', 'worked', 'movement', 'owner']);
  });

  it('11. a player with two cities: the line names the city whose citizen gathers here', () => {
    const view = viewWith((changed) => {
      const rome = cityIn(changed, SAMPLE.romeId);
      const ostia = { ...cloneJson(rome), id: 'c1_ostia', name: 'Ostia', tile: at(1, 3) };
      if (ostia.own === null) throw new Error('unexpected sample view');
      ostia.own.worked = [FIELD];
      changed.cities.push(ostia);
    });
    expect(lineOf(describeTile(view, FIELD), 'worked').text).toBe('A citizen of Ostia gathers these yields');
    // Rome's own tiles still name Rome.
    expect(lineOf(describeTile(view, SAMPLE.farmTile), 'worked').text).toBe('A citizen of Rome gathers these yields');
  });

  it('12. a tile out of the player\'s land, a city tile and a tile never seen have no such line', () => {
    const view = shoreView();
    for (const tile of [TILES.foreignLand, TILES.rememberedLand, TILES.freeHills, SHORE.free, TILES.ocean, SAMPLE.romeTile, SAMPLE.thebesTile, TILES.unseen]) {
      expect(linesOf(describeTile(view, tile), 'worked'), String(tile)).toEqual([]);
    }
  });

  it('after End Turn and without a connection the lines are the same: they are information, not orders', () => {
    // describeTile takes the view alone; what the view says about the player's own turn changes no word.
    const open = workerOnField(1);
    const ended = workerOnField(1, (changed) => {
      changed.players[0].endedTurn = true;
    });
    for (const tile of [FIELD, SAMPLE.farmTile, SAMPLE.romeTile, TILES.coast]) {
      expect(describeTile(ended, tile), String(tile)).toEqual(describeTile(open, tile));
    }
  });
});

describe('describeTile: an own city that is set to Build', () => {
  /** The sample view with Rome on Build and this food surplus. */
  function romeOnBuild(foodPerTurn: number): PlayerView {
    return viewWith((view) => {
      romeOf(view).focus = 'build';
      romeOf(view).foodPerTurn = foodPerTurn;
    });
  }

  it('says "Set to Build first: not growing" with a surplus of 0 or less and "Set to Build first" above 0, right after the line about what it builds', () => {
    for (const surplus of [0, -1, -2]) {
      const info = describeTile(romeOnBuild(surplus), SAMPLE.romeTile);
      expect(info.lines, String(surplus)).toEqual([
        { kind: 'city', text: 'Rome, population 2: your city', civ: 'rome' },
        { kind: 'building', text: 'Building: Warrior, 4 turns', civ: null },
        { kind: 'focus', text: 'Set to Build first: not growing', civ: null },
        { kind: 'yields', text: 'City centre: 2 food, 1 production', civ: null },
        { kind: 'movement', text: 'Land units: costs 1 move to enter', civ: null },
        { kind: 'owner', text: 'Belongs to you', civ: 'rome' },
      ]);
    }
    for (const surplus of [1, 3]) {
      expect(texts(describeTile(romeOnBuild(surplus), SAMPLE.romeTile)).slice(0, 3), String(surplus)).toEqual([
        'Rome, population 2: your city',
        'Building: Warrior, 4 turns',
        'Set to Build first',
      ]);
    }
    // The name is the button's, from the table.
    expect(lineOf(describeTile(romeOnBuild(0), SAMPLE.romeTile), 'focus').text).toBe(`Set to ${CITY_FOCUS.build.name}: not growing`);

    // Under a city that builds nothing the line stands in the same place.
    const idle = romeOnBuild(-1);
    romeOf(idle).buildQueue = [];
    expect(texts(describeTile(idle, SAMPLE.romeTile)).slice(1, 3)).toEqual(['Builds nothing', 'Set to Build first: not growing']);
    // A unit in the city comes after it.
    const guarded = romeOnBuild(-1);
    unitIn(guarded, SAMPLE.warriorId).tile = SAMPLE.romeTile;
    expect(kinds(describeTile(guarded, SAMPLE.romeTile))).toEqual(['city', 'building', 'focus', 'unit', 'yields', 'movement', 'owner']);
  });

  it('on Grow there is no such line, whatever the surplus: the box of a city nobody touched stays as it was', () => {
    expect(romeOf(sampleView()).focus).toBe('grow');
    expect(linesOf(describeTile(sampleView(), SAMPLE.romeTile), 'focus')).toEqual([]);
    for (const surplus of [3, 0, -2]) {
      const view = viewWith((changed) => {
        romeOf(changed).foodPerTurn = surplus;
      });
      expect(linesOf(describeTile(view, SAMPLE.romeTile), 'focus'), String(surplus)).toEqual([]);
    }
  });

  it('for another player\'s city there is none, in sight or remembered: its `own` is null, so nothing can say how it is set', () => {
    const view = sampleView();
    expect(cityIn(view, SAMPLE.thebesId).own).toBeNull();
    expect(linesOf(describeTile(view, SAMPLE.thebesTile), 'focus')).toEqual([]);
    const inSight = viewWith((changed) => {
      seenTile(changed, SAMPLE.thebesTile).visible = true;
      cityIn(changed, SAMPLE.thebesId).visible = true;
    });
    expect(kinds(describeTile(inSight, SAMPLE.thebesTile))).toEqual(['city', 'yields', 'movement', 'owner']);

    // The viewer's own city on Build says nothing on any OTHER tile: the line belongs to the city's own tile.
    const onBuild = romeOnBuild(-1);
    for (let tile = 0; tile < onBuild.tiles.length; tile++) {
      expect(linesOf(describeTile(onBuild, tile), 'focus'), String(tile)).toHaveLength(tile === SAMPLE.romeTile ? 1 : 0);
    }
  });
});

describe('describeTile: what can be built, and by which unit', () => {
  const canBuild = (view: PlayerView, tile: number): string[] => linesOf(describeTile(view, tile), 'canBuild').map((line) => line.text);

  it('"A Worker can build a Farm here", "A Worker can build a Mine here", "A Fishing Boat can build a Fishing Net here": the builder is the unit table\'s', () => {
    const view = shoreView((changed) => {
      seenTile(changed, TILES.ownUnworked).feature = 'hills';
    });
    expect(canBuild(view, SAMPLE.emptyTile)).toEqual(['A Worker can build a Farm here']);
    expect(canBuild(view, TILES.ownUnworked)).toEqual(['A Worker can build a Mine here']);
    for (const tile of [SHORE.north, SHORE.middle, SHORE.south]) expect(canBuild(view, tile), String(tile)).toEqual(['A Fishing Boat can build a Fishing Net here']);

    // Every improvement of the table has a builder with a name, and the sentence is made from the two tables.
    for (const id of IMPROVEMENT_IDS) {
      const sentence = `A ${UNITS[improvementBuilder(id)].name} can build a ${IMPROVEMENTS[id].name} here`;
      expect(sentence, id).not.toMatch(/undefined/);
    }
    expect(UNITS[improvementBuilder('fishingNet')].name).toBe('Fishing Boat');
    expect(UNITS[improvementBuilder('farm')].name).toBe('Worker');
    expect(UNITS[improvementBuilder('mine')].name).toBe('Worker');
  });

  it('not while an own unit builds that one there, and not once it stands', () => {
    // A Fishing Boat building the net on this very tile: its unit line says so, the offer is left out.
    const building = shoreView((changed) => putToWork(addOwnUnit(changed, 'u1_f1sher', 'fishingBoat', SHORE.middle), 0));
    expect(canBuild(building, SHORE.middle)).toEqual([]);
    expect(canBuild(building, SHORE.north)).toEqual(['A Fishing Boat can build a Fishing Net here']);
    // The boat without a job, or a boat that only passes: the offer stands.
    const idle = shoreView((changed) => {
      addOwnUnit(changed, 'u1_f1sher', 'fishingBoat', SHORE.middle);
      addOwnUnit(changed, 'u1_sc0ut1', 'scoutBoat', SHORE.north);
    });
    expect(canBuild(idle, SHORE.middle)).toEqual(['A Fishing Boat can build a Fishing Net here']);
    expect(canBuild(idle, SHORE.north)).toEqual(['A Fishing Boat can build a Fishing Net here']);
    // A finished net.
    const netted = shoreView((changed) => {
      seenTile(changed, SHORE.middle).improvement = 'fishingNet';
    });
    expect(canBuild(netted, SHORE.middle)).toEqual([]);
  });

  it('never on ocean, on foreign water or on water that is nobody\'s; a Worker is offered no net and a boat no farm', () => {
    const view = shoreView((changed) => {
      seenTile(changed, TILES.ocean).owner = SAMPLE.me; // ocean inside the player's land
      seenTile(changed, TILES.coast).owner = SAMPLE.other; // coast inside Egypt's
    });
    expect(canBuild(view, TILES.ocean)).toEqual([]);
    expect(canBuild(view, TILES.coast)).toEqual([]);
    expect(canBuild(view, SHORE.free)).toEqual([]);
    // In the sample view itself Rome owns no water: no tile of it offers a net.
    const dry = sampleView();
    for (let tile = 0; tile < dry.tiles.length; tile++) expect(canBuild(dry, tile).join(), String(tile)).not.toContain('Fishing Net');
    // Land offers land improvements only, water the net only.
    for (let tile = 0; tile < view.tiles.length; tile++) {
      const seen = view.tiles[tile];
      if (seen === null) continue;
      const water = seen.terrain === 'coast' || seen.terrain === 'ocean';
      for (const sentence of canBuild(view, tile)) expect(sentence, String(tile)).toMatch(water ? /^A Fishing Boat can build a Fishing Net here$/ : /^A Worker can build a (Farm|Mine) here$/);
    }
  });

  it('the two whole water tiles of the specification: ocean inside the player\'s land, and coast outside every border with another player\'s Scout Boat', () => {
    const view = shoreView((changed) => {
      seenTile(changed, TILES.ocean).owner = SAMPLE.me;
      changed.units.push({ id: 'u2_sc0ut1', type: 'scoutBoat', owner: SAMPLE.other, tile: SHORE.free, own: null });
    });
    const ocean = describeTile(view, TILES.ocean);
    expect(ocean.title).toBe('Ocean');
    expect(texts(ocean)).toEqual([
      'Yields 1 food, 0 production',
      'No citizen gathers these yields',
      'Boats only: costs 1 move to enter',
      'Belongs to you',
    ]);
    const coast = describeTile(view, SHORE.free);
    expect(coast.title).toBe('Coast');
    expect(coast.lines).toEqual([
      { kind: 'unit', text: 'Scout Boat of Ben (Egypt). A fast boat that explores the sea.', civ: 'egypt' },
      { kind: 'yields', text: 'Yields 2 food, 0 production', civ: null },
      { kind: 'movement', text: 'Blocked: another player\'s unit or city is here', civ: null },
      { kind: 'owner', text: 'Belongs to nobody', civ: null },
    ]);

    // A plain coast tile of the player's own land: the line about the net is the one it gains.
    expect(texts(describeTile(view, SHORE.south))).toEqual([
      'Yields 2 food, 0 production',
      'No citizen gathers these yields',
      'A Fishing Boat can build a Fishing Net here',
      'Boats only: costs 1 move to enter',
      'Belongs to you',
    ]);
  });
});

describe('describeTile: boats and the net', () => {
  it('the player\'s own boat: "Your Fishing Boat, 2 of 2 moves left", "Your Scout Boat, 0 of 4 moves left"; at work "building a Fishing Net (3 turns left)" and "(1 turn left)"', () => {
    const view = shoreView((changed) => {
      addOwnUnit(changed, 'u1_f1sher', 'fishingBoat', SHORE.middle);
      const scout = addOwnUnit(changed, 'u1_sc0ut1', 'scoutBoat', SHORE.north);
      if (scout.own !== null) scout.own.movesLeft = 0;
    });
    expect(lineOf(describeTile(view, SHORE.middle), 'unit')).toEqual({ kind: 'unit', text: 'Your Fishing Boat, 2 of 2 moves left', civ: 'rome' });
    expect(lineOf(describeTile(view, SHORE.north), 'unit').text).toBe('Your Scout Boat, 0 of 4 moves left');

    putToWork(unitIn(view, 'u1_f1sher'), 1);
    expect(lineOf(describeTile(view, SHORE.middle), 'unit').text).toBe('Your Fishing Boat, building a Fishing Net (3 turns left)');
    putToWork(unitIn(view, 'u1_f1sher'), 3);
    expect(lineOf(describeTile(view, SHORE.middle), 'unit').text).toBe('Your Fishing Boat, building a Fishing Net (1 turn left)');

    // The two boats of one player may share a tile: the Scout Boat (the military class) is named first.
    unitIn(view, 'u1_sc0ut1').tile = SHORE.middle;
    expect(linesOf(describeTile(view, SHORE.middle), 'unit').map((line) => line.text)).toEqual([
      'Your Scout Boat, 0 of 4 moves left',
      'Your Fishing Boat, building a Fishing Net (1 turn left)',
    ]);
  });

  it('another player\'s boat: type, owner and the type\'s description, and nothing about what it is doing', () => {
    const view = viewWith((changed) => {
      changed.units.push({ id: 'u2_f1sher', type: 'fishingBoat', owner: SAMPLE.other, tile: SHORE.free, own: null });
      changed.units.push({ id: 'u2_sc0ut1', type: 'scoutBoat', owner: SAMPLE.other, tile: SHORE.south, own: null });
    });
    expect(lineOf(describeTile(view, SHORE.free), 'unit')).toEqual({
      kind: 'unit', text: 'Fishing Boat of Ben (Egypt). Builds fishing nets inside the borders.', civ: 'egypt',
    });
    expect(lineOf(describeTile(view, SHORE.south), 'unit').text).toBe('Scout Boat of Ben (Egypt). A fast boat that explores the sea.');
    expect(kinds(describeTile(view, SHORE.free))).toEqual(['unit', 'yields', 'movement', 'owner']);
  });

  it('the net: "Fishing Net (+2 food). Nets along the coast for more food.", in sight and as last seen; unitTileText names it', () => {
    expect(improvementBonusText('fishingNet')).toBe('+2 food');
    const view = shoreView((changed) => {
      seenTile(changed, SHORE.middle).improvement = 'fishingNet';
      // Egypt's net on a coast tile the player saw once.
      const far = seenTile(changed, TILES.coast);
      far.improvement = 'fishingNet';
      far.owner = SAMPLE.other;
      far.visible = false;
      addOwnUnit(changed, 'u1_f1sher', 'fishingBoat', SHORE.middle);
      addOwnUnit(changed, 'u1_sc0ut1', 'scoutBoat', SHORE.north);
    });
    expect(lineOf(describeTile(view, SHORE.middle), 'improvement')).toEqual({
      kind: 'improvement', text: 'Fishing Net (+2 food). Nets along the coast for more food.', civ: null,
    });
    expect(texts(describeTile(view, TILES.coast))).toEqual([
      'Out of sight: shown as you last saw it. Units are not shown.',
      'Fishing Net (+2 food). Nets along the coast for more food.',
      'Yields 4 food, 0 production',
      'Boats only: costs 1 move to enter',
      'Belongs to Ben (Egypt)',
    ]);
    expect(unitTileText(view, unitIn(view, 'u1_f1sher'))).toBe('Tile: Coast, Fishing Net. Yields 4 food, 0 production.');
    expect(unitTileText(view, unitIn(view, 'u1_sc0ut1'))).toBe('Tile: Coast. Yields 2 food, 0 production.');
  });
});

describe('describeTile: no sentence about citizens says "work"', () => {
  /** "work", "works", "worked", "working" as words of their own. "Worker" is a unit's name and is not meant. */
  const WORK = /\bwork(s|ed|ing)?\b/i;

  /** A view with every case the lines can be in: a shore with nets and boats at work, a mine, a city on Build, a second city, foreign units on own land. */
  function everyCase(): PlayerView {
    return shoreView((view) => {
      seenTile(view, SHORE.north).improvement = 'fishingNet';
      romeOf(view).worked.push(SHORE.north);
      putToWork(addOwnUnit(view, 'u1_f1sher', 'fishingBoat', SHORE.middle), 2);
      addOwnUnit(view, 'u1_sc0ut1', 'scoutBoat', SHORE.south);
      view.units.push({ id: 'u2_f1sher', type: 'fishingBoat', owner: SAMPLE.other, tile: SHORE.free, own: null });
      const hill = seenTile(view, TILES.ownUnworked);
      hill.feature = 'hills';
      hill.improvement = 'mine';
      seenTile(view, TILES.ownForest).feature = 'mountains';
      romeOf(view).focus = 'build';
      romeOf(view).foodPerTurn = -1;
      const ostia = { ...cloneJson(cityIn(view, SAMPLE.romeId)), id: 'c1_ostia', name: 'Ostia', tile: at(1, 3) };
      if (ostia.own !== null) {
        ostia.own.worked = [SAMPLE.emptyTile];
        ostia.own.focus = 'grow';
        ostia.own.buildQueue = [];
      }
      view.cities.push(ostia);
      unitIn(view, SAMPLE.foreignWarriorId).tile = TILES.ownWorked;
    });
  }

  it('in no line of any tile of the sample view, of a view with a shore, and of a view with every case', () => {
    let lines = 0;
    const kindsSeen = new Set<TileInfoLineKind>();
    for (const view of [sampleView(), shoreView(), everyCase()]) {
      for (let tile = 0; tile < view.tiles.length; tile++) {
        for (const line of describeTile(view, tile).lines) {
          lines += 1;
          kindsSeen.add(line.kind);
          expect(line.text, `${tile} ${line.kind}`).not.toMatch(WORK);
        }
      }
      for (const unit of view.units) expect(unitTileText(view, unit), unit.id).not.toMatch(WORK);
    }
    // The search really went over every kind of line there is, the ones about citizens among them.
    expect([...kindsSeen].sort()).toEqual([...KIND_ORDER].sort());
    expect(lines).toBeGreaterThan(900);
    // What it must not find, so that the search is known to find something: the two sentences of round 2.
    expect('No citizen works this tile').toMatch(WORK);
    expect('Yields nothing: cannot be worked').toMatch(WORK);
    expect('Your Worker, building a Farm (3 turns left)').not.toMatch(WORK);
  });

  it('the three sentences about citizens say "gather"', () => {
    const view = everyCase();
    expect(lineOf(describeTile(view, SHORE.north), 'worked').text).toBe('A citizen of Rome gathers these yields');
    expect(lineOf(describeTile(view, SAMPLE.emptyTile), 'worked').text).toBe('A citizen of Ostia gathers these yields');
    expect(lineOf(describeTile(view, SHORE.middle), 'worked').text).toBe('No citizen gathers these yields');
    expect(lineOf(describeTile(view, TILES.ownForest), 'yields').text).toBe('Yields nothing: citizens cannot gather here');
  });
});
