/**
 * Random games for the robustness, determinism and no-leak tests (work
 * package WP2). Not a test file.
 *
 * Three parts:
 *  - `sensibleAction`: what a well-behaved client might send, chosen from
 *    the player's own VIEW only (never from the hidden state);
 *  - `wildAttempt`: what a broken or malicious client might send;
 *  - `playRandomGame`: the loop that mixes the two for several players over
 *    many turns and reports every step to the test.
 *
 * Everything is driven by the seeded generator of rng.ts, so a failing game
 * can be replayed exactly from its seed.
 */

import {
  RULES,
  UNITS,
  UNIT_TYPE_IDS,
  applyAction,
  boardFromView,
  buildPlayerView,
  distance,
  isValidTile,
  neighbors,
  nextInt,
  pathTo,
  pick,
  reachableTiles,
  seedRng,
  tileAllowsCity,
  tileCount,
  tileMoveCost,
} from '../src/index';
import type {
  Action,
  ActionResult,
  GameState,
  PlayerId,
  PlayerView,
  RngState,
  RuleErrorCode,
  TileIndex,
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

  if (roll < 72) {
    const movable = myUnits.filter((unit) => unit.own !== null && unit.own.movesLeft > 0);
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

  if (roll < 88 && myCities.length > 0) {
    return {
      type: 'setProduction',
      cityId: pick(rng, myCities).id,
      item: { kind: 'unit', unitType: pick(rng, UNIT_TYPE_IDS) },
    };
  }

  return { type: 'endTurn' };
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
 * into the unknown. Some of them happen to be legal; most are not. Chosen
 * with knowledge of the whole state (as a cheater with a memory dump would).
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

  switch (nextInt(rng, 16)) {
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
          { type: 'setProduction', cityId: anyOwnCityId, item: null },
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
    case 8: {
      const unit = own.length > 0 ? pick(rng, own) : null;
      const length = 1 + nextInt(rng, 6);
      const path = unit === null ? [0] : blindWalk(rng, state, unit.tile, length);
      return attempt({ type: 'moveUnit', unitId: unit === null ? anyOwnUnitId : unit.id, path });
    }
    case 9: {
      // A long blind walk: the client would never plan it, the server must still walk it honestly.
      const unit = own.length > 0 ? pick(rng, own) : null;
      const path = unit === null ? [0] : blindWalk(rng, state, unit.tile, RULES.maxPathLength);
      return attempt({ type: 'moveUnit', unitId: unit === null ? anyOwnUnitId : unit.id, path });
    }
    case 10:
      return attempt({ type: 'foundCity', unitId: anyOwnUnitId });
    case 11:
      return attempt({ type: 'foundCity', unitId: nextInt(rng, 2) === 0 ? anyForeignUnitId : pick(rng, madeUpIds) });
    case 12:
      return attempt({
        type: 'setProduction',
        cityId: nextInt(rng, 2) === 0 ? anyForeignCityId : pick(rng, madeUpIds),
        item: { kind: 'unit', unitType: 'warrior' },
      });
    case 13:
      return attempt({
        type: 'setProduction',
        cityId: anyOwnCityId,
        item: pick(rng, [
          { kind: 'building', unitType: 'warrior' },
          { kind: 'unit', unitType: 'dragon' },
          { kind: 'unit', unitType: 'constructor' },
          { kind: 'unit' },
          {},
        ]),
      });
    case 14:
      return attempt({ type: nextInt(rng, 2) === 0 ? 'endTurn' : 'cancelEndTurn' });
    default:
      return attempt({ type: 'setProduction', cityId: anyOwnCityId, item: { kind: 'unit', unitType: pick(rng, UNIT_TYPE_IDS) } });
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
    if (unit.own.movesLeft <= 0) return 'noMovesLeft';
    return firstStepFromView(view, unit, path[0] as TileIndex);
  }

  if (action.type === 'foundCity') {
    const unit = view.units.find((candidate) => candidate.id === action.unitId && candidate.own !== null);
    if (unit === undefined || unit.own === null) return 'noSuchUnit';
    return foundingFromView(view, unit, unit.own.movesLeft);
  }

  if (action.type === 'setProduction') {
    const city = view.cities.find((candidate) => candidate.id === action.cityId && candidate.own !== null);
    if (city === undefined) return 'noSuchCity';
    const item = action.item as { kind?: unknown; unitType?: unknown };
    const known = (UNIT_TYPE_IDS as readonly unknown[]).includes(item.unitType);
    return item.kind === 'unit' && known ? null : 'cannotBuild';
  }

  return null; // endTurn and cancelEndTurn are always accepted
}

/** The referee's own reading of "is this an action at all". */
function looksLikeAnAction(action: unknown): action is Action {
  if (typeof action !== 'object' || action === null) return false;
  const fields = action as Record<string, unknown>;
  if (fields.type === 'endTurn' || fields.type === 'cancelEndTurn') return true;
  if (fields.type === 'foundCity') return typeof fields.unitId === 'string';
  if (fields.type === 'moveUnit') return typeof fields.unitId === 'string' && Array.isArray(fields.path);
  if (fields.type === 'setProduction') {
    return typeof fields.cityId === 'string' && typeof fields.item === 'object' && fields.item !== null;
  }
  return false;
}

/** May the unit take a first step onto `tile`, as far as its owner can see? */
function firstStepFromView(view: PlayerView, unit: UnitView, tile: TileIndex): RuleErrorCode | null {
  const ground = view.tiles[tile];
  if (ground === null || tileMoveCost(ground) === null) return 'impassable';
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
