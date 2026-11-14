import { describe, expect, it } from 'vitest';
import {
  UNITS,
  applyAction,
  buildPlayerView,
  checkInvariants,
  diffViews,
  distance,
  filterEvents,
  nextInt,
  seedRng,
  tileMoveCost,
} from '../src/index';
import type { Action, GameState, PlayerId, TileIndex } from '../src/index';
import {
  MEADOW,
  actWithEvents,
  arrange,
  at,
  codeOf,
  deepFreeze,
  endTurnForAll,
  newGame,
  placeUnit,
  send,
  tamper,
  unitOf,
} from './rulesKit';
import { LONG_TEST, sensibleAction, wildAttempt } from './rulesRandomPlay';
import { inSight } from './visibilityOracle';
import { borderScene, fogScene } from './visibilityScenes';

/**
 * No-leak tests, part 3: TWIN WORLDS (see visibilityNoLeak.test.ts for the
 * other two kinds of proof).
 *
 * Two games that differ only in things one player cannot see are played
 * side by side. Whatever that player does, and whatever the others do out
 * of sight, the player must receive exactly the same answers, the same
 * events and the same views in both worlds. If anything hidden could
 * influence what a player is sent, the two worlds would drift apart and
 * these tests would fail.
 *
 * The file also pins down what error codes and half-finished moves may give
 * away: nothing but what the mover sees on the tiles next to it.
 */

/**
 * Two lands with eight columns of open sea between them. Nobody can cross,
 * and nobody can see across: the west sees at most to column 9, the east at
 * most to column 12. The west (columns 0-10) is the same in both worlds;
 * the east (columns 11-21) is drawn twice, with different land.
 */
const WEST_LAND: readonly string[] = [
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ' ~ g g f g g p ~ ~ ~ ~',
  '~ g g g g h g ~ ~ ~ ~',
  ' ~ g p g g g g ~ ~ ~ ~',
  '~ g g g m g g ~ ~ ~ ~',
  ' ~ f g g g g p ~ ~ ~ ~',
  '~ g g h g g g ~ ~ ~ ~',
  ' ~ g g g g f g ~ ~ ~ ~',
  '~ p g g g g g ~ ~ ~ ~',
  ' ~ g g f g g g ~ ~ ~ ~',
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
];
const EAST_LAND_A: readonly string[] = [
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  '~ ~ ~ ~ g g g f g g ~',
  '~ ~ ~ ~ g h g g g g ~',
  '~ ~ ~ ~ g g g g p g ~',
  '~ ~ ~ ~ f g g g g g ~',
  '~ ~ ~ ~ g g p g g h ~',
  '~ ~ ~ ~ g g g g g g ~',
  '~ ~ ~ ~ g f g g g g ~',
  '~ ~ ~ ~ g g g p g g ~',
  '~ ~ ~ ~ g g g g g f ~',
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
];
const EAST_LAND_B: readonly string[] = [
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  '~ ~ ~ ~ d d p p g g ~',
  '~ ~ ~ ~ d p p g g m ~',
  '~ ~ ~ ~ p p g g g g ~',
  '~ ~ ~ ~ p g g F g g ~',
  '~ ~ ~ ~ g g g g H g ~',
  '~ ~ ~ ~ g g m g g g ~',
  '~ ~ ~ ~ p g g g g d ~',
  '~ ~ ~ ~ p p g g d d ~',
  '~ ~ ~ ~ g p p g g d ~',
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
];
/** p1 can never see a tile east of this column, wherever its units and cities are. */
const LAST_COLUMN_P1_CAN_SEE = 9;

function twoLands(east: readonly string[]): string[] {
  return WEST_LAND.map((row, y) => `${row} ${east[y]}`);
}

/**
 * Applies the same action to both worlds and checks that p1 is told the
 * same in both: the same answer (accepted or the same refusal) and the same
 * events. Returns the two worlds after the action.
 */
function sameAnswerForP1(worldA: GameState, worldB: GameState, playerId: PlayerId, turn: number, action: Action, what: string): [GameState, GameState] {
  const resultA = applyAction(deepFreeze(worldA), playerId, turn, action);
  const resultB = applyAction(deepFreeze(worldB), playerId, turn, action);

  expect(codeOf(resultB), what).toBe(codeOf(resultA));
  expect(resultB.ok && resultB.changed, what).toBe(resultA.ok && resultA.changed);
  const newsA = resultA.ok ? filterEvents(resultA.events, 'p1') : resultA.error;
  const newsB = resultB.ok ? filterEvents(resultB.events, 'p1') : resultB.error;
  expect(newsB, what).toEqual(newsA);

  return [resultA.ok ? resultA.state : worldA, resultB.ok ? resultB.state : worldB];
}

/** p1's view must be the same in both worlds, as an object and as the text that would go over the wire. */
function sameViewForP1(worldA: GameState, worldB: GameState, what: string): void {
  const viewA = buildPlayerView(worldA, 'p1');
  const viewB = buildPlayerView(worldB, 'p1');
  expect(viewB, what).toEqual(viewA);
  expect(JSON.stringify(viewB) === JSON.stringify(viewA), what).toBe(true);
}

/** Both of the above: the same action in both worlds, the same answer, the same events, the same view afterwards. */
function sameForP1(worldA: GameState, worldB: GameState, playerId: PlayerId, turn: number, action: Action, what: string): [GameState, GameState] {
  const next = sameAnswerForP1(worldA, worldB, playerId, turn, action, what);
  sameViewForP1(next[0], next[1], what);
  return next;
}

/**
 * A hidden player does something in ONE world. p1 must get no news of it
 * and no change to their view at all (the server would send p1 nothing).
 */
function hiddenAction(world: GameState, playerId: PlayerId, action: Action): GameState {
  const before = buildPlayerView(world, 'p1');
  const result = applyAction(deepFreeze(world), playerId, world.turn, action);
  if (!result.ok) throw new Error(`hidden action ${action.type} of ${playerId} was rejected: ${result.error.code}`);
  expect(filterEvents(result.events, 'p1')).toEqual([]);
  expect(diffViews(before, buildPlayerView(result.state, 'p1'))).toBeNull();
  return result.state;
}

describe('NO LEAK: twin worlds (WP2)', () => {
  it('two worlds that differ only in what p1 cannot see give p1 identical views, events and answers, whatever anybody does', LONG_TEST, () => {
    for (const seed of ['twins-one', 'twins-two']) {
      // World A and world B: the same west, where p1 lives. In the east,
      // other land, other start tiles for p2 and p3, and (below) other
      // actions. The secret numbers differ too.
      let worldA = newGame(twoLands(EAST_LAND_A), [[3, 5], [17, 3], [18, 7]], seed);
      let worldB = tamper(newGame(twoLands(EAST_LAND_B), [[3, 5], [16, 6], [19, 2]], seed), (draft) => {
        draft.seed = 'the other world';
        draft.rng = [11, 22, 33, 44];
      });
      expect(checkInvariants(worldB)).toEqual([]);
      expect(JSON.stringify(buildPlayerView(worldB, 'p1'))).toBe(JSON.stringify(buildPlayerView(worldA, 'p1')));

      const diceP1 = seedRng(seed, 'p1');
      const diceA = seedRng(seed, 'hidden players in world A');
      const diceB = seedRng(seed, 'hidden players in world B');
      const newsForP1 = new Set<string>();

      for (let turn = 1; turn <= 30; turn++) {
        for (let round = 0; round < 6; round++) {
          // p1 acts: mostly like a client would, sometimes like a cheater who
          // has stolen world A's complete state and probes with its secrets.
          const viewP1 = buildPlayerView(worldA, 'p1');
          let attempt: { playerId: PlayerId; turn: number; action: Action } | null;
          if (nextInt(diceP1, 100) < 30) {
            attempt = wildAttempt(diceP1, worldA, 'p1');
          } else {
            const action = sensibleAction(diceP1, viewP1);
            attempt = action === null ? null : { playerId: 'p1', turn: worldA.turn, action };
          }
          if (attempt !== null) {
            const what = `${seed}, turn ${turn}: ${JSON.stringify(attempt.action)} by ${attempt.playerId}`;
            const result = applyAction(deepFreeze(worldA), attempt.playerId, attempt.turn, attempt.action);
            if (result.ok) for (const event of filterEvents(result.events, 'p1')) newsForP1.add(event.type);
            [worldA, worldB] = sameForP1(worldA, worldB, attempt.playerId, attempt.turn, attempt.action, what);
          }

          // The hidden players act, differently in each world. (They do not
          // end their turns here: who has ended is public, so that happens
          // below, in both worlds alike.) In world B, p3 never founds a city.
          for (const hidden of ['p2', 'p3']) {
            const actionA = sensibleAction(diceA, buildPlayerView(worldA, hidden));
            if (actionA !== null && actionA.type !== 'endTurn' && actionA.type !== 'cancelEndTurn') {
              worldA = hiddenAction(worldA, hidden, actionA);
            }
            const actionB = sensibleAction(diceB, buildPlayerView(worldB, hidden));
            const allowedInB = actionB !== null && !(hidden === 'p3' && actionB.type === 'foundCity');
            if (actionB !== null && allowedInB && actionB.type !== 'endTurn' && actionB.type !== 'cancelEndTurn') {
              worldB = hiddenAction(worldB, hidden, actionB);
            }
          }
        }

        // Everybody ends the turn, in the same order in both worlds.
        for (const playerId of ['p2', 'p3', 'p1']) {
          const endedA = worldA.players.find((player) => player.id === playerId)?.endedTurn;
          const endedB = worldB.players.find((player) => player.id === playerId)?.endedTurn;
          expect(endedB).toBe(endedA);
          if (endedA === true) continue;
          const result = applyAction(deepFreeze(worldA), playerId, worldA.turn, { type: 'endTurn' });
          if (result.ok) for (const event of filterEvents(result.events, 'p1')) newsForP1.add(event.type);
          [worldA, worldB] = sameForP1(worldA, worldB, playerId, worldA.turn, { type: 'endTurn' }, `${seed}, turn ${turn}: ${playerId} ends the turn`);
        }
        expect(worldA.turn).toBe(turn + 1);
        expect(worldB.turn).toBe(turn + 1);

        // The geography holds: p1 sees nothing east of the sea, in either world.
        for (const world of [worldA, worldB]) {
          inSight(world, 'p1').forEach((visible, tile) => {
            if (visible) expect(tile % world.map.width).toBeLessThanOrEqual(LAST_COLUMN_P1_CAN_SEE);
          });
        }
      }

      // The two worlds really did drift far apart where p1 cannot see...
      const citiesOf = (world: GameState, playerId: PlayerId): number =>
        Object.values(world.cities).filter((city) => city.owner === playerId).length;
      expect(citiesOf(worldA, 'p3')).toBeGreaterThan(0);
      expect(citiesOf(worldB, 'p3')).toBe(0);
      expect(JSON.stringify(worldA.units)).not.toBe(JSON.stringify(worldB.units));
      expect(JSON.stringify(worldA.map)).not.toBe(JSON.stringify(worldB.map));
      // ...while p1 lived a full life in both: cities, growth, new units, the lot.
      expect(citiesOf(worldA, 'p1')).toBeGreaterThan(0);
      expect([...newsForP1].sort()).toEqual(['cityFounded', 'cityGrew', 'turnStarted', 'unitBuilt', 'unitMoved']);
      expect(JSON.stringify(buildPlayerView(worldB, 'p1'))).toBe(JSON.stringify(buildPlayerView(worldA, 'p1')));
    }
  });

  it('a foreign unit hidden close by makes no difference to p1 until it comes into sight', LONG_TEST, () => {
    // The same land for everybody this time (the meadow, p1 in the west, p2
    // in the east). The two worlds differ in one thing only: where an extra
    // scout of p2 stands, on two different tiles near p1 that p1 cannot see.
    // p1 plays; as long as the scout is out of p1's sight in both worlds,
    // p1 must not be able to tell the worlds apart.
    let comparisons = 0;
    let discoveries = 0;

    for (let trial = 0; trial < 12; trial++) {
      const dice = seedRng('hidden close by', `trial ${trial}`);
      const start = newGame(MEADOW, [[3, 5], [12, 5]], `nearby-${trial}`);
      const map = start.map;
      const p1Start = at(map, 3, 5);
      const visibleAtStart = inSight(start, 'p1');
      const hidingPlaces = map.tiles
        .map((_, tile) => tile)
        .filter((tile) => !visibleAtStart[tile] && tileMoveCost(map.tiles[tile]) !== null)
        .filter((tile) => distance(tile, p1Start, map) <= 6);
      const placeA = hidingPlaces[nextInt(dice, hidingPlaces.length)];
      const placeB = hidingPlaces[nextInt(dice, hidingPlaces.length)];

      let worldA = arrange(start, (draft) => {
        placeUnit(draft, 'p2', 'scout', placeA);
      });
      let worldB = arrange(start, (draft) => {
        placeUnit(draft, 'p2', 'scout', placeB);
      });

      for (let step = 0; step < 60; step++) {
        const what = `trial ${trial}, step ${step}`;
        const action = sensibleAction(dice, buildPlayerView(worldA, 'p1'));
        if (action !== null) {
          [worldA, worldB] = sameAnswerForP1(worldA, worldB, 'p1', worldA.turn, action, `${what}: ${JSON.stringify(action)}`);
        }
        // p2 does nothing but end the turn when p1 has (in both worlds alike).
        if (worldA.players[0].endedTurn) {
          [worldA, worldB] = sameAnswerForP1(worldA, worldB, 'p2', worldA.turn, { type: 'endTurn' }, `${what}: p2 ends the turn`);
        }
        // From the moment p1 sees the scout in one of the worlds, the views
        // may differ, and rightly so: this trial is over.
        if (inSight(worldA, 'p1')[placeA] || inSight(worldB, 'p1')[placeB]) {
          discoveries += 1;
          break;
        }
        sameViewForP1(worldA, worldB, what);
        comparisons += 1;
      }
    }

    expect(comparisons).toBeGreaterThan(150);
    // The scout really was close: in several trials p1 found it.
    expect(discoveries).toBeGreaterThan(2);
  });

  it('error codes do not tell a hidden thing from a thing that does not exist', () => {
    const { state, thebes } = fogScene();
    const map = state.map;
    let hiddenScoutId = '';
    const world = arrange(state, (draft) => {
      hiddenScoutId = placeUnit(draft, 'p2', 'scout', at(map, 13, 8)).id;
    });
    const hiddenWarriorId = unitOf(world, 'p2', 'warrior').id;
    // The same world without those units and without that city.
    const emptier = tamper(world, (draft) => {
      delete draft.units[hiddenScoutId];
      delete draft.units[hiddenWarriorId];
      delete draft.cities[thebes.id];
      for (const tile of draft.map.tiles) if (tile.cityId === thebes.id) tile.cityId = null;
    });
    expect(JSON.stringify(buildPlayerView(emptier, 'p1'))).toBe(JSON.stringify(buildPlayerView(world, 'p1')));

    const step = at(map, 12, 8);
    const probes: Action[] = [
      { type: 'moveUnit', unitId: hiddenScoutId, path: [step] },
      { type: 'moveUnit', unitId: hiddenScoutId, path: [] },
      { type: 'moveUnit', unitId: hiddenWarriorId, path: [at(map, 11, 5)] },
      { type: 'foundCity', unitId: hiddenScoutId },
      { type: 'foundCity', unitId: hiddenWarriorId },
      { type: 'setProduction', cityId: thebes.id, item: { kind: 'unit', unitType: 'warrior' } },
      { type: 'setProduction', cityId: thebes.id, item: { kind: 'unit', unitType: 'dragon' as 'scout' } },
      { type: 'moveUnit', unitId: 'u2_madeup', path: [step] },
      { type: 'setProduction', cityId: 'c2_madeup', item: { kind: 'unit', unitType: 'warrior' } },
    ];
    for (const probe of probes) {
      const exists = send(world, 'p1', probe);
      const missing = send(emptier, 'p1', probe);
      // The complete answers are the same, to the last character.
      expect(exists.ok).toBe(false);
      expect(JSON.stringify(missing), JSON.stringify(probe)).toBe(JSON.stringify(exists));
    }
    // Units get one code, cities another, whatever else is wrong with the action.
    expect(new Set(probes.map((probe) => codeOf(send(world, 'p1', probe))))).toEqual(new Set(['noSuchUnit', 'noSuchCity']));
    // The owner's own answer shows the ids are real.
    expect(codeOf(send(world, 'p2', { type: 'moveUnit', unitId: hiddenScoutId, path: [step] }))).toBeNull();
  });

  it('a refused first step is always about a tile next to the unit, which its owner sees', () => {
    const { state, scoutId } = borderScene();
    const map = state.map;
    // Around p1's scout at (8,5): a foreign unit, a mountain, an own unit of the same class.
    const scene = arrange(state, (draft) => {
      placeUnit(draft, 'p2', 'settler', at(map, 9, 5));
      draft.map.tiles[at(map, 7, 5)].feature = 'mountains';
      placeUnit(draft, 'p1', 'scout', at(map, 8, 4));
    });
    const view = buildPlayerView(scene, 'p1');
    const refusals = new Map<TileIndex, string | null>();
    for (let direction = 0; direction < 6; direction++) {
      const tile = at(map, 8, 5);
      const next = [at(map, 9, 5), at(map, 9, 6), at(map, 8, 6), at(map, 7, 5), at(map, 8, 4), at(map, 9, 4)][direction];
      expect(view.tiles[next]?.visible, `tile ${next} next to ${tile}`).toBe(true);
      refusals.set(next, codeOf(send(scene, 'p1', { type: 'moveUnit', unitId: scoutId, path: [next] })));
    }
    expect(refusals.get(at(map, 9, 5))).toBe('blocked');
    expect(refusals.get(at(map, 7, 5))).toBe('impassable');
    expect(refusals.get(at(map, 8, 4))).toBe('blocked');
    expect([...refusals.values()].filter((code) => code === null)).toHaveLength(3);
    // Each reason is in p1's view: the foreign settler, the mountain, the own scout.
    expect(view.units.some((unit) => unit.tile === at(map, 9, 5) && unit.owner === 'p2')).toBe(true);
    expect(view.tiles[at(map, 7, 5)]?.feature).toBe('mountains');
    expect(view.units.some((unit) => unit.tile === at(map, 8, 4) && unit.owner === 'p1')).toBe(true);
  });

  it('what a move that stops early gives away is exactly what the mover sees afterwards (what if a unit could walk further than it sees)', () => {
    // With today's numbers no unit can walk beyond its own sight in one
    // turn, so nothing hidden can ever stop a move. This test asks what
    // happens if the numbers are tuned: it gives warriors six moves for a
    // moment (their sight stays 2) and puts the table back afterwards.
    const movesBefore = UNITS.warrior.moves;
    try {
      UNITS.warrior.moves = 6;
      const start = newGame(MEADOW, [[3, 5], [12, 9]]);
      const map = start.map;
      const warrior = unitOf(start, 'p1', 'warrior');
      const alone = arrange(start, (draft) => {
        delete draft.units[unitOf(start, 'p1', 'settler').id]; // only the warrior's short sight is left
      });
      const row = [4, 5, 6, 7, 8].map((x) => at(map, x, 5));
      const move: Action = { type: 'moveUnit', unitId: warrior.id, path: row };
      const blockerTile = at(map, 7, 5);
      expect(buildPlayerView(alone, 'p1').tiles[blockerTile]).toBeNull(); // p1 has never seen that tile

      // Nothing in the way: the warrior walks all five tiles.
      const free = actWithEvents(alone, 'p1', move);
      expect(free.events[0].event).toMatchObject({ path: row, stoppedEarly: false });

      // A hidden foreign unit on the fourth tile: the warrior stops in front of it...
      const guarded = arrange(alone, (draft) => {
        placeUnit(draft, 'p2', 'scout', blockerTile);
      });
      expect(buildPlayerView(guarded, 'p1').units.some((unit) => unit.owner === 'p2')).toBe(false);
      const halted = actWithEvents(guarded, 'p1', move);
      expect(halted.events[0].event).toMatchObject({ path: row.slice(0, 3), stoppedEarly: true });
      expect(halted.state.units[warrior.id]).toMatchObject({ tile: row[2], movesLeft: 3 });
      // ...and what stopped it is in plain sight now: the news tells p1 nothing the view does not show.
      const viewAfter = buildPlayerView(halted.state, 'p1');
      expect(viewAfter.units.filter((unit) => unit.owner === 'p2')).toEqual([
        { id: expect.any(String), type: 'scout', owner: 'p2', tile: blockerTile, own: null },
      ]);
      expect(viewAfter.tiles[blockerTile]).toMatchObject({ visible: true });

      // The same with a hidden foreign city on the path.
      const walled = arrange(alone, (draft) => {
        draft.cities.c2_wall = { id: 'c2_wall', owner: 'p2', name: 'Wall', tile: blockerTile, population: 1, foodStored: 0, production: null, productionStored: 0 };
        draft.map.tiles[blockerTile].cityId = 'c2_wall';
      });
      const atTheGate = actWithEvents(walled, 'p1', move);
      expect(atTheGate.events[0].event).toMatchObject({ path: row.slice(0, 3), stoppedEarly: true });
      expect(buildPlayerView(atTheGate.state, 'p1').cities).toEqual([
        { id: 'c2_wall', owner: 'p2', name: 'Wall', tile: blockerTile, population: 1, visible: true, own: null },
      ]);

      // A foreign unit that the warrior only passes within sight of, and
      // that is out of sight again where the walk ends, leaves no trace:
      // p1 gets the same news and the same view as in a world without it.
      const passingTile = at(map, 5, 3);
      const watched = arrange(alone, (draft) => {
        placeUnit(draft, 'p2', 'scout', passingTile);
      });
      const pastIt = actWithEvents(watched, 'p1', move);
      expect(filterEvents(pastIt.events, 'p1')).toEqual(filterEvents(free.events, 'p1'));
      expect(JSON.stringify(buildPlayerView(pastIt.state, 'p1'))).toBe(JSON.stringify(buildPlayerView(free.state, 'p1')));
      // (It was in sight on the way: the tile is explored now, the unit is not shown.)
      expect(buildPlayerView(pastIt.state, 'p1').tiles[passingTile]).toMatchObject({ visible: false });
    } finally {
      UNITS.warrior.moves = movesBefore;
    }
    expect(UNITS.warrior.moves).toBe(movesBefore);
  });

  it('a turn that resolves tells each player only their own news', () => {
    const scene = borderScene();
    const busy = arrange(scene.state, (draft) => {
      for (const city of Object.values(draft.cities)) {
        city.production = { kind: 'unit', unitType: 'scout' };
        city.productionStored = UNITS.scout.cost;
      }
    });
    const before = buildPlayerView(busy, 'p1');
    const resolved = endTurnForAll(busy);
    const forP1 = JSON.stringify(filterEvents(resolved.events, 'p1'));
    // p2's new scout appears in Thebes, out of p1's sight: neither the news nor the view mention it.
    const newScout = Object.values(resolved.state.units).find((unit) => unit.owner === 'p2' && unit.type === 'scout');
    expect(newScout).toBeDefined();
    expect(forP1).not.toContain(newScout?.id as string);
    expect(forP1).not.toContain(scene.thebes.id);
    const after = buildPlayerView(resolved.state, 'p1');
    expect(after.units.filter((unit) => unit.owner === 'p2')).toEqual(before.units.filter((unit) => unit.owner === 'p2'));
  });
});
