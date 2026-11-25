import { describe, expect, it } from 'vitest';
import {
  RULES,
  RULE_ERROR_MESSAGES,
  UNITS,
  applyAction,
  boardFromView,
  buildPlayerView,
  checkInvariants,
  cloneJson,
  createGame,
  reachableTiles,
  tileIsWater,
} from '../src/index';
import type { Action, City, GameState, PlayerId, RuleErrorCode } from '../src/index';
import {
  EAST,
  MEADOW,
  NORTH_WEST,
  act,
  arrange,
  at,
  codeOf,
  foundCityAt,
  improve,
  newGame,
  placeUnit,
  queueOf,
  send,
  setupFor,
  stepFrom,
  unitOf,
} from './rulesKit';
import { LONG_TEST, WILDS, WILDS_STARTS, playRandomGame, refereeFromView } from './rulesRandomPlay';
import type { Step } from './rulesRandomPlay';

/**
 * Long random games: the rules must stay healthy, pure and deterministic
 * whatever four players throw at them.
 */

function wildsGame(seed = 'whole-game'): GameState {
  return newGame(WILDS, WILDS_STARTS, seed);
}

/** What a test learns about a finished random game. */
interface GameLog {
  steps: number;
  accepted: number;
  rejected: number;
  /** How often each error code was given. */
  codes: Map<RuleErrorCode, number>;
  /** How often each kind of event happened. */
  events: Map<string, number>;
  /** How often each type of action was accepted and changed something. */
  kinds: Map<string, number>;
  /** How many boats cities completed, and how many Fishing Nets were finished. */
  boatsBuilt: number;
  netsBuilt: number;
  /** One line per attempt: who, what, and the complete answer. Two games are the same game if these match. */
  record: string[];
}

function newLog(): GameLog {
  return { steps: 0, accepted: 0, rejected: 0, codes: new Map(), events: new Map(), kinds: new Map(), boatsBuilt: 0, netsBuilt: 0, record: [] };
}

/** Does the city own a water tile, on the true map? Counted here with tileIsWater, apart from the engine's own question. */
function ownsWater(state: GameState, city: City): boolean {
  return state.map.tiles.some((tile) => tile.cityId === city.id && tileIsWater(tile));
}

function count<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Writes a step into the log. */
function logStep(log: GameLog, step: Step): void {
  log.steps += 1;
  if (step.result.ok) {
    log.accepted += 1;
    if (step.result.changed) count(log.kinds, step.action.type);
    for (const addressed of step.result.events) {
      count(log.events, addressed.event.type);
      if (addressed.event.type === 'unitBuilt' && UNITS[addressed.event.unitType].domain === 'sea') log.boatsBuilt += 1;
      if (addressed.event.type === 'improvementBuilt' && addressed.event.improvement === 'fishingNet') log.netsBuilt += 1;
    }
  } else {
    log.rejected += 1;
    count(log.codes, step.result.error.code);
  }
  log.record.push(JSON.stringify([step.playerId, step.turn, step.action, step.result]));
}

/**
 * The checks every step of every random game must pass:
 *  - the engine did not touch the state it was given;
 *  - a rejected action changed nothing, an accepted no-op handed back the same object;
 *  - the new state is healthy;
 *  - the answer is the one a referee predicts who sees only the player's own view;
 *  - the menu of every city in that view greys the boats exactly where the city owns no water;
 *  - a finished improvement is news for its owner only, and names one of the owner's own cities;
 *  - no boat stands on land and no land unit on water, and no stored queue holds a boat in a city without water.
 */
function checkStep(step: Step, jsonBefore: string): string {
  expect(JSON.stringify(step.before), `step ${step.index}: the input state was modified`).toBe(jsonBefore);

  const isPlayer = step.before.players.some((player) => player.id === step.playerId);
  const view = isPlayer ? buildPlayerView(step.before, step.playerId) : null;
  const predicted = refereeFromView(view, step.turn, step.action);
  expect(codeOf(step.result), `step ${step.index}: ${JSON.stringify(step.action)} by ${step.playerId}`).toBe(predicted);
  // The referee reads "this city can never build a boat" from the city's menu where the tiles
  // of a view leave it open. Here that answer is held against the city's true land.
  for (const city of view === null ? [] : view.cities) {
    if (city.own === null) continue;
    const dry = !ownsWater(step.before, step.before.cities[city.id]);
    for (const option of city.own.buildOptions) {
      const boat = UNITS[option.item.unitType].domain === 'sea';
      expect(option.addError === 'noWaterForBoat', `step ${step.index}: ${city.id}, ${option.item.unitType}`).toBe(boat && dry);
    }
  }

  if (!step.result.ok) {
    expect(step.after).toBe(step.before);
    return jsonBefore;
  }
  if (!step.result.changed) {
    expect(step.result.state).toBe(step.before);
    expect(step.result.events).toEqual([]);
    return jsonBefore;
  }
  expect(step.result.state).not.toBe(step.before);
  expect(checkInvariants(step.after), `step ${step.index}`).toEqual([]);
  // News of a finished improvement goes to the unit's owner alone and names one of that player's own cities.
  for (const addressed of step.result.events) {
    if (addressed.event.type !== 'improvementBuilt') continue;
    const { playerId, cityName, tile, improvement } = addressed.event;
    expect(addressed.to, `step ${step.index}`).toEqual([playerId]);
    const ownCityNames = Object.values(step.after.cities).filter((city) => city.owner === playerId).map((city) => city.name);
    expect(ownCityNames, `step ${step.index}: "${cityName}"`).toContain(cityName);
    expect(step.after.map.tiles[tile].improvement, `step ${step.index}`).toBe(improvement);
  }
  // Every unit on its own kind of tile: a boat on water, everybody else on land.
  for (const unit of Object.values(step.after.units)) {
    const afloat = tileIsWater(step.after.map.tiles[unit.tile]);
    expect(afloat, `step ${step.index}: the ${unit.type} ${unit.id} on tile ${unit.tile}`).toBe(UNITS[unit.type].domain === 'sea');
  }
  // No queue holds a boat for a city that can never build one (rule B2 keeps it out).
  for (const city of Object.values(step.after.cities)) {
    if (!city.buildQueue.some((entry) => UNITS[entry.unitType].domain === 'sea')) continue;
    expect(ownsWater(step.after, city), `step ${step.index}: ${city.id} has a boat in its queue`).toBe(true);
  }
  return JSON.stringify(step.after);
}

/**
 * For a move that stopped although the unit still had moves: whatever was
 * in the way stands on a tile next to the unit, where its owner now sees
 * it. So "stopped early" tells the player nothing that their new view does
 * not show. Returns true if the step was such a move.
 */
function checkEarlyStop(step: Step): boolean {
  if (!step.result.ok || step.action.type !== 'moveUnit') return false;
  const moved = step.result.events[0].event;
  if (moved.type !== 'unitMoved' || !moved.stoppedEarly) return false;
  const unit = step.after.units[moved.unitId];
  if (unit.movesLeft <= 0) return false; // it simply ran out of moves

  const obstacle = step.action.path[moved.path.length];
  const viewAfter = buildPlayerView(step.after, step.playerId);
  expect(viewAfter.tiles[obstacle]?.visible, `step ${step.index}: the tile that stopped the unit is in sight`).toBe(true);
  const why = refereeFromView(viewAfter, step.after.turn, { type: 'moveUnit', unitId: unit.id, path: [obstacle] });
  expect(['impassable', 'blocked'], `step ${step.index}: the reason is in the mover's view`).toContain(why);
  return true;
}

/**
 * For an action a client chose from its own view: the engine accepts it,
 * and a move ends exactly where the highlight said, with the moves it said.
 */
function checkSensibleStep(step: Step): void {
  expect(step.result.ok, `step ${step.index}: ${JSON.stringify(step.action)} by ${step.playerId}`).toBe(true);
  if (!step.result.ok || step.action.type !== 'moveUnit') return;

  const view = buildPlayerView(step.before, step.playerId);
  const unit = step.before.units[step.action.unitId];
  const path = step.action.path;
  // Everything a unit can reach in one turn lies within its sight today.
  // Only then must the view and the truth agree on the whole path.
  if (!path.every((tile) => view.tiles[tile]?.visible === true)) return;

  const reach = reachableTiles(boardFromView(view), unit);
  const target = path[path.length - 1];
  expect(step.after.units[unit.id]).toMatchObject({ tile: target, movesLeft: reach.get(target)?.movesLeft });
  expect(step.result.events[0].event).toMatchObject({ type: 'unitMoved', path, stoppedEarly: false });
}

describe('whole-game properties (WP2)', () => {
  it('random legal play for 30 turns with 4 players: checkInvariants stays empty after every action', LONG_TEST, () => {
    const start = wildsGame();
    const log = newLog();
    let json = JSON.stringify(start);

    const end = playRandomGame({
      start,
      seed: 'legal-play',
      turns: 30,
      wildShare: 0,
      onStep: (step) => {
        logStep(log, step);
        checkSensibleStep(step);
        json = checkStep(step, json);
      },
    });

    expect(end.turn).toBe(31);
    expect(log.rejected).toBe(0);
    // The game really was a game: everybody settled, cities grew and built, units walked.
    expect(Object.keys(end.cities).length).toBeGreaterThanOrEqual(4);
    expect(log.events.get('unitMoved') ?? 0).toBeGreaterThan(200);
    expect(log.events.get('cityFounded') ?? 0).toBeGreaterThanOrEqual(4);
    expect(log.events.get('cityGrew') ?? 0).toBeGreaterThan(3);
    expect(log.events.get('unitBuilt') ?? 0).toBeGreaterThan(3);
    expect(log.events.get('turnStarted')).toBe(30);
    // Queues were edited, Workers were built and set to work, and some of that work was finished.
    expect(log.kinds.get('setBuildQueue') ?? 0).toBeGreaterThan(100);
    expect(log.kinds.get('startJob') ?? 0).toBeGreaterThan(3);
    expect(log.events.get('improvementBuilt') ?? 0).toBeGreaterThan(3);
    expect(end.map.tiles.filter((tile) => tile.improvement !== null).length).toBeGreaterThan(3);
    // Cities were told to place their citizens the other way, and back; the cities that own water built boats.
    expect(log.kinds.get('setCityFocus') ?? 0).toBeGreaterThan(5);
    expect(log.boatsBuilt).toBeGreaterThan(0);
  });

  it('random legal and illegal play for 40 turns: every answer is the one the player\'s own view predicts, and the state stays healthy', LONG_TEST, () => {
    let dryBoatsRefused = 0;
    for (const seed of ['wild-one', 'wild-two']) {
      const start = wildsGame(seed);
      const log = newLog();
      let json = JSON.stringify(start);
      let earlyStops = 0;

      const end = playRandomGame({
        start,
        seed,
        turns: 40,
        wildShare: 45,
        onStep: (step) => {
          logStep(log, step);
          if (step.sensible) checkSensibleStep(step);
          json = checkStep(step, json);
          if (checkEarlyStop(step)) earlyStops += 1;
        },
      });

      expect(end.turn).toBe(41);
      expect(checkInvariants(end)).toEqual([]);
      // Blind walks did run into water, mountains and other units with moves to spare.
      expect(earlyStops).toBeGreaterThan(4);
      // Workers were at work in this game too, and finished some of it.
      expect(log.events.get('improvementBuilt') ?? 0).toBeGreaterThan(0);
      // Both kinds of answer came up, in numbers, and the wild attempts met many different refusals.
      expect(log.accepted).toBeGreaterThan(500);
      expect(log.rejected).toBeGreaterThan(300);
      for (const code of [
        'staleTurn', 'turnAlreadyEnded', 'noSuchUnit', 'noSuchCity', 'badPath', 'noMovesLeft',
        'impassable', 'blocked', 'cannotFoundCity', 'cannotBuild', 'badAction',
        'queueFull', 'cannotImprove', 'unitBusy',
      ] as const) {
        expect(log.codes.get(code) ?? 0, `${seed}: ${code}`).toBeGreaterThan(0);
      }
      // Boats were built and sailed, and the focus was set, also with nonsense (badAction, counted above).
      expect(log.boatsBuilt, seed).toBeGreaterThan(2);
      expect(log.kinds.get('setCityFocus') ?? 0, seed).toBeGreaterThan(5);
      dryBoatsRefused += log.codes.get('noWaterForBoat') ?? 0;
    }
    // Boats were asked of cities without water (in the game whose players founded such cities).
    expect(dryBoatsRefused).toBeGreaterThan(0);
  });

  it('the same seed and the same actions give byte-identical JSON twice', LONG_TEST, () => {
    const play = (gameSeed: string, playSeed: string): { final: string; record: string[] } => {
      const log = newLog();
      const end = playRandomGame({
        start: wildsGame(gameSeed),
        seed: playSeed,
        turns: 20,
        wildShare: 30,
        onStep: (step) => logStep(log, step),
      });
      return { final: JSON.stringify(end), record: log.record };
    };

    const first = play('same-seed', 'same-actions');
    const second = play('same-seed', 'same-actions');
    expect(second.record).toEqual(first.record);
    expect(second.final).toBe(first.final);

    // Step by step, too: asking the same question again gives the same
    // answer to the last character, and so does asking it of a copy of the
    // state that went through text and back.
    let compared = 0;
    playRandomGame({
      start: wildsGame('same-seed'),
      seed: 'same-actions',
      turns: 12,
      wildShare: 30,
      onStep: (step) => {
        const answer = JSON.stringify(step.result);
        const again = applyAction(step.before, step.playerId, step.turn, step.action);
        expect(JSON.stringify(again), `step ${step.index}`).toBe(answer);
        const reloaded = JSON.parse(JSON.stringify(step.before)) as GameState;
        expect(JSON.stringify(applyAction(reloaded, step.playerId, step.turn, step.action)), `step ${step.index}`).toBe(answer);
        compared += 1;
      },
    });
    expect(compared).toBeGreaterThan(400);

    // The comparison is not empty: other dice give another game, and so does another game seed.
    expect(play('same-seed', 'other-actions').final).not.toBe(first.final);
    expect(play('other-seed', 'same-actions').final).not.toBe(first.final);
  });

  it('saving and loading (JSON round trip) in mid-game changes nothing afterwards', LONG_TEST, () => {
    const play = (reload?: (state: GameState, index: number) => GameState): { final: string; record: string[] } => {
      const log = newLog();
      const end = playRandomGame({
        start: wildsGame('save-load'),
        seed: 'save-load-actions',
        turns: 20,
        wildShare: 30,
        onStep: (step) => logStep(log, step),
        reload,
      });
      return { final: JSON.stringify(end), record: log.record };
    };

    const uninterrupted = play();
    // The same game, but every fifth attempt is made on a copy that went
    // through text and back, as a state does when the server restarts.
    let reloads = 0;
    const withReloads = play((state, index) => {
      if (index % 5 !== 2) return state;
      reloads += 1;
      const text = JSON.stringify(state);
      const loaded = JSON.parse(text) as GameState;
      expect(JSON.stringify(loaded)).toBe(text);
      return loaded;
    });

    expect(reloads).toBeGreaterThan(50);
    expect(withReloads.record).toEqual(uninterrupted.record);
    expect(withReloads.final).toBe(uninterrupted.final);
  });

  it('a rejected action leaves the state deep-equal', () => {
    // One situation in which every error code of the rules can be provoked.
    const start = newGame(MEADOW, [[3, 5], [12, 5]]);
    const map = start.map;
    const settler = unitOf(start, 'p1', 'settler');
    const warrior = unitOf(start, 'p1', 'warrior');
    let state = act(start, 'p1', { type: 'foundCity', unitId: settler.id });
    state = foundCityAt(state, 'p2', at(map, 7, 5));
    const rome = Object.values(state.cities)[0];
    let tiredId = '';
    let forestId = '';
    let cityWorkerId = '';
    let farmWorkerId = '';
    let busyWorkerId = '';
    let strayWorkerId = '';
    state = arrange(state, (draft) => {
      draft.map.tiles[at(map, 3, 8)].feature = 'forest';
      draft.map.tiles[stepFrom(map, warrior.tile, NORTH_WEST)].feature = 'mountains';
      tiredId = placeUnit(draft, 'p1', 'settler', at(map, 2, 8), 0).id;
      forestId = placeUnit(draft, 'p1', 'settler', at(map, 3, 8)).id;
      placeUnit(draft, 'p1', 'settler', at(map, 5, 5)); // on Rome's land, next to p2's
      placeUnit(draft, 'p1', 'settler', at(map, 6, 5)); // on p2's land
      placeUnit(draft, 'p2', 'scout', at(map, 4, 5)); // east of Rome
      // Four Workers of p1: in Rome itself; on a farm on Rome's land; at work on Rome's land; outside every border.
      cityWorkerId = placeUnit(draft, 'p1', 'worker', rome.tile).id;
      improve(draft, at(map, 2, 5), 'farm');
      farmWorkerId = placeUnit(draft, 'p1', 'worker', at(map, 2, 5)).id;
      const busy = placeUnit(draft, 'p1', 'worker', at(map, 1, 5));
      busy.job = { improvement: 'farm', turnsWorked: 1 };
      busyWorkerId = busy.id;
      strayWorkerId = placeUnit(draft, 'p1', 'worker', at(map, 9, 9)).id;
    });
    const onRomesLand = Object.values(state.units).find((u) => u.tile === at(map, 5, 5)) as { id: string };
    const onTheirLand = Object.values(state.units).find((u) => u.tile === at(map, 6, 5)) as { id: string };
    const ended = act(state, 'p1', { type: 'endTurn' });
    const east = stepFrom(map, warrior.tile, EAST);

    const attempts: [RuleErrorCode, GameState, PlayerId, Action, number?][] = [
      ['badAction', state, 'p5', { type: 'endTurn' }],
      ['staleTurn', state, 'p1', { type: 'endTurn' }, state.turn + 1],
      ['turnAlreadyEnded', ended, 'p1', { type: 'foundCity', unitId: forestId }],
      ['noSuchUnit', state, 'p2', { type: 'moveUnit', unitId: warrior.id, path: [east] }],
      ['noSuchCity', state, 'p2', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf('scout') }],
      ['badPath', state, 'p1', { type: 'moveUnit', unitId: warrior.id, path: [at(map, 9, 9)] }],
      ['noMovesLeft', state, 'p1', { type: 'moveUnit', unitId: tiredId, path: [at(map, 1, 8)] }],
      ['impassable', state, 'p1', { type: 'moveUnit', unitId: warrior.id, path: [stepFrom(map, warrior.tile, NORTH_WEST)] }],
      ['blocked', state, 'p1', { type: 'moveUnit', unitId: warrior.id, path: [east] }],
      ['cannotFoundCity', state, 'p1', { type: 'foundCity', unitId: warrior.id }],
      ['badCityTile', state, 'p1', { type: 'foundCity', unitId: forestId }],
      ['tooCloseToCity', state, 'p1', { type: 'foundCity', unitId: onRomesLand.id }],
      ['tileOwned', state, 'p1', { type: 'foundCity', unitId: onTheirLand.id }],
      ['cannotBuild', state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: [{ kind: 'unit', unitType: 'dragon' as 'scout' }] }],
      ['queueFull', state, 'p1', {
        type: 'setBuildQueue', cityId: rome.id, queue: Array.from({ length: RULES.maxQueueLength + 1 }, () => queueOf('scout')[0]),
      }],
      ['cannotImprove', state, 'p1', { type: 'startJob', unitId: warrior.id, improvement: 'farm' }],
      ['unitBusy', state, 'p1', { type: 'moveUnit', unitId: busyWorkerId, path: [at(map, 1, 6)] }],
      ['notYourLand', state, 'p1', { type: 'startJob', unitId: strayWorkerId, improvement: 'farm' }],
      ['cityOnTile', state, 'p1', { type: 'startJob', unitId: cityWorkerId, improvement: 'farm' }],
      ['badImprovementTile', state, 'p1', { type: 'startJob', unitId: farmWorkerId, improvement: 'mine' }],
      ['alreadyImproved', state, 'p1', { type: 'startJob', unitId: farmWorkerId, improvement: 'farm' }],
      // Rome stands in the middle of the meadow and owns no water.
      ['noWaterForBoat', state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf('warrior', 'fishingBoat') }],
    ];

    for (const [code, situation, playerId, action, turn] of attempts) {
      const untouched = cloneJson(situation);
      const result = send(situation, playerId, action, turn ?? situation.turn);
      expect(codeOf(result), code).toBe(code);
      expect(situation).toEqual(untouched);
      expect(JSON.stringify(situation)).toBe(JSON.stringify(untouched));
      // A rejection carries the standard sentence for its code and no new state at all.
      expect(result).toEqual({ ok: false, error: { code, message: RULE_ERROR_MESSAGES[code] } });
    }

    // That was every code there is.
    expect(attempts.map(([code]) => code).sort()).toEqual(Object.keys(RULE_ERROR_MESSAGES).sort());

    // The refusals of round 3's action, which has no code of its own, leave the state alone too.
    const focusAttempts: [RuleErrorCode, GameState, PlayerId, Action][] = [
      ['noSuchCity', state, 'p2', { type: 'setCityFocus', cityId: rome.id, focus: 'build' }],
      ['badAction', state, 'p1', { type: 'setCityFocus', cityId: rome.id, focus: 'fast' } as unknown as Action],
      ['turnAlreadyEnded', ended, 'p1', { type: 'setCityFocus', cityId: rome.id, focus: 'build' }],
    ];
    for (const [code, situation, playerId, action] of focusAttempts) {
      const untouched = JSON.stringify(situation);
      const result = send(situation, playerId, action);
      expect(result).toEqual({ ok: false, error: { code, message: RULE_ERROR_MESSAGES[code] } });
      expect(JSON.stringify(situation)).toBe(untouched);
    }
  });
});

/** The same robustness game on a map from the real generator. */
describe('whole game on a generated map (WP1 + WP2)', () => {
  it('creates a game with the default generator and plays 15 wild turns on it', LONG_TEST, () => {
    const start = createGame(setupFor(4, 'generated-map'));
    expect(checkInvariants(start)).toEqual([]);
    // H3 of the generator's promises: everybody can found a capital on the start tile in turn 1.
    for (const player of start.players) {
      const view = buildPlayerView(start, player.id);
      const settler = view.units.find((unit) => unit.owner === player.id && UNITS[unit.type].canFoundCity);
      expect(settler?.own?.foundCityError).toBeNull();
    }

    let json = JSON.stringify(start);
    const end = playRandomGame({
      start,
      seed: 'generated-map-actions',
      turns: 15,
      wildShare: 40,
      onStep: (step) => {
        if (step.sensible) checkSensibleStep(step);
        json = checkStep(step, json);
      },
    });
    expect(end.turn).toBe(16);
    expect(checkInvariants(end)).toEqual([]);
  });

  it('random legal and illegal play for 40 turns with boats and focus flips on generated maps: every answer is the one the player\'s view predicts; no boat ever stands on land and no land unit on water; no stored queue holds a boat in a city without water', LONG_TEST, () => {
    let dryBoatsRefused = 0;
    for (const seed of ['boats-one', 'boats-two']) {
      const start = createGame(setupFor(4, seed));
      // Every capital of a generated map can build boats from its first turn (rule H6 of the generator).
      let founded = start;
      for (const player of start.players) founded = act(founded, player.id, { type: 'foundCity', unitId: unitOf(founded, player.id, 'settler').id });
      for (const city of Object.values(founded.cities)) expect(ownsWater(founded, city), `${seed}: ${city.name}`).toBe(true);

      const log = newLog();
      let json = JSON.stringify(start);
      let boatMoves = 0;
      const end = playRandomGame({
        start,
        seed: `${seed}-actions`,
        turns: 40,
        wildShare: 40,
        onStep: (step) => {
          logStep(log, step);
          if (step.sensible) checkSensibleStep(step);
          // checkStep holds the three sentences of this test's name after every action.
          json = checkStep(step, json);
          checkEarlyStop(step);
          if (step.result.ok && step.action.type === 'moveUnit' && UNITS[step.before.units[step.action.unitId].type].domain === 'sea') boatMoves += 1;
        },
      });

      expect(end.turn).toBe(41);
      expect(checkInvariants(end)).toEqual([]);
      // The round's new things all happened: boats were built and sailed, nets were finished,
      // and cities were set to Build and back.
      expect(log.boatsBuilt, seed).toBeGreaterThan(4);
      expect(boatMoves, seed).toBeGreaterThan(20);
      expect(log.netsBuilt, seed).toBeGreaterThan(1);
      expect(end.map.tiles.filter((tile) => tile.improvement === 'fishingNet').length, seed).toBe(log.netsBuilt);
      expect(log.kinds.get('setCityFocus') ?? 0, seed).toBeGreaterThan(10);
      expect(Object.values(end.units).some((unit) => unit.type === 'fishingBoat'), seed).toBe(true);
      expect(Object.values(end.units).some((unit) => unit.type === 'scoutBoat'), seed).toBe(true);
      // The wild half met the refusals of this round among the others.
      for (const code of ['cannotImprove', 'badAction', 'noSuchCity', 'impassable', 'queueFull', 'cannotBuild'] as const) {
        expect(log.codes.get(code) ?? 0, `${seed}: ${code}`).toBeGreaterThan(0);
      }
      dryBoatsRefused += log.codes.get('noWaterForBoat') ?? 0;
    }
    // Later cities were founded inland, and boats were asked of them.
    expect(dryBoatsRefused).toBeGreaterThan(0);
  });
});
