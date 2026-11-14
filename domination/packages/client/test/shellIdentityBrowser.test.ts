import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@domination/shared';
import { sampleLobby, sampleView } from '@domination/shared/testing';
import type * as IdentityModule from '../src/net/identity';
import type { Store } from '../src/state/store';

/**
 * net/identity.ts against a pretend browser. identity.ts is the one file of
 * the app shell that touches the address bar, localStorage, sessionStorage
 * and page reloads, so this is the one test file that fakes them. (The
 * plain-Node behaviour, where none of them exist, is tested in shell.test.ts.)
 */

/** A pretend Storage that keeps its items in a Map. */
class FakeStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** A Storage that refuses everything, as some browsers do in private mode. */
class BlockedStorage {
  getItem(): string | null {
    throw new Error('storage is blocked');
  }
  setItem(): void {
    throw new Error('storage is blocked');
  }
  removeItem(): void {
    throw new Error('storage is blocked');
  }
}

interface FakeBrowser {
  identity: typeof IdentityModule;
  local: FakeStorage;
  session: FakeStorage;
  /** The page address as the address bar shows it now. */
  address(): string;
  /** How often the page was reloaded. */
  reloads(): number;
}

/**
 * Puts a pretend `location`, `history`, `localStorage` and `sessionStorage`
 * in place and loads a fresh copy of identity.ts (its remembered token
 * starts empty).
 */
async function browserAt(address: string, storage: { local?: object; session?: object } = {}): Promise<FakeBrowser> {
  let url = new URL(address);
  let reloadCount = 0;
  const local = new FakeStorage();
  const session = new FakeStorage();

  vi.stubGlobal('location', {
    get search() { return url.search; },
    get pathname() { return url.pathname; },
    get hash() { return url.hash; },
    get origin() { return url.origin; },
    get host() { return url.host; },
    get hostname() { return url.hostname; },
    get protocol() { return url.protocol; },
    reload() { reloadCount += 1; },
  });
  vi.stubGlobal('history', {
    state: null,
    replaceState(_state: unknown, _title: string, next: string) {
      url = new URL(next, url);
    },
  });
  vi.stubGlobal('localStorage', storage.local ?? local);
  vi.stubGlobal('sessionStorage', storage.session ?? session);

  vi.resetModules();
  const identity = await import('../src/net/identity');
  return { identity, local, session, address: () => url.href, reloads: () => reloadCount };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('identity in a browser (WP4)', () => {
  it('keeps the token, the name and the last game in localStorage under the documented keys', async () => {
    const { identity, local } = await browserAt('http://game.test/');

    expect(identity.saveToken('secret-token')).toBe(true);
    identity.savePlayerName('Ada');
    identity.saveLastGame('K7QXM');

    expect(local.items.get(identity.STORAGE_KEYS.token)).toBe('secret-token');
    expect(local.items.get(identity.STORAGE_KEYS.playerName)).toBe('Ada');
    expect(local.items.get(identity.STORAGE_KEYS.lastGame)).toBe('K7QXM');
    expect(identity.loadToken()).toBe('secret-token');
    expect(identity.loadPlayerName()).toBe('Ada');
    expect(identity.loadLastGame()).toBe('K7QXM');

    identity.saveLastGame(null);
    expect(local.items.has(identity.STORAGE_KEYS.lastGame)).toBe(false);
    expect(identity.loadLastGame()).toBeNull();
  });

  it('a page that is opened later reads the stored token back', async () => {
    const first = await browserAt('http://game.test/');
    first.identity.saveToken('secret-token');

    // The same browser storage, a freshly loaded page.
    const later = await browserAt('http://game.test/', { local: first.local });
    expect(later.identity.loadToken()).toBe('secret-token');
  });

  it('the token in memory wins over the stored copy', async () => {
    const { identity, local } = await browserAt('http://game.test/');
    identity.saveToken('mine');
    local.items.set(identity.STORAGE_KEYS.token, 'written by another tab');
    expect(identity.loadToken()).toBe('mine');
  });

  it('with storage blocked nothing throws: saveToken answers false but the open page still knows its token', async () => {
    const { identity } = await browserAt('http://game.test/?g=K7QXM', { local: new BlockedStorage(), session: new BlockedStorage() });

    expect(identity.loadToken()).toBeNull();
    expect(identity.loadPlayerName()).toBe('');
    expect(identity.loadLastGame()).toBeNull();
    expect(identity.saveToken('secret-token')).toBe(false);
    expect(identity.loadToken()).toBe('secret-token');
    expect(() => identity.savePlayerName('Ada')).not.toThrow();
    expect(() => identity.saveLastGame('K7QXM')).not.toThrow();
    // Without a place to remember "already reloaded", the page must not reload itself at all.
    expect(identity.reloadPageOnce()).toBe(false);
    // The address bar still works.
    expect(identity.gameCodeFromUrl()).toBe('K7QXM');
  });

  it('a tab opened with ?profile=NAME is a different player: every key gets the suffix .NAME', async () => {
    const plain = await browserAt('http://game.test/');
    plain.identity.saveToken('token-of-the-plain-tab');
    plain.identity.savePlayerName('Ada');

    const second = await browserAt('http://game.test/?profile=2', { local: plain.local });
    expect(second.identity.loadToken()).toBeNull();
    expect(second.identity.loadPlayerName()).toBe('');

    second.identity.saveToken('token-of-profile-2');
    second.identity.savePlayerName('Ben');
    second.identity.saveLastGame('K7QXM');
    expect(plain.local.items.get(`${second.identity.STORAGE_KEYS.token}.2`)).toBe('token-of-profile-2');
    expect(plain.local.items.get(`${second.identity.STORAGE_KEYS.playerName}.2`)).toBe('Ben');
    expect(plain.local.items.get(`${second.identity.STORAGE_KEYS.lastGame}.2`)).toBe('K7QXM');
    // The plain tab's own entries are untouched.
    expect(plain.local.items.get(second.identity.STORAGE_KEYS.token)).toBe('token-of-the-plain-tab');
    expect(plain.local.items.get(second.identity.STORAGE_KEYS.playerName)).toBe('Ada');
  });

  it('a profile that is not letters and digits (or is longer than 16) is ignored', async () => {
    for (const profile of ['two%20words', 'a.b', 'x'.repeat(17), '']) {
      const { identity, local } = await browserAt(`http://game.test/?profile=${profile}`);
      identity.savePlayerName('Ada');
      expect([...local.items.keys()]).toEqual([identity.STORAGE_KEYS.playerName]);
    }
  });

  it('gameCodeFromUrl reads ?g=, trimmed and upper-cased; null without one', async () => {
    expect((await browserAt('http://game.test/?g=k7qxm')).identity.gameCodeFromUrl()).toBe('K7QXM');
    expect((await browserAt('http://game.test/?g=%20K7QXM%20&profile=2')).identity.gameCodeFromUrl()).toBe('K7QXM');
    expect((await browserAt('http://game.test/')).identity.gameCodeFromUrl()).toBeNull();
    expect((await browserAt('http://game.test/?g=')).identity.gameCodeFromUrl()).toBeNull();
  });

  it('a ?g= that cannot be a game code is no code: it is neither shown nor sent, and the page knows the link is broken', async () => {
    const broken = [
      'ABCDEFGHJKMNPQRSTUVWXYZ23456789ABCDEFGHJKMNPQRSTUVWXYZ23456789', // 62 characters
      'K7QXMK7QXMK7QXMK7', // 17: one more than the server reads at all
      'K7QXMM', // one too many
      'K7QX', // one too few
      'K7QXM.', // a full stop that a chat program took into the link
      'K7QX0', // 0, 1, I, L and O are not used in codes
      'K7 XM',
      '%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E',
      'K7QXM%20AND%20SEND%205%20DOLLARS%20TO%20MALLORY%20FIRST',
    ];
    for (const text of broken) {
      const { identity } = await browserAt(`http://game.test/?g=${text}`);
      expect(identity.gameCodeFromUrl(), text).toBeNull();
      expect(identity.gameLinkIsBroken(), text).toBe(true);
    }
    // A code, in whatever case and with spaces around it, is a good link; so is no code at all.
    for (const address of ['http://game.test/?g=k7qxm', 'http://game.test/?g=%20K7QXM%20', 'http://game.test/', 'http://game.test/?g=', 'http://game.test/?g=%20']) {
      expect((await browserAt(address)).identity.gameLinkIsBroken(), address).toBe(false);
    }
  });

  it('a remembered last game that is not a code is forgotten rather than offered', async () => {
    const { identity, local } = await browserAt('http://game.test/');
    local.items.set(identity.STORAGE_KEYS.lastGame, 'K7QXM<script>');
    expect(identity.loadLastGame()).toBeNull();
    local.items.set(identity.STORAGE_KEYS.lastGame, ' k7qxm ');
    expect(identity.loadLastGame()).toBe('K7QXM');
  });

  it('setGameCodeInUrl(null) also takes a ?g= out of the address that was never a code', async () => {
    const browser = await browserAt('http://game.test/?g=NOT-A-CODE&profile=2');
    browser.identity.setGameCodeInUrl(null);
    expect(browser.address()).toBe('http://game.test/?profile=2');
  });

  it('pageIsLocalOnly: localhost and its numbers are addresses nobody else can open', async () => {
    for (const address of ['http://localhost:8787/', 'http://LOCALHOST/', 'http://127.0.0.1:8787/?g=K7QXM', 'http://127.1.2.3/', 'http://[::1]:8787/', 'http://game.localhost/']) {
      expect((await browserAt(address)).identity.pageIsLocalOnly(), address).toBe(true);
    }
    for (const address of ['http://192.168.1.20:8787/', 'https://game.example.com/', 'http://localhost.example.com/', 'http://10.0.0.127/', 'http://1127.0.0.1.example/']) {
      expect((await browserAt(address)).identity.pageIsLocalOnly(), address).toBe(false);
    }
  });

  it('urlParameter tells a bare ?demo from ?demo=lobby from no parameter', async () => {
    expect((await browserAt('http://game.test/?demo')).identity.urlParameter('demo')).toBe('');
    expect((await browserAt('http://game.test/?demo=lobby')).identity.urlParameter('demo')).toBe('lobby');
    expect((await browserAt('http://game.test/')).identity.urlParameter('demo')).toBeNull();
  });

  it('setGameCodeInUrl puts the code into the address bar without losing the profile, and takes it out again', async () => {
    const browser = await browserAt('http://game.test/play/?profile=2#top');

    browser.identity.setGameCodeInUrl('K7QXM');
    expect(new URL(browser.address()).searchParams.get('g')).toBe('K7QXM');
    expect(new URL(browser.address()).searchParams.get('profile')).toBe('2');
    expect(new URL(browser.address()).pathname).toBe('/play/');
    expect(new URL(browser.address()).hash).toBe('#top');
    expect(browser.identity.gameCodeFromUrl()).toBe('K7QXM');

    browser.identity.setGameCodeInUrl('ABCDE'); // another game replaces the code, it is not added twice
    expect(new URL(browser.address()).searchParams.getAll('g')).toEqual(['ABCDE']);

    browser.identity.setGameCodeInUrl(null);
    expect(browser.address()).toBe('http://game.test/play/?profile=2#top');
    expect(browser.identity.gameCodeFromUrl()).toBeNull();
  });

  it('setGameCodeInUrl leaves a bare address bare', async () => {
    const browser = await browserAt('http://game.test/?g=K7QXM');
    browser.identity.setGameCodeInUrl(null);
    expect(browser.address()).toBe('http://game.test/');
  });

  it('shareLink is the page address with ?g=CODE and nothing else', async () => {
    const { identity } = await browserAt('http://game.test:8787/play/?profile=2&g=OLDER#top');
    expect(identity.shareLink('K7QXM')).toBe('http://game.test:8787/play/?g=K7QXM');
  });

  it('webSocketUrl follows the page: ws for http, wss for https, same host and port', async () => {
    expect((await browserAt('http://game.test:8787/?g=K7QXM')).identity.webSocketUrl()).toBe('ws://game.test:8787/ws');
    expect((await browserAt('https://game.test/')).identity.webSocketUrl()).toBe('wss://game.test/ws');
  });

  it('reloadPageOnce reloads the first time and never again in the same tab', async () => {
    const first = await browserAt('http://game.test/');
    expect(first.identity.reloadPageOnce()).toBe(true);
    expect(first.reloads()).toBe(1);

    // The reloaded page: a fresh copy of the code, the same tab (same sessionStorage).
    const reloaded = await browserAt('http://game.test/', { session: first.session });
    expect(reloaded.identity.reloadPageOnce()).toBe(false);
    expect(reloaded.reloads()).toBe(0);

    // A new tab has a sessionStorage of its own and may reload once itself.
    const otherTab = await browserAt('http://game.test/');
    expect(otherTab.identity.reloadPageOnce()).toBe(true);
  });

  it('reloadPage reloads whenever it is asked to', async () => {
    const browser = await browserAt('http://game.test/');
    browser.identity.reloadPage();
    browser.identity.reloadPage();
    expect(browser.reloads()).toBe(2);
  });
});

/**
 * What server messages do to the address bar and to the remembered last
 * game. (What they do to the store is tested in shellMessages.test.ts, in
 * plain Node, where these two do not exist.)
 */
describe('server messages in a browser: the address bar and the remembered game (WP4)', () => {
  const CODE = 'K7QXM';

  /** A page at `address` with a store, and a way to hand it server messages. */
  async function pageAt(address: string) {
    const browser = await browserAt(address);
    // Loaded after browserAt, so that these modules use the pretend browser's copy of identity.ts.
    const { handleServerMessage } = await import('../src/state/serverMessages');
    const { createStore, currentScreen, initialState } = await import('../src/state/store');
    const store: Store = createStore(initialState('Ada', browser.identity.gameCodeFromUrl()));
    const sent: ClientMessage[] = [];
    const deliver = (...messages: ServerMessage[]): void => {
      for (const message of messages) handleServerMessage(store, message, (reply) => sent.push(reply));
    };
    return { ...browser, store, sent, deliver, screen: () => currentScreen(store.get()) };
  }

  const lobby: ServerMessage = { type: 'lobby', lobby: sampleLobby() };
  const game: ServerMessage = { type: 'gameSync', code: CODE, seq: 1, view: sampleView(), connected: ['p1'], events: [] };

  it('the examples use the code of the sample lobby', () => {
    expect(sampleLobby().code).toBe(CODE);
  });

  it('Leave in a lobby: the address loses the code and the game is no longer remembered, so the home screen does not offer it again', async () => {
    const page = await pageAt('http://game.test/');
    page.deliver(lobby);
    expect(page.address()).toBe(`http://game.test/?g=${CODE}`);
    expect(page.identity.loadLastGame()).toBe(CODE);

    page.deliver({ type: 'left' });

    expect(page.screen()).toBe('home');
    expect(page.address()).toBe('http://game.test/');
    expect(page.identity.loadLastGame()).toBeNull();
  });

  it('`left` during a game (the Leave that lost the race against Start) keeps the address and the remembered game', async () => {
    const page = await pageAt(`http://game.test/?g=${CODE}`);
    page.deliver(lobby, game, { type: 'left' });

    expect(page.screen()).toBe('game');
    expect(page.address()).toBe(`http://game.test/?g=${CODE}`);
    expect(page.identity.loadLastGame()).toBe(CODE);
    expect(page.sent).toEqual([{ type: 'joinGame', code: CODE, name: null }]);
  });

  it('`left` on the home screen leaves a game remembered from earlier alone', async () => {
    const page = await pageAt('http://game.test/');
    page.identity.saveLastGame(CODE);
    page.deliver({ type: 'left' });
    expect(page.identity.loadLastGame()).toBe(CODE);
  });

  it('a refused rejoin while a game is on screen: the code stays in the address, except for a game that no longer exists', async () => {
    for (const code of ['nameRequired', 'gameAlreadyStarted', 'gameFull'] as const) {
      const page = await pageAt(`http://game.test/?g=${CODE}`);
      page.deliver(game, { type: 'error', code, message: 'the server text' });
      expect(page.screen(), code).toBe('home');
      // The home screen reads the code from here, to print it with the invitation or with the reason.
      expect(page.address(), code).toBe(`http://game.test/?g=${CODE}`);
      expect(page.identity.loadLastGame(), code).toBe(CODE);
    }

    const gone = await pageAt(`http://game.test/?g=${CODE}`);
    gone.deliver(game);
    // An unrelated error first: the page no longer counts as "joining", and must still forget the game.
    gone.deliver({ type: 'error', code: 'rateLimited', message: 'slow down' });
    // The home screen is put up by the store change. What it finds in the address at that moment is the code it shows.
    const { currentScreen } = await import('../src/state/store');
    const codeWhenHomeAppeared: (string | null)[] = [];
    gone.store.subscribe((state) => {
      if (currentScreen(state) === 'home') codeWhenHomeAppeared.push(gone.identity.gameCodeFromUrl());
    });
    gone.deliver({ type: 'error', code: 'noSuchGame', message: 'the server text' });
    expect(gone.screen()).toBe('home');
    expect(codeWhenHomeAppeared).toEqual([CODE]);
    expect(gone.address()).toBe('http://game.test/');
    expect(gone.identity.loadLastGame()).toBeNull();
  });
});
