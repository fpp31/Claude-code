import { describe, expect, it } from 'vitest';
import { cloneJson, IMPROVEMENT_IDS, IMPROVEMENTS, RULE_ERROR_MESSAGES, SERVER_ERROR_MESSAGE } from '@domination/shared';
import type { ClientMessage, GameEvent, PlayerView, ServerMessage } from '@domination/shared';
import { sampleLobby, sampleView } from '@domination/shared/testing';
import {
  NO_LONGER_IN_GAME_MESSAGE,
  STARTED_BEFORE_LEAVE_MESSAGE,
  TURN_TOAST_SLOT,
  VERSION_MISMATCH_MESSAGE,
  describeEvent,
  foldedNewsText,
  handleServerMessage,
  improvementsFinishedText,
} from '../src/state/serverMessages';
import { createStore, currentScreen, initialState } from '../src/state/store';
import type { AppState, JoinProblem, Store } from '../src/state/store';
import { MAX_TOASTS, showToast, toastsWith } from '../src/ui/toasts';
import { SAMPLE, storeInGame, viewOf } from './shellKit';

/**
 * What each message from the server does to the store. No socket is
 * involved: the messages are handed straight to handleServerMessage, and
 * `replies` collects what it sends back.
 */

/** Applies messages to a store, one after the other, and returns what was sent in reply. */
function deliver(store: Store, ...messages: ServerMessage[]): ClientMessage[] {
  const replies: ClientMessage[] = [];
  for (const message of messages) handleServerMessage(store, message, (reply) => replies.push(reply));
  return replies;
}

function gameSync(seq: number, changes: Partial<Extract<ServerMessage, { type: 'gameSync' }>> = {}): ServerMessage {
  return { type: 'gameSync', code: SAMPLE.code, seq, view: sampleView(), connected: [SAMPLE.me], events: [], ...changes };
}

describe('handleServerMessage (WP4)', () => {
  it('welcome changes nothing in the store', () => {
    const store = storeInGame({ busy: true });
    const before = store.get();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    const replies = deliver(store, { type: 'welcome', protocol: 1, token: 'secret' }, { type: 'pong' });

    expect(store.get()).toBe(before);
    expect(notified).toBe(0);
    expect(replies).toEqual([]);
  });

  it('lobby: sets the lobby and clears the game and joining', () => {
    const store = storeInGame({ joining: SAMPLE.code });
    const lobby = sampleLobby();

    deliver(store, { type: 'lobby', lobby });

    expect(store.get().lobby).toEqual(lobby);
    expect(store.get().game).toBeNull();
    expect(store.get().joining).toBeNull();
  });

  it('lobby: nothing of a map is carried along (selection, tile card, hovered tile, hover box)', () => {
    // A selection and a tile card are never set together; two stores, so that each is seen to go.
    const selecting = storeInGame({ selection: { kind: 'unit', unitId: SAMPLE.warriorId }, hoverTile: 9, hoverInfoTile: 9 });
    const inspecting = storeInGame({ inspectedTile: SAMPLE.emptyTile, hoverTile: 9, hoverInfoTile: 9 });
    for (const store of [selecting, inspecting]) {
      deliver(store, { type: 'lobby', lobby: sampleLobby() });
      expect(currentScreen(store.get())).toBe('lobby');
      expect(store.get().selection).toBeNull();
      expect(store.get().inspectedTile).toBeNull();
      expect(store.get().hoverTile).toBeNull();
      expect(store.get().hoverInfoTile).toBeNull();
    }
  });

  it('gameSync: sets the game session with its seq, awaitingSync false, and clears the lobby, joining and busy', () => {
    const store = createStore(initialState('Ada', SAMPLE.code));
    store.set({ lobby: sampleLobby(), busy: true });
    const view = sampleView();

    deliver(store, { type: 'gameSync', code: SAMPLE.code, seq: 41, view, connected: ['p1', 'p2'], events: [] });

    expect(store.get().game).toEqual({ code: SAMPLE.code, view, connected: ['p1', 'p2'], seq: 41, awaitingSync: false });
    expect(store.get().lobby).toBeNull();
    expect(store.get().joining).toBeNull();
    expect(store.get().busy).toBe(false);
  });

  it('gameSync takes whatever seq it carries, also a lower one, and ends a wait for a resync', () => {
    const store = storeInGame();
    deliver(store, { type: 'gameUpdate', seq: 99, patch: { turn: 8 }, events: [] }); // a gap: now waiting
    expect(store.get().game?.awaitingSync).toBe(true);

    deliver(store, gameSync(2));

    expect(store.get().game?.seq).toBe(2);
    expect(store.get().game?.awaitingSync).toBe(false);
  });

  it('gameUpdate with seq + 1: applies the patch and keeps unchanged parts of the view', () => {
    const store = storeInGame();
    const before = viewOf(store);
    const players = cloneJson(before.players);
    players[0].endedTurn = true;

    const replies = deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 8, players }, events: [] });

    const after = viewOf(store);
    expect(after).not.toBe(before); // a new view object, the old one is not edited
    expect(before.turn).toBe(7);
    expect(after.turn).toBe(8);
    expect(after.players).toEqual(players);
    // The parts the patch did not name are the very same objects as before.
    expect(after.units).toBe(before.units);
    expect(after.cities).toBe(before.cities);
    expect(after.tiles).toBe(before.tiles);
    expect(store.get().game?.seq).toBe(6);
    expect(replies).toEqual([]);
  });

  it('gameUpdate with a gap in seq: changes nothing but awaitingSync, sends resync once, and ignores every update until the next gameSync', () => {
    const store = storeInGame();
    const before = store.get();
    const view = viewOf(store);

    // seq 5 was the last one applied, so 7 means that 6 went missing.
    const replies = deliver(
      store,
      { type: 'gameUpdate', seq: 7, patch: { turn: 8 }, events: [{ type: 'turnStarted', turn: 8 }] },
      { type: 'gameUpdate', seq: 8, patch: { turn: 9 }, events: [] },
      { type: 'gameUpdate', seq: 6, patch: { turn: 10 }, events: [] }, // even the "right" number is ignored now
    );

    expect(replies).toEqual([{ type: 'resync' }]);
    expect(store.get()).toEqual({ ...before, game: { ...before.game, awaitingSync: true } });
    expect(viewOf(store)).toBe(view);

    // The full view puts everything right, and updates count on from its seq.
    const synced = sampleView();
    synced.turn = 9;
    deliver(store, gameSync(20, { view: synced }), { type: 'gameUpdate', seq: 21, patch: { turn: 10 }, events: [] });
    expect(viewOf(store).turn).toBe(10);
    expect(store.get().game?.seq).toBe(21);
    expect(store.get().game?.awaitingSync).toBe(false);
  });

  it('gameUpdate with a seq that is not one higher (a repeat or an old one) also asks for a resync', () => {
    const store = storeInGame();
    const replies = deliver(store, { type: 'gameUpdate', seq: 5, patch: { turn: 8 }, events: [] });
    expect(replies).toEqual([{ type: 'resync' }]);
    expect(viewOf(store).turn).toBe(7);
  });

  it('gameUpdate and presence without a game are ignored', () => {
    const store = createStore(initialState('Ada'));
    const before = store.get();
    const replies = deliver(
      store,
      { type: 'gameUpdate', seq: 1, patch: { turn: 2 }, events: [] },
      { type: 'presence', connected: ['p1'] },
    );
    expect(store.get()).toBe(before);
    expect(replies).toEqual([]);
  });

  it('presence: updates the connected list only', () => {
    const store = storeInGame({ busy: true, selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    const before = store.get();

    deliver(store, { type: 'presence', connected: ['p2'] });

    expect(store.get()).toEqual({ ...before, game: { ...before.game, connected: ['p2'] } });
    expect(viewOf(store)).toBe(before.game?.view);
  });

  it('actionOk and actionRejected clear busy; a rejection adds an error toast with the message', () => {
    const store = storeInGame({ busy: true });
    deliver(store, { type: 'actionOk', requestId: 1 });
    expect(store.get().busy).toBe(false);
    expect(store.get().toasts).toEqual([]);

    store.set({ busy: true });
    const message = RULE_ERROR_MESSAGES.blocked;
    deliver(store, { type: 'actionRejected', requestId: 2, error: { code: 'blocked', message } });
    expect(store.get().busy).toBe(false);
    expect(store.get().toasts.map((toast) => [toast.kind, toast.text])).toEqual([['error', message]]);
  });

  it('every "no" of the server is counted (refusals): an actionRejected and a plain error, never an actionOk or a new view', () => {
    const store = storeInGame({ busy: true });
    expect(store.get().refusals).toBe(0);
    deliver(store, { type: 'actionOk', requestId: 1 });
    deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 8 }, events: [{ type: 'turnStarted', turn: 8 }] });
    deliver(store, { type: 'presence', connected: [SAMPLE.me] });
    expect(store.get().refusals).toBe(0);

    deliver(store, { type: 'actionRejected', requestId: 2, error: { code: 'blocked', message: RULE_ERROR_MESSAGES.blocked } });
    expect(store.get().refusals).toBe(1);
    deliver(store, { type: 'error', code: 'serverError', message: SERVER_ERROR_MESSAGE });
    expect(store.get().refusals).toBe(2);
    // Also one that shows no message of its own.
    deliver(store, { type: 'error', code: 'rateLimited', message: 'Slow down.' });
    expect(store.get().refusals).toBe(3);
    // A full view after a reconnect does not set the count back: a press that waited across it must still see the difference.
    deliver(store, gameSync(20));
    expect(store.get().refusals).toBe(3);
  });

  it('error clears busy and joining and adds a toast; nameRequired adds no toast', () => {
    const store = storeInGame({ busy: true, joining: SAMPLE.code });
    deliver(store, { type: 'error', code: 'serverError', message: SERVER_ERROR_MESSAGE });
    expect(store.get().busy).toBe(false);
    expect(store.get().joining).toBeNull();
    expect(store.get().toasts.map((toast) => [toast.kind, toast.text])).toEqual([['error', SERVER_ERROR_MESSAGE]]);

    const home = createStore(initialState('Ada', SAMPLE.code));
    home.set({ busy: true });
    deliver(home, { type: 'error', code: 'nameRequired', message: 'whatever the server says' });
    expect(home.get().busy).toBe(false);
    expect(home.get().joining).toBeNull();
    expect(home.get().toasts).toEqual([]);
  });

  it('error noSuchGame on a page that is still on the home screen: clears joining and shows the toast', () => {
    const store = createStore(initialState('Ada', SAMPLE.code));
    deliver(store, { type: 'error', code: 'noSuchGame', message: 'the server text' });
    expect(currentScreen(store.get())).toBe('home');
    expect(store.get().joining).toBeNull();
    expect(store.get().toasts.map((toast) => toast.kind)).toEqual(['error']);
  });

  /** The five answers to `joinGame` that mean "you are not in that game", with what the home screen is told afterwards. */
  const REFUSED_REJOINS: {
    code: 'noSuchGame' | 'gameNotLoaded' | 'nameRequired' | 'gameAlreadyStarted' | 'gameFull';
    problem: JoinProblem | null;
    toast: string;
  }[] = [
    { code: 'noSuchGame', problem: 'noSuchGame', toast: 'the server text' },
    // The save is on the server's disk but was not loaded: the server has no such game to be in right now.
    { code: 'gameNotLoaded', problem: 'gameNotLoaded', toast: 'the server text' },
    { code: 'gameAlreadyStarted', problem: 'gameAlreadyStarted', toast: 'the server text' },
    { code: 'gameFull', problem: 'gameFull', toast: 'the server text' },
    // The game is there and has a seat: no "problem", but a word on why the page is back on the first screen.
    { code: 'nameRequired', problem: null, toast: NO_LONGER_IN_GAME_MESSAGE },
  ];

  it('a rejoin that is refused while a GAME is on screen takes the game down: the home screen appears with the reason', () => {
    for (const { code, problem, toast } of REFUSED_REJOINS) {
      const store = storeInGame({
        joining: SAMPLE.code,
        busy: true,
        selection: { kind: 'unit', unitId: SAMPLE.warriorId },
        hoverTile: SAMPLE.emptyTile,
        hoverInfoTile: SAMPLE.emptyTile,
      });
      expect(currentScreen(store.get())).toBe('game');

      const replies = deliver(store, { type: 'error', code, message: 'the server text' });

      const state = store.get();
      expect(currentScreen(state), code).toBe('home');
      expect(state.game, code).toBeNull();
      expect(state.joinProblem, code).toBe(problem);
      expect(state.selection, code).toBeNull();
      expect(state.hoverTile, code).toBeNull();
      expect(state.hoverInfoTile, code).toBeNull();
      expect(state.joining, code).toBeNull();
      expect(state.busy, code).toBe(false);
      expect(state.toasts.map((shown) => [shown.kind, shown.text]), code).toEqual([['error', toast]]);
      expect(replies, code).toEqual([]);

      // The same with a tile card open instead of a selection: the card goes down with the game.
      const inspecting = storeInGame({ inspectedTile: SAMPLE.emptyTile });
      deliver(inspecting, { type: 'error', code, message: 'the server text' });
      expect(inspecting.get().game, code).toBeNull();
      expect(inspecting.get().inspectedTile, code).toBeNull();
    }
  });

  it('a rejoin that is refused while a LOBBY is on screen takes the lobby down in the same way', () => {
    for (const { code, problem, toast } of REFUSED_REJOINS) {
      const store = createStore(initialState('Ada'));
      store.set({ connection: 'online', lobby: sampleLobby(), joining: SAMPLE.code });
      expect(currentScreen(store.get())).toBe('lobby');

      deliver(store, { type: 'error', code, message: 'the server text' });

      const state = store.get();
      expect(currentScreen(state), code).toBe('home');
      expect(state.lobby, code).toBeNull();
      expect(state.joinProblem, code).toBe(problem);
      expect(state.joining, code).toBeNull();
      expect(state.toasts.map((shown) => [shown.kind, shown.text]), code).toEqual([['error', toast]]);
    }
  });

  it('the refusal counts also when an earlier, unrelated error has already cleared `joining`', () => {
    const store = storeInGame({ joining: SAMPLE.code });
    deliver(store, { type: 'error', code: 'rateLimited', message: 'slow down' });
    expect(store.get().joining).toBeNull();
    expect(currentScreen(store.get())).toBe('game');

    deliver(store, { type: 'error', code: 'gameAlreadyStarted', message: 'the server text' });
    expect(currentScreen(store.get())).toBe('home');
    expect(store.get().joinProblem).toBe('gameAlreadyStarted');
  });

  it('an error that says nothing about membership leaves the game or lobby on screen', () => {
    for (const code of ['serverError', 'rateLimited', 'notInGame', 'badMessage', 'notHost', 'civTaken', 'badName'] as const) {
      const inGame = storeInGame({ selection: { kind: 'unit', unitId: SAMPLE.warriorId }, hoverInfoTile: 9 });
      const game = inGame.get().game;
      deliver(inGame, { type: 'error', code, message: 'the server text' });
      expect(inGame.get().game, code).toBe(game);
      expect(inGame.get().selection, code).toEqual({ kind: 'unit', unitId: SAMPLE.warriorId });
      expect(inGame.get().hoverInfoTile, code).toBe(9);

      const inspecting = storeInGame({ inspectedTile: SAMPLE.emptyTile });
      deliver(inspecting, { type: 'error', code, message: 'the server text' });
      expect(inspecting.get().inspectedTile, code).toBe(SAMPLE.emptyTile);

      const inLobby = createStore(initialState('Ada'));
      inLobby.set({ lobby: sampleLobby() });
      deliver(inLobby, { type: 'error', code, message: 'the server text' });
      expect(currentScreen(inLobby.get()), code).toBe('lobby');
    }
  });

  it('a refused join that trying again cannot cure is remembered, so the home screen can go on saying why', () => {
    for (const code of ['noSuchGame', 'gameNotLoaded', 'gameAlreadyStarted', 'gameFull'] as const) {
      const store = createStore(initialState('Cleo', SAMPLE.code));
      deliver(store, { type: 'error', code, message: 'the server text' });
      expect(store.get().joinProblem).toBe(code);
      expect(store.get().joining).toBeNull();

      // The toast goes away after a few seconds; the reason must not go with it.
      store.set({ toasts: [] });
      expect(store.get().joinProblem).toBe(code);
    }
  });

  it('the join problem is forgotten when the game turns out to be open, and when a game is entered or left', () => {
    const refused = (): Store => {
      const store = createStore(initialState('Cleo', SAMPLE.code));
      deliver(store, { type: 'error', code: 'gameFull', message: 'the server text' });
      expect(store.get().joinProblem).toBe('gameFull');
      return store;
    };

    // Somebody left the lobby meanwhile: the server now asks for a name, so there is a seat.
    const open = refused();
    deliver(open, { type: 'error', code: 'nameRequired', message: 'the server text' });
    expect(open.get().joinProblem).toBeNull();

    const inLobby = refused();
    deliver(inLobby, { type: 'lobby', lobby: sampleLobby() });
    expect(inLobby.get().joinProblem).toBeNull();

    const inGame = refused();
    deliver(inGame, gameSync(1));
    expect(inGame.get().joinProblem).toBeNull();

    const left = refused();
    deliver(left, { type: 'left' });
    expect(left.get().joinProblem).toBeNull();
  });

  it('an error that says nothing about the game leaves the join problem as it was', () => {
    const store = createStore(initialState('Cleo', SAMPLE.code));
    deliver(store, { type: 'error', code: 'gameAlreadyStarted', message: 'the server text' });
    deliver(store, { type: 'error', code: 'rateLimited', message: 'the server text' });
    expect(store.get().joinProblem).toBe('gameAlreadyStarted');

    // And such an error alone sets none.
    const fresh = createStore(initialState('Cleo'));
    deliver(fresh, { type: 'error', code: 'serverError', message: SERVER_ERROR_MESSAGE });
    expect(fresh.get().joinProblem).toBeNull();
  });

  it('error protocolMismatch: where the page cannot reload itself (again), a fatal message is set instead of a toast', () => {
    // In plain Node reloadPageOnce() answers false, exactly as it does in a
    // browser tab that has already been reloaded once.
    const store = createStore(initialState('Ada', SAMPLE.code));
    store.set({ busy: true });
    deliver(store, { type: 'error', code: 'protocolMismatch', message: 'the server text' });
    expect(store.get().fatalMessage).not.toBeNull();
    expect(store.get().toasts).toEqual([]);
    expect(store.get().busy).toBe(false);
    // The sentence says what to do in each case: reload; wait and reload; and,
    // when waiting does not help (the build was forgotten), whom to tell and what they must do.
    expect(store.get().fatalMessage).toBe(VERSION_MISMATCH_MESSAGE);
    expect(VERSION_MISMATCH_MESSAGE).toContain('Reload the page');
    expect(VERSION_MISMATCH_MESSAGE).toContain('wait a minute and reload once more');
    expect(VERSION_MISMATCH_MESSAGE).toContain('tell the person who runs the server');
    expect(VERSION_MISMATCH_MESSAGE).toContain('"npm run build"');
    expect(VERSION_MISMATCH_MESSAGE).toContain('restart');
    expect(store.get().joining).toBeNull();
  });

  it('left: clears lobby, game, selection and joining', () => {
    // (The page left a lobby. A selection, a tile card, a hovered tile and a
    // hover box cannot exist there; they are set here to see that nothing of
    // a map is carried along.)
    const store = createStore(initialState('Ada'));
    store.set({
      connection: 'online',
      lobby: sampleLobby(),
      selection: { kind: 'city', cityId: SAMPLE.romeId },
      inspectedTile: 4,
      joining: SAMPLE.code,
      busy: true,
      hoverTile: 3,
      hoverInfoTile: 3,
    });

    const replies = deliver(store, { type: 'left' });

    const state = store.get();
    expect(currentScreen(state)).toBe('home');
    expect(state.lobby).toBeNull();
    expect(state.game).toBeNull();
    expect(state.selection).toBeNull();
    expect(state.joining).toBeNull();
    expect(state.busy).toBe(false);
    expect(state.hoverTile).toBeNull();
    expect(state.inspectedTile).toBeNull();
    expect(state.hoverInfoTile).toBeNull();
    expect(state.toasts).toEqual([]);
    expect(replies).toEqual([]);

    // On the home screen already (a second answer to a Leave pressed twice): nothing to do, nothing breaks.
    expect(deliver(store, { type: 'left' })).toEqual([]);
    expect(currentScreen(store.get())).toBe('home');
  });

  it('left while a GAME is on screen (Leave was pressed in the lobby as the game started): the page stays in the game and asks to be let back in', () => {
    // What the server sends a player whose Leave arrives just after the
    // host's Start: the game, and then the answer to the Leave.
    const store = createStore(initialState('Cy'));
    store.set({ connection: 'online', lobby: sampleLobby() });
    const replies = deliver(store, gameSync(1), { type: 'left' });

    const state = store.get();
    expect(currentScreen(state)).toBe('game');
    expect(state.game?.code).toBe(SAMPLE.code);
    expect(replies).toEqual([{ type: 'joinGame', code: SAMPLE.code, name: null }]);
    expect(state.toasts.map((toast) => [toast.kind, toast.text])).toEqual([['info', STARTED_BEFORE_LEAVE_MESSAGE]]);

    // Nothing the player had on the map is thrown away while the page waits for the server's answer.
    const playing = storeInGame({ selection: { kind: 'unit', unitId: SAMPLE.warriorId }, hoverTile: SAMPLE.emptyTile, hoverInfoTile: SAMPLE.emptyTile });
    const before = playing.get();
    deliver(playing, { type: 'left' });
    expect({ ...playing.get(), toasts: [] }).toEqual({ ...before, toasts: [] });
    const reading = storeInGame({ inspectedTile: SAMPLE.thebesTile });
    deliver(reading, { type: 'left' });
    expect(reading.get().inspectedTile).toBe(SAMPLE.thebesTile);
    // The server's answer is a full view, which puts the page back in step.
    deliver(playing, gameSync(9));
    expect(playing.get().game?.seq).toBe(9);
  });

  it('drops the selection when the selected unit or city is no longer in the view', () => {
    // A unit that is gone after an update (the Settler founded a city).
    const store = storeInGame({ selection: { kind: 'unit', unitId: SAMPLE.settlerId } });
    const units = viewOf(store).units.filter((unit) => unit.id !== SAMPLE.settlerId);
    deliver(store, { type: 'gameUpdate', seq: 6, patch: { units }, events: [] });
    expect(store.get().selection).toBeNull();

    // A selection that is still there is kept.
    store.set({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    deliver(store, { type: 'gameUpdate', seq: 7, patch: { turn: 8 }, events: [] });
    expect(store.get().selection).toEqual({ kind: 'unit', unitId: SAMPLE.warriorId });

    // A city that is gone from a full view.
    store.set({ selection: { kind: 'city', cityId: SAMPLE.romeId } });
    const withoutRome = sampleView();
    withoutRome.cities = withoutRome.cities.filter((city) => city.id !== SAMPLE.romeId);
    deliver(store, gameSync(8, { view: withoutRome }));
    expect(store.get().selection).toBeNull();

    // A unit that now belongs to somebody else is no longer ours to select.
    const store2 = storeInGame({ selection: { kind: 'unit', unitId: SAMPLE.warriorId } });
    const captured = cloneJson(viewOf(store2).units);
    const warrior = captured.find((unit) => unit.id === SAMPLE.warriorId);
    if (warrior === undefined) throw new Error('the sample view has no warrior');
    warrior.owner = SAMPLE.other;
    warrior.own = null;
    deliver(store2, { type: 'gameUpdate', seq: 6, patch: { units: captured }, events: [] });
    expect(store2.get().selection).toBeNull();
  });

  it('gameSync for another game drops the selection and the hovered tile, even if the ids happen to match', () => {
    const store = storeInGame({ selection: { kind: 'unit', unitId: SAMPLE.warriorId }, hoverTile: 9 });
    deliver(store, gameSync(1, { code: 'ZZZZZ' }));
    expect(store.get().game?.code).toBe('ZZZZZ');
    expect(store.get().selection).toBeNull();
    expect(store.get().hoverTile).toBeNull();
    expect(store.get().inspectedTile).toBeNull();
    expect(store.get().hoverInfoTile).toBeNull();
  });

  it('a gameUpdate keeps the tile card open; a gameSync for the same game keeps it; for another game it is closed and the hover box is gone', () => {
    const store = storeInGame({ inspectedTile: SAMPLE.foreignWarriorTile, hoverTile: SAMPLE.thebesTile, hoverInfoTile: SAMPLE.thebesTile });

    // The foreign Warrior walks off the inspected tile, and the turn goes on: the card and the box stay where they are.
    const units = cloneJson(viewOf(store).units);
    const walker = units.find((unit) => unit.id === SAMPLE.foreignWarriorId);
    if (walker === undefined) throw new Error('the sample view has no foreign warrior');
    walker.tile += 1;
    deliver(store, { type: 'gameUpdate', seq: 6, patch: { units, turn: 8 }, events: [{ type: 'turnStarted', turn: 8 }] });
    expect(store.get().inspectedTile).toBe(SAMPLE.foreignWarriorTile);
    expect(store.get().hoverInfoTile).toBe(SAMPLE.thebesTile);
    expect(store.get().hoverTile).toBe(SAMPLE.thebesTile);
    expect(store.get().selection).toBeNull();
    expect(viewOf(store).turn).toBe(8); // (the update itself was applied)

    // An update that takes the tile out of sight closes nothing either: the card is rewritten from the new view.
    const seen = viewOf(store).tiles[SAMPLE.foreignWarriorTile];
    if (seen === null) throw new Error('the sample view does not know the foreign warrior\'s tile');
    deliver(store, { type: 'gameUpdate', seq: 7, patch: { tiles: [[SAMPLE.foreignWarriorTile, { ...seen, visible: false }]] }, events: [] });
    expect(viewOf(store).tiles[SAMPLE.foreignWarriorTile]?.visible).toBe(false);
    expect(store.get().inspectedTile).toBe(SAMPLE.foreignWarriorTile);

    // A full view of the same game (after a reconnect, a resync, or with patches switched off).
    deliver(store, gameSync(20));
    expect(store.get().inspectedTile).toBe(SAMPLE.foreignWarriorTile);
    expect(store.get().hoverInfoTile).toBe(SAMPLE.thebesTile);
    expect(store.get().hoverTile).toBe(SAMPLE.thebesTile);

    // A gameUpdate that is ignored (a gap: the page asks for a resync) leaves them alone too.
    deliver(store, { type: 'gameUpdate', seq: 99, patch: { turn: 12 }, events: [] });
    expect(store.get().inspectedTile).toBe(SAMPLE.foreignWarriorTile);
    expect(store.get().hoverInfoTile).toBe(SAMPLE.thebesTile);

    // Another game is another map: its tile numbers mean other tiles.
    deliver(store, gameSync(1, { code: 'ZZZZZ' }));
    expect(store.get().game?.code).toBe('ZZZZZ');
    expect(store.get().inspectedTile).toBeNull();
    expect(store.get().hoverInfoTile).toBeNull();
    expect(store.get().hoverTile).toBeNull();
  });

  it('presence, actionOk and actionRejected leave the tile card and the hover box alone', () => {
    const store = storeInGame({ inspectedTile: SAMPLE.emptyTile, hoverInfoTile: 9, busy: true });
    deliver(
      store,
      { type: 'presence', connected: ['p1'] },
      { type: 'actionOk', requestId: 1 },
      { type: 'actionRejected', requestId: 2, error: { code: 'unitBusy', message: RULE_ERROR_MESSAGES.unitBusy } },
    );
    expect(store.get().inspectedTile).toBe(SAMPLE.emptyTile);
    expect(store.get().hoverInfoTile).toBe(9);
    // What the server says about a unit at work reaches the player as it is.
    expect(store.get().toasts.map((toast) => toast.text)).toEqual(['This unit is at work. Stop the work first.']);
  });

  it('events become info toasts, in order; events that need no words add none', () => {
    const store = storeInGame();
    const events: GameEvent[] = [
      { type: 'unitMoved', playerId: 'p1', unitId: SAMPLE.warriorId, from: 1, path: [2], stoppedEarly: false },
      { type: 'cityGrew', playerId: 'p1', cityId: SAMPLE.romeId, name: 'Rome', population: 3 },
      { type: 'turnStarted', turn: 8 },
    ];
    deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 8 }, events });

    const view = viewOf(store);
    expect(store.get().toasts.map((toast) => [toast.kind, toast.text])).toEqual([
      ['info', describeEvent(events[1], view)],
      ['info', describeEvent(events[2], view)],
    ]);
  });

  it('"Turn N has begun." never piles up: the newest takes the place of the one before, and the news that came with an earlier turn goes with it', () => {
    const store = storeInGame();
    const grew: GameEvent = { type: 'cityGrew', playerId: 'p1', cityId: SAMPLE.romeId, name: 'Rome', population: 3 };
    deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 8 }, events: [grew, { type: 'turnStarted', turn: 8 }] });
    const firstId = store.get().toasts[0].id;
    deliver(store, { type: 'gameUpdate', seq: 7, patch: { turn: 9 }, events: [{ type: 'turnStarted', turn: 9 }] });
    // Rome grew when turn 8 began. Under "Turn 9 has begun." it would read as news of turn 9.
    expect(store.get().toasts.map((toast) => toast.text)).toEqual(['Turn 9 has begun.']);

    // The same through a full view (after a reconnect, or with patches switched off).
    const view = sampleView();
    view.turn = 10;
    deliver(store, gameSync(20, { view, events: [{ type: 'turnStarted', turn: 10 }] }));
    const toasts = store.get().toasts;
    expect(toasts.map((toast) => toast.text)).toEqual(['Turn 10 has begun.']);
    // It is a new toast each time (its four seconds start again), in the slot the turn news shares.
    expect(toasts[0].id).toBeGreaterThan(firstId + 2);
    expect(toasts.map((toast) => toast.slot)).toEqual([TURN_TOAST_SLOT]);

    // Ten turns in a row, as in a game played alone with Enter held down: still one.
    for (let turn = 11; turn <= 20; turn++) {
      deliver(store, { type: 'gameUpdate', seq: 10 + turn, patch: { turn }, events: [{ type: 'turnStarted', turn }] });
    }
    expect(store.get().toasts.filter((toast) => toast.text.includes('has begun')).map((toast) => toast.text)).toEqual(['Turn 20 has begun.']);
  });

  describe('news of an earlier turn goes when the news of a new turn arrives', () => {
    const farm = (tile: number): GameEvent => ({ type: 'improvementBuilt', playerId: 'p1', unitId: SAMPLE.workerId, improvement: 'farm', tile, cityName: 'Rome' });
    const texts = (store: Store): string[] => store.get().toasts.map((toast) => toast.text);

    it('a farm finished at turn 11, then turn 12 begins within the four seconds: only turn 12\'s lines are shown', () => {
      const store = storeInGame();
      deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 11 }, events: [farm(10), { type: 'turnStarted', turn: 11 }] });
      expect(texts(store)).toEqual(['Your Worker finished a Farm near Rome.', 'Turn 11 has begun.']);

      // Nothing was finished in turn 11 (no toast has timed out yet: nothing in this test lets time pass).
      deliver(store, { type: 'gameUpdate', seq: 7, patch: { turn: 12 }, events: [{ type: 'turnStarted', turn: 12 }] });
      expect(texts(store)).toEqual(['Turn 12 has begun.']);

      // A turn with news of its own shows that news, and none of the turn before.
      const grew: GameEvent = { type: 'cityGrew', playerId: 'p1', cityId: SAMPLE.romeId, name: 'Rome', population: 4 };
      deliver(store, { type: 'gameUpdate', seq: 8, patch: { turn: 13 }, events: [grew, { type: 'turnStarted', turn: 13 }] });
      expect(texts(store)).toEqual(['Rome grew to 4.', 'Turn 13 has begun.']);
    });

    it('a message that answers a press of the player is not touched: a refusal stays, and so does every message that is not news of the game', () => {
      const store = storeInGame();
      deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 11 }, events: [farm(10), { type: 'turnStarted', turn: 11 }] });
      deliver(store, { type: 'actionRejected', requestId: 1, error: { code: 'staleTurn', message: RULE_ERROR_MESSAGES.staleTurn } });
      showToast(store, 'a message of the page itself', 'info');

      deliver(store, { type: 'gameUpdate', seq: 7, patch: { turn: 12 }, events: [{ type: 'turnStarted', turn: 12 }] });

      expect(store.get().toasts.map((toast) => [toast.kind, toast.text])).toEqual([
        ['error', RULE_ERROR_MESSAGES.staleTurn],
        ['info', 'a message of the page itself'],
        ['info', 'Turn 12 has begun.'],
      ]);
    });

    it('news of the SAME turn stays: what the player\'s own orders bring during a turn is added to that turn\'s lines, and goes when the next turn begins', () => {
      const store = storeInGame();
      deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 11 }, events: [farm(10), { type: 'turnStarted', turn: 11 }] });
      const founded: GameEvent = { type: 'cityFounded', playerId: 'p1', cityId: 'c1_new', name: 'Ostia', tile: 5 };
      deliver(store, { type: 'gameUpdate', seq: 7, patch: {}, events: [founded] });
      expect(texts(store)).toEqual(['Your Worker finished a Farm near Rome.', 'Turn 11 has begun.', 'You founded Ostia.']);

      deliver(store, { type: 'gameUpdate', seq: 8, patch: { turn: 12 }, events: [farm(11), { type: 'turnStarted', turn: 12 }] });
      expect(texts(store)).toEqual(['Your Worker finished a Farm near Rome.', 'Turn 12 has begun.']);
      // The farm's line is the new turn's (a new toast), not the old one left standing.
      expect(store.get().toasts.every((toast) => toast.turn === 12)).toBe(true);
    });

    it('toastsWith: a toast of a turn takes the place of every toast of an earlier turn, and of no other', () => {
      const store = createStore(initialState(''));
      store.set({ toasts: toastsWith(store, [{ text: 'news of 3', kind: 'info', turn: 3 }, { text: 'plain', kind: 'info' }, { text: 'news of 4', kind: 'info', turn: 4 }]) });
      expect(texts(store)).toEqual(['plain', 'news of 4']);
      store.set({ toasts: toastsWith(store, [{ text: 'more of 4', kind: 'info', turn: 4 }]) });
      expect(texts(store)).toEqual(['plain', 'news of 4', 'more of 4']);
      // News that arrives late for an older turn (it cannot, but the rule must not eat newer lines for it) removes nothing.
      store.set({ toasts: toastsWith(store, [{ text: 'late of 2', kind: 'info', turn: 2 }]) });
      expect(texts(store)).toEqual(['plain', 'news of 4', 'more of 4', 'late of 2']);
      store.set({ toasts: toastsWith(store, [{ text: 'news of 5', kind: 'info', turn: 5 }]) });
      expect(texts(store)).toEqual(['plain', 'news of 5']);
    });
  });

  describe('the news of one message: counted, and folded when it is more than the list holds', () => {
    const built = (improvement: 'farm' | 'mine', cityName: string, tile: number): GameEvent => ({
      type: 'improvementBuilt', playerId: 'p1', unitId: SAMPLE.workerId, improvement, tile, cityName,
    });
    const completed = (cityName: string, unitType: 'warrior' | 'scout' | 'worker', queueEmpty: boolean): GameEvent => ({
      type: 'unitBuilt', playerId: 'p1', cityId: `c1_${cityName}`, cityName, unitId: `u1_${cityName}`, unitType, queueEmpty,
    });
    const grew = (name: string, population: number): GameEvent => ({ type: 'cityGrew', playerId: 'p1', cityId: `c1_${name}`, name, population });
    /** The toasts a turn's events leave in a store that showed none. */
    const newsOf = (events: GameEvent[]): string[] => {
      const store = storeInGame();
      deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 31 }, events });
      return store.get().toasts.map((toast) => toast.text);
    };

    it('two Workers that finish farms near one city in one turn are "2 Farms were finished near Rome.", not one farm', () => {
      expect(newsOf([built('farm', 'Rome', 10), built('farm', 'Rome', 11), { type: 'turnStarted', turn: 31 }])).toEqual([
        '2 Farms were finished near Rome.',
        'Turn 31 has begun.',
      ]);
      expect(newsOf([built('farm', 'Rome', 10), built('farm', 'Rome', 11), built('farm', 'Rome', 12)])).toEqual(['3 Farms were finished near Rome.']);
      expect(newsOf([built('mine', 'Ostia', 10), built('mine', 'Ostia', 11)])).toEqual(['2 Mines were finished near Ostia.']);
      // Away from every city the words "near ..." are left out, as in the sentence about one.
      expect(newsOf([built('farm', '', 10), built('farm', '', 11)])).toEqual(['2 Farms were finished.']);
    });

    it('one of a kind keeps the sentence about one; a farm and a mine, or farms near two cities, are counted apart', () => {
      expect(newsOf([built('farm', 'Rome', 10)])).toEqual(['Your Worker finished a Farm near Rome.']);
      expect(newsOf([built('farm', 'Rome', 10), built('mine', 'Rome', 11), built('farm', 'Ostia', 12), built('farm', 'Rome', 13)])).toEqual([
        '2 Farms were finished near Rome.',
        'Your Worker finished a Mine near Rome.',
        'Your Worker finished a Farm near Ostia.',
      ]);
    });

    it('improvementsFinishedText: the count, the plural of the name, and the city; every name in the table takes a plain "s"', () => {
      expect(improvementsFinishedText(2, 'farm', 'Rome')).toBe('2 Farms were finished near Rome.');
      expect(improvementsFinishedText(12, 'mine', '')).toBe('12 Mines were finished.');
      expect(improvementsFinishedText(2, 'fishingNet', 'Rome')).toBe('2 Fishing Nets were finished near Rome.');
      // The plural is the name with an "s". A name that needs another plural (a Quarry) must bring its own word along.
      // (That is why the net is the "Fishing Net": "Fishing nets" would give "Fishing netss" here.)
      expect(IMPROVEMENT_IDS).toEqual(['farm', 'mine', 'fishingNet']);
      for (const id of IMPROVEMENT_IDS) expect(IMPROVEMENTS[id].name, id).toMatch(/[a-rt-wA-Z]$/);
      for (const id of IMPROVEMENT_IDS) expect(IMPROVEMENTS[id].name, id).not.toMatch(/(ch|sh|[^aeiou]y)$/);
      for (const id of IMPROVEMENT_IDS) expect(improvementsFinishedText(3, id, 'Rome'), id).toBe(`3 ${IMPROVEMENTS[id].name}s were finished near Rome.`);
    });

    it('the news of boats and nets (round 3): "Fishing Boat completed in Rome.", "Scout Boat completed in Rome. Rome has nothing left to build.", "Your Fishing Boat finished a Fishing Net near Rome.", "2 Fishing Nets were finished near Rome.", "Your Scout Boat stopped early: something is in the way."', () => {
      /** The sample view with the player's two boats in it, so that the news can name them. */
      const withBoats = (): PlayerView => {
        const view = sampleView();
        view.units.push({ id: 'u1_f1sher', type: 'fishingBoat', owner: 'p1', tile: 56, own: { movesLeft: 2, foundCityError: 'cannotFoundCity', job: null, jobOptions: [] } });
        view.units.push({ id: 'u1_sc0ut1', type: 'scoutBoat', owner: 'p1', tile: 42, own: { movesLeft: 4, foundCityError: 'cannotFoundCity', job: null, jobOptions: [] } });
        return view;
      };
      const boatBuilt = (unitType: 'fishingBoat' | 'scoutBoat', queueEmpty: boolean): GameEvent => ({
        type: 'unitBuilt', playerId: 'p1', cityId: SAMPLE.romeId, cityName: 'Rome', unitId: 'u1_new', unitType, queueEmpty,
      });
      const net = (unitId: string, tile: number, cityName = 'Rome'): GameEvent => ({ type: 'improvementBuilt', playerId: 'p1', unitId, improvement: 'fishingNet', tile, cityName });
      const view = withBoats();

      // A boat is completed: the sentence every unit gets.
      expect(describeEvent(boatBuilt('fishingBoat', false), view)).toBe('Fishing Boat completed in Rome.');
      expect(describeEvent(boatBuilt('scoutBoat', false), view)).toBe('Scout Boat completed in Rome.');
      expect(describeEvent(boatBuilt('scoutBoat', true), view)).toBe('Scout Boat completed in Rome. Rome has nothing left to build.');
      expect(describeEvent(boatBuilt('fishingBoat', true), view)).toBe('Fishing Boat completed in Rome. Rome has nothing left to build.');

      // A net is finished: the boat is named, as the Worker is for a farm; away from every city "near ..." is left out.
      expect(describeEvent(net('u1_f1sher', 56), view)).toBe('Your Fishing Boat finished a Fishing Net near Rome.');
      expect(describeEvent(net('u1_f1sher', 56, ''), view)).toBe('Your Fishing Boat finished a Fishing Net.');

      // Several in one turn near one city are counted; a net and a farm are counted apart.
      const store = storeInGame({}, withBoats());
      deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 12 }, events: [net('u1_f1sher', 56), net('u1_f1sher', 70), { type: 'turnStarted', turn: 12 }] });
      expect(store.get().toasts.map((toast) => toast.text)).toEqual(['2 Fishing Nets were finished near Rome.', 'Turn 12 has begun.']);
      const mixed = storeInGame({}, withBoats());
      const farm: GameEvent = { type: 'improvementBuilt', playerId: 'p1', unitId: SAMPLE.workerId, improvement: 'farm', tile: 10, cityName: 'Rome' };
      deliver(mixed, { type: 'gameUpdate', seq: 6, patch: { turn: 12 }, events: [net('u1_f1sher', 56), farm, boatBuilt('fishingBoat', false)] });
      expect(mixed.get().toasts.map((toast) => toast.text)).toEqual([
        'Your Fishing Boat finished a Fishing Net near Rome.',
        'Your Worker finished a Farm near Rome.',
        'Fishing Boat completed in Rome.',
      ]);

      // A boat that stops early: another player's boat was in the way.
      const stopped = (unitId: string): GameEvent => ({ type: 'unitMoved', playerId: 'p1', unitId, from: 42, path: [56], stoppedEarly: true });
      expect(describeEvent(stopped('u1_sc0ut1'), view)).toBe('Your Scout Boat stopped early: something is in the way.');
      expect(describeEvent(stopped('u1_f1sher'), view)).toBe('Your Fishing Boat stopped early: something is in the way.');
    });

    it('the same sentence a turn later still takes the place of the one on screen (only ONE message is counted)', () => {
      const store = storeInGame();
      deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 8 }, events: [built('farm', 'Rome', 10), { type: 'turnStarted', turn: 8 }] });
      deliver(store, { type: 'gameUpdate', seq: 7, patch: { turn: 9 }, events: [built('farm', 'Rome', 11), { type: 'turnStarted', turn: 9 }] });
      expect(store.get().toasts.map((toast) => toast.text)).toEqual(['Your Worker finished a Farm near Rome.', 'Turn 9 has begun.']);
    });

    it('eight events of one turn: the farms are counted, "nothing left to build" is kept, what does not fit is one last line', () => {
      // The reviewer's turn: Rome grew and ran out of work, Ostia built a Worker, three farms near Rome, a mine near Ostia.
      const events: GameEvent[] = [
        grew('Rome', 4),
        completed('Rome', 'scout', true),
        completed('Ostia', 'worker', false),
        built('farm', 'Rome', 10),
        built('farm', 'Rome', 11),
        built('farm', 'Rome', 12),
        built('mine', 'Ostia', 13),
        { type: 'turnStarted', turn: 31 },
      ];
      // Six lines for a list of five: the first city's news is no longer the part that is cut.
      expect(MAX_TOASTS).toBe(5);
      expect(newsOf(events)).toEqual([
        'Rome grew to 4.',
        'Scout completed in Rome. Rome has nothing left to build.',
        'Worker completed in Ostia.',
        // Two lines were left out, and they stand for FOUR things that happened: three farms and a mine.
        'And 4 more pieces of news.',
        'Turn 31 has begun.',
      ]);
      // One line fewer and nothing is folded: the count is on screen.
      expect(newsOf(events.slice(1))).toEqual([
        'Scout completed in Rome. Rome has nothing left to build.',
        'Worker completed in Ostia.',
        '3 Farms were finished near Rome.',
        'Your Worker finished a Mine near Ostia.',
        'Turn 31 has begun.',
      ]);
    });

    it('a line that asks for something is kept before one that does not, wherever it stands in the message', () => {
      // Capua, the third city, is the one with nothing left to build; its line comes after four others.
      const events: GameEvent[] = [
        grew('Rome', 5),
        completed('Rome', 'warrior', false),
        grew('Ostia', 3),
        completed('Ostia', 'worker', false),
        completed('Capua', 'scout', true),
        built('farm', 'Rome', 10),
        { type: 'turnStarted', turn: 31 },
      ];
      expect(newsOf(events)).toEqual([
        'Rome grew to 5.',
        'Warrior completed in Rome.',
        'Scout completed in Capua. Capua has nothing left to build.',
        'And 3 more pieces of news.',
        'Turn 31 has begun.',
      ]);
    });

    it('more cities with nothing left to build than the list holds: the last line says how many more', () => {
      const cities = ['Rome', 'Ostia', 'Capua', 'Ravenna', 'Pisa'];
      const events: GameEvent[] = [...cities.map((name) => completed(name, 'warrior', true)), grew('Rome', 2), { type: 'turnStarted', turn: 31 }];
      expect(newsOf(events)).toEqual([
        'Warrior completed in Rome. Rome has nothing left to build.',
        'Warrior completed in Ostia. Ostia has nothing left to build.',
        'Warrior completed in Capua. Capua has nothing left to build.',
        'And 3 more pieces of news: 2 more cities have nothing left to build.',
        'Turn 31 has begun.',
      ]);
      expect(foldedNewsText(4, 0)).toBe('And 4 more pieces of news.');
      expect(foldedNewsText(2, 1)).toBe('And 2 more pieces of news: 1 more city has nothing left to build.');
    });

    it('the last line counts what happened, not the lines left out: farms that were counted into one line count each; one thing is "1 more piece of news"', () => {
      // Seven lines for a list of five; the three left out are five farms near Pisa (one line), a mine and a city that grew.
      const events: GameEvent[] = [
        grew('Rome', 2),
        grew('Ostia', 2),
        grew('Capua', 2),
        ...[10, 11, 12, 13, 14].map((tile) => built('farm', 'Pisa', tile)),
        built('mine', 'Pisa', 15),
        grew('Ravenna', 2),
        { type: 'turnStarted', turn: 31 },
      ];
      expect(newsOf(events)).toEqual(['Rome grew to 2.', 'Ostia grew to 2.', 'Capua grew to 2.', 'And 7 more pieces of news.', 'Turn 31 has begun.']);
      // The words for one thing (no message of today's rules folds a single line, but the sentence must be right if one does).
      expect(foldedNewsText(1, 0)).toBe('And 1 more piece of news.');
      expect(foldedNewsText(1, 1)).toBe('And 1 more piece of news: 1 more city has nothing left to build.');
    });

    it('news that was on screen before makes room, oldest first; the new message is folded by its own size only', () => {
      const store = storeInGame();
      showToast(store, 'old one', 'info');
      showToast(store, 'old two', 'info');
      deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 31 }, events: [grew('Rome', 2), grew('Ostia', 2), grew('Capua', 2), { type: 'turnStarted', turn: 31 }] });
      expect(store.get().toasts.map((toast) => toast.text)).toEqual(['old two', 'Rome grew to 2.', 'Ostia grew to 2.', 'Capua grew to 2.', 'Turn 31 has begun.']);
    });
  });

  it('ends up with the same state whether events are present or stripped from the messages', () => {
    const afterMove = sampleView();
    afterMove.units[0].tile = SAMPLE.warriorTile + 1;
    const afterCity = cloneJson(afterMove);
    afterCity.units = afterCity.units.filter((unit) => unit.id !== SAMPLE.settlerId);
    afterCity.cities.push({
      id: 'c1_new', owner: 'p1', name: 'Ostia', tile: SAMPLE.settlerTile, population: 1, visible: true, own: null,
    });

    const script: ServerMessage[] = [
      { type: 'gameSync', code: SAMPLE.code, seq: 1, view: sampleView(), connected: ['p1', 'p2'], events: [{ type: 'turnStarted', turn: 7 }] },
      {
        type: 'gameUpdate', seq: 2, patch: { units: afterMove.units },
        events: [{ type: 'unitMoved', playerId: 'p1', unitId: SAMPLE.warriorId, from: SAMPLE.warriorTile, path: [SAMPLE.warriorTile + 1], stoppedEarly: true }],
      },
      { type: 'actionOk', requestId: 1 },
      {
        type: 'gameUpdate', seq: 3, patch: { units: afterCity.units, cities: afterCity.cities },
        events: [{ type: 'cityFounded', playerId: 'p1', cityId: 'c1_new', name: 'Ostia', tile: SAMPLE.settlerTile }],
      },
      { type: 'presence', connected: ['p1'] },
      {
        type: 'gameUpdate', seq: 4, patch: { turn: 8 },
        events: [
          { type: 'cityGrew', playerId: 'p1', cityId: SAMPLE.romeId, name: 'Rome', population: 3 },
          { type: 'unitBuilt', playerId: 'p1', cityId: SAMPLE.romeId, cityName: 'Rome', unitId: 'u1_new', unitType: 'warrior', queueEmpty: true },
          { type: 'improvementBuilt', playerId: 'p1', unitId: SAMPLE.workerId, improvement: 'farm', tile: SAMPLE.workerTile, cityName: 'Rome' },
          { type: 'turnStarted', turn: 8 },
        ],
      },
    ];
    const withoutEvents = script.map((message) => (message.type === 'gameSync' || message.type === 'gameUpdate' ? { ...message, events: [] } : message));

    const play = (messages: ServerMessage[]): AppState => {
      const [first, ...rest] = cloneJson(messages);
      const store = createStore(initialState('Ada', SAMPLE.code));
      store.set({ connection: 'online' });
      deliver(store, first);
      // The player selects the Settler, which the later city-founding update removes.
      store.set({ selection: { kind: 'unit', unitId: SAMPLE.settlerId } });
      deliver(store, ...rest);
      return store.get();
    };

    const loud = play(script);
    const quiet = play(withoutEvents);

    // Toasts are the one thing events are for; everything else must match.
    expect(loud.toasts.length).toBeGreaterThan(0);
    expect(quiet.toasts).toEqual([]);
    expect({ ...loud, toasts: [] }).toEqual({ ...quiet, toasts: [] });
    expect(loud.selection).toBeNull();
    expect(loud.game?.view).toEqual({ ...afterCity, turn: 8 });
  });
});

describe('describeEvent (WP4)', () => {
  const view = sampleView();

  it('gives one short sentence for news the player should hear', () => {
    // The exact wording is free to change (edit the expectations with it);
    // what matters is that each sentence names the right thing.
    expect(describeEvent({ type: 'cityGrew', playerId: 'p1', cityId: SAMPLE.romeId, name: 'Rome', population: 2 }, view)).toBe('Rome grew to 2.');
    expect(describeEvent({ type: 'turnStarted', turn: 8 }, view)).toBe('Turn 8 has begun.');
    expect(describeEvent({ type: 'cityFounded', playerId: 'p1', cityId: 'c1_new', name: 'Ostia', tile: 5 }, view)).toBe('You founded Ostia.');
  });

  it('a completed unit gets its sentence, and a second one when the queue has run empty', () => {
    const built: GameEvent = {
      type: 'unitBuilt', playerId: 'p1', cityId: SAMPLE.romeId, cityName: 'Rome', unitId: 'u1_new', unitType: 'warrior', queueEmpty: false,
    };
    expect(describeEvent(built, view)).toBe('Warrior completed in Rome.');
    expect(describeEvent({ ...built, unitType: 'worker' }, view)).toBe('Worker completed in Rome.');

    // The last entry of the queue: from now on the city builds nothing, and this toast is the first to say so.
    expect(describeEvent({ ...built, unitType: 'scout', queueEmpty: true }, view)).toBe('Scout completed in Rome. Rome has nothing left to build.');
    expect(describeEvent({ ...built, cityName: 'Ostia', queueEmpty: true }, view)).toBe('Warrior completed in Ostia. Ostia has nothing left to build.');

    // Both sentences travel in one toast.
    const store = storeInGame();
    deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 8 }, events: [{ ...built, queueEmpty: true }] });
    expect(store.get().toasts.map((toast) => [toast.kind, toast.text])).toEqual([['info', 'Warrior completed in Rome. Rome has nothing left to build.']]);
  });

  it('describeEvent for improvementBuilt: "Your Worker finished a Farm near Rome."; without a city name the words "near ..." are left out', () => {
    const finished: GameEvent = {
      type: 'improvementBuilt', playerId: 'p1', unitId: SAMPLE.workerId, improvement: 'farm', tile: SAMPLE.workerTile, cityName: 'Rome',
    };
    expect(describeEvent(finished, view)).toBe('Your Worker finished a Farm near Rome.');
    expect(describeEvent({ ...finished, improvement: 'mine' }, view)).toBe('Your Worker finished a Mine near Rome.');
    expect(describeEvent({ ...finished, cityName: '' }, view)).toBe('Your Worker finished a Farm.');
    // A unit the view does not hold (any more) is still "your unit".
    expect(describeEvent({ ...finished, unitId: 'u1_gone' }, view)).toBe('Your unit finished a Farm near Rome.');

    const store = storeInGame();
    deliver(store, { type: 'gameUpdate', seq: 6, patch: { turn: 8 }, events: [finished] });
    expect(store.get().toasts.map((toast) => [toast.kind, toast.text])).toEqual([['info', 'Your Worker finished a Farm near Rome.']]);
  });

  it('names the other player when somebody else founds a city', () => {
    const text = describeEvent({ type: 'cityFounded', playerId: 'p2', cityId: 'c2_new', name: 'Memphis', tile: 5 }, view);
    expect(text).toContain('Ben');
    expect(text).toContain('Memphis');
  });

  it('says nothing about an ordinary move, but explains an own unit that stopped early', () => {
    const move: GameEvent = { type: 'unitMoved', playerId: 'p1', unitId: SAMPLE.warriorId, from: 1, path: [2, 3], stoppedEarly: false };
    expect(describeEvent(move, view)).toBeNull();
    expect(describeEvent({ ...move, stoppedEarly: true }, view)).toContain('Warrior');
    // Somebody else's unit stopping early is none of this player's business.
    expect(describeEvent({ ...move, playerId: 'p2', unitId: SAMPLE.foreignWarriorId, stoppedEarly: true }, view)).toBeNull();
  });
});

describe('toasts in the store (WP4)', () => {
  it('showToast adds toasts newest last, with ids that only go up', () => {
    const store = createStore(initialState(''));
    showToast(store, 'first', 'info');
    showToast(store, 'second', 'error');
    const toasts = store.get().toasts;
    expect(toasts.map((toast) => [toast.text, toast.kind])).toEqual([
      ['first', 'info'],
      ['second', 'error'],
    ]);
    expect(toasts[1].id).toBeGreaterThan(toasts[0].id);
  });

  it('an id is never used twice, also after earlier toasts have gone', () => {
    const store = createStore(initialState(''));
    showToast(store, 'first', 'info');
    const firstId = store.get().toasts[0].id;
    store.set({ toasts: [] }); // it timed out
    showToast(store, 'second', 'info');
    expect(store.get().toasts[0].id).toBeGreaterThan(firstId);
  });

  it('a message is never on screen twice: saying it again moves it to the end with a new id', () => {
    const store = createStore(initialState(''));
    showToast(store, 'This game is full.', 'error');
    showToast(store, 'Turn 2 has begun.', 'info');
    const firstId = store.get().toasts[0].id;

    showToast(store, 'This game is full.', 'error');

    const toasts = store.get().toasts;
    expect(toasts.map((toast) => toast.text)).toEqual(['Turn 2 has begun.', 'This game is full.']);
    expect(toasts[1].id).toBeGreaterThan(firstId); // a new toast, so its four seconds start again

    // The same words as another kind of message are another message.
    showToast(store, 'This game is full.', 'info');
    expect(store.get().toasts.map((toast) => [toast.text, toast.kind])).toEqual([
      ['Turn 2 has begun.', 'info'],
      ['This game is full.', 'error'],
      ['This game is full.', 'info'],
    ]);
  });

  it('the same refusal twice in a row (the page asks, then the player presses Join) leaves one toast', () => {
    const store = createStore(initialState('Cleo', SAMPLE.code));
    const refusal: ServerMessage = { type: 'error', code: 'gameFull', message: 'This game is full.' };
    handleServerMessage(store, refusal, () => {});
    handleServerMessage(store, refusal, () => {});
    expect(store.get().toasts.map((toast) => toast.text)).toEqual(['This game is full.']);
  });

  it('a toast with a slot takes the place of the one holding that slot; toasts without a slot never do', () => {
    const store = createStore(initialState(''));
    store.set({ toasts: toastsWith(store, [{ text: 'one', kind: 'info', slot: 'a' }, { text: 'plain', kind: 'info' }]) });
    store.set({ toasts: toastsWith(store, [{ text: 'two', kind: 'error', slot: 'a' }, { text: 'other slot', kind: 'info', slot: 'b' }]) });
    showToast(store, 'plain two', 'info');
    expect(store.get().toasts.map((toast) => toast.text)).toEqual(['plain', 'two', 'other slot', 'plain two']);
  });

  it('keeps only the newest few: a flood of news pushes the oldest out', () => {
    const store = createStore(initialState(''));
    for (let index = 1; index <= MAX_TOASTS + 3; index++) showToast(store, `news ${index}`, 'info');
    const texts = store.get().toasts.map((toast) => toast.text);
    expect(texts).toHaveLength(MAX_TOASTS);
    expect(texts[texts.length - 1]).toBe(`news ${MAX_TOASTS + 3}`);
    expect(texts[0]).toBe('news 4');
  });
});
