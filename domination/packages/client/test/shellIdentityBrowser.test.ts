import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as IdentityModule from '../src/net/identity';

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
