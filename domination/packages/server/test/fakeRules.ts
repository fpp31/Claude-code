/**
 * A tiny stand-in for the rules engine, for server tests (owned by WP3).
 *
 * The server never looks inside a game state, so lobby, reconnect,
 * persistence and failure tests do not need the real game: they need rules
 * that are simple enough to predict and that can be told to fail.
 *
 * The fake game:
 *  - the map is sampleMap(); every player has exactly ONE unit, a Warrior
 *    whose id is fakeUnitId(player), standing on tile 0;
 *  - a player sees only their OWN unit (total fog for units), the turn
 *    number and the public player list. So moving a unit changes the view of
 *    its owner and of nobody else, and ending a turn changes everybody's;
 *  - moveUnit puts the unit on the last tile of the path, endTurn /
 *    cancelEndTurn work like the real ones (the turn advances when everybody
 *    has ended), and foundCity, setBuildQueue, startJob and stopJob are
 *    always refused.
 *
 * Failures are switched on through the `control` object, from the test.
 */

import { STATE_SCHEMA, ruleError, seedRng } from '@domination/shared';
import type {
  Action,
  ActionResult,
  AddressedEvent,
  GameEvent,
  GameSetup,
  GameState,
  PlayerId,
  PlayerView,
  RuleErrorCode,
} from '@domination/shared';
import { sampleMap, sampleView } from '@domination/shared/testing';
import type { Rules } from '../src/rules';

/** A string no real message contains. Exceptions thrown by the fake carry it, so tests can prove it never reaches a client. */
export const CANARY = 'CANARY-7f3a-hidden-unit-u9_zzzzzz';

export interface FakeRulesControl {
  /** While true, applyAction throws (with CANARY in the text). */
  applyActionThrows: boolean;
  /** While true, createGame throws (with CANARY in the text). */
  createGameThrows: boolean;
  /** buildPlayerView throws for this player (with CANARY in the text); null = for nobody. */
  viewThrowsFor: PlayerId | null;
  /**
   * While true, every refusal carries more than a rule error should: a text
   * of its own (with CANARY in it) and an extra field. The server must pass
   * on the code and the standard sentence only.
   */
  talkativeRefusals: boolean;
  /** What checkInvariants reports for every game. */
  invariantProblems: string[];
  /** Every setup createGame was called with, in order. */
  setups: GameSetup[];
  /** How often applyAction was called. */
  actionCalls: number;
}

/** The id of a player's one unit in the fake game: 'p2' -> 'u2_fake00'. */
export function fakeUnitId(playerId: PlayerId): string {
  return `u${playerId.slice(1)}_fake00`;
}

export function createFakeRules(): { rules: Rules; control: FakeRulesControl } {
  const control: FakeRulesControl = {
    applyActionThrows: false,
    createGameThrows: false,
    viewThrowsFor: null,
    talkativeRefusals: false,
    invariantProblems: [],
    setups: [],
    actionCalls: 0,
  };

  function createGame(setup: GameSetup): GameState {
    control.setups.push(setup);
    if (control.createGameThrows) throw new Error(`fake createGame failed ${CANARY}`);

    const map = sampleMap();
    const state: GameState = {
      schema: STATE_SCHEMA,
      seed: setup.seed,
      rng: seedRng(setup.seed, 'dice'),
      settings: setup.settings,
      turn: 1,
      map,
      players: setup.players.map((player) => ({
        id: player.id,
        name: player.name,
        civ: player.civ,
        endedTurn: false,
        citiesFounded: 0,
        idRng: seedRng(setup.seed, `ids:${player.id}`),
        knowledge: { explored: map.tiles.map(() => 0), remembered: {} },
      })),
      units: {},
      cities: {},
    };
    for (const player of state.players) {
      const id = fakeUnitId(player.id);
      state.units[id] = { id, type: 'warrior', owner: player.id, tile: 0, movesLeft: 2, job: null };
    }
    return state;
  }

  /** A refusal, the way the real engine makes one (unless the test asked for a talkative one). */
  function refuse(code: RuleErrorCode): ActionResult {
    if (!control.talkativeRefusals) return { ok: false, error: ruleError(code) };
    const talkative = { code, message: `refused because of ${CANARY}`, hiddenUnit: CANARY };
    return { ok: false, error: talkative };
  }

  function applyAction(state: GameState, playerId: PlayerId, turn: number, action: Action): ActionResult {
    control.actionCalls += 1;
    if (control.applyActionThrows) throw new Error(`fake applyAction failed ${CANARY}`);

    const actor = state.players.find((player) => player.id === playerId);
    if (actor === undefined) return refuse('badAction');
    if (turn !== state.turn) return refuse('staleTurn');

    // Like the real engine: work on a copy, never on the state that was passed in.
    const next: GameState = JSON.parse(JSON.stringify(state));
    const me = next.players.find((player) => player.id === playerId)!;

    switch (action.type) {
      case 'moveUnit': {
        const unit = next.units[action.unitId];
        if (unit === undefined || unit.owner !== playerId) return refuse('noSuchUnit');
        if (action.path.length === 0) return refuse('badPath');
        const from = unit.tile;
        unit.tile = action.path[action.path.length - 1];
        const moved: GameEvent = { type: 'unitMoved', playerId, unitId: unit.id, from, path: action.path, stoppedEarly: false };
        return { ok: true, state: next, events: [{ to: [playerId], event: moved }], changed: true };
      }
      case 'foundCity':
        return refuse('cannotFoundCity');
      case 'setBuildQueue':
        return refuse('noSuchCity');
      case 'startJob':
        return refuse('cannotImprove');
      case 'stopJob':
        return refuse('noSuchUnit');
      case 'endTurn': {
        if (me.endedTurn) return { ok: true, state, events: [], changed: false };
        me.endedTurn = true;
        const events: AddressedEvent[] = [];
        if (next.players.every((player) => player.endedTurn)) {
          next.turn += 1;
          for (const player of next.players) player.endedTurn = false;
          events.push({ to: 'all', event: { type: 'turnStarted', turn: next.turn } });
        }
        return { ok: true, state: next, events, changed: true };
      }
      case 'cancelEndTurn': {
        if (!me.endedTurn) return { ok: true, state, events: [], changed: false };
        me.endedTurn = false;
        return { ok: true, state: next, events: [], changed: true };
      }
    }
  }

  function buildPlayerView(state: GameState, playerId: PlayerId): PlayerView {
    if (control.viewThrowsFor === playerId) throw new Error(`fake buildPlayerView failed for ${playerId} ${CANARY}`);
    if (!state.players.some((player) => player.id === playerId)) {
      throw new Error(`fake buildPlayerView: ${playerId} is not in this game`);
    }
    const sample = sampleView();
    return {
      you: playerId,
      turn: state.turn,
      width: sample.width,
      height: sample.height,
      tiles: sample.tiles,
      units: Object.values(state.units)
        .filter((unit) => unit.owner === playerId)
        .map((unit) => ({
          id: unit.id,
          type: unit.type,
          owner: unit.owner,
          tile: unit.tile,
          own: { movesLeft: unit.movesLeft, foundCityError: 'cannotFoundCity' as const, job: null, jobOptions: [] },
        })),
      cities: [],
      players: state.players.map((player) => ({
        id: player.id,
        name: player.name,
        civ: player.civ,
        endedTurn: player.endedTurn,
      })),
    };
  }

  /** The same three lines as the real one: pick by audience, drop the audience. */
  function filterEvents(events: AddressedEvent[], playerId: PlayerId): GameEvent[] {
    return events.filter((entry) => entry.to === 'all' || entry.to.includes(playerId)).map((entry) => entry.event);
  }

  function checkInvariants(): string[] {
    return control.invariantProblems;
  }

  return { rules: { createGame, applyAction, buildPlayerView, filterEvents, checkInvariants }, control };
}
