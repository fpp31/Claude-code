import { describe, expect, it } from 'vitest';
import { IMPROVEMENTS, UNITS, cloneJson } from '@domination/shared';
import type { PlayerView, TileView } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import { describeTile, improvementBonusText, unitTileText } from '../src/game/tileInfo';
import type { TileInfo, TileInfoLine, TileInfoLineKind } from '../src/game/tileInfo';
import { SAMPLE, at, cityIn, ownOf, romeOf, unitIn } from './shellKit';

/**
 * What the hover box, the tile card and the unit panel's "Tile:" line say
 * about a tile (game/tileInfo.ts), on the sample view: Ada plays Rome and
 * sees Ben's Egypt. The example table of the round 2 spec (section 2A) is
 * pinned here word for word; change the wording in tileInfo.ts and in these
 * expectations together.
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

/** The tile of a view the viewer has seen; throws for a never-seen one. */
function seenTile(view: PlayerView, tile: number): TileView {
  const seen = view.tiles[tile];
  if (seen === null || seen === undefined) throw new Error(`tile ${tile} is not explored in this view`);
  return seen;
}

/** Freezes a value and everything in it, so that an edit throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** The order of A-D11. */
const KIND_ORDER: TileInfoLineKind[] = ['remembered', 'city', 'building', 'unit', 'improvement', 'yields', 'worked', 'canBuild', 'movement', 'owner'];

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
        { kind: 'movement', text: 'Costs 2 moves to enter', civ: null },
        { kind: 'owner', text: 'Belongs to nobody', civ: null },
      ],
    });
  });

  it('a feature is named with its ground ("Forest on Grassland") and its numbers replace the ground\'s', () => {
    const info = describeTile(sampleView(), TILES.ownForest);
    expect(info.title).toBe('Forest on Grassland');
    // Grassland alone gives 2 food and 1 production and costs 1 move; the forest's numbers stand in for them.
    expect(lineOf(info, 'yields').text).toBe('Yields 1 food, 1 production');
    expect(lineOf(info, 'movement').text).toBe('Costs 2 moves to enter');

    expect(describeTile(sampleView(), SAMPLE.rememberedMineTile).title).toBe('Hills on Desert');
    expect(describeTile(sampleView(), SAMPLE.emptyTile).title).toBe('Grassland');
  });

  it('mountains: "Yields nothing: cannot be worked" and "Land units cannot enter"', () => {
    const info = describeTile(sampleView(), TILES.mountains);
    expect(info.title).toBe('Mountains on Grassland');
    expect(texts(info)).toEqual(['Yields nothing: cannot be worked', 'Land units cannot enter', 'Belongs to nobody']);

    // The spec's example: the same on a tile out of sight, on Egypt's land.
    const remembered = describeTile(sampleView(), TILES.rememberedMountains);
    expect(remembered.knowledge).toBe('remembered');
    expect(texts(remembered)).toEqual([
      'Out of sight: shown as you last saw it. Units are not shown.',
      'Yields nothing: cannot be worked',
      'Land units cannot enter',
      'Belongs to Ben (Egypt)',
    ]);
  });

  it('water yields food and cannot be entered', () => {
    const coast = describeTile(sampleView(), TILES.coast);
    expect(coast.title).toBe('Coast');
    expect(texts(coast)).toEqual(['Yields 2 food, 0 production', 'Land units cannot enter', 'Belongs to nobody']);

    const ocean = describeTile(sampleView(), TILES.ocean);
    expect(ocean.title).toBe('Ocean');
    expect(texts(ocean)).toEqual(['Yields 1 food, 0 production', 'Land units cannot enter', 'Belongs to nobody']);
  });

  it('"1 move" and "2 moves": the singular and the plural', () => {
    expect(lineOf(describeTile(sampleView(), SAMPLE.emptyTile), 'movement').text).toBe('Costs 1 move to enter');
    expect(lineOf(describeTile(sampleView(), TILES.freeHills), 'movement').text).toBe('Costs 2 moves to enter');
  });

  it('own land says "Belongs to you" with the viewer\'s colours; foreign land names the player and the civilization; nobody\'s land has no colour square', () => {
    const view = sampleView();
    expect(lineOf(describeTile(view, TILES.ownWorked), 'owner')).toEqual({ kind: 'owner', text: 'Belongs to you', civ: 'rome' });
    expect(lineOf(describeTile(view, TILES.foreignLand), 'owner')).toEqual({ kind: 'owner', text: 'Belongs to Ben (Egypt)', civ: 'egypt' });
    expect(lineOf(describeTile(view, TILES.rememberedLand), 'owner')).toEqual({ kind: 'owner', text: 'Belongs to Ben (Egypt)', civ: 'egypt' });
    expect(lineOf(describeTile(view, TILES.freeHills), 'owner')).toEqual({ kind: 'owner', text: 'Belongs to nobody', civ: null });
  });

  it('own land says whether a citizen works it: "A citizen of Rome works this tile" on a worked tile, "No citizen works this tile" on another; foreign land, nobody\'s land, a city\'s own tile and mountains have no such line', () => {
    const view = sampleView();
    expect(romeOf(view).worked).toContain(TILES.ownWorked);
    expect(texts(describeTile(view, TILES.ownWorked))).toEqual([
      'Yields 2 food, 1 production',
      'A citizen of Rome works this tile',
      'A Farm can be built here',
      'Costs 1 move to enter',
      'Belongs to you',
    ]);
    expect(texts(describeTile(view, TILES.ownUnworked))).toEqual([
      'Yields 2 food, 1 production',
      'No citizen works this tile',
      'A Farm can be built here',
      'Costs 1 move to enter',
      'Belongs to you',
    ]);
    expect(lineOf(describeTile(view, TILES.ownWorked), 'worked').civ).toBeNull();

    expect(linesOf(describeTile(view, TILES.foreignLand), 'worked')).toEqual([]);
    expect(linesOf(describeTile(view, TILES.freeHills), 'worked')).toEqual([]);
    expect(linesOf(describeTile(view, SAMPLE.romeTile), 'worked')).toEqual([]);

    // Mountains on the viewer's own land: nothing to work, so nothing to say about citizens.
    const ownPeak = viewWith((changed) => {
      seenTile(changed, TILES.ownUnworked).feature = 'mountains';
    });
    expect(texts(describeTile(ownPeak, TILES.ownUnworked))).toEqual(['Yields nothing: cannot be worked', 'Land units cannot enter', 'Belongs to you']);

    // A tile a foreign city claims to work is none of the viewer's business:
    // only the viewer's own cities are asked, the first of them that lists the tile.
    const two = viewWith((changed) => {
      const rome = cityIn(changed, SAMPLE.romeId);
      changed.cities.push({ ...cloneJson(rome), id: 'c1_second', name: 'Ostia', tile: at(1, 3) });
      changed.cities.push({ ...cloneJson(rome), id: 'c2_liar', name: 'Memphis', owner: SAMPLE.other, tile: at(8, 7) });
      changed.cities.reverse(); // Memphis, Ostia, Rome, Thebes
    });
    expect(lineOf(describeTile(two, TILES.ownWorked), 'worked').text).toBe('A citizen of Ostia works this tile');
  });

  it('own land says what can be built: "A Farm can be built here" on open grassland, "A Mine can be built here" on hills, nothing on forest, on a city\'s tile, on a tile that has the improvement, and on the tile where the viewer\'s own Worker is building it; foreign land never has the line', () => {
    const view = sampleView();
    expect(linesOf(describeTile(view, TILES.ownUnworked), 'canBuild')).toEqual([{ kind: 'canBuild', text: 'A Farm can be built here', civ: null }]);

    const ownHills = viewWith((changed) => {
      seenTile(changed, TILES.ownUnworked).feature = 'hills';
    });
    expect(linesOf(describeTile(ownHills, TILES.ownUnworked), 'canBuild').map((line) => line.text)).toEqual(['A Mine can be built here']);

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
    expect(linesOf(describeTile(stopped, SAMPLE.workerTile), 'canBuild').map((line) => line.text)).toEqual(['A Farm can be built here']);

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
      { kind: 'movement', text: 'Costs 1 move to enter', civ: null },
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
    expect(lineOf(hillCity, 'movement').text).toBe('Costs 2 moves to enter');
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
      'Costs 1 move to enter',
      'Belongs to Ben (Egypt)',
    ]);
    expect(JSON.stringify(info)).not.toContain('Warrior');
  });

  it('an own unit: "Your Warrior, 2 of 2 moves left"; two own units on one tile: the soldier first', () => {
    const view = sampleView();
    expect(describeTile(view, SAMPLE.warriorTile).lines).toEqual([
      { kind: 'unit', text: 'Your Warrior, 2 of 2 moves left', civ: 'rome' },
      { kind: 'yields', text: 'Yields 2 food, 1 production', civ: null },
      { kind: 'movement', text: 'Costs 1 move to enter', civ: null },
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
      for (const kind of ['city', 'building', 'improvement', 'worked'] as const) expect(linesOf(info, kind).length, `${tile} ${kind}`).toBeLessThanOrEqual(1);
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
  it('the sample farm: "Farm (+1 food). Fields that give the tile more food.", "Yields 3 food, 1 production" and "A citizen of Rome works this tile"', () => {
    const info = describeTile(sampleView(), SAMPLE.farmTile);
    expect(info.title).toBe('Grassland');
    expect(info.lines).toEqual([
      { kind: 'improvement', text: 'Farm (+1 food). Fields that give the tile more food.', civ: null },
      { kind: 'yields', text: 'Yields 3 food, 1 production', civ: null },
      { kind: 'worked', text: 'A citizen of Rome works this tile', civ: null },
      { kind: 'movement', text: 'Costs 1 move to enter', civ: null },
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
      'Costs 2 moves to enter',
      'Belongs to Ben (Egypt)',
    ]);
  });

  it('the sample Worker at work: "Your Worker, building a Farm (3 turns left)"; with one turn left "1 turn left"', () => {
    const info = describeTile(sampleView(), SAMPLE.workerTile);
    expect(info.title).toBe('Plains');
    expect(info.lines).toEqual([
      { kind: 'unit', text: 'Your Worker, building a Farm (3 turns left)', civ: 'rome' },
      { kind: 'yields', text: 'Yields 1 food, 2 production', civ: null },
      { kind: 'worked', text: 'No citizen works this tile', civ: null },
      { kind: 'movement', text: 'Costs 1 move to enter', civ: null },
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
