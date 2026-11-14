import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleLobby, sampleView } from '@domination/shared/testing';
import * as identity from '../src/net/identity';
import { createStore, currentScreen, initialState } from '../src/state/store';
import type { AppState } from '../src/state/store';

/**
 * Tests of the app shell (WP4). They run in plain Node (no
 * browser, so no window, no address bar, no localStorage), and cover the
 * parts that are pure logic: the store, the handling of server messages,
 * the selectors and the controller. They use sampleView() / sampleLobby()
 * from '@domination/shared/testing' as data and a fake Connection that
 * records what was sent.
 *
 * NO BROWSER NEEDED, by design: the code under test reaches the address bar
 * and the storage only through net/identity.ts, whose functions quietly do
 * nothing where those do not exist. If a test here needs a fake `window`,
 * something is reaching around identity.ts.
 *
 * NO RULES ENGINE NEEDED for most of them either: createController and
 * overlayFor take the "which tiles can this unit reach" function as an
 * option. The tests pass a function that returns a hand-made Map (pathTo
 * turns it into a path), and a fake clock for the End Turn guard:
 *     createController(store, connection, { reach: () => myReachMap, now: () => clock })
 * so a controller test fails only when the controller is wrong. The real
 * reachableFor, on top of the real movement rules, has its own tests in
 * shellSelectors.test.ts.
 *
 * The DOM panels and the pointer input are covered by the end-to-end script
 * (e2e/two-players.ts), not here.
 *
 * WHERE THE TESTS ARE. This file holds the store and identity tests. The
 * rest of the list lives in files of its own next to this one, all picked up
 * by `npx vitest run packages/client/test/shell`:
 *   shellMessages.test.ts    handleServerMessage, describeEvent, toasts
 *   shellSelectors.test.ts   selectors, reachableFor with the real rules
 *   shellController.test.ts  controller
 *   shellConnection.test.ts  connecting, reconnecting, liveness (fake socket and clock)
 *   shellInput.test.ts       tap / drag / pinch / wheel / keyboard decisions
 *   shellTexts.test.ts       the sentences the panels print
 *   shellIdentityBrowser.test.ts  identity.ts against a pretend browser
 *   shellKit.ts              helpers shared by these files
 */

describe('store (WP4)', () => {
  it('get returns the initial state; set merges fields and notifies every subscriber once', () => {
    const initial = initialState('Ada');
    const store = createStore(initial);
    expect(store.get()).toBe(initial);

    const first: AppState[] = [];
    const second: AppState[] = [];
    store.subscribe((state) => first.push(state));
    store.subscribe((state) => second.push(state));

    store.set({ busy: true, hoverTile: 12 });

    expect(store.get().busy).toBe(true);
    expect(store.get().hoverTile).toBe(12);
    // Fields that were not named are kept, and the old state object is not edited.
    expect(store.get().playerName).toBe('Ada');
    expect(initial.busy).toBe(false);
    // Each subscriber was called exactly once, with the new state.
    expect(first).toEqual([store.get()]);
    expect(second).toEqual([store.get()]);
  });

  it('unsubscribe stops notifications', () => {
    const store = createStore(initialState(''));
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.set({ busy: true });
    unsubscribe();
    store.set({ busy: false });
    expect(calls).toBe(1);
  });

  it('a subscriber may unsubscribe (itself or another) while being notified', () => {
    const store = createStore(initialState(''));
    const calls: string[] = [];
    const stopFirst = store.subscribe(() => {
      calls.push('first');
      stopFirst();
    });
    store.subscribe(() => calls.push('second'));
    store.set({ busy: true });
    store.set({ busy: false });
    expect(calls).toEqual(['first', 'second', 'second']);
  });

  it('a subscriber that is unsubscribed during a notification is not called any more, not even in that round', () => {
    // This is what happens when the app swaps screens in answer to a change:
    // the old screen's parts are unsubscribed by a listener that runs before them.
    const store = createStore(initialState(''));
    const calls: string[] = [];
    let stopLate: () => void = () => {};
    store.subscribe(() => {
      calls.push('early');
      stopLate();
    });
    stopLate = store.subscribe(() => calls.push('late'));

    store.set({ busy: true });

    expect(calls).toEqual(['early']);
  });

  it('a subscriber added during a notification is first called on the next change', () => {
    const store = createStore(initialState(''));
    const calls: string[] = [];
    let added = false;
    store.subscribe(() => {
      calls.push('first');
      if (!added) {
        added = true;
        store.subscribe(() => calls.push('added'));
      }
    });

    store.set({ busy: true });
    expect(calls).toEqual(['first']);
    store.set({ busy: false });
    expect(calls).toEqual(['first', 'first', 'added']);
  });

  it('a subscriber may change the store itself; everybody ends up with the newest state', () => {
    const store = createStore(initialState(''));
    const seenByLast: boolean[] = [];
    store.subscribe((state) => {
      if (state.busy) store.set({ busy: false }); // for example: an answer that clears a flag at once
    });
    store.subscribe((state) => seenByLast.push(state.busy));

    store.set({ busy: true });

    expect(store.get().busy).toBe(false);
    expect(seenByLast[seenByLast.length - 1]).toBe(false);
  });

  it('currentScreen is home, lobby or game depending on what is set', () => {
    const home = initialState('');
    expect(currentScreen(home)).toBe('home');

    const lobby: AppState = { ...home, lobby: sampleLobby() };
    expect(currentScreen(lobby)).toBe('lobby');

    const game: AppState = {
      ...home,
      game: { code: 'K7QXM', view: sampleView(), connected: [], seq: 0, awaitingSync: false },
    };
    expect(currentScreen(game)).toBe('game');
    // A game wins over a lobby, should both ever be set.
    expect(currentScreen({ ...game, lobby: sampleLobby() })).toBe('game');
  });

  it('initialState carries the name and the game code being rejoined (joining)', () => {
    expect(initialState('Ada', 'K7QXM')).toEqual({
      connection: 'connecting',
      playerName: 'Ada',
      joining: 'K7QXM',
      joinProblem: null,
      lobby: null,
      game: null,
      selection: null,
      hoverTile: null,
      busy: false,
      toasts: [],
      fatalMessage: null,
    });
    expect(initialState('Ada').joining).toBeNull();
  });
});

describe('identity (WP4)', () => {
  // The token is remembered in the identity module itself. Every test loads
  // a fresh copy of the module, so no test depends on what another one saved.
  async function freshIdentity(): Promise<typeof identity> {
    vi.resetModules();
    return import('../src/net/identity');
  }

  afterEach(() => {
    vi.resetModules();
  });

  it('every function is safe in plain Node: loads return null or "", saves and URL changes do nothing, nothing throws', async () => {
    const fresh = await freshIdentity();

    expect(fresh.loadToken()).toBeNull();
    expect(fresh.loadPlayerName()).toBe('');
    expect(fresh.loadLastGame()).toBeNull();
    expect(fresh.gameCodeFromUrl()).toBeNull();
    expect(fresh.urlParameter('demo')).toBeNull();
    expect(fresh.webSocketUrl()).toBeNull();

    expect(() => fresh.savePlayerName('Ada')).not.toThrow();
    expect(() => fresh.saveLastGame('K7QXM')).not.toThrow();
    expect(() => fresh.saveLastGame(null)).not.toThrow();
    expect(() => fresh.setGameCodeInUrl('K7QXM')).not.toThrow();
    expect(() => fresh.setGameCodeInUrl(null)).not.toThrow();
    expect(() => fresh.reloadPage()).not.toThrow();

    // Nothing was stored anywhere, so nothing comes back.
    expect(fresh.loadPlayerName()).toBe('');
    expect(fresh.loadLastGame()).toBeNull();
    expect(fresh.gameCodeFromUrl()).toBeNull();
    // Without a page address the link is at least the part that names the game.
    expect(fresh.shareLink('K7QXM')).toBe('?g=K7QXM');
  });

  it('saveToken keeps the token in memory, so loadToken returns it even though nothing could be stored; saveToken then returns false', async () => {
    const fresh = await freshIdentity();
    expect(fresh.loadToken()).toBeNull();
    expect(fresh.saveToken('secret-token')).toBe(false);
    expect(fresh.loadToken()).toBe('secret-token');
  });

  it('reloadPageOnce returns false where there is no browser', async () => {
    const fresh = await freshIdentity();
    expect(fresh.reloadPageOnce()).toBe(false);
    expect(fresh.reloadPageOnce()).toBe(false);
  });
});
