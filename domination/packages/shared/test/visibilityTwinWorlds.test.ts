import { describe, expect, it } from 'vitest';
import {
  IMPROVEMENTS,
  RULES,
  UNITS,
  UNIT_DOMAINS,
  UNIT_TYPE_IDS,
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
import type { Action, BuildItem, GameState, PlayerId, TileIndex } from '../src/index';
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
  queueOf,
  send,
  tamper,
  unitOf,
  workerOn,
} from './rulesKit';
import { LONG_TEST, nextStepOfThePlan, sensibleAction, wildAttempt } from './rulesRandomPlay';
import { inSight } from './visibilityOracle';
import { borderScene, fogScene, shoreScene } from './visibilityScenes';

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
 * Two lands, each with its own sea, and a wall of mountains five columns
 * thick between them (columns 9 to 13, from the top edge to the bottom
 * edge). Nobody can cross it, on foot or by boat, and nobody can see across
 * it: a Scout Boat sees four tiles, so from the west nobody sees further
 * than column 12, which is wall, and from the east nobody sees further west
 * than column 10. (Until round 3 the two lands were parted by eight columns
 * of open sea; a boat would sail across that in two turns.)
 *
 * The west (columns 0-10) is the same in both worlds. The east (columns
 * 11-21) is drawn twice, with different land behind the same wall.
 */
const WEST_LAND: readonly string[] = [
  '~ ~ ~ ~ ~ ~ ~ ~ ~ m m',
  ' ~ g g f g g p , ~ m m',
  '~ g g g g h g , ~ m m',
  ' ~ g p g g g g , ~ m m',
  '~ g g g m g g , ~ m m',
  ' ~ f g g g g p , ~ m m',
  '~ g g h g g g , ~ m m',
  ' ~ g g g g f g , ~ m m',
  '~ p g g g g g , ~ m m',
  ' ~ g g f g g g , ~ m m',
  '~ ~ ~ ~ ~ ~ ~ ~ ~ m m',
];
const EAST_LAND_A: readonly string[] = [
  'm m m ~ ~ ~ ~ ~ ~ ~ ~',
  'm m m , g g g f g g ~',
  'm m m , g h g g g g ~',
  'm m m , g g g g p g ~',
  'm m m , f g g g g g ~',
  'm m m , g g p g g h ~',
  'm m m , g g g g g g ~',
  'm m m , g f g g g g ~',
  'm m m , g g g p g g ~',
  'm m m , g g g g g f ~',
  'm m m ~ ~ ~ ~ ~ ~ ~ ~',
];
const EAST_LAND_B: readonly string[] = [
  'm m m ~ ~ ~ ~ ~ ~ ~ ~',
  'm m m ~ d d p p g g ~',
  'm m m , d p p g g m ~',
  'm m m , p p g g g g ~',
  'm m m ~ p g g F g g ~',
  'm m m , g g g g H g ~',
  'm m m , g g m g g g ~',
  'm m m ~ p g g g g d ~',
  'm m m , p p g g d d ~',
  'm m m , g p p g g d ~',
  'm m m ~ ~ ~ ~ ~ ~ ~ ~',
];
/** p1 can never see a tile east of this column, wherever its units and cities are: it is in the middle of the wall. */
const LAST_COLUMN_P1_CAN_SEE = 12;
/** The last column that is the same in both worlds: the east edge of the wall. */
const LAST_COLUMN_OF_THE_WALL = 13;

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
  it('the wall between the two lands: the same in both worlds, closed to every unit, and too thick to see across', () => {
    const mapA = newGame(twoLands(EAST_LAND_A), [[5, 5], [16, 3], [18, 7]]).map;
    const mapB = newGame(twoLands(EAST_LAND_B), [[5, 5], [16, 6], [19, 2]]).map;
    const column = (tile: TileIndex): number => tile % mapA.width;
    const farthestSight = Math.max(...UNIT_TYPE_IDS.map((type) => UNITS[type].sight), RULES.cityClaimRadius + RULES.territorySightMargin);
    expect(farthestSight).toBe(4);
    mapA.tiles.forEach((tile, index) => {
      // West of the wall and the wall itself: one drawing for both worlds.
      if (column(index) <= LAST_COLUMN_OF_THE_WALL) expect(mapB.tiles[index], `tile ${index}`).toEqual(tile);
      // The wall lets nobody in, in any row.
      if (column(index) >= 9 && column(index) <= LAST_COLUMN_OF_THE_WALL) {
        for (const domain of UNIT_DOMAINS) expect(tileMoveCost(tile, domain), `tile ${index}, ${domain}`).toBeNull();
      }
    });
    // From every tile west of the wall, the farthest sight there is ends inside the wall.
    for (let west = 0; west < mapA.tiles.length; west++) {
      if (column(west) >= 9) continue;
      for (let east = 0; east < mapA.tiles.length; east++) {
        if (column(east) > LAST_COLUMN_P1_CAN_SEE) expect(distance(west, east, mapA), `${west} to ${east}`).toBeGreaterThan(farthestSight);
      }
    }
    // Both sides have water to sail on and coast to fish, and the two seas are not one.
    for (const map of [mapA, mapB]) {
      expect(map.tiles.some((tile, index) => tile.terrain === 'coast' && column(index) < 9)).toBe(true);
      expect(map.tiles.some((tile, index) => tile.terrain === 'coast' && column(index) > LAST_COLUMN_OF_THE_WALL)).toBe(true);
    }
  });

  it('two worlds that differ only in what p1 cannot see give p1 identical views, events and answers, whatever anybody does', LONG_TEST, () => {
    for (const seed of ['twins-one', 'twins-two']) {
      // World A and world B: the same west, where p1 lives. In the east,
      // other land, other start tiles for p2 and p3, and (below) other
      // actions. The secret numbers differ too.
      let worldA = newGame(twoLands(EAST_LAND_A), [[5, 5], [16, 3], [18, 7]], seed);
      let worldB = tamper(newGame(twoLands(EAST_LAND_B), [[5, 5], [16, 6], [19, 2]], seed), (draft) => {
        draft.seed = 'the other world';
        draft.rng = [11, 22, 33, 44];
      });
      expect(checkInvariants(worldB)).toEqual([]);
      expect(JSON.stringify(buildPlayerView(worldB, 'p1'))).toBe(JSON.stringify(buildPlayerView(worldA, 'p1')));

      const diceP1 = seedRng(seed, 'p1');
      const diceA = seedRng(seed, 'hidden players in world A');
      const diceB = seedRng(seed, 'hidden players in world B');
      const newsForP1 = new Set<string>();
      const hiddenKindsA = new Set<string>();
      let hiddenFlipsA = 0;
      let hiddenBoatMovesA = 0;
      const isBoat = (world: GameState, unitId: string): boolean => UNITS[world.units[unitId].type].domain === 'sea';
      // The hidden p2 of world A settles where it stands, two tiles from the coast: its plan
      // (below) needs a city that can build boats. In world B the dice decide where p2 settles.
      worldA = hiddenAction(worldA, 'p2', { type: 'foundCity', unitId: unitOf(worldA, 'p2', 'settler').id });
      expect(worldA.map.tiles.some((tile) => tile.cityId !== null && tile.terrain === 'coast')).toBe(true);

      for (let turn = 1; turn <= 30; turn++) {
        // The hidden p2 of world A follows a plan (at most three steps of it
        // a turn, before the dice get at its units): a Fishing Boat and a
        // net first, and after that a Worker and a farm.
        for (let step = 0; step < 3; step++) {
          const netsOfTheHidden = worldA.map.tiles.some((tile, index) => tile.improvement === 'fishingNet' && index % worldA.map.width > LAST_COLUMN_P1_CAN_SEE);
          const hiddenPlan = nextStepOfThePlan(buildPlayerView(worldA, 'p2'), netsOfTheHidden ? 'worker' : 'fishingBoat');
          if (hiddenPlan !== null) worldA = hiddenAction(worldA, 'p2', hiddenPlan);
        }

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
          // below, in both worlds alike.) In world A they do whatever their
          // dice say: they build boats, sail them, fish, and tell their
          // cities to place their citizens one way and the other. In world B,
          // p3 never founds a city, nobody ever sets a unit to work, no city
          // ever leaves "Grow first", and every boat a city is asked for
          // becomes a Warrior: there is not one boat in the east of world B.
          for (const hidden of ['p2', 'p3']) {
            const actionA = sensibleAction(diceA, buildPlayerView(worldA, hidden));
            if (actionA !== null && actionA.type !== 'endTurn' && actionA.type !== 'cancelEndTurn') {
              if (actionA.type === 'setCityFocus') hiddenFlipsA += 1;
              if (actionA.type === 'moveUnit' && isBoat(worldA, actionA.unitId)) hiddenBoatMovesA += 1;
              hiddenKindsA.add(actionA.type);
              worldA = hiddenAction(worldA, hidden, actionA);
            }
            let actionB = sensibleAction(diceB, buildPlayerView(worldB, hidden));
            if (actionB !== null && actionB.type === 'setBuildQueue') {
              actionB = { ...actionB, queue: actionB.queue.map((entry) => (UNITS[entry.unitType].domain === 'sea' ? queueOf('warrior')[0] : entry)) };
            }
            const allowedInB =
              actionB !== null && !(hidden === 'p3' && actionB.type === 'foundCity') && actionB.type !== 'startJob' && actionB.type !== 'setCityFocus';
            if (actionB !== null && allowedInB && actionB.type !== 'endTurn' && actionB.type !== 'cancelEndTurn') {
              worldB = hiddenAction(worldB, hidden, actionB);
            }
          }
        }

        // On top of the dice p1 follows a plan too (at most three steps of
        // it a turn), in both worlds alike: a Worker and an improvement.
        for (let step = 0; step < 3; step++) {
          const planned = worldA.players[0].endedTurn ? null : nextStepOfThePlan(buildPlayerView(worldA, 'p1'));
          if (planned !== null) {
            const result = applyAction(deepFreeze(worldA), 'p1', worldA.turn, planned);
            if (result.ok) for (const event of filterEvents(result.events, 'p1')) newsForP1.add(event.type);
            [worldA, worldB] = sameForP1(worldA, worldB, 'p1', worldA.turn, planned, `${seed}, turn ${turn}: p1's plan, ${JSON.stringify(planned)}`);
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

        // The geography holds: p1 sees nothing east of the wall, in either
        // world, and no unit of the hidden players has come west of it.
        for (const world of [worldA, worldB]) {
          inSight(world, 'p1').forEach((visible, tile) => {
            if (visible) expect(tile % world.map.width).toBeLessThanOrEqual(LAST_COLUMN_P1_CAN_SEE);
          });
          for (const unit of Object.values(world.units)) {
            if (unit.owner !== 'p1') expect(unit.tile % world.map.width, unit.id).toBeGreaterThan(LAST_COLUMN_OF_THE_WALL);
          }
        }
      }

      // The two worlds really did drift far apart where p1 cannot see...
      const citiesOf = (world: GameState, playerId: PlayerId): number =>
        Object.values(world.cities).filter((city) => city.owner === playerId).length;
      expect(citiesOf(worldA, 'p3')).toBeGreaterThan(0);
      expect(citiesOf(worldB, 'p3')).toBe(0);
      expect(JSON.stringify(worldA.units)).not.toBe(JSON.stringify(worldB.units));
      expect(JSON.stringify(worldA.map)).not.toBe(JSON.stringify(worldB.map));
      // ...down to what stands on the land and the water: behind the wall, world A has
      // improvements (p2's plan saw to that), a net among them, and world B has none.
      const builtInTheEast = (world: GameState, improvement?: string): number =>
        world.map.tiles.filter(
          (tile, index) => tile.improvement !== null && (improvement === undefined || tile.improvement === improvement) && index % world.map.width > LAST_COLUMN_P1_CAN_SEE,
        ).length;
      expect(builtInTheEast(worldA)).toBeGreaterThan(0);
      expect(builtInTheEast(worldA, 'fishingNet')).toBeGreaterThan(0);
      expect(builtInTheEast(worldB)).toBe(0);
      // ...to the boats: world A's hidden players built some and sailed them about, world B's never had one.
      const hiddenBoats = (world: GameState): number =>
        Object.values(world.units).filter((unit) => unit.owner !== 'p1' && UNITS[unit.type].domain === 'sea').length;
      expect(hiddenBoats(worldA)).toBeGreaterThan(0);
      expect(hiddenBoatMovesA).toBeGreaterThan(5);
      expect(hiddenBoats(worldB)).toBe(0);
      // ...and to how the hidden cities place their citizens: in world A they were pressed back and forth, in world B never.
      expect(hiddenFlipsA).toBeGreaterThan(3);
      expect(Object.values(worldB.cities).filter((city) => city.owner !== 'p1').every((city) => city.focus === 'grow')).toBe(true);
      for (const kind of ['moveUnit', 'foundCity', 'setBuildQueue', 'setCityFocus', 'startJob']) expect(hiddenKindsA, kind).toContain(kind);
      // ...while p1 lived a full life in both: cities, growth, new units, a finished improvement, the lot.
      expect(citiesOf(worldA, 'p1')).toBeGreaterThan(0);
      expect([...newsForP1].sort()).toEqual(['cityFounded', 'cityGrew', 'improvementBuilt', 'turnStarted', 'unitBuilt', 'unitMoved']);
      expect(worldA.map.tiles.some((tile, index) => tile.improvement !== null && index % worldA.map.width <= LAST_COLUMN_P1_CAN_SEE)).toBe(true);
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
        .filter((tile) => !visibleAtStart[tile] && tileMoveCost(map.tiles[tile], 'land') !== null)
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
      { type: 'setBuildQueue', cityId: thebes.id, queue: queueOf('warrior') },
      { type: 'setBuildQueue', cityId: thebes.id, queue: [{ kind: 'unit', unitType: 'dragon' as 'scout' }] },
      { type: 'startJob', unitId: hiddenScoutId, improvement: 'farm' },
      { type: 'startJob', unitId: hiddenWarriorId, improvement: 'dragon' as 'farm' },
      { type: 'stopJob', unitId: hiddenScoutId },
      // Round 3: a boat for the hidden city (it would be refused 'noWaterForBoat' if it were p1's own
      // and dry), and the hidden city told how to place its citizens, with a real choice and with nonsense.
      { type: 'setBuildQueue', cityId: thebes.id, queue: queueOf('fishingBoat') },
      { type: 'setCityFocus', cityId: thebes.id, focus: 'build' },
      { type: 'setCityFocus', cityId: thebes.id, focus: 'grow' },
      { type: 'setCityFocus', cityId: thebes.id, focus: 'fast' } as unknown as Action,
      { type: 'setCityFocus', cityId: 'c2_madeup', focus: 'build' },
      { type: 'startJob', unitId: hiddenScoutId, improvement: 'fishingNet' },
      { type: 'moveUnit', unitId: 'u2_madeup', path: [step] },
      { type: 'setBuildQueue', cityId: 'c2_madeup', queue: queueOf('warrior') },
      { type: 'startJob', unitId: 'u2_madeup', improvement: 'mine' },
      { type: 'stopJob', unitId: 'u2_madeup' },
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

  it('the setBuildQueue probes get the same answers in both worlds', () => {
    // Two worlds that p1 cannot tell apart. In world A the fogged city of
    // p2 has a full queue and a full store; in world B its queue is empty;
    // in world C the city is not there at all.
    const { state, thebes } = fogScene();
    const worldA = tamper(state, (draft) => {
      draft.cities[thebes.id].buildQueue = Array.from({ length: RULES.maxQueueLength }, () => queueOf('settler')[0]);
      draft.cities[thebes.id].productionStored = 4321;
    });
    const worldB = state;
    const worldC = tamper(state, (draft) => {
      delete draft.cities[thebes.id];
      for (const tile of draft.map.tiles) if (tile.cityId === thebes.id) tile.cityId = null;
    });
    expect(worldB.cities[thebes.id].buildQueue).toEqual([]);
    const viewOfP1 = JSON.stringify(buildPlayerView(worldA, 'p1'));
    expect(JSON.stringify(buildPlayerView(worldB, 'p1'))).toBe(viewOfP1);
    expect(JSON.stringify(buildPlayerView(worldC, 'p1'))).toBe(viewOfP1);

    const tooLong = Array.from({ length: RULES.maxQueueLength + 1 }, () => queueOf('scout')[0]);
    const lists: BuildItem[][] = [
      [],
      queueOf('warrior'),
      queueOf('settler', 'settler'),
      Array.from({ length: RULES.maxQueueLength }, () => queueOf('settler')[0]), // the very queue the city has in world A
      tooLong,
      [{ kind: 'unit', unitType: 'dragon' } as unknown as BuildItem],
      [null as unknown as BuildItem],
    ];
    for (const cityId of [thebes.id, 'c2_madeup', 'constructor']) {
      for (const queue of lists) {
        const probe: Action = { type: 'setBuildQueue', cityId, queue };
        const what = `${cityId}, ${JSON.stringify(queue)}`;
        const answers = [worldA, worldB, worldC].map((world) => JSON.stringify(send(world, 'p1', probe)));
        // One code for "not yours" and "does not exist", whatever the list
        // is: not "the same queue as now", not "full", not "cannot build".
        expect(codeOf(send(worldA, 'p1', probe)), what).toBe('noSuchCity');
        expect(answers[1], what).toBe(answers[0]);
        expect(answers[2], what).toBe(answers[0]);
      }
    }
    // The ids and the queues are real: the owner gets other answers.
    expect(codeOf(send(worldA, 'p2', { type: 'setBuildQueue', cityId: thebes.id, queue: tooLong }))).toBe('queueFull');
    const same = send(worldA, 'p2', { type: 'setBuildQueue', cityId: thebes.id, queue: lists[3] });
    expect(same.ok && !same.changed).toBe(true);
    const other = send(worldB, 'p2', { type: 'setBuildQueue', cityId: thebes.id, queue: lists[3] });
    expect(other.ok && other.changed).toBe(true);

    // p1's own queue edits get the same answers and leave the same views, too.
    const rome = Object.values(state.cities).find((city) => city.owner === 'p1');
    let [a, b] = [worldA, worldB];
    for (const queue of [queueOf('warrior'), queueOf('warrior', 'worker'), queueOf('warrior', 'worker'), tooLong, []]) {
      [a, b] = sameForP1(a, b, 'p1', a.turn, { type: 'setBuildQueue', cityId: rome?.id ?? '', queue }, JSON.stringify(queue));
    }
  });

  it('an improvement a hidden player builds in one world only changes nothing p1 is sent', () => {
    // The fog scene twice. In world A p2 has a Worker on Theban land that p1
    // has never seen, and sets it to build a farm; world B has neither.
    const { state } = fogScene();
    const site = at(state.map, 14, 5);
    expect(buildPlayerView(state, 'p1').tiles[site]).toBeNull();
    const hidden = workerOn(state, 'p2', site);
    let worldA = hidden.state;
    let worldB = state;
    sameViewForP1(worldA, worldB, 'a hidden Worker');

    // The order, and every turn of the work: p1 does the same in both worlds
    // and is told the same; what p2 does in world A sends p1 nothing.
    worldA = hiddenAction(worldA, 'p2', { type: 'startJob', unitId: hidden.workerId, improvement: 'farm' });
    sameViewForP1(worldA, worldB, 'the job has begun');
    const warrior = unitOf(worldA, 'p1', 'warrior');
    for (let turn = 0; turn < IMPROVEMENTS.farm.turns; turn++) {
      const there = worldA.units[warrior.id].tile === at(state.map, 3, 5) ? at(state.map, 2, 5) : at(state.map, 3, 5);
      const steps: [PlayerId, Action][] = [
        ['p1', { type: 'moveUnit', unitId: warrior.id, path: [there] }],
        ['p1', { type: 'startJob', unitId: hidden.workerId, improvement: 'farm' }], // a probe with the stolen id
        ['p1', { type: 'endTurn' }],
        ['p2', { type: 'endTurn' }],
      ];
      for (const [playerId, action] of steps) {
        [worldA, worldB] = sameForP1(worldA, worldB, playerId, worldA.turn, action, `turn ${turn}: ${action.type} of ${playerId}`);
      }
    }

    // The farm stands in world A, its owner was told, and p1 knows nothing of it.
    expect(worldA.map.tiles[site].improvement).toBe('farm');
    expect(worldB.map.tiles[site].improvement).toBeNull();
    expect(worldA.units[hidden.workerId].job).toBeNull();
    expect(buildPlayerView(worldA, 'p2').tiles[site]).toMatchObject({ improvement: 'farm' });
    expect(JSON.stringify(buildPlayerView(worldA, 'p1'))).not.toContain('"farm"');
    sameViewForP1(worldA, worldB, 'the farm is finished');

    // The last resolution, looked at alone: world A's has the news for p2, and nothing more for p1 than world B's.
    const almost = tamper(hidden.state, (draft) => {
      draft.units[hidden.workerId].job = { improvement: 'farm', turnsWorked: IMPROVEMENTS.farm.turns - 1 };
    });
    const finishing = endTurnForAll(almost);
    const quiet = endTurnForAll(state);
    expect(filterEvents(finishing.events, 'p2').map((event) => event.type)).toEqual(['improvementBuilt', 'turnStarted']);
    expect(filterEvents(finishing.events, 'p1')).toEqual(filterEvents(quiet.events, 'p1'));
    expect(filterEvents(finishing.events, 'p1').map((event) => event.type)).toEqual(['turnStarted']);
    // The patch p1 would be sent is the same in both worlds (the turn number, and nothing about that tile).
    const patchA = diffViews(buildPlayerView(almost, 'p1'), buildPlayerView(finishing.state, 'p1'));
    const patchB = diffViews(buildPlayerView(state, 'p1'), buildPlayerView(quiet.state, 'p1'));
    expect(patchA).toEqual(patchB);
    expect(JSON.stringify(patchA)).not.toContain('farm');
  });

  /**
   * The five things round 3 added that one player may not learn of another,
   * each as a pair of worlds on the shore (visibilityScenes.ts): p1's scout
   * at (8,4) sees the western edge of Thebes' land and one tile of its
   * water, (10,5); Thebes itself and the water east of that tile are out of
   * p1's sight. In every pair p1 does the same in both worlds, probes with
   * what a cheater would have stolen from world A, and must be told and
   * shown the same.
   */
  describe('the five differences of round 3', () => {
    /** One turn of p1 in both worlds: a step with the Warrior, the probes, and everybody ends the turn. */
    function playOneTurn(worlds: [GameState, GameState], probes: Action[], what: string): [GameState, GameState] {
      let [a, b] = worlds;
      const map = a.map;
      const warrior = unitOf(a, 'p1', 'warrior');
      const there = warrior.tile === at(map, 3, 4) ? at(map, 2, 4) : at(map, 3, 4);
      const steps: [PlayerId, Action][] = [
        ['p1', { type: 'moveUnit', unitId: warrior.id, path: [there] }],
        ...probes.map((probe): [PlayerId, Action] => ['p1', probe]),
        ['p1', { type: 'endTurn' }],
        ['p2', { type: 'endTurn' }],
      ];
      for (const [playerId, action] of steps) {
        [a, b] = sameForP1(a, b, playerId, a.turn, action, `${what}, turn ${a.turn}: ${JSON.stringify(action)} of ${playerId}`);
      }
      expect(b.turn).toBe(a.turn);
      return [a, b];
    }

    it('the focus of a foreign city: Build in one world, Grow in the other', () => {
      const { state, thebes } = shoreScene();
      // Thebes has room to grow and land on which the two ways differ: a mined hill east of the city, out of p1's sight.
      const base = arrange(state, (draft) => {
        const hill = at(draft.map, 13, 3);
        draft.map.tiles[hill].feature = 'hills';
        draft.map.tiles[hill].improvement = 'mine';
        draft.cities[thebes.id].buildQueue = queueOf('warrior', 'warrior', 'warrior');
      });
      expect(buildPlayerView(base, 'p1').cities.some((city) => city.id === thebes.id)).toBe(false); // p1 has never seen the city
      let worldA = hiddenAction(base, 'p2', { type: 'setCityFocus', cityId: thebes.id, focus: 'build' });
      let worldB = base;
      sameViewForP1(worldA, worldB, 'Thebes set to Build');
      expect(buildPlayerView(worldA, 'p2').cities.find((city) => city.id === thebes.id)?.own?.worked).not.toEqual(
        buildPlayerView(worldB, 'p2').cities.find((city) => city.id === thebes.id)?.own?.worked,
      );

      // Eight turns. p1 probes with the stolen id: for the owner, 'build' would change something in one
      // world and nothing in the other, and 'grow' the other way round. p1 is told the same both times.
      const probes: Action[] = [
        { type: 'setCityFocus', cityId: thebes.id, focus: 'build' },
        { type: 'setCityFocus', cityId: thebes.id, focus: 'grow' },
        { type: 'setCityFocus', cityId: thebes.id, focus: 'fast' } as unknown as Action,
        { type: 'setCityFocus', cityId: 'c2_madeup', focus: 'build' },
      ];
      for (const probe of probes.slice(0, 2)) expect(codeOf(send(worldA, 'p1', probe))).toBe('noSuchCity');
      for (let turn = 0; turn < 8; turn++) [worldA, worldB] = playOneTurn([worldA, worldB], probes, 'the focus');
      // The two cities went different ways meanwhile: one grew, the other built.
      expect(worldA.cities[thebes.id].focus).toBe('build');
      expect(worldB.cities[thebes.id].focus).toBe('grow');
      expect(worldA.cities[thebes.id].population).toBeLessThan(worldB.cities[thebes.id].population);
      expect(Object.keys(worldA.units).length).toBeGreaterThan(Object.keys(worldB.units).length);
      sameViewForP1(worldA, worldB, 'after eight turns');
    });

    it('whether a foreign Fishing Boat in sight has a job: started, advanced and stopped in one world, idle in the other', () => {
      const { state } = shoreScene();
      const map = state.map;
      const seenCoast = at(map, 10, 5);
      let boatId = '';
      const base = arrange(state, (draft) => {
        boatId = placeUnit(draft, 'p2', 'fishingBoat', seenCoast).id;
      });
      expect(inSight(base, 'p1')[seenCoast]).toBe(true);
      expect(buildPlayerView(base, 'p1').units.find((unit) => unit.id === boatId)).toEqual({ id: boatId, type: 'fishingBoat', owner: 'p2', tile: seenCoast, own: null });

      // Started in world A; then three turns of work, one short of the net.
      let worldA = hiddenAction(base, 'p2', { type: 'startJob', unitId: boatId, improvement: 'fishingNet' });
      let worldB = base;
      sameViewForP1(worldA, worldB, 'the job has begun');
      const probes: Action[] = [
        { type: 'startJob', unitId: boatId, improvement: 'fishingNet' },
        { type: 'stopJob', unitId: boatId },
        { type: 'moveUnit', unitId: boatId, path: [at(map, 9, 5)] },
      ];
      for (let turn = 1; turn < IMPROVEMENTS.fishingNet.turns; turn++) {
        [worldA, worldB] = playOneTurn([worldA, worldB], probes, 'the boat at work');
        expect(worldA.units[boatId].job).toEqual({ improvement: 'fishingNet', turnsWorked: turn });
        expect(worldB.units[boatId].job).toBeNull();
      }
      // Stopped: as private as starting.
      worldA = hiddenAction(worldA, 'p2', { type: 'stopJob', unitId: boatId });
      [worldA, worldB] = playOneTurn([worldA, worldB], probes, 'the boat has stopped');
      expect(worldA.map.tiles[seenCoast].improvement).toBeNull();
      sameViewForP1(worldA, worldB, 'after the job was stopped');

      // The comparison is not blind: a job that is FINISHED in sight puts a net on p1's map, and rightly so.
      const almost = tamper(base, (draft) => {
        draft.units[boatId].job = { improvement: 'fishingNet', turnsWorked: IMPROVEMENTS.fishingNet.turns - 1 };
      });
      const finished = endTurnForAll(almost);
      expect(buildPlayerView(finished.state, 'p1').tiles[seenCoast]).toMatchObject({ improvement: 'fishingNet', visible: true });
      // The news of it goes to the boat's owner alone.
      expect(filterEvents(finished.events, 'p1').map((event) => event.type)).toEqual(['turnStarted']);
      expect(filterEvents(finished.events, 'p2').map((event) => event.type)).toEqual(['improvementBuilt', 'turnStarted']);
    });

    it('a boat out of sight that is moved: it sails about in one world and lies still in the other', () => {
      const { state } = shoreScene();
      const map = state.map;
      const berth = at(map, 13, 7);
      let boatId = '';
      const base = arrange(state, (draft) => {
        boatId = placeUnit(draft, 'p2', 'scoutBoat', berth).id;
      });
      expect(buildPlayerView(base, 'p1').tiles[berth]).toBeNull();
      let worldA = base;
      let worldB = base;
      // A round trip over water p1 has never seen, four tiles a turn.
      const legs: [number, number][][] = [
        [[13, 8], [13, 9], [12, 9], [11, 9]],
        [[12, 9], [13, 9], [14, 9], [14, 8]],
        [[14, 7], [14, 6], [13, 6], [13, 7]],
        [[12, 7], [12, 8], [13, 8], [13, 7]],
      ];
      const probes: Action[] = [{ type: 'moveUnit', unitId: boatId, path: [at(map, 12, 7)] }];
      for (const leg of legs) {
        const path = leg.map(([x, y]) => at(map, x, y));
        for (const tile of path) expect(inSight(worldA, 'p1')[tile], `tile ${tile}`).toBe(false);
        worldA = hiddenAction(worldA, 'p2', { type: 'moveUnit', unitId: boatId, path });
        expect(worldA.units[boatId]).toMatchObject({ tile: path[path.length - 1], movesLeft: 0 });
        [worldA, worldB] = playOneTurn([worldA, worldB], probes, 'the hidden boat');
      }
      expect(worldB.units[boatId].tile).toBe(berth);
      // Its owner has explored the open sea with it meanwhile; p1 knows as much as before.
      const explored = (world: GameState, seat: number): number => world.players[seat].knowledge.explored.filter((flag) => flag === 1).length;
      expect(explored(worldA, 1)).toBeGreaterThan(explored(worldB, 1));
      expect(explored(worldA, 0)).toBe(explored(worldB, 0));
      sameViewForP1(worldA, worldB, 'after the voyage');
    });

    it('a net finished on a tile out of sight, in one world only', () => {
      const { state, thebes } = shoreScene();
      const map = state.map;
      const site = at(map, 12, 5);
      expect(state.map.tiles[site]).toMatchObject({ terrain: 'coast', cityId: thebes.id });
      expect(buildPlayerView(state, 'p1').tiles[site]).toBeNull();
      let boatId = '';
      let worldA = arrange(state, (draft) => {
        boatId = placeUnit(draft, 'p2', 'fishingBoat', site).id;
      });
      let worldB = state;
      sameViewForP1(worldA, worldB, 'a hidden Fishing Boat');

      worldA = hiddenAction(worldA, 'p2', { type: 'startJob', unitId: boatId, improvement: 'fishingNet' });
      const probes: Action[] = [
        { type: 'startJob', unitId: boatId, improvement: 'fishingNet' },
        { type: 'stopJob', unitId: boatId },
      ];
      for (let turn = 0; turn < IMPROVEMENTS.fishingNet.turns; turn++) [worldA, worldB] = playOneTurn([worldA, worldB], probes, 'the hidden net');

      // The net stands in world A, its owner was told and sees it, and p1 knows nothing of it.
      expect(worldA.map.tiles[site].improvement).toBe('fishingNet');
      expect(worldB.map.tiles[site].improvement).toBeNull();
      expect(worldA.units[boatId].job).toBeNull();
      expect(buildPlayerView(worldA, 'p2').tiles[site]).toMatchObject({ improvement: 'fishingNet', visible: true });
      expect(JSON.stringify(buildPlayerView(worldA, 'p1'))).not.toContain('fishingNet');
      sameViewForP1(worldA, worldB, 'the net is finished');
      // Thebes gathers from it in world A (its citizen fishes): more food there, and still nothing for p1 to see.
      expect(buildPlayerView(worldA, 'p2').cities.find((city) => city.id === thebes.id)?.own?.worked).toEqual([site]);
      [worldA, worldB] = playOneTurn([worldA, worldB], probes, 'the hidden net, gathered from');
      expect(worldA.cities[thebes.id].foodStored).toBeGreaterThan(worldB.cities[thebes.id].foodStored);
    });

    it('a foreign queue that holds a Scout Boat in one world and a Warrior in the other', () => {
      const { state, thebes } = shoreScene();
      const queued = (unitType: 'scoutBoat' | 'warrior'): GameState =>
        tamper(state, (draft) => {
          draft.cities[thebes.id].buildQueue = queueOf(unitType, unitType);
          draft.cities[thebes.id].productionStored = 2 * UNITS.scoutBoat.cost;
        });
      let worldA = queued('scoutBoat');
      let worldB = queued('warrior');
      expect(checkInvariants(worldA)).toEqual([]);
      expect(checkInvariants(worldB)).toEqual([]);
      sameViewForP1(worldA, worldB, 'the two queues');

      // p1 probes the foreign queue with both lists: one of them is "the queue the city has" in each world.
      const probes: Action[] = [
        { type: 'setBuildQueue', cityId: thebes.id, queue: queueOf('scoutBoat', 'scoutBoat') },
        { type: 'setBuildQueue', cityId: thebes.id, queue: queueOf('warrior', 'warrior') },
        { type: 'setBuildQueue', cityId: thebes.id, queue: queueOf('scoutBoat') },
      ];
      for (let turn = 0; turn < 3; turn++) {
        [worldA, worldB] = playOneTurn([worldA, worldB], probes, 'the hidden queue');
        // What the cities completed stands out of p1's sight in both worlds: boats on Thebes' water, Warriors on its land.
        for (const world of [worldA, worldB]) {
          for (const unit of Object.values(world.units)) {
            if (unit.owner === 'p2') expect(inSight(world, 'p1')[unit.tile], `${unit.type} on tile ${unit.tile}`).toBe(false);
          }
        }
      }
      const typesOf = (world: GameState): string[] => Object.values(world.units).filter((unit) => unit.owner === 'p2').map((unit) => unit.type).sort();
      expect(typesOf(worldA)).toEqual(['scoutBoat', 'scoutBoat', 'warrior']);
      expect(typesOf(worldB)).toEqual(['warrior', 'warrior', 'warrior']);
      sameViewForP1(worldA, worldB, 'after the boats and the Warriors were built');
    });
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
        draft.cities.c2_wall = {
          id: 'c2_wall', owner: 'p2', name: 'Wall', tile: blockerTile, population: 1, foodStored: 0, buildQueue: [], productionStored: 0,
          focus: 'grow',
        };
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
        city.buildQueue = queueOf('scout');
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
