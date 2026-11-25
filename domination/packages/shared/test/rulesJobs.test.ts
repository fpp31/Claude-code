import { describe, expect, it } from 'vitest';
import {
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  UNITS,
  UNIT_TYPE_IDS,
  buildPlayerView,
  checkInvariants,
  cityEconomy,
  cloneJson,
  improvementFits,
  jobOptions,
  resolveTurn,
  startJobError,
  tileYields,
  unitCanImprove,
} from '../src/index';
import type { Action, City, CityFocusId, GameState, ImprovementId, RuleErrorCode, TileIndex, UnitJob, UnitTypeId } from '../src/index';
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
 * Tests for units at work: the startJob and stopJob actions
 * (rules/unitJob.ts, rules/improvements.ts), what a job does to moving and
 * founding, and the step of turn resolution that does the work (runJobs in
 * rules/turn.ts). Every action goes through the real applyAction.
 *
 * The first blocks are about the Worker, who came first. The Fishing Boat
 * and its net (round 3) have the job of the Worker unchanged, so their
 * block at the end tests what is theirs alone: who builds what, where a
 * net fits, and what citizens make of a fished tile.
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
      expect(UNITS[type].improvements).toEqual([]);
      expect(unitCanImprove(type)).toBe(false);
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
    expect(UNITS.worker.improvements).toEqual(['farm', 'mine']);
    for (const improvement of UNITS.worker.improvements) {
      expect(refusal(inRome.state, 'p1', start(inRome.workerId, improvement)), improvement).toBe('cityOnTile');
    }
    // What a Worker does not build is refused for that, before the tile is looked at.
    expect(refusal(inRome.state, 'p1', start(inRome.workerId, 'fishingNet'))).toBe('cannotImprove');
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
      for (const improvement of UNITS.worker.improvements) {
        const expected: RuleErrorCode | null = improvement === fitting ? null : 'badImprovementTile';
        expect(refusal(state, 'p1', start(workerId, improvement)), `${improvement} on ${what}`).toBe(expected);
      }
      // A net is not a Worker's to build, on any ground.
      expect(refusal(state, 'p1', start(workerId, 'fishingNet')), `fishingNet on ${what}`).toBe('cannotImprove');
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
        draft.cities.c1_under = { id: 'c1_under', owner: 'p1', name: 'Under', tile, population: 1, foodStored: 0, buildQueue: [], productionStored: 0, focus: 'grow' };
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

describe('the Fishing Boat and its net (round 3)', () => {
  /**
   * Two cities on a shore. Rome (p1) stands at (3,3), Thebes (p2) at (9,3);
   * row 4 is coast, everything below is open ocean. Row 3 is an odd row, so
   * Rome touches the coast tiles (3,4) and (4,4).
   *   Rome's water:   coast (2,4) (3,4) (4,4) (5,4), ocean (2,5) (3,5) (4,5)
   *   nobody's coast: (6,4) and (7,4)
   *   Thebes's coast: (8,4) to (11,4)
   */
  const HARBOUR: readonly string[] = [
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ' ~ g g g g g g g g g g g ~',
    '~ g g g g g g g g g g g ~',
    ' ~ g g g g g g g g g g g ~',
    '~ , , , , , , , , , , , ~',
    ' ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ];

  /** Both capitals founded; their Warriors stand in the cities. */
  function harbourGame(): JobsGame {
    const begun = newGame(HARBOUR, [[3, 3], [9, 3]]);
    let state = act(begun, 'p1', { type: 'foundCity', unitId: unitOf(begun, 'p1', 'settler').id });
    state = act(state, 'p2', { type: 'foundCity', unitId: unitOf(state, 'p2', 'settler').id });
    return { state, rome: cityOn(state, at(state.map, 3, 3)), thebes: cityOn(state, at(state.map, 9, 3)) };
  }

  /** A copy of the state with one more unit of p1 on the tile (x, y), and its id. */
  function withUnitAt(state: GameState, type: UnitTypeId, x: number, y: number): { state: GameState; unitId: string; tile: TileIndex } {
    const tile = at(state.map, x, y);
    let unitId = '';
    const ready = arrange(state, (draft) => {
      unitId = placeUnit(draft, 'p1', type, tile).id;
    });
    return { state: ready, unitId, tile };
  }

  it('a Fishing Boat on a coast tile of its owner\'s land starts a net; four resolutions later the tile carries it, the boat is still there and free, the event names the city; the tile gives 4 food from the turn after', () => {
    const game = harbourGame();
    const map = game.state.map;
    expect(IMPROVEMENTS.fishingNet.turns).toBe(4);

    // The boat sails two tiles to a coast tile next to Rome and begins in the same turn, with no moves left.
    const boat = withUnitAt(game.state, 'fishingBoat', 6, 4);
    const site = at(map, 4, 4);
    expect(game.state.map.tiles[site]).toMatchObject({ terrain: 'coast', improvement: null, cityId: game.rome.id });
    const arrived = act(boat.state, 'p1', { type: 'moveUnit', unitId: boat.unitId, path: [at(map, 5, 4), site] });
    expect(arrived.units[boat.unitId]).toMatchObject({ tile: site, movesLeft: 0 });
    const begun = actWithEvents(arrived, 'p1', start(boat.unitId, 'fishingNet'));
    expect(begun.events).toEqual([]);
    expect(begun.state.units[boat.unitId]).toEqual({
      id: boat.unitId, type: 'fishingBoat', owner: 'p1', tile: site, movesLeft: 0, job: { improvement: 'fishingNet', turnsWorked: 0 },
    });
    expect(begun.state.map.tiles[site]).toEqual(arrived.map.tiles[site]);

    // Three resolutions: the work goes on, the tile is bare, the boat stays (it cannot sail while it works).
    let current = begun.state;
    const bare = cityEconomy(current, current.cities[game.rome.id]);
    expect(bare.worked).not.toContain(site); // the citizen gathers from grassland: bare coast gives 2 food and nothing else
    for (let resolved = 1; resolved <= 3; resolved++) {
      const step = endTurnForAll(current);
      current = step.state;
      expect(current.units[boat.unitId], `after ${resolved} turns`).toMatchObject({ tile: site, job: { improvement: 'fishingNet', turnsWorked: resolved } });
      expect(current.map.tiles[site].improvement, `after ${resolved} turns`).toBeNull();
      expect(step.events.some((addressed) => addressed.event.type === 'improvementBuilt')).toBe(false);
      expect(refusal(current, 'p1', { type: 'moveUnit', unitId: boat.unitId, path: [at(map, 5, 4)] })).toBe('unitBusy');
      expect(buildPlayerView(current, 'p1').units.find((unit) => unit.id === boat.unitId)?.own?.job).toEqual({
        improvement: 'fishingNet', turnsWorked: resolved, turnsTotal: 4, turnsLeft: 4 - resolved,
      });
    }

    // The fourth: the net is on the tile, the boat is where it was, not used up, free and with full moves.
    const foodBefore = current.cities[game.rome.id].foodStored;
    const shown = buildPlayerView(current, 'p1').cities.find((city) => city.id === game.rome.id)?.own;
    const done = endTurnForAll(current);
    expect(done.state.map.tiles[site]).toEqual({ ...current.map.tiles[site], improvement: 'fishingNet' });
    expect(done.state.units[boat.unitId]).toEqual({
      id: boat.unitId, type: 'fishingBoat', owner: 'p1', tile: site, movesLeft: UNITS.fishingBoat.moves, job: null,
    });
    expect(done.events.filter((addressed) => addressed.event.type === 'improvementBuilt')).toEqual([
      { to: ['p1'], event: { type: 'improvementBuilt', playerId: 'p1', unitId: boat.unitId, improvement: 'fishingNet', tile: site, cityName: game.rome.name } },
    ]);
    expect(refusal(done.state, 'p1', { type: 'moveUnit', unitId: boat.unitId, path: [at(map, 5, 4)] })).toBeNull();
    expect(refusal(done.state, 'p1', start(boat.unitId, 'fishingNet'))).toBe('alreadyImproved');

    // The turn that finished the net gave the city what its panel had shown: the yields without the net.
    expect(shown?.foodPerTurn).toBe(bare.foodSurplus);
    expect(done.state.cities[game.rome.id].foodStored).toBe(foodBefore + bare.foodSurplus);
    // From the turn after, the fished tile gives 4 food and no production, and the citizen gathers from it.
    expect(tileYields(done.state.map.tiles[site])).toEqual({ food: 4, production: 0 });
    const fished = cityEconomy(done.state, done.state.cities[game.rome.id]);
    expect(fished).toEqual({ worked: [site], food: 2 + 4, production: 1, foodSurplus: 4 });
    // (The store is emptied by hand first, so that the four turns of grassland before do not make the city grow here.)
    const emptied = arrange(done.state, (draft) => {
      draft.cities[game.rome.id].foodStored = 0;
    });
    expect(endTurnForAll(emptied).state.cities[game.rome.id]).toMatchObject({ foodStored: 4, population: 1 });
    // Units never matter to citizens, on water as on land: with another player's boat on the fished tile the city gathers the same.
    const visited = arrange(done.state, (draft) => {
      draft.units[boat.unitId].tile = at(map, 5, 4);
      placeUnit(draft, 'p2', 'scoutBoat', site);
    });
    expect(cityEconomy(visited, visited.cities[game.rome.id])).toEqual(fished);
    // Everybody who sees the tile sees the net; the owner's panel marks the tile as gathered from.
    const view = buildPlayerView(done.state, 'p1');
    expect(view.tiles[site]).toMatchObject({ improvement: 'fishingNet', visible: true, owner: 'p1' });
    expect(view.cities.find((city) => city.id === game.rome.id)?.own?.worked).toEqual([site]);
  });

  it('a net is refused on ocean (badImprovementTile), outside the borders (notYourLand), on a netted tile (alreadyImproved)', () => {
    const game = harbourGame();
    const map = game.state.map;
    const net = (x: number, y: number, prepare: (draft: GameState) => void = () => undefined): RuleErrorCode | null => {
      const boat = withUnitAt(arrange(game.state, prepare), 'fishingBoat', x, y);
      const answer = refusal(boat.state, 'p1', start(boat.unitId, 'fishingNet'));
      // The owner's view says the same on the boat's one button, before any press.
      expect(buildPlayerView(boat.state, 'p1').units.find((unit) => unit.id === boat.unitId)?.own?.jobOptions).toEqual([
        { improvement: 'fishingNet', turns: IMPROVEMENTS.fishingNet.turns, error: answer },
      ]);
      return answer;
    };

    // Ocean inside the borders: the water is Rome's, but a net needs coast.
    expect(map.tiles[at(map, 3, 5)]).toMatchObject({ terrain: 'ocean', cityId: game.rome.id });
    expect(net(3, 5)).toBe('badImprovementTile');
    // Coast outside the borders: nobody's, and another player's. (The boat may be there: borders do not stop boats.)
    expect(map.tiles[at(map, 6, 4)]).toMatchObject({ terrain: 'coast', cityId: null });
    expect(net(6, 4)).toBe('notYourLand');
    expect(map.tiles[at(map, 9, 4)]).toMatchObject({ terrain: 'coast', cityId: game.thebes.id });
    expect(net(9, 4)).toBe('notYourLand');
    // Whose water comes before what water: ocean outside the borders is 'notYourLand'.
    expect(map.tiles[at(map, 7, 5)]).toMatchObject({ terrain: 'ocean', cityId: null });
    expect(net(7, 5)).toBe('notYourLand');
    // A tile that carries a net already.
    expect(net(4, 4, (draft) => improve(draft, at(map, 4, 4), 'fishingNet'))).toBe('alreadyImproved');
    // And where it is built: every coast tile of Rome's.
    for (const x of [2, 3, 4, 5]) expect(net(x, 4), `(${x}, 4)`).toBeNull();
    // Thebes's boat on Thebes's coast, for good measure: the rule is about the boat's owner.
    let theirBoat = '';
    const theirs = arrange(game.state, (draft) => {
      theirBoat = placeUnit(draft, 'p2', 'fishingBoat', at(map, 9, 4)).id;
    });
    expect(refusal(theirs, 'p2', start(theirBoat, 'fishingNet'))).toBeNull();
    // A net on ground that does not suit it is something the health check names (arrange would not let it through).
    const netOnOcean = tamper(game.state, (draft) => improve(draft, at(map, 3, 5), 'fishingNet'));
    expect(improvementFits('fishingNet', netOnOcean.map.tiles[at(map, 3, 5)])).toBe(false);
    expect(checkInvariants(netOnOcean)).toHaveLength(1);
    expect(checkInvariants(netOnOcean)[0]).toContain(`Tile ${at(map, 3, 5)} `);
  });

  it('a Worker asked for a net and a Fishing Boat asked for a farm or a mine are refused cannotImprove; a Scout Boat for anything', () => {
    const game = harbourGame();
    const worker = withUnitAt(game.state, 'worker', 2, 3);
    const fishing = withUnitAt(worker.state, 'fishingBoat', 4, 4);
    const scouting = withUnitAt(fishing.state, 'scoutBoat', 3, 4);
    const state = scouting.state;

    expect(refusal(state, 'p1', start(worker.unitId, 'fishingNet'))).toBe('cannotImprove');
    expect(refusal(state, 'p1', start(fishing.unitId, 'farm'))).toBe('cannotImprove');
    expect(refusal(state, 'p1', start(fishing.unitId, 'mine'))).toBe('cannotImprove');
    for (const improvement of IMPROVEMENT_IDS) {
      expect(refusal(state, 'p1', start(scouting.unitId, improvement)), improvement).toBe('cannotImprove');
    }
    // Each can do its own work on the very tile it stands on: it is the unit that is wrong, not the place.
    expect(refusal(state, 'p1', start(worker.unitId, 'farm'))).toBeNull();
    expect(refusal(state, 'p1', start(fishing.unitId, 'fishingNet'))).toBeNull();
    // The Scout Boat lies on coast of Rome's where a net fits.
    expect(improvementFits('fishingNet', state.map.tiles[scouting.tile])).toBe(true);

    // "Not yours to build" is said before "busy" and before anything about the tile.
    const busyBoat = withJob(state, fishing.unitId, { improvement: 'fishingNet', turnsWorked: 1 });
    expect(refusal(busyBoat, 'p1', start(fishing.unitId, 'farm'))).toBe('cannotImprove');
    const busyWorker = withJob(state, worker.unitId, { improvement: 'farm', turnsWorked: 1 });
    expect(refusal(busyWorker, 'p1', start(worker.unitId, 'fishingNet'))).toBe('cannotImprove');
    expect(refusal(busyWorker, 'p1', start(worker.unitId, 'mine'))).toBe('unitBusy');
    const abroad = withUnitAt(game.state, 'fishingBoat', 9, 4);
    expect(refusal(abroad.state, 'p1', start(abroad.unitId, 'farm'))).toBe('cannotImprove');
    // startJobError says the same without an action.
    expect(startJobError(state, state.units[worker.unitId], 'fishingNet')).toBe('cannotImprove');
    expect(startJobError(state, state.units[fishing.unitId], 'mine')).toBe('cannotImprove');
    expect(startJobError(state, state.units[scouting.unitId], 'fishingNet')).toBe('cannotImprove');
    // Nothing was started by any of the refusals.
    for (const unit of Object.values(state.units)) expect(unit.job).toBeNull();
  });

  it('jobOptions: two for a Worker, one for a Fishing Boat, none for the others, in IMPROVEMENT_IDS order', () => {
    const game = harbourGame();
    const map = game.state.map;
    // One unit of every type of p1, each on ground it can stand on.
    const state = arrange(game.state, (draft) => {
      placeUnit(draft, 'p1', 'scout', at(map, 2, 2));
      placeUnit(draft, 'p1', 'settler', at(map, 2, 3));
      placeUnit(draft, 'p1', 'worker', at(map, 4, 3));
      placeUnit(draft, 'p1', 'fishingBoat', at(map, 4, 4));
      placeUnit(draft, 'p1', 'scoutBoat', at(map, 3, 4));
    });
    const view = buildPlayerView(state, 'p1');
    const expected: Record<UnitTypeId, ImprovementId[]> = {
      warrior: [], scout: [], settler: [], worker: ['farm', 'mine'], fishingBoat: ['fishingNet'], scoutBoat: [],
    };
    for (const type of UNIT_TYPE_IDS) {
      const unit = unitOf(state, 'p1', type);
      const options = jobOptions(state, unit);
      expect(options.map((option) => option.improvement), type).toEqual(expected[type]);
      // The unit table's list, in the order of IMPROVEMENT_IDS, with the table's turns.
      expect(options.map((option) => option.improvement), type).toEqual(IMPROVEMENT_IDS.filter((id) => UNITS[type].improvements.includes(id)));
      for (const option of options) {
        expect(option.turns, `${type}: ${option.improvement}`).toBe(IMPROVEMENTS[option.improvement].turns);
        expect(option.error, `${type}: ${option.improvement}`).toBe(startJobError(state, unit, option.improvement));
        expect(Object.keys(option).sort()).toEqual(['error', 'improvement', 'turns']);
      }
      // The owner's view carries exactly these.
      expect(view.units.find((seen) => seen.id === unit.id)?.own?.jobOptions, type).toEqual(options);
    }
    // What stands where: the Worker on open grassland may farm, the boat on Rome's coast may fish.
    expect(jobOptions(state, unitOf(state, 'p1', 'worker'))).toEqual([
      { improvement: 'farm', turns: 4, error: null },
      { improvement: 'mine', turns: 5, error: 'badImprovementTile' },
    ]);
    expect(jobOptions(state, unitOf(state, 'p1', 'fishingBoat'))).toEqual([{ improvement: 'fishingNet', turns: 4, error: null }]);
    // Nobody is shown a button that can never be pressed: p2 sees p1's boat and learns nothing of what it could do.
    for (const unit of buildPlayerView(state, 'p2').units) if (unit.owner === 'p1') expect(unit.own).toBeNull();
  });

  /**
   * A capital drawn like a real one, on a shore: Rome at (3,3). Its land:
   * seven open grassland tiles, one plains tile, two forests, one hill
   * (at (4,2), next to the city), four coast tiles and three of ocean.
   */
  const SHORE_CAPITAL: readonly string[] = [
    '~ ~ ~ ~ ~ ~ ~ ~ ~',
    ' ~ g g f g g g ~ ~',
    '~ g p g h g p g ~',
    ' ~ g g g g f g ~ ~',
    '~ , , , , , , , ~',
    ' ~ ~ ~ ~ ~ ~ ~ ~ ~',
    '~ ~ ~ ~ ~ ~ ~ ~ ~',
  ];

  /** The economy of the one city of a state at this size and under this focus, with these improvements on its land. */
  function economyWith(base: GameState, population: number, focus: CityFocusId, built: readonly [TileIndex, ImprovementId][]) {
    const state = arrange(base, (draft) => {
      const city = Object.values(draft.cities)[0];
      city.population = population;
      city.focus = focus;
      for (const [tile, improvement] of built) improve(draft, tile, improvement);
    });
    const city = Object.values(state.cities)[0];
    const economy = cityEconomy(state, city);
    // The owner's panel and the map's gold tokens say the same.
    expect(buildPlayerView(state, 'p1').cities[0].own).toMatchObject({
      worked: economy.worked, foodPerTurn: economy.foodSurplus, productionPerTurn: economy.production, focus,
    });
    return economy;
  }

  it('citizens gather a fished coast tile: in a city drawn like a real capital the net is taken by the first citizen, with a farm and a mine beside it too; the mine is still taken first when a farm feeds it', () => {
    const begun = newGame(SHORE_CAPITAL, [[3, 3]]);
    const base = act(begun, 'p1', { type: 'foundCity', unitId: unitOf(begun, 'p1', 'settler').id });
    const map = base.map;
    const rome = cityOn(base, at(map, 3, 3));
    const NET = at(map, 4, 4);
    const FARM = at(map, 2, 3);
    const MINE = at(map, 4, 2);
    const land = map.tiles.filter((tile) => tile.cityId === rome.id);
    expect(land).toHaveLength(19);
    expect(land.filter((tile) => tile.terrain === 'coast')).toHaveLength(4);
    expect(map.tiles[FARM]).toMatchObject({ terrain: 'grassland', feature: null, cityId: rome.id });
    expect(map.tiles[MINE]).toMatchObject({ feature: 'hills', cityId: rome.id });
    const net: [TileIndex, ImprovementId] = [NET, 'fishingNet'];
    const farm: [TileIndex, ImprovementId] = [FARM, 'farm'];
    const mine: [TileIndex, ImprovementId] = [MINE, 'mine'];

    // Bare land: the first citizen gathers from open grassland (2 + 1), not from bare coast (2 + 0).
    const bare = economyWith(base, 1, 'grow', []);
    expect(map.tiles[bare.worked[0]]).toMatchObject({ terrain: 'grassland', feature: null });
    // One net: a fished tile gives 4, more than any bare tile. The FIRST citizen takes it.
    expect(economyWith(base, 1, 'grow', [net])).toEqual({ worked: [NET], food: 6, production: 1, foodSurplus: 4 });
    // With a farm and a mine beside it too. The mined hill gives most (5) but no food, so one
    // citizen cannot stay on it (2 - 2 = 0); the citizen is moved to the tile with the most food: the net.
    expect(economyWith(base, 1, 'grow', [net, farm, mine])).toEqual({ worked: [NET], food: 6, production: 1, foodSurplus: 4 });
    // The second citizen: the mine first (5), then the net (4 food) ahead of the farm (3 + 1). The net feeds the mine.
    expect(economyWith(base, 2, 'grow', [net, farm, mine])).toEqual({ worked: [MINE, NET], food: 6, production: 6, foodSurplus: 2 });
    // The third: the farm.
    expect(economyWith(base, 3, 'grow', [net, farm, mine])).toEqual({ worked: [FARM, MINE, NET].sort((a, b) => a - b), food: 9, production: 7, foodSurplus: 3 });
    // The net pushes nobody out: every later citizen has the mine, the net and the farm among its tiles.
    for (let population = 3; population <= 8; population++) {
      const worked = economyWith(base, population, 'grow', [net, farm, mine]).worked;
      for (const tile of [MINE, NET, FARM]) expect(worked, `population ${population}`).toContain(tile);
    }

    // The mine is still taken first when a farm feeds it, with no net anywhere: round 2's rule is unchanged.
    expect(economyWith(base, 2, 'grow', [farm, mine])).toEqual({ worked: [FARM, MINE].sort((a, b) => a - b), food: 5, production: 7, foodSurplus: 1 });
    // And still not by a single citizen, whom the farm then feeds instead.
    expect(economyWith(base, 1, 'grow', [farm, mine]).worked).toEqual([FARM]);
  });

  it('a mine needs a feeder: in a capital drawn with a mined hill, six farmed plains tiles and no grassland, the mine is gathered from at no city size from 1 to 6 under Grow; with ONE net beside them it is gathered from, from the second citizen on; under Build it is at every size', () => {
    // Rome at (3,3) on plains. Around it: six open plains tiles, one hill
    // (4,4) and one coast tile (3,5); everything else is mountains, which
    // nobody gathers from. No grassland anywhere: the cities of 4.6 whose
    // promised mine stood unused for a whole game.
    const DRY_HILLS: readonly string[] = [
      'M M M M M M M',
      ' M M M M M M M',
      'M M M p p M M',
      ' M M p p p M M',
      'M M p p H M M',
      ' M M M , M M M',
      'M M M M M M M',
    ];
    const begun = newGame(DRY_HILLS, [[3, 3]]);
    const base = act(begun, 'p1', { type: 'foundCity', unitId: unitOf(begun, 'p1', 'settler').id });
    const map = base.map;
    const rome = cityOn(base, at(map, 3, 3));
    const MINE = at(map, 4, 4);
    const NET = at(map, 3, 5);
    const plains = map.tiles
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile, index }) => tile.cityId === rome.id && index !== rome.tile && tile.terrain === 'plains' && tile.feature === null)
      .map(({ index }) => index);
    expect(plains).toHaveLength(6);
    expect(map.tiles.some((tile) => tile.cityId === rome.id && tile.terrain === 'grassland' && tile.feature === null)).toBe(false);
    expect(map.tiles[MINE]).toMatchObject({ terrain: 'plains', feature: 'hills', cityId: rome.id });
    expect(map.tiles[NET]).toMatchObject({ terrain: 'coast', cityId: rome.id });

    const worked: [TileIndex, ImprovementId][] = [[MINE, 'mine'], ...plains.map((tile): [TileIndex, ImprovementId] => [tile, 'farm'])];
    // What the numbers are: a farmed plains tile gives 2 food, exactly what its own citizen eats.
    expect(tileYields({ terrain: 'plains', feature: null, improvement: 'farm' })).toEqual({ food: 2, production: 2 });
    expect(tileYields({ terrain: 'plains', feature: 'hills', improvement: 'mine' })).toEqual({ food: 0, production: 5 });

    for (let population = 1; population <= 6; population++) {
      const what = `population ${population}`;
      // Under Grow, a Worker's work alone: the mine is the best tile and nobody stands on it. With it the
      // city would stand still (the centre's 2 and 2 for every other citizen, all eaten), so its citizen is moved.
      const farmed = economyWith(base, population, 'grow', worked);
      expect(farmed.worked, what).not.toContain(MINE);
      expect(farmed.foodSurplus, what).toBe(2);
      // Under Build it is gathered from at every size, and the city stands still, as the sentence above says.
      const building = economyWith(base, population, 'build', worked);
      expect(building.worked, what).toContain(MINE);
      expect(building.foodSurplus, what).toBe(0);
      expect(building.production, what).toBeGreaterThan(farmed.production);

      // With ONE net beside them: from the second citizen on the mine is gathered from (2 + 0 + 4 - 4 = +2).
      const fed = economyWith(base, population, 'grow', [...worked, [NET, 'fishingNet']]);
      if (population === 1) {
        expect(fed.worked, what).toEqual([NET]);
      } else {
        expect(fed.worked, what).toContain(MINE);
        expect(fed.worked, what).toContain(NET);
        expect(fed.foodSurplus, what).toBe(2);
        expect(fed.production, what).toBe(farmed.production + 5 - 2 - 2 + 0); // the mine and the net instead of two farmed plains tiles
      }
      expect(economyWith(base, population, 'build', [...worked, [NET, 'fishingNet']]).worked, what).toContain(MINE);
    }
  });
});
