import { describe, expect, it } from 'vitest';
import {
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  UNITS,
  buildPlayerView,
  cityEconomy,
  cloneJson,
  improvementFits,
  resolveTurn,
  startJobError,
  tileYields,
} from '../src/index';
import type { Action, City, GameState, ImprovementId, RuleErrorCode, TileIndex, UnitJob } from '../src/index';
import {
  act,
  actWithEvents,
  arrange,
  at,
  cityOn,
  codeOf,
  deepFreeze,
  endTurnForAll,
  foundCityAt,
  improve,
  newGame,
  placeUnit,
  queueOf,
  refusal,
  send,
  tamper,
  unitOf,
  workerOn,
} from './rulesKit';

/**
 * Tests for Workers at work: the startJob and stopJob actions
 * (rules/unitJob.ts, rules/improvements.ts), what a job does to moving and
 * founding, and the step of turn resolution that does the work (runJobs in
 * rules/turn.ts). Every action goes through the real applyAction.
 */

/**
 * Two cities with every kind of ground a Worker can meet between them.
 * Rome (p1) stands at (3,3), Thebes (p2) at (9,3); column 6 is nobody's.
 * On Rome's land:
 *   (2,2) hills on grassland   (3,2) hills on plains   (4,2) hills on desert   (5,2) forest
 *   (2,3) grassland            (4,3) grassland         (5,3) forest on plains
 *   (2,4) plains               (3,4) desert
 */
const JOBS_LAND: readonly string[] = [
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ' ~ g g p d g g g g g g g ~',
  '~ g h H D f g g h g g g ~',
  ' ~ g g g g F g g g g g g ~',
  '~ g p d g g g g g g g g ~',
  ' ~ g g g g g g g g g g g ~',
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
];

interface JobsGame {
  state: GameState;
  rome: City;
  thebes: City;
}

/** Both players have founded their capital; their Warriors stand in the cities. */
function jobsGame(): JobsGame {
  const start = newGame(JOBS_LAND, [[3, 3], [9, 3]]);
  let state = act(start, 'p1', { type: 'foundCity', unitId: unitOf(start, 'p1', 'settler').id });
  state = act(state, 'p2', { type: 'foundCity', unitId: unitOf(state, 'p2', 'settler').id });
  return { state, rome: cityOn(state, at(state.map, 3, 3)), thebes: cityOn(state, at(state.map, 9, 3)) };
}

/** The game with a Worker of p1 on the tile (x, y), and what `startJob` for it would be. */
function withWorkerAt(x: number, y: number): { state: GameState; workerId: string; tile: TileIndex; rome: City; thebes: City } {
  const game = jobsGame();
  const tile = at(game.state.map, x, y);
  const placed = workerOn(game.state, 'p1', tile);
  return { ...game, state: placed.state, workerId: placed.workerId, tile };
}

function start(unitId: string, improvement: ImprovementId): Action {
  return { type: 'startJob', unitId, improvement };
}

/** A copy of the state in which the unit has this job (null: none), set by hand. */
function withJob(state: GameState, unitId: string, job: UnitJob | null): GameState {
  return arrange(state, (draft) => {
    draft.units[unitId].job = job;
  });
}

describe('applyAction: startJob', () => {
  it('sets the unit to work: job { improvement, turnsWorked: 0 }, moves untouched, tile untouched, no event', () => {
    const { state, workerId, tile, rome } = withWorkerAt(2, 3);
    expect(state.map.tiles[tile]).toMatchObject({ terrain: 'grassland', feature: null, improvement: null, cityId: rome.id });
    const tired = arrange(state, (draft) => {
      draft.units[workerId].movesLeft = 1;
    });

    const step = actWithEvents(tired, 'p1', start(workerId, 'farm'));
    expect(step.changed).toBe(true);
    expect(step.events).toEqual([]);
    expect(step.state.units[workerId]).toEqual({
      id: workerId, type: 'worker', owner: 'p1', tile, movesLeft: 1, job: { improvement: 'farm', turnsWorked: 0 },
    });
    // The tile changes only when the job is finished.
    expect(step.state.map.tiles[tile]).toEqual(tired.map.tiles[tile]);
    // Nothing else in the game moved.
    expect({ ...step.state, units: null }).toEqual({ ...tired, units: null });
    for (const unit of Object.values(tired.units)) {
      if (unit.id !== workerId) expect(step.state.units[unit.id]).toEqual(unit);
    }
    // A mine on hills works the same way.
    const onHills = withWorkerAt(2, 2);
    expect(act(onHills.state, 'p1', start(onHills.workerId, 'mine')).units[onHills.workerId].job).toEqual({ improvement: 'mine', turnsWorked: 0 });
  });

  it('rejects a missing unit and another player\'s unit with noSuchUnit', () => {
    const { state, workerId } = withWorkerAt(2, 3);
    // p2 may not order p1's Worker about, whatever the improvement is called.
    expect(refusal(state, 'p2', start(workerId, 'farm'))).toBe('noSuchUnit');
    expect(refusal(state, 'p2', start(workerId, 'dragon' as ImprovementId))).toBe('noSuchUnit');
    for (const unitId of ['u1_nobody', 'u2_nobody', 'constructor', '__proto__', 'toString', '']) {
      expect(refusal(state, 'p1', start(unitId, 'farm')), unitId).toBe('noSuchUnit');
    }
    // A city id is not a unit id.
    expect(refusal(state, 'p1', start(Object.keys(state.cities)[0], 'farm'))).toBe('noSuchUnit');
  });

  it('rejects a unit that cannot improve, an unknown improvement and inherited names like "constructor" with cannotImprove', () => {
    const game = withWorkerAt(2, 3);
    // A Warrior, a Scout and a Settler on a tile where a Worker could build a farm.
    const site = at(game.state.map, 4, 3);
    for (const type of ['warrior', 'scout', 'settler'] as const) {
      let unitId = '';
      const state = arrange(game.state, (draft) => {
        unitId = placeUnit(draft, 'p1', type, site).id;
      });
      expect(UNITS[type].canImprove).toBe(false);
      for (const improvement of IMPROVEMENT_IDS) expect(refusal(state, 'p1', start(unitId, improvement)), type).toBe('cannotImprove');
    }

    // A Worker, and things that are no improvements.
    for (const name of ['dragon', 'constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'Farm', 'farm ', 'road']) {
      expect(refusal(game.state, 'p1', start(game.workerId, name as ImprovementId)), `'${name}'`).toBe('cannotImprove');
    }
    // The real names are fine there.
    expect(refusal(game.state, 'p1', start(game.workerId, 'farm'))).toBeNull();
  });

  it('rejects land that is not the player\'s own, nobody\'s and another player\'s alike (notYourLand)', () => {
    const game = jobsGame();
    const map = game.state.map;
    const nobodys = at(map, 6, 3);
    const theirs = at(map, 8, 3);
    const theirHills = at(map, 8, 2);
    expect(game.state.map.tiles[nobodys].cityId).toBeNull();
    expect(game.state.map.tiles[theirs].cityId).toBe(game.thebes.id);
    expect(game.state.map.tiles[theirHills]).toMatchObject({ feature: 'hills', cityId: game.thebes.id });

    for (const [what, tile, improvement] of [
      ['nobody\'s grassland', nobodys, 'farm'],
      ['Theban grassland', theirs, 'farm'],
      ['Theban hills', theirHills, 'mine'],
    ] as const) {
      const placed = workerOn(game.state, 'p1', tile);
      // The ground would suit: it is the owner that is wrong.
      expect(improvementFits(improvement, placed.state.map.tiles[tile]), what).toBe(true);
      expect(refusal(placed.state, 'p1', start(placed.workerId, improvement)), what).toBe('notYourLand');
    }
    // The owner of that land can build there.
    const theirWorker = workerOn(game.state, 'p2', theirs);
    expect(refusal(theirWorker.state, 'p2', start(theirWorker.workerId, 'farm'))).toBeNull();
  });

  it('rejects the tile of a city (cityOnTile)', () => {
    const game = jobsGame();
    const inRome = workerOn(game.state, 'p1', game.rome.tile);
    for (const improvement of IMPROVEMENT_IDS) {
      expect(refusal(inRome.state, 'p1', start(inRome.workerId, improvement)), improvement).toBe('cityOnTile');
    }
    // A city on hills is no place for a mine either. (The capital of this game is moved onto hills by hand.)
    const hillTown = arrange(inRome.state, (draft) => {
      draft.map.tiles[game.rome.tile].feature = 'hills';
    });
    expect(improvementFits('mine', hillTown.map.tiles[game.rome.tile])).toBe(true);
    expect(refusal(hillTown, 'p1', start(inRome.workerId, 'mine'))).toBe('cityOnTile');
  });

  it('rejects ground that does not fit: a farm on hills and on forest, a mine on open ground (badImprovementTile); accepts a farm on grassland, plains and desert and a mine on hills of each', () => {
    // Every kind of ground on Rome's land, and what may be built there.
    const grounds: [string, number, number, ImprovementId | null][] = [
      ['grassland', 2, 3, 'farm'],
      ['plains', 2, 4, 'farm'],
      ['desert', 3, 4, 'farm'],
      ['hills on grassland', 2, 2, 'mine'],
      ['hills on plains', 3, 2, 'mine'],
      ['hills on desert', 4, 2, 'mine'],
      ['forest on grassland', 5, 2, null],
      ['forest on plains', 5, 3, null],
    ];
    for (const [what, x, y, fitting] of grounds) {
      const { state, workerId, tile, rome } = withWorkerAt(x, y);
      expect(state.map.tiles[tile].cityId, what).toBe(rome.id);
      for (const improvement of IMPROVEMENT_IDS) {
        const expected: RuleErrorCode | null = improvement === fitting ? null : 'badImprovementTile';
        expect(refusal(state, 'p1', start(workerId, improvement)), `${improvement} on ${what}`).toBe(expected);
      }
    }
    // The drawing is what the comment says it is.
    const map = jobsGame().state.map;
    expect(map.tiles[at(map, 4, 2)]).toMatchObject({ terrain: 'desert', feature: 'hills' });
    expect(map.tiles[at(map, 5, 3)]).toMatchObject({ terrain: 'plains', feature: 'forest' });
    expect(map.tiles[at(map, 3, 4)]).toMatchObject({ terrain: 'desert', feature: null });
  });

  it('rejects the improvement the tile already has (alreadyImproved)', () => {
    const farmed = withWorkerAt(2, 3);
    const onFarm = arrange(farmed.state, (draft) => improve(draft, farmed.tile, 'farm'));
    expect(refusal(onFarm, 'p1', start(farmed.workerId, 'farm'))).toBe('alreadyImproved');
    // The other improvement does not fit that ground: that is said instead.
    expect(refusal(onFarm, 'p1', start(farmed.workerId, 'mine'))).toBe('badImprovementTile');

    const mined = withWorkerAt(2, 2);
    const onMine = arrange(mined.state, (draft) => improve(draft, mined.tile, 'mine'));
    expect(refusal(onMine, 'p1', start(mined.workerId, 'mine'))).toBe('alreadyImproved');
    expect(refusal(onMine, 'p1', start(mined.workerId, 'farm'))).toBe('badImprovementTile');
  });

  it('judges in the documented order', () => {
    const game = jobsGame();
    const map = game.state.map;
    const theirHills = at(map, 8, 2);

    // 1. The unit and the name come first: a Warrior on foreign land is told
    //    cannotImprove, and so is a Worker there who asks for a dragon.
    let warriorId = '';
    const abroad = arrange(game.state, (draft) => {
      warriorId = placeUnit(draft, 'p1', 'warrior', theirHills).id;
    });
    expect(refusal(abroad, 'p1', start(warriorId, 'mine'))).toBe('cannotImprove');
    const workerAbroad = workerOn(game.state, 'p1', theirHills);
    expect(refusal(workerAbroad.state, 'p1', start(workerAbroad.workerId, 'dragon' as ImprovementId))).toBe('cannotImprove');

    // 2. Then the job: a Worker at work, asked for the other job on land that
    //    does not suit it, is told unitBusy, also on land that is not its owner's.
    const busy = withWorkerAt(2, 3);
    const working = act(busy.state, 'p1', start(busy.workerId, 'farm'));
    expect(refusal(working, 'p1', start(busy.workerId, 'mine'))).toBe('unitBusy');
    const busyAbroad = withJob(workerAbroad.state, workerAbroad.workerId, { improvement: 'mine', turnsWorked: 0 });
    expect(refusal(busyAbroad, 'p1', start(workerAbroad.workerId, 'farm'))).toBe('unitBusy');
    // An unknown name is answered before that: cannotImprove, at work or not.
    expect(refusal(working, 'p1', start(busy.workerId, 'dragon' as ImprovementId))).toBe('cannotImprove');

    // 3. Then whose land: a Worker on foreign hills asking for a farm (which hills never take) is told notYourLand.
    expect(refusal(workerAbroad.state, 'p1', start(workerAbroad.workerId, 'farm'))).toBe('notYourLand');

    // 4. Then the city: a Worker in its own city, asking for a mine on open ground, is told cityOnTile.
    const inRome = workerOn(game.state, 'p1', game.rome.tile);
    expect(improvementFits('mine', inRome.state.map.tiles[game.rome.tile])).toBe(false);
    expect(refusal(inRome.state, 'p1', start(inRome.workerId, 'mine'))).toBe('cityOnTile');
    // Somebody else's city never gets that far: a foreign unit cannot stand in it at all.

    // 5. Then the ground, and last what stands there: a mine on a farmed meadow is badImprovementTile, not alreadyImproved.
    const onFarm = arrange(busy.state, (draft) => improve(draft, busy.tile, 'farm'));
    expect(refusal(onFarm, 'p1', start(busy.workerId, 'mine'))).toBe('badImprovementTile');
    expect(refusal(onFarm, 'p1', start(busy.workerId, 'farm'))).toBe('alreadyImproved');

    // And before all of them, whose unit it is.
    expect(refusal(working, 'p2', start(busy.workerId, 'dragon' as ImprovementId))).toBe('noSuchUnit');
  });

  it('the same job again is accepted and changes nothing; the state object comes back', () => {
    const { state, workerId } = withWorkerAt(2, 3);
    const working = act(state, 'p1', start(workerId, 'farm'));
    // Two turns into the job, the count is not set back by asking again.
    const later = endTurnForAll(endTurnForAll(working).state).state;
    expect(later.units[workerId].job).toEqual({ improvement: 'farm', turnsWorked: 2 });

    for (const situation of [working, later]) {
      const again = send(situation, 'p1', start(workerId, 'farm'));
      expect(again.ok).toBe(true);
      if (!again.ok) continue;
      expect(again.changed).toBe(false);
      expect(again.state).toBe(situation);
      expect(again.events).toEqual([]);
    }
  });

  it('needs no moves: a Worker with 0 moves left starts work', () => {
    // Walking onto hills uses all of a Worker's moves; the job starts all the same.
    const game = jobsGame();
    const map = game.state.map;
    const next = workerOn(game.state, 'p1', at(map, 2, 3));
    const hills = at(map, 2, 2);
    const arrived = act(next.state, 'p1', { type: 'moveUnit', unitId: next.workerId, path: [hills] });
    expect(arrived.units[next.workerId]).toMatchObject({ tile: hills, movesLeft: 0 });

    const working = act(arrived, 'p1', start(next.workerId, 'mine'));
    expect(working.units[next.workerId]).toMatchObject({ tile: hills, movesLeft: 0, job: { improvement: 'mine', turnsWorked: 0 } });
  });

  it('is refused in an old turn (staleTurn) and after End Turn (turnAlreadyEnded); a malformed one is badAction', () => {
    const { state, workerId } = withWorkerAt(2, 3);
    const order = start(workerId, 'farm');

    expect(codeOf(send(state, 'p1', order, state.turn - 1))).toBe('staleTurn');
    expect(codeOf(send(state, 'p1', order, state.turn + 1))).toBe('staleTurn');
    const ended = act(state, 'p1', { type: 'endTurn' });
    expect(refusal(ended, 'p1', order)).toBe('turnAlreadyEnded');
    expect(refusal(ended, 'p1', { type: 'stopJob', unitId: workerId })).toBe('turnAlreadyEnded');
    expect(refusal(act(ended, 'p1', { type: 'cancelEndTurn' }), 'p1', order)).toBeNull();

    const malformed: unknown[] = [
      { type: 'startJob', unitId: workerId },
      { type: 'startJob', unitId: workerId, improvement: 5 },
      { type: 'startJob', unitId: workerId, improvement: null },
      { type: 'startJob', unitId: workerId, improvement: ['farm'] },
      { type: 'startJob', unitId: workerId, improvement: { id: 'farm' } },
      { type: 'startJob', unitId: 7, improvement: 'farm' },
      { type: 'startJob', improvement: 'farm' },
      { type: 'stopJob' },
      { type: 'stopJob', unitId: 7 },
      { type: 'stopJob', unitId: [workerId] },
    ];
    for (const action of malformed) expect(refusal(state, 'p1', action as Action), JSON.stringify(action)).toBe('badAction');
    // The order of the general checks: a stranger first, then the shape, then the turn.
    expect(codeOf(send(state, 'p9', order, state.turn - 1))).toBe('badAction');
    expect(codeOf(send(state, 'p1', malformed[1] as Action, state.turn - 1))).toBe('badAction');
  });

  it('stores nothing but the improvement and the count, whatever else the action carried', () => {
    const { state, workerId } = withWorkerAt(2, 3);
    const note = 'y'.repeat(50);
    const padded = {
      type: 'startJob',
      unitId: workerId,
      improvement: 'farm',
      turnsWorked: 3,
      turnsLeft: 1,
      note,
      job: { improvement: 'mine', turnsWorked: 99 },
    } as unknown as Action;

    const working = act(state, 'p1', padded);
    const job = working.units[workerId].job;
    expect(job).toEqual({ improvement: 'farm', turnsWorked: 0 });
    expect(Object.keys(job ?? {}).sort()).toEqual(['improvement', 'turnsWorked']);
    expect(Object.keys(working.units[workerId]).sort()).toEqual(['id', 'job', 'movesLeft', 'owner', 'tile', 'type']);
    expect(JSON.stringify(working)).not.toContain(note);
    expect(JSON.stringify(buildPlayerView(working, 'p1'))).not.toContain(note);
    // The job is a fresh object every time: two Workers started with one action object share nothing.
    const second = workerOn(working, 'p1', at(state.map, 4, 3));
    const both = act(second.state, 'p1', { ...padded, unitId: second.workerId } as Action);
    expect(both.units[second.workerId].job).toEqual({ improvement: 'farm', turnsWorked: 0 });
    expect(both.units[second.workerId].job).not.toBe(both.units[workerId].job);
  });

  it('startJobError gives the same answer as the action, without changing anything; the one exception is the job the unit is already doing (the action: an accepted no-op; startJobError: unitBusy)', () => {
    const game = jobsGame();
    const map = game.state.map;
    // Units of p1 in every kind of spot: Workers idle and at work, and units that cannot build.
    const scene = arrange(game.state, (draft) => {
      for (const [x, y] of [[2, 3], [2, 4], [3, 4], [2, 2], [5, 2], [6, 3], [8, 3], [8, 2]]) placeUnit(draft, 'p1', 'worker', at(map, x, y));
      placeUnit(draft, 'p1', 'worker', at(map, 4, 3)).job = { improvement: 'farm', turnsWorked: 1 };
      placeUnit(draft, 'p1', 'worker', at(map, 3, 2)).job = { improvement: 'mine', turnsWorked: 0 };
      improve(draft, at(map, 4, 4), 'farm');
      placeUnit(draft, 'p1', 'worker', at(map, 4, 4));
      placeUnit(draft, 'p1', 'worker', game.rome.tile);
      placeUnit(draft, 'p1', 'scout', at(map, 2, 5));
      placeUnit(draft, 'p1', 'settler', at(map, 1, 3), 0);
    });
    const frozen = deepFreeze(cloneJson(scene));
    const before = JSON.stringify(frozen);

    const seen = new Set<string>();
    let exceptions = 0;
    for (const unit of Object.values(frozen.units)) {
      if (unit.owner !== 'p1') continue;
      for (const improvement of [...IMPROVEMENT_IDS, 'dragon', 'constructor', '']) {
        const predicted = startJobError(frozen, unit, improvement);
        const result = send(frozen, 'p1', start(unit.id, improvement as ImprovementId));
        const what = `${unit.type} on tile ${unit.tile}, '${improvement}'`;
        if (unit.job !== null && unit.job.improvement === improvement) {
          // The one exception: the job it is already doing.
          expect(predicted, what).toBe('unitBusy');
          expect(result.ok && !result.changed, what).toBe(true);
          exceptions += 1;
        } else {
          expect(codeOf(result), what).toBe(predicted);
          if (result.ok) expect(result.changed, what).toBe(true);
        }
        seen.add(String(predicted));
      }
    }
    expect(JSON.stringify(frozen)).toBe(before);
    expect(exceptions).toBe(2);
    // The scene covers a job that can be started and every reason why not.
    expect([...seen].sort()).toEqual(
      ['alreadyImproved', 'badImprovementTile', 'cannotImprove', 'cityOnTile', 'notYourLand', 'null', 'unitBusy'],
    );
  });
});

describe('applyAction: stopJob', () => {
  it('ends the job: no job, the turns worked are gone, moves untouched, no event', () => {
    const { state, workerId, tile } = withWorkerAt(2, 3);
    const working = act(state, 'p1', start(workerId, 'farm'));
    const later = endTurnForAll(endTurnForAll(working).state).state;
    expect(later.units[workerId].job).toEqual({ improvement: 'farm', turnsWorked: 2 });
    const tired = arrange(later, (draft) => {
      draft.units[workerId].movesLeft = 1;
    });

    const step = actWithEvents(tired, 'p1', { type: 'stopJob', unitId: workerId });
    expect(step.changed).toBe(true);
    expect(step.events).toEqual([]);
    expect(step.state.units[workerId]).toEqual({ id: workerId, type: 'worker', owner: 'p1', tile, movesLeft: 1, job: null });
    expect(step.state.map.tiles[tile].improvement).toBeNull();
    expect({ ...step.state, units: null }).toEqual({ ...tired, units: null });

    // The two turns are gone: starting again starts from nothing.
    const again = act(step.state, 'p1', start(workerId, 'farm'));
    expect(again.units[workerId].job).toEqual({ improvement: 'farm', turnsWorked: 0 });
  });

  it('is accepted and changes nothing for a unit without a job', () => {
    const { state, workerId } = withWorkerAt(2, 3);
    const warrior = unitOf(state, 'p1', 'warrior');
    for (const unitId of [workerId, warrior.id]) {
      const result = send(state, 'p1', { type: 'stopJob', unitId });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.changed).toBe(false);
      expect(result.state).toBe(state);
      expect(result.events).toEqual([]);
    }
  });

  it('rejects a missing unit and another player\'s unit with noSuchUnit', () => {
    const { state, workerId } = withWorkerAt(2, 3);
    const working = act(state, 'p1', start(workerId, 'farm'));
    expect(refusal(working, 'p2', { type: 'stopJob', unitId: workerId })).toBe('noSuchUnit');
    expect(working.units[workerId].job).not.toBeNull();
    for (const unitId of ['u1_nobody', 'constructor', '__proto__', '']) {
      expect(refusal(working, 'p1', { type: 'stopJob', unitId }), unitId).toBe('noSuchUnit');
    }
  });
});

describe('a unit at work', () => {
  it('does not move: unitBusy, with moves left and without, whatever the first step is; a malformed path is still badPath', () => {
    const { state, workerId } = withWorkerAt(2, 3);
    const map = state.map;
    const scene = arrange(act(state, 'p1', start(workerId, 'farm')), (draft) => {
      placeUnit(draft, 'p2', 'scout', at(map, 2, 4)); // a foreign unit next door
      placeUnit(draft, 'p1', 'settler', at(map, 1, 3)); // an own civilian next door
    });
    expect(scene.units[workerId].movesLeft).toBe(UNITS.worker.moves);

    const steps: [string, TileIndex][] = [
      ['open land', at(map, 2, 2)],
      ['its own city', at(map, 3, 3)],
      ['a foreign unit (would be blocked)', at(map, 2, 4)],
      ['an own civilian (would be blocked)', at(map, 1, 3)],
    ];
    for (const moves of [UNITS.worker.moves, 1, 0]) {
      const situation = arrange(scene, (draft) => {
        draft.units[workerId].movesLeft = moves;
      });
      for (const [what, tile] of steps) {
        expect(refusal(situation, 'p1', { type: 'moveUnit', unitId: workerId, path: [tile] }), `${what}, ${moves} moves`).toBe('unitBusy');
      }
      // A longer path is no different.
      expect(refusal(situation, 'p1', { type: 'moveUnit', unitId: workerId, path: [at(map, 2, 2), at(map, 3, 2)] })).toBe('unitBusy');
      // The shape of the path is judged first, as for every unit.
      expect(refusal(situation, 'p1', { type: 'moveUnit', unitId: workerId, path: [] })).toBe('badPath');
      expect(refusal(situation, 'p1', { type: 'moveUnit', unitId: workerId, path: [at(map, 9, 5)] })).toBe('badPath');
      expect(refusal(situation, 'p1', { type: 'moveUnit', unitId: workerId, path: [-1] })).toBe('badPath');
      // Nothing changed: the job and the moves are as they were.
      expect(situation.units[workerId]).toMatchObject({ movesLeft: moves, job: { improvement: 'farm', turnsWorked: 0 } });
    }
    // Somebody else's order is refused as ever.
    expect(refusal(scene, 'p2', { type: 'moveUnit', unitId: workerId, path: [at(map, 2, 2)] })).toBe('noSuchUnit');
    // The owner's view offers the unit no way of leaving, and says why it stays.
    const own = buildPlayerView(scene, 'p1').units.find((unit) => unit.id === workerId)?.own;
    expect(own?.job).toMatchObject({ improvement: 'farm' });
    expect(own?.movesLeft).toBe(UNITS.worker.moves);
  });

  it('moves again right after stopJob, with the moves it has', () => {
    const { state, workerId, tile } = withWorkerAt(2, 3);
    const map = state.map;
    const working = arrange(act(state, 'p1', start(workerId, 'farm')), (draft) => {
      draft.units[workerId].movesLeft = 1;
    });
    const west = at(map, 1, 3);

    expect(refusal(working, 'p1', { type: 'moveUnit', unitId: workerId, path: [west] })).toBe('unitBusy');
    const stopped = act(working, 'p1', { type: 'stopJob', unitId: workerId });
    const moved = act(stopped, 'p1', { type: 'moveUnit', unitId: workerId, path: [west] });
    expect(moved.units[workerId]).toMatchObject({ tile: west, movesLeft: 0, job: null });
    // The one move it had is used up: the next step has to wait for the next turn.
    expect(refusal(moved, 'p1', { type: 'moveUnit', unitId: workerId, path: [tile] })).toBe('noMovesLeft');
    // A full-moves Worker that stops walks its two tiles.
    const fresh = act(act(state, 'p1', start(workerId, 'farm')), 'p1', { type: 'stopJob', unitId: workerId });
    const far = act(fresh, 'p1', { type: 'moveUnit', unitId: workerId, path: [west, at(map, 1, 4)] });
    expect(far.units[workerId]).toMatchObject({ tile: at(map, 1, 4), movesLeft: 0 });
  });

  it('keeps another civilian of its owner off the tile (blocked), so two Workers never share a job, and no Settler can found a city under it', () => {
    const { state, workerId, tile } = withWorkerAt(2, 3);
    const map = state.map;
    const next = at(map, 1, 3);
    let secondWorkerId = '';
    let settlerId = '';
    let scoutId = '';
    const scene = arrange(act(state, 'p1', start(workerId, 'farm')), (draft) => {
      secondWorkerId = placeUnit(draft, 'p1', 'worker', next).id;
      settlerId = placeUnit(draft, 'p1', 'settler', at(map, 2, 4)).id;
      scoutId = placeUnit(draft, 'p1', 'scout', at(map, 2, 2)).id;
    });

    // A tile holds one civilian: neither the second Worker nor the Settler can step onto the tile.
    expect(refusal(scene, 'p1', { type: 'moveUnit', unitId: secondWorkerId, path: [tile] })).toBe('blocked');
    expect(refusal(scene, 'p1', { type: 'moveUnit', unitId: settlerId, path: [tile] })).toBe('blocked');
    // So the second Worker can only work where it stands, on a job of its own...
    const both = act(scene, 'p1', start(secondWorkerId, 'farm'));
    expect(both.units[secondWorkerId]).toMatchObject({ tile: next, job: { improvement: 'farm', turnsWorked: 0 } });
    // ...and the Settler founds its city elsewhere or not at all (here: too close to Rome, wherever it stands).
    expect(scene.units[settlerId].tile).not.toBe(tile);
    // A soldier may share the tile, as with any civilian; the work goes on.
    const guarded = act(scene, 'p1', { type: 'moveUnit', unitId: scoutId, path: [tile] });
    expect(guarded.units[scoutId].tile).toBe(tile);
    expect(guarded.units[workerId].job).toEqual({ improvement: 'farm', turnsWorked: 0 });
    expect(endTurnForAll(guarded).state.units[workerId].job).toEqual({ improvement: 'farm', turnsWorked: 1 });
  });
});

describe('turn resolution: runJobs', () => {
  it('a job advances by one each turn and the improvement appears when IMPROVEMENTS[x].turns turns have resolved, not one earlier', () => {
    for (const [improvement, x, y] of [['farm', 2, 3], ['mine', 2, 2]] as const) {
      const { state, workerId, tile } = withWorkerAt(x, y);
      const turns = IMPROVEMENTS[improvement].turns;
      expect(turns).toBeGreaterThan(1);
      let current = act(state, 'p1', start(workerId, improvement));
      const startedIn = current.turn;

      for (let resolved = 1; resolved < turns; resolved++) {
        // What the owner is told before this turn resolves: 4, 3, 2 ... turns left.
        const job = buildPlayerView(current, 'p1').units.find((unit) => unit.id === workerId)?.own?.job;
        expect(job, `${improvement}, turn ${current.turn}`).toEqual({
          improvement, turnsWorked: resolved - 1, turnsTotal: turns, turnsLeft: turns - (resolved - 1),
        });

        const step = endTurnForAll(current);
        current = step.state;
        expect(current.units[workerId].job, `${improvement} after ${resolved} turns`).toEqual({ improvement, turnsWorked: resolved });
        expect(current.map.tiles[tile].improvement, `${improvement} after ${resolved} turns`).toBeNull();
        expect(step.events.map((addressed) => addressed.event.type)).toEqual(['turnStarted']);
      }
      // One turn to go, and the owner is told so.
      expect(buildPlayerView(current, 'p1').units.find((unit) => unit.id === workerId)?.own?.job?.turnsLeft).toBe(1);

      const done = endTurnForAll(current);
      expect(done.state.map.tiles[tile].improvement).toBe(improvement);
      expect(done.state.units[workerId].job).toBeNull();
      // Started during turn N with `turns` turns of work: finished when turn N + turns - 1 resolves.
      expect(done.state.turn).toBe(startedIn + turns);
    }
  });

  it('on completion the tile carries the improvement, the unit has no job, stands where it stood and has full moves; one improvementBuilt event, addressed to the owner only, that names the city on whose land the tile lies', () => {
    const { state, workerId, tile, rome } = withWorkerAt(2, 3);
    const almost = arrange(state, (draft) => {
      draft.units[workerId].job = { improvement: 'farm', turnsWorked: IMPROVEMENTS.farm.turns - 1 };
      draft.units[workerId].movesLeft = 0;
    });

    const done = endTurnForAll(almost);
    expect(done.state.map.tiles[tile]).toEqual({ ...almost.map.tiles[tile], improvement: 'farm' });
    expect(done.state.units[workerId]).toEqual({
      id: workerId, type: 'worker', owner: 'p1', tile, movesLeft: UNITS.worker.moves, job: null,
    });
    expect(done.events).toEqual([
      {
        to: ['p1'],
        event: { type: 'improvementBuilt', playerId: 'p1', unitId: workerId, improvement: 'farm', tile, cityName: rome.name },
      },
      { to: 'all', event: { type: 'turnStarted', turn: almost.turn + 1 } },
    ]);
    // No other tile and no other unit was touched.
    done.state.map.tiles.forEach((after, index) => {
      if (index !== tile) expect(after).toEqual(almost.map.tiles[index]);
    });
    // The Worker is free again: it can walk off, and the finished farm cannot be built twice.
    expect(refusal(done.state, 'p1', start(workerId, 'farm'))).toBe('alreadyImproved');
    expect(refusal(done.state, 'p1', { type: 'moveUnit', unitId: workerId, path: [at(state.map, 1, 3)] })).toBeNull();

    // The city named is the one whose land the tile is: here the player's second city.
    const map = state.map;
    const withOstia = foundCityAt(state, 'p1', at(map, 6, 5));
    const ostia = cityOn(withOstia, at(map, 6, 5));
    const site = at(map, 6, 4);
    expect(withOstia.map.tiles[site].cityId).toBe(ostia.id);
    const second = workerOn(withOstia, 'p1', site);
    const finishing = withJob(second.state, second.workerId, { improvement: 'farm', turnsWorked: IMPROVEMENTS.farm.turns - 1 });
    const events = endTurnForAll(finishing).events.filter((addressed) => addressed.event.type === 'improvementBuilt');
    expect(events).toEqual([
      { to: ['p1'], event: { type: 'improvementBuilt', playerId: 'p1', unitId: second.workerId, improvement: 'farm', tile: site, cityName: ostia.name } },
    ]);
    expect(ostia.name).not.toBe(rome.name);
  });

  it('the city\'s economy of the resolving turn does not count an improvement finished in that resolution; the next turn\'s does', () => {
    const game = jobsGame();
    const { rome } = game;
    // The tile Rome's one citizen works, which is open grassland: the farm is built right under the citizen.
    const [site] = cityEconomy(game.state, rome).worked;
    expect(game.state.map.tiles[site]).toMatchObject({ terrain: 'grassland', feature: null });
    const placed = workerOn(game.state, 'p1', site);
    const almost = withJob(placed.state, placed.workerId, { improvement: 'farm', turnsWorked: IMPROVEMENTS.farm.turns - 1 });
    const before = cityEconomy(almost, almost.cities[rome.id]);

    // The turn in which the farm is finished: the city gets what its panel showed, the yields without the farm.
    const shown = buildPlayerView(almost, 'p1').cities.find((city) => city.id === rome.id)?.own;
    expect(shown?.foodPerTurn).toBe(before.foodSurplus);
    const finished = endTurnForAll(almost).state;
    expect(finished.map.tiles[site].improvement).toBe('farm');
    expect(finished.cities[rome.id].foodStored).toBe(before.foodSurplus);

    // From then on the farm counts.
    const after = cityEconomy(finished, finished.cities[rome.id]);
    expect(after.worked).toEqual([site]);
    expect(after.food).toBe(before.food + IMPROVEMENTS.farm.yields.food);
    const next = endTurnForAll(finished).state;
    expect(next.cities[rome.id].foodStored).toBe(before.foodSurplus + after.foodSurplus);
    expect(after.foodSurplus).toBe(before.foodSurplus + 1);
  });

  it('a citizen takes a new farm from the next turn on', () => {
    const game = jobsGame();
    const { rome } = game;
    const map = game.state.map;
    const before = cityEconomy(game.state, rome);
    // A farm on a grassland tile the citizen does NOT work (all open grassland is alike; the lowest index is worked).
    const site = at(map, 4, 3);
    expect(before.worked).not.toContain(site);
    expect(tileYields(map.tiles[site])).toEqual(tileYields(map.tiles[before.worked[0]]));

    const placed = workerOn(game.state, 'p1', site);
    let current = act(placed.state, 'p1', start(placed.workerId, 'farm'));
    for (let turn = 1; turn < IMPROVEMENTS.farm.turns; turn++) {
      current = endTurnForAll(current).state;
      // While the work goes on, nothing changes for the city.
      expect(cityEconomy(current, current.cities[rome.id]).worked).toEqual(before.worked);
    }
    current = endTurnForAll(current).state;
    const after = cityEconomy(current, current.cities[rome.id]);
    expect(after.worked).toEqual([site]);
    expect(after.food).toBe(before.food + 1);
    expect(after.production).toBe(before.production);
    // The owner's panel and map say so in the same view.
    const view = buildPlayerView(current, 'p1');
    expect(view.tiles[site]).toMatchObject({ improvement: 'farm', visible: true });
    expect(view.cities.find((city) => city.id === rome.id)?.own?.worked).toEqual([site]);
  });

  it('a job whose site has gone bad ends without an improvement and without an event: the tile is no longer the player\'s land; a city stands on it; the tile already has the improvement', () => {
    const { state, workerId, tile, thebes } = withWorkerAt(2, 3);
    const working = withJob(state, workerId, { improvement: 'farm', turnsWorked: IMPROVEMENTS.farm.turns - 1 });
    // Left alone, this turn would finish the farm.
    expect(resolveTurn(working).state.map.tiles[tile].improvement).toBe('farm');

    const gone: [string, (draft: GameState) => void, ImprovementId | null][] = [
      ['the tile is nobody\'s land', (draft) => { draft.map.tiles[tile].cityId = null; }, null],
      ['the tile is another player\'s land', (draft) => { draft.map.tiles[tile].cityId = thebes.id; }, null],
      ['a city stands on the tile', (draft) => {
        draft.cities.c1_under = { id: 'c1_under', owner: 'p1', name: 'Under', tile, population: 1, foodStored: 0, buildQueue: [], productionStored: 0 };
        draft.map.tiles[tile].cityId = 'c1_under';
      }, null],
      ['the tile already has the improvement', (draft) => { draft.map.tiles[tile].improvement = 'farm'; }, 'farm'],
    ];
    for (const [what, change, improvementAfter] of gone) {
      // None of these can be reached by playing today: the state is changed by hand, and the turn resolved directly.
      const bad = tamper(working, change);
      const resolved = resolveTurn(deepFreeze(bad));
      expect(resolved.state.units[workerId], what).toMatchObject({ tile, job: null, movesLeft: UNITS.worker.moves });
      expect(resolved.state.map.tiles[tile].improvement, what).toBe(improvementAfter);
      expect(resolved.events.some((addressed) => addressed.event.type === 'improvementBuilt'), what).toBe(false);
      expect(resolved.events[resolved.events.length - 1].event.type, what).toBe('turnStarted');
    }

    // The same job in its first turn is dropped just the same: the site is judged before every turn of work.
    const fresh = withJob(state, workerId, { improvement: 'farm', turnsWorked: 0 });
    const lost = resolveTurn(tamper(fresh, (draft) => { draft.map.tiles[tile].cityId = null; }));
    expect(lost.state.units[workerId].job).toBeNull();
  });

  it('jobs of two players resolve independently; the events come after the cities\' events, in seat order, before turnStarted', () => {
    const game = jobsGame();
    const map = game.state.map;
    const mine = workerOn(game.state, 'p1', at(map, 2, 3));
    const second = workerOn(mine.state, 'p1', at(map, 2, 2));
    const theirs = workerOn(second.state, 'p2', at(map, 8, 3));
    const ready = arrange(theirs.state, (draft) => {
      // p2's Worker was created last and finishes; p1 has one that finishes and one in mid-job.
      draft.units[theirs.workerId].job = { improvement: 'farm', turnsWorked: IMPROVEMENTS.farm.turns - 1 };
      draft.units[mine.workerId].job = { improvement: 'farm', turnsWorked: IMPROVEMENTS.farm.turns - 1 };
      draft.units[second.workerId].job = { improvement: 'mine', turnsWorked: 1 };
      // Both cities complete a unit this turn, and both grow.
      for (const city of Object.values(draft.cities)) {
        city.buildQueue = queueOf('scout');
        city.productionStored = UNITS.scout.cost;
        city.foodStored = 100;
      }
    });

    const resolved = endTurnForAll(ready);
    expect(resolved.events.map((addressed) => [addressed.to, addressed.event.type])).toEqual([
      [['p1'], 'cityGrew'],
      [['p1'], 'unitBuilt'],
      [['p2'], 'cityGrew'],
      [['p2'], 'unitBuilt'],
      [['p1'], 'improvementBuilt'],
      [['p2'], 'improvementBuilt'],
      ['all', 'turnStarted'],
    ]);
    expect(resolved.events[4].event).toMatchObject({ playerId: 'p1', unitId: mine.workerId, cityName: game.rome.name });
    expect(resolved.events[5].event).toMatchObject({ playerId: 'p2', unitId: theirs.workerId, cityName: game.thebes.name });
    // Each job went its own way.
    expect(resolved.state.units[mine.workerId].job).toBeNull();
    expect(resolved.state.units[theirs.workerId].job).toBeNull();
    expect(resolved.state.units[second.workerId].job).toEqual({ improvement: 'mine', turnsWorked: 2 });
    expect(resolved.state.map.tiles[at(map, 2, 3)].improvement).toBe('farm');
    expect(resolved.state.map.tiles[at(map, 8, 3)].improvement).toBe('farm');
    expect(resolved.state.map.tiles[at(map, 2, 2)].improvement).toBeNull();

    // Within one player, units work in creation order.
    const twoOfMine = arrange(ready, (draft) => {
      draft.units[second.workerId].job = { improvement: 'mine', turnsWorked: IMPROVEMENTS.mine.turns - 1 };
    });
    const built = endTurnForAll(twoOfMine).events.filter((addressed) => addressed.event.type === 'improvementBuilt');
    expect(built.map((addressed) => ('unitId' in addressed.event ? addressed.event.unitId : ''))).toEqual([
      mine.workerId, second.workerId, theirs.workerId,
    ]);
  });

  it('a unit at work gets its moves back like every unit', () => {
    const { state, workerId } = withWorkerAt(2, 3);
    const spent = arrange(act(state, 'p1', start(workerId, 'farm')), (draft) => {
      draft.units[workerId].movesLeft = 0;
    });
    const next = endTurnForAll(spent).state;
    expect(next.units[workerId]).toMatchObject({ movesLeft: UNITS.worker.moves, job: { improvement: 'farm', turnsWorked: 1 } });
    // It has them and cannot use them.
    expect(refusal(next, 'p1', { type: 'moveUnit', unitId: workerId, path: [at(state.map, 1, 3)] })).toBe('unitBusy');
  });

  it('stopping in the last turn before completion leaves the tile as it was', () => {
    const { state, workerId, tile } = withWorkerAt(2, 3);
    let current = act(state, 'p1', start(workerId, 'farm'));
    for (let turn = 1; turn < IMPROVEMENTS.farm.turns; turn++) current = endTurnForAll(current).state;
    expect(current.units[workerId].job).toEqual({ improvement: 'farm', turnsWorked: IMPROVEMENTS.farm.turns - 1 });

    const stopped = act(current, 'p1', { type: 'stopJob', unitId: workerId });
    const resolved = endTurnForAll(stopped);
    expect(resolved.state.map.tiles[tile]).toEqual(state.map.tiles[tile]);
    expect(resolved.state.units[workerId].job).toBeNull();
    expect(resolved.events.map((addressed) => addressed.event.type)).toEqual(['turnStarted']);
    // Starting over means the whole job again.
    let again = act(resolved.state, 'p1', start(workerId, 'farm'));
    for (let turn = 1; turn < IMPROVEMENTS.farm.turns; turn++) again = endTurnForAll(again).state;
    expect(again.map.tiles[tile].improvement).toBeNull();
    expect(endTurnForAll(again).state.map.tiles[tile].improvement).toBe('farm');
  });

  it('resolveTurn does not modify its input', () => {
    // Jobs in every stage, and a queue with something to complete.
    const game = jobsGame();
    const map = game.state.map;
    const scene = arrange(game.state, (draft) => {
      placeUnit(draft, 'p1', 'worker', at(map, 2, 3)).job = { improvement: 'farm', turnsWorked: 0 };
      placeUnit(draft, 'p1', 'worker', at(map, 2, 2)).job = { improvement: 'mine', turnsWorked: IMPROVEMENTS.mine.turns - 1 };
      placeUnit(draft, 'p1', 'worker', at(map, 6, 3)).job = { improvement: 'farm', turnsWorked: 2 }; // nobody's land: dropped
      placeUnit(draft, 'p2', 'worker', at(map, 8, 3)).job = { improvement: 'farm', turnsWorked: 40 }; // long overdue
      draft.cities[game.rome.id].buildQueue = queueOf('worker', 'scout');
      draft.cities[game.rome.id].productionStored = UNITS.worker.cost;
    });
    const frozen = deepFreeze(cloneJson(scene));
    const before = JSON.stringify(frozen);

    const resolved = resolveTurn(frozen); // an edit of the frozen input would throw here
    expect(JSON.stringify(frozen)).toBe(before);
    expect(resolved.state).not.toBe(frozen);
    expect(resolved.events.map((addressed) => addressed.event.type)).toEqual([
      'unitBuilt', 'improvementBuilt', 'improvementBuilt', 'turnStarted',
    ]);
    const jobs = Object.values(resolved.state.units).filter((unit) => unit.type === 'worker').map((unit) => unit.job);
    expect(jobs).toEqual([{ improvement: 'farm', turnsWorked: 1 }, null, null, null, null]);
    // The same input gives the same output, every time, to the last character.
    expect(JSON.stringify(resolveTurn(frozen))).toBe(JSON.stringify(resolved));
  });
});

describe('founding a city', () => {
  it('the tile a city is founded on loses its improvement', () => {
    // Today's numbers never bring a Settler onto improved land that could
    // take a city (improved land lies within two tiles of a city, and a new
    // city needs four). So the farm is put on free land by hand.
    const game = jobsGame();
    const map = game.state.map;
    const site = at(map, 6, 5);
    const farmed = arrange(game.state, (draft) => improve(draft, site, 'farm'));
    expect(farmed.map.tiles[site]).toMatchObject({ improvement: 'farm', cityId: null });
    // A scout of p2 has the tile in sight and remembers the farm.
    const watched = arrange(farmed, (draft) => {
      placeUnit(draft, 'p2', 'scout', at(map, 7, 5));
    });
    expect(watched.players[1].knowledge.remembered[site]).toEqual({ owner: null, city: null, improvement: 'farm' });

    const founded = foundCityAt(watched, 'p1', site);
    const city = cityOn(founded, site);
    expect(founded.map.tiles[site]).toEqual({ ...farmed.map.tiles[site], improvement: null, cityId: city.id });
    // Everybody who sees the tile sees it without the farm from this moment on.
    expect(founded.players[1].knowledge.remembered[site]).toMatchObject({ owner: 'p1', improvement: null });
    expect(buildPlayerView(founded, 'p1').tiles[site]).toMatchObject({ improvement: null, owner: 'p1' });
    expect(buildPlayerView(founded, 'p2').tiles[site]).toMatchObject({ improvement: null, owner: 'p1' });
    // The centre gives what a centre gives, with no farm counted in.
    expect(cityEconomy(founded, city).food).toBe(2 + 2);

    // A farm next to the new city stays, and now belongs to it.
    const neighbor = at(map, 5, 5);
    const twoFarms = arrange(watched, (draft) => improve(draft, neighbor, 'farm'));
    const settled = foundCityAt(twoFarms, 'p1', site);
    expect(settled.map.tiles[neighbor]).toMatchObject({ improvement: 'farm', cityId: cityOn(settled, site).id });
    expect(settled.map.tiles[site].improvement).toBeNull();
  });
});
