import { describe, expect, it } from 'vitest';
import {
  RULES,
  UNITS,
  boardFromState,
  boardFromView,
  buildPlayerView,
  canEnterTile,
  distance,
  neighbors,
  pathTo,
  reachableTiles,
  tileCount,
  tileMoveCost,
} from '../src/index';
import type { Action, GameState, TileIndex, Unit } from '../src/index';
import { sampleView } from '../src/testing';
import {
  EAST,
  MEADOW,
  NORTH_EAST,
  SOUTH_EAST,
  WEST,
  act,
  actWithEvents,
  arrange,
  at,
  deepFreeze,
  foundCityAt,
  newGame,
  placeUnit,
  refusal,
  stepFrom,
  unitOf,
} from './rulesKit';

/**
 * Tests for moving units: the moveUnit action, and the movement functions
 * the client uses to highlight where a unit can go (rules/movement.ts).
 */

/**
 * One row of land with every kind of ground on it, water all around.
 * Row 2 from west to east: coast, grass, grass, forest, grass, hills,
 * grass, mountains, grass.
 */
const TRAIL: readonly string[] = [
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ' ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ', g g f g h g m g ~',
  ' ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
];

/** A single player on the trail, with the Settler and the Warrior on the westmost grass tile. */
function trailGame(): GameState {
  return newGame(TRAIL, [[1, 2]]);
}

/** Two players on the meadow: p1 around (3,5), p2 around (12,5), far out of each other's sight. */
function meadowGame(): GameState {
  return newGame(MEADOW, [[3, 5], [12, 5]]);
}

function move(unit: Unit, path: TileIndex[]): Action {
  return { type: 'moveUnit', unitId: unit.id, path };
}

describe('applyAction: moveUnit (WP2)', () => {
  it('moves along the path and charges tileMoveCost per step', () => {
    const start = trailGame();
    const map = start.map;
    const warrior = unitOf(start, 'p1', 'warrior');

    // One step on grass costs 1 of the warrior's 2 moves.
    const oneStep = act(start, 'p1', move(warrior, [at(map, 2, 2)]));
    expect(oneStep.units[warrior.id].tile).toBe(at(map, 2, 2));
    expect(oneStep.units[warrior.id].movesLeft).toBe(UNITS.warrior.moves - 1);

    // A scout (3 moves) crosses forest (2) and then grass (1).
    let scoutId = '';
    const withScout = arrange(start, (draft) => {
      scoutId = placeUnit(draft, 'p1', 'scout', at(map, 2, 2)).id;
    });
    const intoForest = act(withScout, 'p1', { type: 'moveUnit', unitId: scoutId, path: [at(map, 3, 2)] });
    expect(intoForest.units[scoutId].movesLeft).toBe(UNITS.scout.moves - (tileMoveCost(map.tiles[at(map, 3, 2)]) as number));
    const beyond = act(withScout, 'p1', { type: 'moveUnit', unitId: scoutId, path: [at(map, 3, 2), at(map, 4, 2)] });
    expect(beyond.units[scoutId].tile).toBe(at(map, 4, 2));
    expect(beyond.units[scoutId].movesLeft).toBe(0);

    // Nothing else moved, and the unit kept its id, type and owner.
    expect(beyond.units[warrior.id]).toEqual(withScout.units[warrior.id]);
    expect(beyond.units[scoutId]).toEqual({ ...withScout.units[scoutId], tile: at(map, 4, 2), movesLeft: 0 });
  });

  it('lets a unit with 1 move left enter rough terrain (moves floor at 0)', () => {
    const start = trailGame();
    const map = start.map;
    const warrior = unitOf(start, 'p1', 'warrior');

    // Grass (1 of 2 moves), then forest, which costs 2 but only 1 is left.
    const step = actWithEvents(start, 'p1', move(warrior, [at(map, 2, 2), at(map, 3, 2)]));
    expect(step.state.units[warrior.id].tile).toBe(at(map, 3, 2));
    expect(step.state.units[warrior.id].movesLeft).toBe(0);
    expect(step.events[0].event).toMatchObject({ stoppedEarly: false });
  });

  it('rejects a missing unit and another player\'s unit with the same code, noSuchUnit', () => {
    const state = meadowGame();
    const foreign = unitOf(state, 'p2', 'warrior');
    const pathOfForeign = [stepFrom(state.map, foreign.tile, WEST)];

    expect(refusal(state, 'p1', move(foreign, pathOfForeign))).toBe('noSuchUnit');
    expect(refusal(state, 'p1', { type: 'moveUnit', unitId: 'u1_nobody', path: pathOfForeign })).toBe('noSuchUnit');
    // Names every JavaScript object inherits are not unit ids either.
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', '']) {
      expect(refusal(state, 'p1', { type: 'moveUnit', unitId: id, path: pathOfForeign }), id).toBe('noSuchUnit');
    }
    // The owner can move it, of course.
    expect(refusal(state, 'p2', move(foreign, pathOfForeign))).toBeNull();

    // "Whose unit" is answered before the path is looked at: a bad path does not change the code.
    expect(refusal(state, 'p1', move(foreign, []))).toBe('noSuchUnit');
  });

  it('rejects empty, too long, off-map and non-adjacent paths with badPath', () => {
    const state = meadowGame();
    const map = state.map;
    const warrior = unitOf(state, 'p1', 'warrior');
    const east = stepFrom(map, warrior.tile, EAST);
    const twoEast = stepFrom(map, east, EAST);

    // Walking east and back west again and again: every step is adjacent, only the length differs.
    const pacing = (length: number): TileIndex[] =>
      Array.from({ length }, (_, i) => (i % 2 === 0 ? east : warrior.tile));

    const bad: [string, unknown[]][] = [
      ['empty', []],
      ['one step too long', pacing(RULES.maxPathLength + 1)],
      ['a negative number', [-1]],
      ['a number past the last tile', [tileCount(map)]],
      ['a fraction', [east + 0.5]],
      ['not a number', ['east']],
      ['a number written as text', [String(east)]],
      ['null', [null]],
      ['NaN', [Number.NaN]],
      ['a first step two tiles away', [twoEast]],
      ['a first step onto its own tile', [warrior.tile]],
      ['a later step that is not adjacent', [east, stepFrom(map, twoEast, EAST)]],
      ['the same tile twice', [east, east]],
      ['a later step off the map', [east, -1]],
    ];
    for (const [what, path] of bad) {
      expect(refusal(state, 'p1', move(warrior, path as TileIndex[])), what).toBe('badPath');
    }

    // The longest allowed path is fine as geometry: the warrior simply stops when its moves run out.
    const longest = actWithEvents(state, 'p1', move(warrior, pacing(RULES.maxPathLength)));
    expect(longest.events[0].event).toMatchObject({ path: [east, warrior.tile], stoppedEarly: true });

    // The path is judged before the moves: a spent unit with a bad path is told badPath.
    const spent = arrange(state, (draft) => {
      draft.units[warrior.id].movesLeft = 0;
    });
    expect(refusal(spent, 'p1', move(warrior, [twoEast]))).toBe('badPath');
  });

  it('rejects a step beyond the last row with badPath, although it would be a neighbor on a taller map', () => {
    // Land right down to the bottom edge. The tile "below" (1,1) would have
    // the number 7 on a map with one more row; here it does not exist.
    const start = newGame(['g g g', ' g g g'], [[1, 1]]);
    const map = start.map;
    const warrior = unitOf(start, 'p1', 'warrior');
    const below = tileCount(map) + 1;
    expect(refusal(start, 'p1', move(warrior, [below])), 'as the first step').toBe('badPath');
    expect(refusal(start, 'p1', move(warrior, [at(map, 0, 1), tileCount(map)])), 'as a later step').toBe('badPath');
    // On the map's real tiles the warrior walks as usual.
    expect(refusal(start, 'p1', move(warrior, [at(map, 0, 1), at(map, 0, 0)]))).toBeNull();
  });

  it('rejects a unit with no moves left with noMovesLeft', () => {
    const state = meadowGame();
    const warrior = unitOf(state, 'p1', 'warrior');
    const east = stepFrom(state.map, warrior.tile, EAST);
    const twoEast = stepFrom(state.map, east, EAST);

    const moved = act(state, 'p1', move(warrior, [east, twoEast]));
    expect(moved.units[warrior.id].movesLeft).toBe(0);
    expect(refusal(moved, 'p1', move(warrior, [east]))).toBe('noMovesLeft');

    // Even a step that could never be taken is answered with noMovesLeft first.
    const trail = trailGame();
    const spent = arrange(trail, (draft) => {
      draft.units[unitOf(trail, 'p1', 'warrior').id].movesLeft = 0;
    });
    expect(refusal(spent, 'p1', move(unitOf(trail, 'p1', 'warrior'), [at(trail.map, 0, 2)]))).toBe('noMovesLeft');
  });

  it('rejects a first step into water or mountains with impassable', () => {
    const start = trailGame();
    const map = start.map;
    const warrior = unitOf(start, 'p1', 'warrior');

    expect(refusal(start, 'p1', move(warrior, [at(map, 0, 2)])), 'coast').toBe('impassable');
    expect(refusal(start, 'p1', move(warrior, [stepFrom(map, warrior.tile, NORTH_EAST)])), 'ocean').toBe('impassable');

    let scoutId = '';
    const nextToMountain = arrange(start, (draft) => {
      scoutId = placeUnit(draft, 'p1', 'scout', at(map, 6, 2)).id;
    });
    expect(refusal(nextToMountain, 'p1', { type: 'moveUnit', unitId: scoutId, path: [at(map, 7, 2)] }), 'mountains').toBe('impassable');
    // Nothing leads through the mountain either: the path stops being walked at its foot.
    expect(refusal(nextToMountain, 'p1', { type: 'moveUnit', unitId: scoutId, path: [at(map, 7, 2), at(map, 8, 2)] })).toBe('impassable');
  });

  it('rejects a first step onto a foreign unit, a foreign city, or an own unit of the same class with blocked', () => {
    const start = meadowGame();
    const map = start.map;
    const warrior = unitOf(start, 'p1', 'warrior');
    const settler = unitOf(start, 'p1', 'settler');
    const east = stepFrom(map, warrior.tile, EAST);
    const west = stepFrom(map, warrior.tile, WEST);
    const northEast = stepFrom(map, warrior.tile, NORTH_EAST);

    // A foreign warrior to the east, a foreign settler to the west: both
    // block both of p1's units, whatever their class.
    const withForeigners = arrange(start, (draft) => {
      placeUnit(draft, 'p2', 'warrior', east);
      placeUnit(draft, 'p2', 'settler', west);
    });
    for (const unit of [warrior, settler]) {
      expect(refusal(withForeigners, 'p1', move(unit, [east])), `${unit.type} onto a foreign warrior`).toBe('blocked');
      expect(refusal(withForeigners, 'p1', move(unit, [west])), `${unit.type} onto a foreign settler`).toBe('blocked');
    }

    // An empty foreign city.
    const cityTile = stepFrom(map, stepFrom(map, east, EAST), EAST);
    const withCity = arrange(foundCityAt(start, 'p2', cityTile), (draft) => {
      draft.units[warrior.id].tile = stepFrom(map, cityTile, WEST);
    });
    expect(refusal(withCity, 'p1', move(warrior, [cityTile]))).toBe('blocked');

    // Own units of the same class: a second military unit, a second civilian unit.
    const crowded = arrange(start, (draft) => {
      placeUnit(draft, 'p1', 'scout', east);
      placeUnit(draft, 'p1', 'settler', northEast);
    });
    expect(refusal(crowded, 'p1', move(warrior, [east])), 'warrior onto own scout').toBe('blocked');
    expect(refusal(crowded, 'p1', move(settler, [northEast])), 'settler onto own settler').toBe('blocked');
  });

  it('allows a military and a civilian unit of the same player to share a tile', () => {
    const start = meadowGame();
    const map = start.map;
    const warrior = unitOf(start, 'p1', 'warrior');
    const settler = unitOf(start, 'p1', 'settler');
    const east = stepFrom(map, warrior.tile, EAST);

    // They start on one tile. The settler steps out, the warrior follows onto its tile.
    const apart = act(start, 'p1', move(settler, [east]));
    const together = act(apart, 'p1', move(warrior, [east]));
    expect(together.units[warrior.id].tile).toBe(east);
    expect(together.units[settler.id].tile).toBe(east);

    // The other way round: a settler joins a warrior.
    const settlerJoins = act(act(start, 'p1', move(warrior, [east])), 'p1', move(settler, [east]));
    expect(settlerJoins.units[settler.id].tile).toBe(east);

    // An own city blocks nobody: one unit of each class may stand in it.
    const withCity = act(start, 'p1', { type: 'foundCity', unitId: settler.id });
    const cityTile = settler.tile;
    let newSettlerId = '';
    const visitors = arrange(withCity, (draft) => {
      draft.units[warrior.id].tile = east;
      newSettlerId = placeUnit(draft, 'p1', 'settler', east).id;
    });
    const bothIn = act(act(visitors, 'p1', move(warrior, [cityTile])), 'p1', { type: 'moveUnit', unitId: newSettlerId, path: [cityTile] });
    expect(bothIn.units[warrior.id].tile).toBe(cityTile);
    expect(bothIn.units[newSettlerId].tile).toBe(cityTile);
  });

  it('stops early (and succeeds) when a later step is illegal or the moves run out, reporting stoppedEarly', () => {
    const start = meadowGame();
    const map = start.map;
    const warrior = unitOf(start, 'p1', 'warrior');
    const one = stepFrom(map, warrior.tile, EAST);
    const two = stepFrom(map, one, EAST);
    const three = stepFrom(map, two, EAST);

    // The moves run out: a warrior asked to go three tiles goes two.
    const tired = actWithEvents(start, 'p1', move(warrior, [one, two, three]));
    expect(tired.state.units[warrior.id]).toMatchObject({ tile: two, movesLeft: 0 });
    expect(tired.events[0].event).toMatchObject({ path: [one, two], stoppedEarly: true });

    // A later step is blocked by a foreign unit: the warrior stops in front
    // of it and keeps the move it did not spend.
    const guarded = arrange(start, (draft) => {
      placeUnit(draft, 'p2', 'warrior', two);
    });
    const halted = actWithEvents(guarded, 'p1', move(warrior, [one, two]));
    expect(halted.state.units[warrior.id]).toMatchObject({ tile: one, movesLeft: 1 });
    expect(halted.events[0].event).toMatchObject({ path: [one], stoppedEarly: true });

    // A later step is into mountains (there is no passing through anything).
    const trail = trailGame();
    let scoutId = '';
    const nearMountain = arrange(trail, (draft) => {
      scoutId = placeUnit(draft, 'p1', 'scout', at(trail.map, 5, 2)).id;
    });
    const atTheFoot = actWithEvents(nearMountain, 'p1', {
      type: 'moveUnit', unitId: scoutId, path: [at(trail.map, 6, 2), at(trail.map, 7, 2), at(trail.map, 8, 2)],
    });
    expect(atTheFoot.state.units[scoutId]).toMatchObject({ tile: at(trail.map, 6, 2), movesLeft: 2 });
    expect(atTheFoot.events[0].event).toMatchObject({ path: [at(trail.map, 6, 2)], stoppedEarly: true });

    // A later step onto an own unit of the same class: same thing.
    const ownInTheWay = arrange(start, (draft) => {
      placeUnit(draft, 'p1', 'scout', two);
    });
    const behindFriend = actWithEvents(ownInTheWay, 'p1', move(warrior, [one, two]));
    expect(behindFriend.events[0].event).toMatchObject({ path: [one], stoppedEarly: true });

    // Not stopped early: the whole path was walked, although no moves are left.
    const complete = actWithEvents(start, 'p1', move(warrior, [one, two]));
    expect(complete.events[0].event).toMatchObject({ path: [one, two], stoppedEarly: false });
  });

  it('may walk back over the tile it started from (the unit has left it)', () => {
    const start = meadowGame();
    const map = start.map;
    let scoutId = '';
    const origin = at(map, 6, 2);
    const withScout = arrange(start, (draft) => {
      scoutId = placeUnit(draft, 'p1', 'scout', origin).id;
    });
    const east = stepFrom(map, origin, EAST);
    const step = actWithEvents(withScout, 'p1', { type: 'moveUnit', unitId: scoutId, path: [east, origin, east] });
    expect(step.state.units[scoutId]).toMatchObject({ tile: east, movesLeft: 0 });
    expect(step.events[0].event).toMatchObject({ path: [east, origin, east], stoppedEarly: false });
  });

  it('explores along the way: tiles seen from intermediate steps become explored', () => {
    const start = meadowGame();
    const map = start.map;
    // A scout walks two tiles east and one back. The column furthest east
    // was in sight only from the turning point.
    const origin = at(map, 6, 2);
    let scoutId = '';
    const withScout = arrange(start, (draft) => {
      scoutId = placeUnit(draft, 'p1', 'scout', origin).id;
    });
    const one = stepFrom(map, origin, EAST);
    const turningPoint = stepFrom(map, one, EAST);
    const farEast = at(map, 6 + 2 + UNITS.scout.sight, 2);
    expect(distance(turningPoint, farEast, map)).toBe(UNITS.scout.sight);
    expect(distance(one, farEast, map)).toBeGreaterThan(UNITS.scout.sight);
    expect(withScout.players[0].knowledge.explored[farEast]).toBe(0);

    const after = act(withScout, 'p1', { type: 'moveUnit', unitId: scoutId, path: [one, turningPoint, one] });
    expect(after.units[scoutId].tile).toBe(one);
    expect(after.players[0].knowledge.explored[farEast]).toBe(1);

    // And it is in the player's view as a fogged tile: seen, but not in sight now.
    expect(buildPlayerView(after, 'p1').tiles[farEast]).toMatchObject({ visible: false });
    // The other player learnt nothing from it.
    expect(after.players[1].knowledge).toEqual(withScout.players[1].knowledge);
  });

  it('emits one unitMoved event with the steps actually taken, addressed to the mover only (to: [playerId])', () => {
    const start = meadowGame();
    const map = start.map;
    const warrior = unitOf(start, 'p1', 'warrior');
    const one = stepFrom(map, warrior.tile, EAST);
    const two = stepFrom(map, one, EAST);
    const three = stepFrom(map, two, EAST);

    const whole = actWithEvents(start, 'p1', move(warrior, [one, two]));
    expect(whole.events).toEqual([
      {
        to: ['p1'],
        event: { type: 'unitMoved', playerId: 'p1', unitId: warrior.id, from: warrior.tile, path: [one, two], stoppedEarly: false },
      },
    ]);

    const cut = actWithEvents(start, 'p1', move(warrior, [one, two, three]));
    expect(cut.events).toEqual([
      {
        to: ['p1'],
        event: { type: 'unitMoved', playerId: 'p1', unitId: warrior.id, from: warrior.tile, path: [one, two], stoppedEarly: true },
      },
    ]);
  });
});

describe('movement rules: canEnterTile, reachableTiles and the two boards (WP2)', () => {
  /**
   * A meadow with some rough ground. p1 starts at (2,2), p2 far in the east.
   *   forest at (3,2) and (2,5); hills at (6,2); mountains at (4,3).
   */
  const ROUGH: readonly string[] = [
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ' ~ g g g g g g g g g g g g ~',
    '~ g g f g g h g g g g g g ~',
    ' ~ g g g m g g g g g g g g ~',
    '~ g g g g g g g g g g g g ~',
    ' ~ g f g g g g g g g g g g ~',
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ];

  function roughGame(): GameState {
    return newGame(ROUGH, [[2, 2], [11, 4]]);
  }

  it('canEnterTile: water, mountains and unknown tiles are impassable; foreign units, foreign cities and own units of the same class block', () => {
    const start = roughGame();
    const map = start.map;
    const board = boardFromState(start);
    const p1Warrior = { owner: 'p1', type: 'warrior' as const };
    const p1Settler = { owner: 'p1', type: 'settler' as const };
    const startTile = at(map, 2, 2);

    expect(canEnterTile(board, p1Warrior, at(map, 0, 0))).toBe('impassable'); // ocean
    expect(canEnterTile(board, p1Warrior, at(map, 4, 3))).toBe('impassable'); // mountains
    expect(canEnterTile(board, p1Warrior, -1)).toBe('impassable'); // not a tile at all
    expect(canEnterTile(board, p1Warrior, tileCount(map))).toBe('impassable');
    expect(canEnterTile(board, p1Warrior, at(map, 3, 2))).toBeNull(); // forest
    expect(canEnterTile(board, p1Warrior, at(map, 6, 2))).toBeNull(); // hills
    expect(canEnterTile(board, p1Warrior, at(map, 5, 4))).toBeNull(); // open grass

    // The start tile holds p1's settler and warrior: full for both classes of p1, closed to p2.
    expect(canEnterTile(board, p1Warrior, startTile)).toBe('blocked');
    expect(canEnterTile(board, p1Settler, startTile)).toBe('blocked');
    expect(canEnterTile(board, { owner: 'p2', type: 'scout' }, startTile)).toBe('blocked');

    // With only a civilian there, a military unit of the same player fits, another civilian does not.
    const warriorGone = arrange(start, (draft) => {
      draft.units[unitOf(start, 'p1', 'warrior').id].tile = at(map, 5, 4);
    });
    expect(canEnterTile(boardFromState(warriorGone), p1Warrior, startTile)).toBeNull();
    expect(canEnterTile(boardFromState(warriorGone), { owner: 'p1', type: 'scout' }, startTile)).toBeNull();
    expect(canEnterTile(boardFromState(warriorGone), p1Settler, startTile)).toBe('blocked');
    expect(canEnterTile(boardFromState(warriorGone), p1Settler, at(map, 5, 4))).toBeNull();

    // Cities: the owner walks in, everybody else is blocked.
    const withCity = foundCityAt(start, 'p2', at(map, 7, 4));
    expect(canEnterTile(boardFromState(withCity), p1Warrior, at(map, 7, 4))).toBe('blocked');
    expect(canEnterTile(boardFromState(withCity), { owner: 'p2', type: 'warrior' }, at(map, 7, 4))).toBeNull();
    // Foreign territory around a city is open: only the city tile itself is closed.
    expect(canEnterTile(boardFromState(withCity), p1Warrior, at(map, 6, 4))).toBeNull();
  });

  it('boardFromState reads the state live', () => {
    const start = roughGame();
    const draft = arrange(start, () => undefined); // an editable copy
    const board = boardFromState(draft);
    const tile = at(draft.map, 5, 4);
    expect(board.width).toBe(draft.map.width);
    expect(board.height).toBe(draft.map.height);
    expect(board.unitsAt(tile)).toEqual([]);
    expect(board.ground(tile)).toEqual({ terrain: 'grassland', feature: null });
    expect(board.cityOwnerAt(tile)).toBeNull();

    // The same board object sees a later edit of the same state object.
    draft.units[unitOf(draft, 'p1', 'warrior').id].tile = tile;
    expect(board.unitsAt(tile)).toEqual([{ owner: 'p1', unitClass: 'military' }]);
    expect(board.unitsAt(at(draft.map, 2, 2))).toEqual([{ owner: 'p1', unitClass: 'civilian' }]);
  });

  it('boardFromView knows only what the view contains', () => {
    const start = roughGame();
    const map = start.map;
    // p2 has a city at (7,4). p1's scout saw it and then walked away west.
    const cityTile = at(map, 7, 4);
    let scoutId = '';
    const seen = arrange(foundCityAt(start, 'p2', cityTile), (draft) => {
      scoutId = placeUnit(draft, 'p1', 'scout', at(map, 5, 4)).id;
    });
    const away = arrange(seen, (draft) => {
      draft.units[scoutId].tile = at(map, 2, 4);
    });
    const view = buildPlayerView(away, 'p1');
    const board = boardFromView(view);

    expect(board.width).toBe(map.width);
    expect(board.height).toBe(map.height);
    // Never seen: unknown ground. Seen: the ground, and only terrain and feature.
    const neverSeen = at(map, 12, 5);
    expect(view.tiles[neverSeen]).toBeNull();
    expect(board.ground(neverSeen)).toBeNull();
    expect(board.ground(at(map, 3, 2))).toEqual({ terrain: 'grassland', feature: 'forest' });
    expect(board.ground(-5)).toBeNull();
    // Units in sight, own and foreign.
    expect(board.unitsAt(at(map, 2, 4))).toEqual([{ owner: 'p1', unitClass: 'military' }]);
    expect(board.unitsAt(at(map, 2, 2)).map((unit) => unit.unitClass).sort()).toEqual(['civilian', 'military']);
    // p2's units stand at (11,4), out of sight: the board does not know them.
    expect(board.unitsAt(at(map, 11, 4))).toEqual([]);
    // The city is fogged but remembered, so the board still reports it.
    expect(view.tiles[cityTile]).toMatchObject({ visible: false });
    expect(board.cityOwnerAt(cityTile)).toBe('p2');
    expect(board.cityOwnerAt(at(map, 5, 4))).toBeNull();
    // A unit of p1 therefore cannot enter the remembered city, and an unknown tile is impassable.
    expect(canEnterTile(board, { owner: 'p1', type: 'scout' }, cityTile)).toBe('blocked');
    expect(canEnterTile(board, { owner: 'p1', type: 'scout' }, neverSeen)).toBe('impassable');
  });

  it('reachableTiles: nothing without moves, never the own tile, everything within range on open ground', () => {
    const start = newGame(MEADOW, [[7, 5]]);
    const map = start.map;
    const warrior = unitOf(start, 'p1', 'warrior');
    const board = boardFromState(start);

    expect(reachableTiles(board, { ...warrior, movesLeft: 0 }).size).toBe(0);

    const reach = reachableTiles(board, warrior);
    expect(reach.has(warrior.tile)).toBe(false);
    // Exactly the tiles one or two steps away, with 1 and 0 moves left on arrival.
    const expected = map.tiles
      .map((_, tile) => tile)
      .filter((tile) => distance(tile, warrior.tile, map) >= 1 && distance(tile, warrior.tile, map) <= 2);
    expect([...reach.keys()].sort((a, b) => a - b)).toEqual(expected);
    for (const [tile, step] of reach) {
      const apart = distance(tile, warrior.tile, map);
      expect(step.movesLeft).toBe(UNITS.warrior.moves - apart);
      // The first step comes from the unit's tile. A second step comes from
      // the lowest-numbered tile in between: tiles with equal moves left are
      // expanded in tile order, and the first route found is kept.
      const between = neighbors(tile, map).filter((n) => distance(n, warrior.tile, map) === apart - 1);
      expect(step.previous).toBe(Math.min(...between));
    }
  });

  it('reachableTiles: rough ground uses up the moves, and the route that leaves the most moves wins', () => {
    const start = roughGame();
    const map = start.map;
    const origin = at(map, 2, 2);
    const forest = stepFrom(map, origin, EAST); // (3,2)
    const grassSouthEast = stepFrom(map, origin, SOUTH_EAST);
    // A tile two steps away that can be reached through the forest or through open grass.
    const target = stepFrom(map, forest, SOUTH_EAST);
    expect(stepFrom(map, grassSouthEast, EAST)).toBe(target);
    expect(tileMoveCost(map.tiles[target])).toBe(1);

    const scout = { owner: 'p1', type: 'scout' as const, tile: origin, movesLeft: UNITS.scout.moves };
    const empty = arrange(start, (draft) => {
      // Send p1's own units far away, so that nothing but the ground matters.
      for (const unit of Object.values(draft.units)) if (unit.owner === 'p1') unit.tile = at(map, 9, 1);
    });
    const reach = reachableTiles(boardFromState(empty), scout);

    expect(reach.get(forest)).toEqual({ movesLeft: 1, previous: origin });
    expect(reach.get(grassSouthEast)).toEqual({ movesLeft: 2, previous: origin });
    // Through the grass the scout arrives with 1 move left, through the forest with 0.
    expect(reach.get(target)).toEqual({ movesLeft: 1, previous: grassSouthEast });
    expect(pathTo(reach, target)).toEqual([grassSouthEast, target]);
    // The mountain at (4,3) is never reachable.
    expect(reach.has(at(map, 4, 3))).toBe(false);
    // A warrior (2 moves) ends its move in the forest and gets no further east through it.
    const warriorReach = reachableTiles(boardFromState(empty), { ...scout, type: 'warrior', movesLeft: UNITS.warrior.moves });
    expect(warriorReach.get(forest)).toEqual({ movesLeft: 0, previous: origin });
    expect(warriorReach.has(stepFrom(map, forest, EAST))).toBe(false);
  });

  it('reachableTiles: there is no passing through a tile the unit could not stop on', () => {
    // A corridor one tile wide; a foreign unit stands in it.
    const corridor = ['~ ~ ~ ~ ~ ~ ~ ~', ' ~ ~ ~ ~ ~ ~ ~ ~', '~ g g g g g g ~', ' ~ ~ ~ ~ ~ ~ ~ ~', '~ ~ ~ ~ ~ ~ ~ ~'];
    const start = newGame(corridor, [[1, 2], [6, 2]]);
    const map = start.map;
    let scoutId = '';
    const blockedCorridor = arrange(start, (draft) => {
      scoutId = placeUnit(draft, 'p1', 'scout', at(map, 2, 2)).id;
      placeUnit(draft, 'p2', 'scout', at(map, 4, 2));
    });
    const scout = blockedCorridor.units[scoutId];

    const reach = reachableTiles(boardFromState(blockedCorridor), scout);
    // West is its own warrior (same class), east is free for one tile, then the foreign scout.
    expect([...reach.keys()]).toEqual([at(map, 3, 2)]);

    const open = reachableTiles(boardFromState(arrange(start, (draft) => {
      placeUnit(draft, 'p1', 'scout', at(map, 2, 2));
    })), scout);
    expect([...open.keys()].sort((a, b) => a - b)).toEqual([at(map, 3, 2), at(map, 4, 2), at(map, 5, 2)]);
  });

  it('works on the hand-made sample view the client is developed against', () => {
    const view = sampleView();
    let checked = 0;
    for (const unit of view.units) {
      if (unit.own === null) continue;
      const mover = { owner: unit.owner, type: unit.type, tile: unit.tile, movesLeft: unit.own.movesLeft };
      const reach = reachableTiles(boardFromView(view), mover);
      expect(reach.size).toBeGreaterThan(0);
      for (const [tile, step] of reach) {
        // Only known, enterable tiles without somebody else's unit or city.
        const ground = view.tiles[tile];
        expect(ground).not.toBeNull();
        if (ground !== null) expect(tileMoveCost(ground)).not.toBeNull();
        expect(view.units.some((other) => other.tile === tile && other.owner !== unit.owner)).toBe(false);
        expect(view.cities.some((city) => city.tile === tile && city.owner !== unit.owner)).toBe(false);
        expect(step.movesLeft).toBeGreaterThanOrEqual(0);
        expect(step.movesLeft).toBeLessThan(mover.movesLeft);
        // The route is a chain of neighboring tiles from the unit to the target.
        const path = pathTo(reach, tile) as TileIndex[];
        expect(path[path.length - 1]).toBe(tile);
        let previous = unit.tile;
        for (const next of path) {
          expect(distance(previous, next, view)).toBe(1);
          previous = next;
        }
        expect(path.length).toBeLessThanOrEqual(mover.movesLeft);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('reachableTiles does not change the view it reads', () => {
    const start = roughGame();
    const view = deepFreeze(buildPlayerView(start, 'p1'));
    const warrior = unitOf(start, 'p1', 'warrior');
    expect(() => reachableTiles(boardFromView(view), warrior)).not.toThrow();
  });

  it('the highlight matches the server: every reachable tile of every unit is accepted, with the predicted moves left', () => {
    // A busier situation: rough ground, a foreign city and foreign units close by.
    const start = roughGame();
    const map = start.map;
    const busy = arrange(foundCityAt(start, 'p2', at(map, 6, 4)), (draft) => {
      placeUnit(draft, 'p2', 'warrior', at(map, 4, 2));
      placeUnit(draft, 'p2', 'settler', at(map, 3, 4));
      placeUnit(draft, 'p1', 'scout', at(map, 4, 4));
    });
    const view = buildPlayerView(busy, 'p1');
    let tried = 0;

    for (const unit of view.units) {
      if (unit.own === null) continue;
      const mover = { owner: unit.owner, type: unit.type, tile: unit.tile, movesLeft: unit.own.movesLeft };
      const fromView = reachableTiles(boardFromView(view), mover);
      // Everything within reach is in sight, so the view and the truth must agree completely.
      const fromTruth = reachableTiles(boardFromState(busy), mover);
      expect([...fromView.entries()]).toEqual([...fromTruth.entries()]);

      for (const [target, step] of fromView) {
        const path = pathTo(fromView, target) as TileIndex[];
        const result = actWithEvents(busy, 'p1', { type: 'moveUnit', unitId: unit.id, path });
        expect(result.state.units[unit.id]).toMatchObject({ tile: target, movesLeft: step.movesLeft });
        expect(result.events[0].event).toMatchObject({ path, stoppedEarly: false });
        tried += 1;
      }

      // And the other way round: a neighbor that is not highlighted is refused.
      for (const neighbor of neighbors(unit.tile, map)) {
        if (fromView.has(neighbor)) continue;
        expect(refusal(busy, 'p1', { type: 'moveUnit', unitId: unit.id, path: [neighbor] })).not.toBeNull();
        tried += 1;
      }
    }
    expect(tried).toBeGreaterThan(30);
  });
});
