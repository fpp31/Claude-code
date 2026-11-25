/**
 * Random games for the robustness, determinism and no-leak tests (work
 * package WP2). Not a test file.
 *
 * Four parts:
 *  - `sensibleAction`: what a well-behaved client might send, chosen from
 *    the player's own VIEW only (never from the hidden state): moves on
 *    land and by sea, new cities, edits of build queues with what the
 *    city's menu offers, jobs for Workers and Fishing Boats, and now and
 *    then the other way of placing a city's citizens;
 *  - `nextStepOfThePlan`: the same kind of action without dice, for tests
 *    in which a player must get an improvement built;
 *  - `wildAttempt`: what a broken or malicious client might send (boats
 *    for cities without water, nets from Workers and a focus that is none
 *    among it);
 *  - `playRandomGame`: the loop that mixes the two for several players over
 *    many turns and reports every step to the test.
 *
 * And the referee (`refereeFromView`), who predicts every answer of the
 * rules from the acting player's view alone.
 *
 * Everything is driven by the seeded generator of rng.ts, so a failing game
 * can be replayed exactly from its seed.
 */

import {
  CITY_FOCUS_IDS,
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  RULES,
  UNITS,
  UNIT_TYPE_IDS,
  applyAction,
  boardFromView,
  buildPlayerView,
  distance,
  improvementSiteError,
  isValidTile,
  neighbors,
  nextInt,
  pathTo,
  pick,
  reachableTiles,
  seedRng,
  siteInView,
  tileAllowsCity,
  tileCount,
  tileMoveCost,
} from '../src/index';
import type {
  Action,
  ActionResult,
  BuildItem,
  CityView,
  GameState,
  ImprovementId,
  PlayerId,
  PlayerView,
  RngState,
  RuleErrorCode,
  TileIndex,
  TileView,
  UnitTypeId,
  UnitView,
} from '../src/index';
import { deepFreeze } from './rulesKit';

/**
 * Time limit for a test that plays whole random games. Such a test takes a
 * second or two alone, but far longer when the machine is busy with other
 * work; the usual limit of five seconds would then fail it for no fault of
 * the rules. Use as `it('...', LONG_TEST, () => { ... })`.
 */
export const LONG_TEST = { timeout: 120_000 };

// ---------------------------------------------------------------------------
// A world for random games
// ---------------------------------------------------------------------------

/**
 * A mixed land, 20 x 13, for up to four players: open ground, forests,
 * hills, a mountain range in the middle, lakes and a ragged coast.
 */
export const WILDS: readonly string[] = [
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
  ' ~ , g g p p g f f g , , g g p p g g , ~',
  '~ , g g g p h g f g g , g p p h g g g ~',
  ' ~ g g f g g g g g m g g g g f g g d d ~',
  '~ , g f f g p p g m m g h g g g d d d ~',
  ' ~ g g g g g p g g g m g g g p g g D d ~',
  '~ , p g h g g , , g g g f g p p g g g ~',
  ' ~ g p p g g g , g g h g f f g g g g , ~',
  '~ , g g g f g g g p p g g g g h g g , ~',
  ' ~ g g g f f g g p p g g g m g g f g g ~',
  '~ , , g g g g h g g g d d g g g f g , ~',
  ' ~ , g g g g g g g , , d g g g g g , , ~',
  '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
];

/** Four start tiles on WILDS, one per corner region, all on open ground. */
export const WILDS_STARTS: readonly [x: number, y: number][] = [
  [4, 2],
  [15, 3],
  [3, 9],
  [14, 9],
];

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

/** One thing a player tries to do. */
export interface Attempt {
  playerId: PlayerId;
  /** The turn number sent along with the action. */
  turn: number;
  action: Action;
  /** True if the action was chosen from the player's own view, the way a client would. */
  sensible: boolean;
}

/** An attempt together with what the engine made of it. */
export interface Step extends Attempt {
  /** Counts the attempts of one game from 0. */
  index: number;
  before: GameState;
  result: ActionResult;
  /** The state after the attempt: the result's state, or `before` itself if the attempt was rejected. */
  after: GameState;
}

function movingUnit(unit: UnitView): { owner: PlayerId; type: UnitView['type']; tile: TileIndex; movesLeft: number } {
  return { owner: unit.owner, type: unit.type, tile: unit.tile, movesLeft: unit.own === null ? 0 : unit.own.movesLeft };
}

/**
 * An action a reasonable client could send right now, or null if the player
 * has ended the turn and stays put. Built from the view alone.
 *
 * Roughly, of 100 actions: up to 30 found a city (when a Settler can), up to
 * 25 more set a Worker or a Fishing Boat to work (when one stands where it
 * can build), about 40 move a unit that is free to move (a boat over
 * water: the tiles come from the same reach function the page lights them
 * with), 14 edit a build queue, 2 press the other of a city's two "Grow
 * first / Build first" buttons, and the rest end the turn. A unit at work
 * is never moved; about once in 200 actions a job is given up.
 */
export function sensibleAction(rng: RngState, view: PlayerView): Action | null {
  const me = view.players.find((player) => player.id === view.you);
  if (me === undefined) return null;
  if (me.endedTurn) return nextInt(rng, 5) === 0 ? { type: 'cancelEndTurn' } : null;

  const myUnits = view.units.filter((unit) => unit.own !== null);
  const myCities = view.cities.filter((city) => city.own !== null);
  const roll = nextInt(rng, 100);

  // Settle early and often: a game without cities exercises very little.
  const founders = myUnits.filter((unit) => unit.own !== null && unit.own.foundCityError === null);
  if (founders.length > 0 && roll < 30) return { type: 'foundCity', unitId: pick(rng, founders).id };

  // Put Workers and Fishing Boats to work where they stand, as a client
  // does: with a job the unit's own view offers (an option without an error).
  const idleBuilders = myUnits.filter((unit) => unit.own !== null && unit.own.jobOptions.some((option) => option.error === null));
  if (idleBuilders.length > 0 && roll < 55) {
    const unit = pick(rng, idleBuilders);
    const offered = unit.own === null ? [] : unit.own.jobOptions.filter((option) => option.error === null);
    return { type: 'startJob', unitId: unit.id, improvement: pick(rng, offered).improvement };
  }

  if (roll < 72) {
    // A unit at work stays where it is: a client offers it no tiles to go to.
    const movable = myUnits.filter((unit) => unit.own !== null && unit.own.movesLeft > 0 && unit.own.job === null);
    if (movable.length > 0) {
      const unit = pick(rng, movable);
      const reach = reachableTiles(boardFromView(view), movingUnit(unit));
      if (reach.size > 0) {
        const target = pick(rng, [...reach.keys()]);
        const path = pathTo(reach, target);
        if (path !== null) return { type: 'moveUnit', unitId: unit.id, path };
      }
    }
  }

  if (roll < 86 && myCities.length > 0) return queueEdit(rng, pick(rng, myCities));

  // Now and then a city is told to place its citizens the other way: a
  // press on the button that is not sunk.
  if (roll < 88 && myCities.length > 0) {
    const city = pick(rng, myCities);
    const other = city.own !== null && city.own.focus === 'grow' ? 'build' : 'grow';
    return { type: 'setCityFocus', cityId: city.id, focus: other };
  }

  // Now and then somebody changes their mind about a job.
  const atWork = myUnits.filter((unit) => unit.own !== null && unit.own.job !== null);
  if (roll === 88 && atWork.length > 0 && nextInt(rng, 2) === 0) return { type: 'stopJob', unitId: pick(rng, atWork).id };

  return { type: 'endTurn' };
}

/**
 * One press of a button of the city panel: the whole list the client would
 * send, made from the queue in its own view. Of 100 edits about 70 add an
 * item at the end, 15 swap two neighbors, 10 remove an entry and 5 empty the
 * queue; so queues fill up and cities keep building. An empty queue always
 * gets an item, a full one never does, and a queue of one entry, which has
 * nothing to swap, gets a second one instead.
 *
 * An item that is added is one of those the city's own menu OFFERS (an
 * option whose addError is null): the add buttons that are not greyed. So a
 * city without water never asks for a boat, as no page would.
 */
function queueEdit(rng: RngState, city: CityView): Action {
  const current: BuildItem[] =
    city.own === null ? [] : city.own.buildQueue.map((row): BuildItem => ({ kind: 'unit', unitType: row.item.unitType }));
  const full = current.length >= RULES.maxQueueLength;
  const roll = nextInt(rng, 100);

  let queue: BuildItem[];
  if (current.length === 0 || (roll < 70 && !full) || (roll < 85 && current.length === 1)) {
    const offered = city.own === null ? [] : city.own.buildOptions.filter((option) => option.addError === null);
    // Nothing on offer cannot happen here (the queue is not full, and a land unit can always be added); the queue then stays as it is.
    queue = offered.length === 0 ? current : [...current, { kind: 'unit', unitType: pick(rng, offered).item.unitType }];
  } else if (roll < 85) {
    const upper = nextInt(rng, current.length - 1);
    queue = [...current];
    queue[upper] = current[upper + 1];
    queue[upper + 1] = current[upper];
  } else if (roll < 95) {
    const gone = nextInt(rng, current.length);
    queue = current.filter((_, index) => index !== gone);
  } else {
    queue = [];
  }
  return { type: 'setBuildQueue', cityId: city.id, queue };
}

/**
 * The next thing a player with a plan would do to get an improvement built,
 * or null if there is nothing to do right now: keep a builder (a Worker, or
 * with `builder` 'fishingBoat' a Fishing Boat) first in the queue of the
 * first city that can build one until there is such a unit; then bring it
 * to a tile of the player's own land where it can build; then set it to
 * work. Chosen from the player's own view alone, as a client would.
 *
 * Tests call it on top of random play, or instead of it, where "this player
 * gets an improvement built" must not hang on the dice (the twin worlds,
 * the games that go on from an older save).
 */
export function nextStepOfThePlan(view: PlayerView, builder: UnitTypeId = 'worker'): Action | null {
  const builders = view.units.filter((unit) => unit.own !== null && unit.type === builder);
  if (builders.length === 0) {
    // The first city whose menu does not rule the builder out for good (a boat needs water in the city's land).
    const city = view.cities.find(
      (candidate) => candidate.own !== null && candidate.own.buildOptions.some((option) => option.item.unitType === builder && option.addError !== 'noWaterForBoat'),
    );
    if (city === undefined || city.own === null) return null;
    const current = city.own.buildQueue.map((row): BuildItem => ({ kind: 'unit', unitType: row.item.unitType }));
    if (current.length > 0 && current[0].unitType === builder) return null;
    const first: BuildItem = { kind: 'unit', unitType: builder };
    return { type: 'setBuildQueue', cityId: city.id, queue: [first, ...current].slice(0, RULES.maxQueueLength) };
  }

  const unit = builders[0];
  if (unit.own === null || unit.own.job !== null) return null;
  const offered = unit.own.jobOptions.find((option) => option.error === null);
  if (offered !== undefined) return { type: 'startJob', unitId: unit.id, improvement: offered.improvement };

  // Nothing to build where it stands: the nearest tile (lowest index) it can reach this turn where it can build something.
  const reach = reachableTiles(boardFromView(view), { owner: unit.owner, type: unit.type, tile: unit.tile, movesLeft: unit.own.movesLeft });
  const sites = [...reach.keys()]
    .filter((tile) => UNITS[builder].improvements.some((improvement) => improvementSiteError(siteInView(view, tile), improvement) === null))
    .sort((a, b) => a - b);
  if (sites.length === 0) return null;
  const path = pathTo(reach, sites[0]);
  return path === null ? null : { type: 'moveUnit', unitId: unit.id, path };
}

/** A step-by-step walk over neighboring tiles, whatever they are: valid as geometry, often not as a move. */
function blindWalk(rng: RngState, state: GameState, from: TileIndex, length: number): TileIndex[] {
  const path: TileIndex[] = [];
  let tile = from;
  for (let i = 0; i < length; i++) {
    tile = pick(rng, neighbors(tile, state.map));
    path.push(tile);
  }
  return path;
}

/**
 * Something a well-behaved client would not send: wrong turn numbers,
 * strangers, nonsense, other players' things, impossible paths, blind walks
 * into the unknown (a land unit into the sea, a boat up the beach), queues
 * that are too long or hold things no city can build, boats for cities
 * that own no water, jobs for units that cannot work, nets from Workers and
 * farms from Fishing Boats, improvements that do not exist, marching orders
 * for a unit at work, a way of placing citizens that is none and somebody
 * else's city told how to place its own. Some of them happen to be legal;
 * most are not. Chosen with knowledge of the whole state (as a cheater with
 * a memory dump would).
 */
export function wildAttempt(rng: RngState, state: GameState, playerId: PlayerId): Attempt {
  const units = Object.values(state.units);
  const cities = Object.values(state.cities);
  const own = units.filter((unit) => unit.owner === playerId);
  const foreign = units.filter((unit) => unit.owner !== playerId);
  const ownCities = cities.filter((city) => city.owner === playerId);
  const foreignCities = cities.filter((city) => city.owner !== playerId);

  const madeUpIds = ['u1_nobody', 'c1_nowhere', 'constructor', '__proto__', 'toString', ''];
  const anyOwnUnitId = own.length > 0 ? pick(rng, own).id : pick(rng, madeUpIds);
  const anyOwnUnitTile = own.length > 0 ? own[0].tile : 0;
  const anyForeignUnitId = foreign.length > 0 ? pick(rng, foreign).id : pick(rng, madeUpIds);
  const anyOwnCityId = ownCities.length > 0 ? pick(rng, ownCities).id : pick(rng, madeUpIds);
  const anyForeignCityId = foreignCities.length > 0 ? pick(rng, foreignCities).id : pick(rng, madeUpIds);

  const attempt = (action: unknown, turn: number = state.turn, as: PlayerId = playerId): Attempt => ({
    playerId: as,
    turn,
    action: action as Action,
    sensible: false,
  });

  const item = (unitType: string): unknown => ({ kind: 'unit', unitType });
  const improvementNames: unknown[] = [...IMPROVEMENT_IDS, 'dragon', 'constructor', '__proto__', '', 5, null];
  const atWork = own.filter((unit) => unit.job !== null);

  const boats = UNIT_TYPE_IDS.filter((type) => UNITS[type].domain === 'sea');

  switch (nextInt(rng, 32)) {
    case 0:
      return attempt({ type: 'endTurn' }, state.turn + (nextInt(rng, 2) === 0 ? -1 : 1));
    case 1: {
      const usual = sensibleAction(rng, buildPlayerView(state, playerId)) ?? { type: 'endTurn' };
      return attempt(usual, state.turn + (nextInt(rng, 2) === 0 ? -1 : 1));
    }
    case 2:
      return attempt({ type: 'endTurn' }, state.turn, pick(rng, ['p9', 'nobody', '', 'constructor']));
    case 3:
      return attempt(
        pick(rng, [
          { type: 'dance' },
          null,
          {},
          'endTurn',
          { type: 'moveUnit', unitId: 5, path: 'east' },
          { type: 'moveUnit', unitId: anyOwnUnitId },
          { type: 'foundCity' },
          // The action phase 1 had is no action any more.
          { type: 'setProduction', cityId: anyOwnCityId, item: item('warrior') },
          { type: 'setBuildQueue', cityId: anyOwnCityId },
          { type: 'setBuildQueue', queue: [] },
          { type: 'startJob', unitId: anyOwnUnitId },
          { type: 'startJob', improvement: 'farm' },
          { type: 'stopJob' },
          { type: 'stopJob', unitId: 7 },
          { type: 'setCityFocus', cityId: anyOwnCityId },
          { type: 'setCityFocus', focus: 'build' },
          { type: 'setCityFocus', cityId: anyOwnCityId, focus: 5 },
          { type: 'setCityFocus', cityId: anyOwnCityId, focus: null },
          { type: 'setCityFocus', cityId: 7, focus: 'grow' },
        ]),
      );
    case 4: {
      const victim = foreign.length > 0 ? pick(rng, foreign) : null;
      const path = victim === null ? [0] : blindWalk(rng, state, victim.tile, 1);
      return attempt({ type: 'moveUnit', unitId: victim === null ? pick(rng, madeUpIds) : victim.id, path });
    }
    case 5:
      return attempt({ type: 'moveUnit', unitId: pick(rng, madeUpIds), path: blindWalk(rng, state, anyOwnUnitTile, 1) });
    case 6: {
      const farAway = nextInt(rng, tileCount(state.map));
      const tooLong = blindWalk(rng, state, anyOwnUnitTile, RULES.maxPathLength + 1);
      const badPaths: unknown[] = [[], [farAway], [-1], [tileCount(state.map)], [anyOwnUnitTile + 0.5], ['3'], [null], tooLong];
      return attempt({ type: 'moveUnit', unitId: anyOwnUnitId, path: pick(rng, badPaths) });
    }
    case 7:
    case 8:
    case 24:
    case 25: {
      const unit = own.length > 0 ? pick(rng, own) : null;
      const length = 1 + nextInt(rng, 6);
      const path = unit === null ? [0] : blindWalk(rng, state, unit.tile, length);
      return attempt({ type: 'moveUnit', unitId: unit === null ? anyOwnUnitId : unit.id, path });
    }
    case 9:
    case 26: {
      // A long blind walk: the client would never plan it, the server must still walk it honestly.
      const unit = own.length > 0 ? pick(rng, own) : null;
      const path = unit === null ? [0] : blindWalk(rng, state, unit.tile, RULES.maxPathLength);
      return attempt({ type: 'moveUnit', unitId: unit === null ? anyOwnUnitId : unit.id, path });
    }
    case 10:
      return attempt({ type: 'foundCity', unitId: anyOwnUnitId });
    case 11:
      return attempt({ type: 'foundCity', unitId: nextInt(rng, 2) === 0 ? anyForeignUnitId : pick(rng, madeUpIds) });
    case 12: {
      // Somebody else's city, or none at all: whatever the list is, also one that is too long or full of nonsense.
      const lists: unknown[] = [
        [item('warrior')],
        [],
        [item('dragon')],
        Array.from({ length: RULES.maxQueueLength + 1 }, () => item('scout')),
      ];
      return attempt({
        type: 'setBuildQueue',
        cityId: nextInt(rng, 2) === 0 ? anyForeignCityId : pick(rng, madeUpIds),
        queue: pick(rng, lists),
      });
    }
    case 13: {
      // One entry that is not an item, among good ones: first, in the middle or last.
      const bad = pick(rng, [
        { kind: 'building', unitType: 'warrior' },
        { kind: 'unit', unitType: 'dragon' },
        { kind: 'unit', unitType: 'constructor' },
        { kind: 'unit', unitType: 3 },
        { kind: 'unit' },
        {},
        null,
        3,
        'warrior',
        [item('warrior')],
      ]);
      const before = Array.from({ length: nextInt(rng, 3) }, () => item(pick(rng, UNIT_TYPE_IDS)));
      const after = Array.from({ length: nextInt(rng, 3) }, () => item(pick(rng, UNIT_TYPE_IDS)));
      return attempt({ type: 'setBuildQueue', cityId: anyOwnCityId, queue: [...before, bad, ...after] });
    }
    case 14:
      return attempt({ type: nextInt(rng, 2) === 0 ? 'endTurn' : 'cancelEndTurn' });
    case 15: {
      // A list that is too long, by one entry and by many; the entries themselves may be nonsense too.
      const length = RULES.maxQueueLength + pick(rng, [1, 2, 12, 56]);
      const nonsense = nextInt(rng, 3) === 0;
      const queue = Array.from({ length }, () => (nonsense ? item('dragon') : item(pick(rng, UNIT_TYPE_IDS))));
      return attempt({ type: 'setBuildQueue', cityId: anyOwnCityId, queue });
    }
    case 16:
      // A queue that is not a list.
      return attempt({
        type: 'setBuildQueue',
        cityId: anyOwnCityId,
        queue: pick(rng, [null, 'warrior', {}, 5, item('warrior'), { 0: item('warrior'), length: 1 }] as unknown[]),
      });
    case 17:
      return attempt({
        type: 'startJob',
        unitId: nextInt(rng, 2) === 0 ? anyForeignUnitId : pick(rng, madeUpIds),
        improvement: pick(rng, IMPROVEMENT_IDS),
      });
    case 18: {
      // A unit that can build, wherever it happens to stand: in a city, on
      // foreign land, in a forest, on a finished farm, at work already. And
      // whatever it is asked for: a Worker for a net, a Fishing Boat for a farm.
      const builders = own.filter((unit) => UNITS[unit.type].improvements.length > 0);
      const unitId = builders.length > 0 ? pick(rng, builders).id : anyOwnUnitId;
      return attempt({ type: 'startJob', unitId, improvement: pick(rng, IMPROVEMENT_IDS) });
    }
    case 19:
      // One's own unit, whatever it is, and any name for the improvement.
      return attempt({ type: 'startJob', unitId: anyOwnUnitId, improvement: pick(rng, improvementNames) });
    case 20:
      return attempt({ type: 'stopJob', unitId: nextInt(rng, 2) === 0 ? anyForeignUnitId : pick(rng, madeUpIds) });
    case 21:
      return attempt({ type: 'stopJob', unitId: atWork.length > 0 && nextInt(rng, 4) > 0 ? pick(rng, atWork).id : anyOwnUnitId });
    case 22:
    case 23: {
      // Moving a unit that is at work (or any own unit, while nobody works): a good path, a bad one, a blind one.
      const unit = atWork.length > 0 ? pick(rng, atWork) : own.length > 0 ? pick(rng, own) : null;
      if (unit === null) return attempt({ type: 'moveUnit', unitId: anyOwnUnitId, path: [0] });
      const path = nextInt(rng, 4) === 0 ? [] : blindWalk(rng, state, unit.tile, 1 + nextInt(rng, 2));
      return attempt({ type: 'moveUnit', unitId: unit.id, path });
    }
    case 27: {
      // A boat for one's own city, whether it owns water or not: alone, or among land units.
      const boat = item(pick(rng, boats));
      const others = Array.from({ length: nextInt(rng, 3) }, () => item(pick(rng, UNIT_TYPE_IDS)));
      return attempt({ type: 'setBuildQueue', cityId: anyOwnCityId, queue: nextInt(rng, 2) === 0 ? [boat, ...others] : [...others, boat] });
    }
    case 28:
      // A way of placing citizens that is none, for one's own city.
      return attempt({
        type: 'setCityFocus',
        cityId: anyOwnCityId,
        focus: pick(rng, ['', 'Build', 'GROW', 'fast', 'constructor', '__proto__', 'toString', 'grow ']),
      });
    case 29:
      // Somebody else's city, or none at all, told how to place its citizens.
      return attempt({
        type: 'setCityFocus',
        cityId: nextInt(rng, 2) === 0 ? anyForeignCityId : pick(rng, madeUpIds),
        focus: pick(rng, [...CITY_FOCUS_IDS, 'fast']),
      });
    case 30:
      // One's own city and a real choice, also the one it has already: mostly legal.
      return attempt({ type: 'setCityFocus', cityId: anyOwnCityId, focus: pick(rng, CITY_FOCUS_IDS) });
    default: {
      // Any list of real items for one's own city: mostly legal.
      const queue = Array.from({ length: nextInt(rng, RULES.maxQueueLength + 1) }, () => item(pick(rng, UNIT_TYPE_IDS)));
      return attempt({ type: 'setBuildQueue', cityId: anyOwnCityId, queue });
    }
  }
}

// ---------------------------------------------------------------------------
// The game loop
// ---------------------------------------------------------------------------

export interface RandomGameOptions {
  /** The state to start from. */
  start: GameState;
  /** Seed of this game's dice (which player acts, what they try). */
  seed: string;
  /** Stop when this many turns have been resolved. */
  turns: number;
  /** Out of 100 attempts, how many are wild rather than sensible. */
  wildShare: number;
  /** Called after every attempt. */
  onStep?: (step: Step) => void;
  /**
   * Called before every attempt with the current state; what it returns is
   * played on. Lets a test swap in a saved-and-loaded copy in mid-game.
   */
  reload?: (state: GameState, index: number) => GameState;
}

/**
 * Plays a random game and returns its final state. Every state is
 * deep-frozen before it is handed to the engine, so an engine that edited
 * its input would crash here.
 *
 * Players act in random order. So that the game moves on, a turn gets a
 * fixed budget of attempts; when it is used up, everybody who has not ended
 * the turn does so, in seat order.
 */
export function playRandomGame(options: RandomGameOptions): GameState {
  const rng = seedRng(options.seed, 'random-play');
  const lastTurn = options.start.turn + options.turns;
  let state = options.start;
  let index = 0;
  let attemptsThisTurn = 0;

  while (state.turn < lastTurn) {
    if (options.reload !== undefined) state = options.reload(state, index);
    const budget = 14 * state.players.length;
    // A turn must be over once its budget is spent and everybody has been
    // asked to end it. If it is not, the rules are stuck; say so instead of
    // going round for ever (a test's time limit cannot stop a busy loop).
    if (attemptsThisTurn > budget + state.players.length) {
      throw new Error(`playRandomGame: turn ${state.turn} does not end although everybody has ended it`);
    }

    let attempt: Attempt | null;
    if (attemptsThisTurn >= budget) {
      const straggler = state.players.find((player) => !player.endedTurn);
      if (straggler === undefined) throw new Error('playRandomGame: everybody has ended, yet the turn did not resolve');
      attempt = { playerId: straggler.id, turn: state.turn, action: { type: 'endTurn' }, sensible: true };
    } else {
      const playerId = pick(rng, state.players).id;
      if (nextInt(rng, 100) < options.wildShare) {
        attempt = wildAttempt(rng, state, playerId);
      } else {
        const action = sensibleAction(rng, buildPlayerView(state, playerId));
        attempt = action === null ? null : { playerId, turn: state.turn, action, sensible: true };
      }
    }
    attemptsThisTurn += 1;
    if (attempt === null) continue;

    const result = applyAction(deepFreeze(state), attempt.playerId, attempt.turn, attempt.action);
    const after = result.ok ? result.state : state;
    if (options.onStep !== undefined) options.onStep({ ...attempt, index, before: state, result, after });

    if (after.turn !== state.turn) attemptsThisTurn = 0;
    state = after;
    index += 1;
  }
  return state;
}

// ---------------------------------------------------------------------------
// The referee: what must the answer be, judging by the player's view alone?
// ---------------------------------------------------------------------------

/**
 * The error code the rules must give for an action (null = accepted),
 * worked out from NOTHING but the acting player's own view, the turn number
 * and the action. It is written by hand from the doc comment of applyAction
 * and deliberately shares no code with the engine.
 *
 * Why it matters: if this referee, who cannot see hidden things, always
 * predicts the engine's answer, then the answer cannot depend on hidden
 * things, so error codes give nothing away.
 *
 * `view` is null for somebody who is not a player of the game.
 */
export function refereeFromView(view: PlayerView | null, turn: number, action: unknown): RuleErrorCode | null {
  if (view === null || !looksLikeAnAction(action)) return 'badAction';
  if (turn !== view.turn) return 'staleTurn';

  const me = view.players.find((player) => player.id === view.you);
  if (me !== undefined && me.endedTurn) {
    if (action.type === 'endTurn') return null;
    if (action.type !== 'cancelEndTurn') return 'turnAlreadyEnded';
  }

  if (action.type === 'moveUnit') {
    const unit = view.units.find((candidate) => candidate.id === action.unitId && candidate.own !== null);
    if (unit === undefined || unit.own === null) return 'noSuchUnit';

    const path = action.path as unknown[];
    if (path.length === 0 || path.length > RULES.maxPathLength) return 'badPath';
    let previous = unit.tile;
    for (const entry of path) {
      if (typeof entry !== 'number' || !isValidTile(entry, view)) return 'badPath';
      if (distance(previous, entry, view) !== 1) return 'badPath';
      previous = entry;
    }
    if (unit.own.job !== null) return 'unitBusy';
    if (unit.own.movesLeft <= 0) return 'noMovesLeft';
    return firstStepFromView(view, unit, path[0] as TileIndex);
  }

  if (action.type === 'foundCity') {
    const unit = view.units.find((candidate) => candidate.id === action.unitId && candidate.own !== null);
    if (unit === undefined || unit.own === null) return 'noSuchUnit';
    return foundingFromView(view, unit, unit.own.movesLeft);
  }

  if (action.type === 'setBuildQueue') {
    const city = view.cities.find((candidate) => candidate.id === action.cityId && candidate.own !== null);
    if (city === undefined) return 'noSuchCity';
    const queue = action.queue as unknown[];
    if (queue.length > RULES.maxQueueLength) return 'queueFull';
    const wanted: UnitTypeId[] = [];
    for (const entry of queue) {
      if (typeof entry !== 'object' || entry === null) return 'cannotBuild';
      const item = entry as { kind?: unknown; unitType?: unknown };
      const known = UNIT_TYPE_IDS.find((id) => id === item.unitType);
      if (item.kind !== 'unit' || known === undefined) return 'cannotBuild';
      wanted.push(known);
    }
    // Only when every entry is an item: the first one this city can never build.
    for (const unitType of wanted) {
      if (UNITS[unitType].domain === 'sea' && !cityHasWaterInView(view, city)) return 'noWaterForBoat';
    }
    return null; // the same queue again is accepted too (as a no-op)
  }

  if (action.type === 'setCityFocus') {
    const city = view.cities.find((candidate) => candidate.id === action.cityId && candidate.own !== null);
    if (city === undefined) return 'noSuchCity';
    const wanted: unknown = action.focus;
    if (wanted !== 'grow' && wanted !== 'build') return 'badAction';
    return null; // the focus the city has already is accepted too (as a no-op)
  }

  if (action.type === 'startJob') {
    const unit = view.units.find((candidate) => candidate.id === action.unitId && candidate.own !== null);
    if (unit === undefined || unit.own === null) return 'noSuchUnit';
    const wanted: unknown = action.improvement;
    if (unit.own.job !== null && unit.own.job.improvement === wanted) return null; // the job it is doing: a no-op
    const improvement = IMPROVEMENT_IDS.find((id) => id === wanted);
    // Read from the unit table, not from the options the view carries for the unit: the referee is there to check those.
    if (improvement === undefined || !UNITS[unit.type].improvements.includes(improvement)) return 'cannotImprove';
    if (unit.own.job !== null) return 'unitBusy';
    return buildingFromView(view, unit.tile, improvement);
  }

  if (action.type === 'stopJob') {
    const unit = view.units.find((candidate) => candidate.id === action.unitId && candidate.own !== null);
    return unit === undefined ? 'noSuchUnit' : null; // without a job it is a no-op
  }

  return null; // endTurn and cancelEndTurn are always accepted
}

/**
 * May the improvement be built on `tile`, as far as the player can see? Read
 * from the view's tiles and cities and the improvement table, and on purpose
 * NOT from the ready-made answers the view carries (OwnUnitDetail.jobOptions):
 * the referee is there to check those.
 */
function buildingFromView(view: PlayerView, tile: TileIndex, improvement: ImprovementId): RuleErrorCode | null {
  const ground: TileView | null = view.tiles[tile];
  if (ground === null || ground.owner !== view.you) return 'notYourLand';
  for (const city of view.cities) {
    if (city.tile === tile) return 'cityOnTile';
  }
  let groundFits = false;
  for (const terrain of IMPROVEMENTS[improvement].terrains) {
    if (terrain !== ground.terrain) continue;
    for (const feature of IMPROVEMENTS[improvement].features) {
      if (feature === ground.feature) groundFits = true;
    }
  }
  if (!groundFits) return 'badImprovementTile';
  if (ground.improvement === improvement) return 'alreadyImproved';
  return null;
}

/**
 * Does this city of the viewer own a tile a boat can enter, as far as the
 * view says? A view tells whose a tile is, not which CITY's, so the
 * referee cannot always count a city's water itself. It reads the tiles
 * where they leave no doubt, and the city's own menu otherwise:
 *  - no water tile of the viewer's within the claim radius of the city:
 *    the city owns none;
 *  - a water tile of the viewer's within the claim radius of this city and
 *    of no other city of theirs: it is this city's (a city only ever claims
 *    tiles within that radius);
 *  - otherwise (water that two of the viewer's cities could both have
 *    claimed): what the city's menu says about a boat, the ready-made
 *    answer of the view (BuildOption.addError). The whole-game tests hold
 *    that answer against the true land of every city.
 * Everything it reads is the viewer's own land, which is always in sight.
 */
function cityHasWaterInView(view: PlayerView, city: CityView): boolean {
  const others = view.cities.filter((candidate) => candidate.own !== null && candidate.id !== city.id);
  let waterNearby = false;
  for (let tile = 0; tile < view.tiles.length; tile++) {
    const ground = view.tiles[tile];
    if (ground === null || ground.owner !== view.you || tileMoveCost(ground, 'sea') === null) continue;
    if (distance(city.tile, tile, view) > RULES.cityClaimRadius) continue;
    waterNearby = true;
    if (others.every((other) => distance(other.tile, tile, view) > RULES.cityClaimRadius)) return true;
  }
  if (!waterNearby) return false;
  const boat = city.own === null ? undefined : city.own.buildOptions.find((option) => UNITS[option.item.unitType].domain === 'sea');
  return boat !== undefined && boat.addError !== 'noWaterForBoat';
}

/** The referee's own reading of "is this an action at all". */
function looksLikeAnAction(action: unknown): action is Action {
  if (typeof action !== 'object' || action === null) return false;
  const fields = action as Record<string, unknown>;
  if (fields.type === 'endTurn' || fields.type === 'cancelEndTurn') return true;
  if (fields.type === 'foundCity') return typeof fields.unitId === 'string';
  if (fields.type === 'moveUnit') return typeof fields.unitId === 'string' && Array.isArray(fields.path);
  if (fields.type === 'setBuildQueue') return typeof fields.cityId === 'string' && Array.isArray(fields.queue);
  if (fields.type === 'setCityFocus') return typeof fields.cityId === 'string' && typeof fields.focus === 'string';
  if (fields.type === 'startJob') return typeof fields.unitId === 'string' && typeof fields.improvement === 'string';
  if (fields.type === 'stopJob') return typeof fields.unitId === 'string';
  return false;
}

/** May the unit take a first step onto `tile`, as far as its owner can see? */
function firstStepFromView(view: PlayerView, unit: UnitView, tile: TileIndex): RuleErrorCode | null {
  const ground = view.tiles[tile];
  // The ground the unit's own domain cannot enter: water for a land unit, land for a boat, mountains and the unknown for both.
  if (ground === null || tileMoveCost(ground, UNITS[unit.type].domain) === null) return 'impassable';
  for (const city of view.cities) {
    if (city.tile === tile && city.owner !== view.you) return 'blocked';
  }
  for (const other of view.units) {
    if (other.tile !== tile) continue;
    if (other.owner !== view.you) return 'blocked';
    if (UNITS[other.type].unitClass === UNITS[unit.type].unitClass) return 'blocked';
  }
  return null;
}

/** May the unit found a city where it stands, as far as its owner can see? */
function foundingFromView(view: PlayerView, unit: UnitView, movesLeft: number): RuleErrorCode | null {
  if (!UNITS[unit.type].canFoundCity) return 'cannotFoundCity';
  if (movesLeft <= 0) return 'noMovesLeft';
  const ground = view.tiles[unit.tile];
  if (ground === null) return 'badCityTile'; // cannot happen: a player always sees the tiles of their own units
  if (!tileAllowsCity(ground)) return 'badCityTile';
  if (ground.owner !== null && ground.owner !== view.you) return 'tileOwned';
  for (const city of view.cities) {
    if (distance(city.tile, unit.tile, view) < RULES.minCityDistance) return 'tooCloseToCity';
  }
  return null;
}
