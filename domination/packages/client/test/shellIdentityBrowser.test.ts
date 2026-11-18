import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@domination/shared';
import { sampleLobby, sampleView } from '@domination/shared/testing';
import type { SocketEvents } from '../src/net/connection';
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
  for (const connection of openConnections.splice(0)) connection.close();
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Connections opened by connectionOf, closed after each test. */
const openConnections: { close(): void }[] = [];

/** One pretend socket of a page: what the page sent on it, whether the page closed it, and a way to play the server's side. */
interface PretendSocket {
  sent: ClientMessage[];
  closedByPage: boolean;
  serverSends(message: ServerMessage): void;
  /** The connection is lost. */
  drop(): void;
}

/** The connection of one page (one tab) in the pretend browser. */
interface PageConnection {
  /** Every socket the page opened, oldest first; each one has been opened (the page has said hello on it). */
  sockets: PretendSocket[];
  /** The newest socket. */
  socket(): PretendSocket;
  /** What the connection told the app, in order: 'status online', 'ready', 'disconnect', ... */
  told: string[];
  /** What the app answers to "does this page show no lobby and no game?" (ConnectionHandlers.mayChangeIdentity). */
  showsNoGame: boolean;
  /** Plays the browser telling this tab that another tab has changed the stored token. */
  storageEvent(): void;
  /** The wait after a lost connection is over: the page tries again. */
  reconnect(): void;
}

/**
 * A connection (net/connection.ts) of the page in the pretend browser. Its
 * timers never run. Call it after browserAt, so that the connection uses
 * the pretend browser's identity.ts.
 */
async function connectionOf(_browser: FakeBrowser): Promise<PageConnection> {
  const { createConnection, RECONNECT_FIRST_DELAY_MS } = await import('../src/net/connection');
  let tokenStored: () => void = () => {};
  let tryAgain: () => void = () => {};
  const page: PageConnection = {
    sockets: [],
    told: [],
    showsNoGame: true,
    socket() {
      const newest = page.sockets[page.sockets.length - 1];
      if (newest === undefined) throw new Error('the connection opened no socket');
      return newest;
    },
    storageEvent: () => tokenStored(),
    reconnect: () => tryAgain(),
  };
  const connection = createConnection(
    {
      onStatus: (status) => void page.told.push(`status ${status}`),
      onReady: () => void page.told.push('ready'),
      onMessage() {},
      onDisconnect: () => void page.told.push('disconnect'),
      onTokenNotSaved: () => void page.told.push('token not saved'),
      mayChangeIdentity: () => page.showsNoGame,
    },
    {
      url: 'ws://game.test/ws',
      openSocket(_url, events: SocketEvents) {
        const socket: PretendSocket = {
          sent: [],
          closedByPage: false,
          serverSends: (message) => events.frame(JSON.stringify(message)),
          drop: () => events.closed(),
        };
        page.sockets.push(socket);
        // The browser reports "open" a moment later; the page then says hello.
        queueMicrotask(() => events.opened());
        return {
          send: (text) => void socket.sent.push(JSON.parse(text) as ClientMessage),
          close() {
            socket.closedByPage = true;
          },
        };
      },
      now: () => 0,
      // No timer runs by itself; the wait before a new attempt (the shortest one, 500 ms) is ended by `reconnect`.
      setTimer(run, delayMs) {
        if (delayMs === RECONNECT_FIRST_DELAY_MS) tryAgain = run;
        return 0;
      },
      clearTimer() {},
      random: () => 0,
      onWake: () => () => {},
      onTokenStored(listener) {
        tokenStored = listener;
        return () => {
          tokenStored = () => {};
        };
      },
    },
  );
  openConnections.push(connection);
  await settled();
  return page;
}

/** Lets the pretend sockets that were just made report "open". */
async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** What a token looks like: 32 lower-case hex characters, as the server makes and accepts them. */
const TOKEN_SHAPE = /^[0-9a-f]{32}$/;

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

  it('a welcome from the server makes the tab forget that it reloaded itself, so the NEXT update may reload it once again; without a welcome the guard against a reload loop holds', async () => {
    // Update day: the open page is turned away (another version) and reloads itself.
    const first = await browserAt('http://game.test/');
    expect(first.identity.reloadPageOnce()).toBe(true);
    expect(first.reloads()).toBe(1);

    // The reloaded page (the same tab: the same sessionStorage) is turned away
    // again, because the build was forgotten. It is never welcomed, and it
    // does not reload itself a second time, however often it is asked.
    const turnedAway = await browserAt('http://game.test/', { session: first.session });
    const refused = await connectionOf(turnedAway);
    refused.socket().serverSends({ type: 'error', code: 'protocolMismatch', message: 'the server text' });
    expect(turnedAway.identity.reloadPageOnce()).toBe(false);
    expect(turnedAway.identity.reloadPageOnce()).toBe(false);
    expect(turnedAway.reloads()).toBe(0);

    // The usual case: the reloaded page fetched the new version and is welcomed. The reload has done its job.
    const reloaded = await browserAt('http://game.test/', { session: first.session });
    const welcomed = await connectionOf(reloaded);
    expect(reloaded.identity.reloadPageOnce()).toBe(false); // not yet welcomed: the guard holds
    expect(reloaded.reloads()).toBe(0);
    const proposed = welcomed.socket().sent[0];
    welcomed.socket().serverSends({ type: 'welcome', protocol: 3, token: proposed.type === 'hello' && proposed.token !== null ? proposed.token : 'f'.repeat(32) });

    // Days later the game is updated again. The same tab, still open, is turned away, and reloads itself once more.
    expect(reloaded.identity.reloadPageOnce()).toBe(true);
    expect(reloaded.reloads()).toBe(1);
    // Once, not twice.
    expect(reloaded.identity.reloadPageOnce()).toBe(false);
    expect(reloaded.reloads()).toBe(1);
  });

  it('reloadPage reloads whenever it is asked to', async () => {
    const browser = await browserAt('http://game.test/');
    browser.identity.reloadPage();
    browser.identity.reloadPage();
    expect(browser.reloads()).toBe(2);
  });
});

/**
 * One browser is one player, also on its very first visit and in several
 * tabs. The page makes its own token and stores it BEFORE it says hello, so
 * a second tab finds it; and a tab whose identity is new gives it up for
 * the one in the browser's storage as long as it shows no lobby and no game.
 */
describe('a first visit in several tabs: one browser is one player (WP4)', () => {
  /** The token a page said hello with on a socket. */
  function helloToken(socket: PretendSocket): string | null {
    const hello = socket.sent[0];
    if (hello === undefined || hello.type !== 'hello') throw new Error(`the page did not say hello first: ${JSON.stringify(socket.sent)}`);
    return hello.token;
  }

  /** The server's answer to a hello: the proposed token, as the real server answers a token of the right form. */
  function welcome(socket: PretendSocket): string {
    const token = helloToken(socket);
    if (token === null) throw new Error('the page proposed no token');
    socket.serverSends({ type: 'welcome', protocol: 3, token });
    return token;
  }

  it('on a first visit the page makes a token of its own (32 lower-case hex characters) and has stored it before it says hello', async () => {
    const browser = await browserAt('http://game.test/');
    expect(browser.local.items.size).toBe(0);

    const page = await connectionOf(browser);

    const token = helloToken(page.socket());
    expect(token).toMatch(TOKEN_SHAPE);
    // Stored already, although the server has not answered yet: this is what a second tab finds.
    expect(browser.local.items.get(browser.identity.STORAGE_KEYS.token)).toBe(token);
    expect(browser.identity.loadToken()).toBe(token);

    // Another first visit (another browser) makes another token.
    const other = await browserAt('http://game.test/');
    expect(helloToken((await connectionOf(other)).socket())).not.toBe(token);
  });

  it('a second tab opened before the first has heard back from the server says hello with the same token, and so does a third after the answer', async () => {
    const first = await browserAt('http://game.test/');
    const tab1 = await connectionOf(first);
    const token = helloToken(tab1.socket());

    // The second tab: a fresh copy of the page, the same browser storage. Tab 1 has not been answered.
    const second = await browserAt('http://game.test/', { local: first.local });
    const tab2 = await connectionOf(second);
    expect(helloToken(tab2.socket())).toBe(token);

    // Both are welcomed: neither opens another socket, both are ready, and the storage holds the one token.
    welcome(tab1.socket());
    welcome(tab2.socket());
    expect(tab1.sockets).toHaveLength(1);
    expect(tab2.sockets).toHaveLength(1);
    expect(tab1.told).toEqual(['status online', 'ready']);
    expect(tab2.told).toEqual(['status online', 'ready']);
    expect(first.local.items.get(first.identity.STORAGE_KEYS.token)).toBe(token);

    const third = await browserAt('http://game.test/', { local: first.local });
    expect(helloToken((await connectionOf(third)).socket())).toBe(token);
  });

  it('two tabs that found the storage empty in the same instant: the tab whose token is not the stored one takes the stored one when its answer arrives, and says hello again as that player', async () => {
    const browser = await browserAt('http://game.test/');
    const tab1 = await connectionOf(browser);
    const own = helloToken(tab1.socket());
    // The other tab read the empty storage before tab 1 wrote, made a token too, and wrote after tab 1.
    const others = 'b'.repeat(32);
    browser.local.items.set(browser.identity.STORAGE_KEYS.token, others);

    tab1.socket().serverSends({ type: 'welcome', protocol: 3, token: own as string });
    await settled();

    // Not ready as the first player: the old socket is closed, and a new one says hello as the player in the storage.
    expect(tab1.sockets).toHaveLength(2);
    expect(tab1.sockets[0].closedByPage).toBe(true);
    expect(helloToken(tab1.sockets[1])).toBe(others);
    expect(tab1.told).toEqual([]);
    expect(browser.identity.loadToken()).toBe(others);
    expect(browser.local.items.get(browser.identity.STORAGE_KEYS.token)).toBe(others);

    // The second answer settles it: ready once, one player, and no third socket.
    welcome(tab1.sockets[1]);
    await settled();
    expect(tab1.sockets).toHaveLength(2);
    expect(tab1.told).toEqual(['status online', 'ready']);
    expect(browser.local.items.get(browser.identity.STORAGE_KEYS.token)).toBe(others);
    // An answer that still arrives on the socket the page has given up changes nothing.
    tab1.sockets[0].serverSends({ type: 'welcome', protocol: 3, token: own as string });
    expect(browser.identity.loadToken()).toBe(others);
    expect(tab1.told).toEqual(['status online', 'ready']);
  });

  it('the browser says "another tab stored a token": a tab with a new identity that shows no lobby and no game takes it over at once, also after it was welcomed', async () => {
    // Before the answer.
    const early = await browserAt('http://game.test/');
    const waiting = await connectionOf(early);
    const others = 'c'.repeat(32);
    early.local.items.set(early.identity.STORAGE_KEYS.token, others);
    waiting.storageEvent();
    await settled();
    expect(waiting.sockets).toHaveLength(2);
    expect(waiting.sockets[0].closedByPage).toBe(true);
    expect(helloToken(waiting.sockets[1])).toBe(others);
    expect(waiting.told).toEqual([]); // the app was never told "online", so it is told nothing now

    // After the answer, on the first screen.
    const late = await browserAt('http://game.test/');
    const welcomed = await connectionOf(late);
    welcome(welcomed.socket());
    expect(welcomed.told).toEqual(['status online', 'ready']);
    late.local.items.set(late.identity.STORAGE_KEYS.token, others);
    welcomed.storageEvent();
    await settled();
    expect(welcomed.sockets).toHaveLength(2);
    expect(helloToken(welcomed.sockets[1])).toBe(others);
    // The app is told that it is not connected for a moment (no "Connection lost" notice: it is connecting).
    expect(welcomed.told).toEqual(['status online', 'ready', 'disconnect', 'status connecting']);
    welcome(welcomed.sockets[1]);
    expect(welcomed.told).toEqual(['status online', 'ready', 'disconnect', 'status connecting', 'status online', 'ready']);
    expect(late.identity.loadToken()).toBe(others);

    // An event that changes nothing (the storage holds this tab's own token) opens no socket.
    welcomed.storageEvent();
    await settled();
    expect(welcomed.sockets).toHaveLength(2);
  });

  it('a tab that shows a lobby or a game never gives its identity up: not when the browser reports another token, and not when it is welcomed again after a lost connection; it writes its own token back', async () => {
    const browser = await browserAt('http://game.test/');
    const tab = await connectionOf(browser);
    const own = welcome(tab.socket());
    tab.showsNoGame = false; // the player has made a game: this identity holds a seat now
    const others = 'd'.repeat(32);
    browser.local.items.set(browser.identity.STORAGE_KEYS.token, others);

    tab.storageEvent();
    await settled();
    expect(tab.sockets).toHaveLength(1);
    expect(browser.identity.loadToken()).toBe(own);

    // The connection is lost and comes back: the page says hello as itself and stays that player.
    tab.socket().drop();
    tab.reconnect();
    await settled();
    expect(tab.sockets).toHaveLength(2);
    expect(helloToken(tab.sockets[1])).toBe(own);
    welcome(tab.sockets[1]);
    await settled();
    expect(tab.sockets).toHaveLength(2);
    expect(browser.identity.loadToken()).toBe(own);
    // The storage has its token again (so the other tab, if it holds no seat, comes over to this player).
    expect(browser.local.items.get(browser.identity.STORAGE_KEYS.token)).toBe(own);
  });

  it('a page that came back with a stored token (a returning player) never takes over another token, whatever the storage says later', async () => {
    const earlier = await browserAt('http://game.test/');
    const mine = 'e'.repeat(32);
    earlier.local.items.set(earlier.identity.STORAGE_KEYS.token, mine);

    // The same browser storage, a freshly loaded page (the storage of this page is `earlier.local`).
    const browser = await browserAt('http://game.test/?g=K7QXM', { local: earlier.local });
    const storage = earlier.local.items;
    const page = await connectionOf(browser);
    expect(helloToken(page.socket())).toBe(mine);

    // The storage is emptied and another tab makes a token of its own (site data cleared while this page is open).
    const others = 'f'.repeat(32);
    storage.set(browser.identity.STORAGE_KEYS.token, others);
    page.storageEvent();
    await settled();
    expect(page.sockets).toHaveLength(1);
    expect(browser.identity.adoptStoredToken()).toBe(false);

    // Its answer arrives: it stays who it was, and writes its token back, as an open page always did.
    welcome(page.socket());
    expect(page.sockets).toHaveLength(1);
    expect(page.told).toEqual(['status online', 'ready']);
    expect(browser.identity.loadToken()).toBe(mine);
    expect(storage.get(browser.identity.STORAGE_KEYS.token)).toBe(mine);
  });

  it('a tab that is waiting to reconnect takes the stored token over without opening a socket for it: its next hello carries it', async () => {
    const browser = await browserAt('http://game.test/');
    const tab = await connectionOf(browser);
    welcome(tab.socket());
    tab.socket().drop(); // the connection is lost; the page waits before it tries again
    const others = 'c'.repeat(32);
    browser.local.items.set(browser.identity.STORAGE_KEYS.token, others);

    tab.storageEvent();
    await settled();
    expect(tab.sockets).toHaveLength(1);
    expect(browser.identity.loadToken()).toBe(others);

    tab.reconnect();
    await settled();
    expect(tab.sockets).toHaveLength(2);
    expect(helloToken(tab.sockets[1])).toBe(others);
  });

  it('what is in the storage is taken over only if it has the form of a token', async () => {
    const browser = await browserAt('http://game.test/');
    const tab = await connectionOf(browser);
    const own = helloToken(tab.socket());
    for (const notAToken of ['', 'short', 'B'.repeat(32), 'g'.repeat(32), 'a'.repeat(33), `${'a'.repeat(32)}\n`, '<script>alert(1)</script>']) {
      browser.local.items.set(browser.identity.STORAGE_KEYS.token, notAToken);
      tab.storageEvent();
      await settled();
      expect(tab.sockets, JSON.stringify(notAToken)).toHaveLength(1);
      expect(browser.identity.loadToken(), JSON.stringify(notAToken)).toBe(own);
    }
    // The token removed from the storage (site data cleared): nothing to take over either.
    browser.local.items.delete(browser.identity.STORAGE_KEYS.token);
    tab.storageEvent();
    await settled();
    expect(tab.sockets).toHaveLength(1);
    expect(browser.identity.loadToken()).toBe(own);
  });

  it('a tab opened with ?profile=2 makes and stores its token under the profile\'s key, and is not the player of the plain tab', async () => {
    const plain = await browserAt('http://game.test/');
    const plainToken = helloToken((await connectionOf(plain)).socket());

    const second = await browserAt('http://game.test/?profile=2', { local: plain.local });
    const token = helloToken((await connectionOf(second)).socket());
    expect(token).toMatch(TOKEN_SHAPE);
    expect(token).not.toBe(plainToken);
    expect(plain.local.items.get(`${second.identity.STORAGE_KEYS.token}.2`)).toBe(token);
    expect(plain.local.items.get(second.identity.STORAGE_KEYS.token)).toBe(plainToken);
  });

  it('where the browser stores nothing, or has no source of random numbers, the page proposes no token and the server makes one, as before', async () => {
    const blocked = await browserAt('http://game.test/', { local: new BlockedStorage(), session: new BlockedStorage() });
    const page = await connectionOf(blocked);
    expect(helloToken(page.socket())).toBeNull();
    page.socket().serverSends({ type: 'welcome', protocol: 3, token: 'a'.repeat(32) });
    expect(page.told).toEqual(['token not saved', 'status online', 'ready']);
    expect(blocked.identity.loadToken()).toBe('a'.repeat(32));
    expect(page.sockets).toHaveLength(1);

    const noRandom = await browserAt('http://game.test/');
    vi.stubGlobal('crypto', undefined);
    const old = await connectionOf(noRandom);
    expect(helloToken(old.socket())).toBeNull();
    expect(noRandom.local.items.size).toBe(0);
    old.socket().serverSends({ type: 'welcome', protocol: 3, token: 'a'.repeat(32) });
    expect(noRandom.local.items.get(noRandom.identity.STORAGE_KEYS.token)).toBe('a'.repeat(32));
    expect(old.told).toEqual(['status online', 'ready']);
  });

  it('a reload: the stored token is the one the page says hello with, and nothing new is made', async () => {
    const first = await browserAt('http://game.test/');
    const token = welcome((await connectionOf(first)).socket());

    const reloaded = await browserAt('http://game.test/', { local: first.local });
    const page = await connectionOf(reloaded);
    expect(helloToken(page.socket())).toBe(token);
    welcome(page.socket());
    expect(page.sockets).toHaveLength(1);
    expect([...first.local.items.keys()]).toEqual([first.identity.STORAGE_KEYS.token]);
  });
});

/**
 * The same nets with the APP's own answers (ui/app.ts, appConnectionHandlers)
 * instead of a pretend handler: the app's store, the real handling of
 * server messages, the real connection, the pretend browser. This is the
 * wiring a first-visit tab in a game depends on.
 */
describe('the app itself decides when a first-visit tab may still become another player (WP4)', () => {
  const CODE = 'K7QXM';
  const OTHERS = 'd'.repeat(32);

  /** The app of one tab: its store, and its connection with the app's own handlers on pretend sockets. */
  async function appOf(browser: FakeBrowser) {
    // Loaded after browserAt, so that all of them use the pretend browser's copy of identity.ts.
    const { createConnection } = await import('../src/net/connection');
    const { appConnectionHandlers } = await import('../src/ui/app');
    const { createStore, currentScreen, initialState } = await import('../src/state/store');
    const store: Store = createStore(initialState('Ada', browser.identity.gameCodeFromUrl()));
    const sockets: PretendSocket[] = [];
    let tokenStored: () => void = () => {};
    const connection = createConnection(
      appConnectionHandlers(store, () => connection),
      {
        url: 'ws://game.test/ws',
        openSocket(_url, events: SocketEvents) {
          const socket: PretendSocket = {
            sent: [],
            closedByPage: false,
            serverSends: (message) => events.frame(JSON.stringify(message)),
            drop: () => events.closed(),
          };
          sockets.push(socket);
          queueMicrotask(() => events.opened());
          return {
            send: (text) => void socket.sent.push(JSON.parse(text) as ClientMessage),
            close() {
              socket.closedByPage = true;
            },
          };
        },
        now: () => 0,
        setTimer: () => 0,
        clearTimer() {},
        random: () => 0,
        onWake: () => () => {},
        onTokenStored(listener) {
          tokenStored = listener;
          return () => {
            tokenStored = () => {};
          };
        },
      },
    );
    openConnections.push(connection);
    await settled();
    return {
      store,
      sockets,
      screen: () => currentScreen(store.get()),
      /** The server's answer to the page's first hello: the token the page proposed. */
      welcome(): string {
        const hello = sockets[0].sent[0];
        if (hello === undefined || hello.type !== 'hello' || hello.token === null) throw new Error('the page proposed no token');
        sockets[0].serverSends({ type: 'welcome', protocol: 3, token: hello.token });
        return hello.token;
      },
      /** Another tab of the browser stores a token, and the browser tells this tab. */
      async anotherTabStores(token: string): Promise<void> {
        browser.local.items.set(browser.identity.STORAGE_KEYS.token, token);
        tokenStored();
        await settled();
      },
    };
  }

  const lobby: ServerMessage = { type: 'lobby', lobby: sampleLobby() };
  const game: ServerMessage = { type: 'gameSync', code: CODE, seq: 1, view: sampleView(), connected: ['p1'], events: [] };
  const notLoaded: ServerMessage = { type: 'error', code: 'gameNotLoaded', message: 'the server text' };

  it('in a lobby, in a game, and on the first screen with "could not be opened", the tab keeps its identity when another tab stores a token', async () => {
    const cases: { name: string; messages: ServerMessage[]; screen: string }[] = [
      { name: 'a lobby', messages: [lobby], screen: 'lobby' },
      { name: 'a game', messages: [game], screen: 'game' },
      { name: 'a game that could not be opened after a restart', messages: [game, notLoaded], screen: 'home' },
      { name: 'a lobby that could not be opened after a restart', messages: [lobby, notLoaded], screen: 'home' },
    ];
    for (const { name, messages, screen } of cases) {
      const browser = await browserAt(`http://game.test/?g=${CODE}`);
      const tab = await appOf(browser);
      const own = tab.welcome();
      for (const message of messages) tab.sockets[0].serverSends(message);
      expect(tab.screen(), name).toBe(screen);

      await tab.anotherTabStores(OTHERS);

      // No second socket, no second hello: the tab is who it was.
      expect(tab.sockets, name).toHaveLength(1);
      expect(tab.sockets[0].closedByPage, name).toBe(false);
      expect(browser.identity.loadToken(), name).toBe(own);
    }
  });

  it('a tab that holds no seat takes the stored token over: on the first screen, and on an invite link that asks for a name or leads nowhere', async () => {
    const cases: { name: string; address: string; messages: ServerMessage[] }[] = [
      { name: 'the first screen', address: 'http://game.test/', messages: [] },
      { name: 'an invite link, asked for a name', address: `http://game.test/?g=${CODE}`, messages: [{ type: 'error', code: 'nameRequired', message: 'the server text' }] },
      { name: 'an invite link to a game that has started', address: `http://game.test/?g=${CODE}`, messages: [{ type: 'error', code: 'gameAlreadyStarted', message: 'the server text' }] },
    ];
    for (const { name, address, messages } of cases) {
      const browser = await browserAt(address);
      const tab = await appOf(browser);
      tab.welcome();
      for (const message of messages) tab.sockets[0].serverSends(message);
      expect(tab.screen(), name).toBe('home');

      await tab.anotherTabStores(OTHERS);

      expect(tab.sockets, name).toHaveLength(2);
      expect(tab.sockets[0].closedByPage, name).toBe(true);
      expect(tab.sockets[1].sent[0], name).toEqual({ type: 'hello', protocol: expect.any(Number), token: OTHERS });
      expect(browser.identity.loadToken(), name).toBe(OTHERS);
    }
  });

  it('the tab that waited on "could not be opened" is back on its seat after the repair: its next hello carries its own token, and it asks for its game', async () => {
    const browser = await browserAt(`http://game.test/?g=${CODE}`);
    const tab = await appOf(browser);
    const own = tab.welcome();
    tab.sockets[0].serverSends(game);
    tab.sockets[0].serverSends(notLoaded);
    await tab.anotherTabStores(OTHERS);
    expect(tab.store.get().joinProblem).toBe('gameNotLoaded');

    // What it says on that socket from now on is said as itself; the page's own rejoin went out after the welcome.
    expect(tab.sockets[0].sent).toEqual([
      { type: 'hello', protocol: expect.any(Number), token: own },
      { type: 'joinGame', code: CODE, name: null },
    ]);
    // The game is there again: the tab is in it, and may still not change who it is.
    tab.sockets[0].serverSends(game);
    expect(tab.screen()).toBe('game');
    await tab.anotherTabStores('e'.repeat(32));
    expect(tab.sockets).toHaveLength(1);
    expect(browser.identity.loadToken()).toBe(own);
  });
});

/**
 * What server messages do to the address bar and to the remembered last
 * game. (What they do to the store is tested in shellMessages.test.ts, in
 * plain Node, where these two do not exist.)
 */
describe('server messages in a browser: the address bar and the remembered game (WP4)', () => {
  const CODE = 'K7QXM';

  /** A page at `address` with a store, and a way to hand it server messages. `storage`: the storage of an earlier page of the same browser. */
  async function pageAt(address: string, storage: { local?: object; session?: object } = {}) {
    const browser = await browserAt(address, storage);
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

  it('a game that is on the server but could not be opened: the home screen says why, and neither the address nor the remembered game is given up, so the player is back once it is repaired', async () => {
    // The tab was in the game when the server was restarted and left the save alone.
    const inGame = await pageAt(`http://game.test/?g=${CODE}`);
    inGame.deliver(game);
    expect(inGame.identity.loadLastGame()).toBe(CODE);
    inGame.deliver({ type: 'error', code: 'gameNotLoaded', message: 'the server text' });
    expect(inGame.screen()).toBe('home');
    expect(inGame.store.get().joinProblem).toBe('gameNotLoaded');
    expect(inGame.store.get().toasts.map((toast) => toast.text)).toEqual(['the server text']);
    expect(inGame.address()).toBe(`http://game.test/?g=${CODE}`);
    expect(inGame.identity.gameCodeFromUrl()).toBe(CODE);
    expect(inGame.identity.loadLastGame()).toBe(CODE);

    // The same from a lobby.
    const inLobby = await pageAt(`http://game.test/?g=${CODE}`);
    inLobby.deliver(lobby, { type: 'error', code: 'gameNotLoaded', message: 'the server text' });
    expect(inLobby.screen()).toBe('home');
    expect(inLobby.address()).toBe(`http://game.test/?g=${CODE}`);
    expect(inLobby.identity.loadLastGame()).toBe(CODE);

    // The player reloads while the game is still not there: the page's own rejoin is refused again, and still nothing is forgotten.
    const reloaded = await pageAt(inGame.address(), { local: inGame.local });
    expect(reloaded.store.get().joining).toBe(CODE);
    reloaded.deliver({ type: 'error', code: 'gameNotLoaded', message: 'the server text' });
    expect(reloaded.screen()).toBe('home');
    expect(reloaded.store.get().joining).toBeNull();
    expect(reloaded.store.get().joinProblem).toBe('gameNotLoaded');
    expect(reloaded.address()).toBe(`http://game.test/?g=${CODE}`);
    expect(reloaded.identity.loadLastGame()).toBe(CODE);

    // The server's owner has put it right: the code is still in the address, so the next rejoin brings the game.
    reloaded.deliver(game);
    expect(reloaded.screen()).toBe('game');
    expect(reloaded.store.get().joinProblem).toBeNull();

    // For contrast, a game that does not exist at all is forgotten (the address too).
    const gone = await pageAt(`http://game.test/?g=${CODE}`, { local: inGame.local });
    gone.deliver({ type: 'error', code: 'noSuchGame', message: 'the server text' });
    expect(gone.address()).toBe('http://game.test/');
    expect(gone.identity.loadLastGame()).toBeNull();
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
