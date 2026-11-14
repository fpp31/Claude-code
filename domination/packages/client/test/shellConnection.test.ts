import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PING_INTERVAL_MS, PONG_TIMEOUT_MS, PROTOCOL_VERSION } from '@domination/shared';
import type { ClientMessage, ServerMessage } from '@domination/shared';
import type * as ConnectionModule from '../src/net/connection';
import type { Connection, ConnectionEnvironment, SocketEvents } from '../src/net/connection';

/**
 * The connection: connecting, reconnecting with growing waits, and telling a
 * dead socket from a quiet one. No network and no real waiting: the
 * connection is given a pretend world (sockets, clock, timers) that the
 * test moves by hand.
 */

/** One pretend socket: what the client sent on it, and a way to play the server's side. */
interface FakeSocket {
  url: string;
  sent: ClientMessage[];
  /** True once the client has closed it. */
  closedByClient: boolean;
  events: SocketEvents;
}

interface FakeWorld {
  environment: ConnectionEnvironment;
  /** Every socket the client has opened, oldest first. */
  sockets: FakeSocket[];
  /** The newest socket. */
  socket(): FakeSocket;
  /** Lets time pass and runs every timer that comes due, in order. */
  advance(ms: number): void;
  /** A sleeping tab: the clock moves on, but no timer runs until the next `advance`. */
  sleep(ms: number): void;
  /** Plays the browser saying "online again" / "the tab is visible again". */
  wake(): void;
  /** How many timers are waiting. */
  pendingTimers(): number;
  /** What Math.random would return (0 = no jitter). */
  random: number;
  /** Makes the next attempts to open a socket fail outright. */
  refuseSockets: boolean;
}

function fakeWorld(): FakeWorld {
  let now = 1_000_000;
  let nextTimerId = 1;
  let timers: { id: number; at: number; run: () => void }[] = [];
  let wakeListener: () => void = () => {};

  const world: FakeWorld = {
    sockets: [],
    random: 0,
    refuseSockets: false,
    socket() {
      const newest = world.sockets[world.sockets.length - 1];
      if (newest === undefined) throw new Error('no socket has been opened');
      return newest;
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (due === undefined) break;
        timers = timers.filter((timer) => timer !== due);
        now = Math.max(now, due.at);
        due.run();
      }
      now = end;
    },
    sleep(ms) {
      now += ms;
    },
    wake() {
      wakeListener();
    },
    pendingTimers() {
      return timers.length;
    },
    environment: {
      url: 'ws://game.test/ws',
      openSocket(url, events) {
        if (world.refuseSockets) throw new Error('sockets are blocked');
        const socket: FakeSocket = { url, sent: [], closedByClient: false, events };
        world.sockets.push(socket);
        return {
          send(text) {
            socket.sent.push(JSON.parse(text) as ClientMessage);
          },
          close() {
            socket.closedByClient = true;
          },
        };
      },
      now: () => now,
      setTimer(run, delayMs) {
        const id = nextTimerId++;
        timers.push({ id, at: now + delayMs, run });
        return id;
      },
      clearTimer(timer) {
        timers = timers.filter((candidate) => candidate.id !== timer);
      },
      random: () => world.random,
      onWake(listener) {
        wakeListener = listener;
        return () => {
          wakeListener = () => {};
        };
      },
    },
  };
  return world;
}

/** The server's side of a socket. */
function serverSends(socket: FakeSocket, message: ServerMessage): void {
  socket.events.frame(JSON.stringify(message));
}

describe('connection (WP4)', () => {
  // The token is remembered inside net/identity.ts. Each test loads fresh
  // copies of the modules, so no test sees a token another one saved.
  let createConnection: typeof ConnectionModule.createConnection;
  let RECONNECT_FIRST_DELAY_MS: number;
  let RECONNECT_MAX_DELAY_MS: number;
  let RECONNECT_JITTER: number;
  let HANDSHAKE_TIMEOUT_MS: number;

  let world: FakeWorld;
  /** Everything the connection told the app, in order. */
  let log: string[];
  let connection: Connection;

  beforeEach(async () => {
    vi.resetModules();
    ({ createConnection, RECONNECT_FIRST_DELAY_MS, RECONNECT_MAX_DELAY_MS, RECONNECT_JITTER, HANDSHAKE_TIMEOUT_MS } = await import(
      '../src/net/connection'
    ));
    world = fakeWorld();
    log = [];
  });

  afterEach(() => {
    connection?.close();
  });

  function connect(): void {
    connection = createConnection(
      {
        onStatus: (status) => log.push(`status ${status}`),
        onReady: () => log.push('ready'),
        onMessage: (message) => log.push(`message ${message.type}`),
        onDisconnect: () => log.push('disconnect'),
        onTokenNotSaved: () => log.push('token not saved'),
      },
      world.environment,
    );
  }

  /** Opens the newest socket and plays the server's welcome. */
  function welcome(token = 'token-1'): FakeSocket {
    const socket = world.socket();
    socket.events.opened();
    serverSends(socket, { type: 'welcome', protocol: PROTOCOL_VERSION, token });
    return socket;
  }

  it('opens a socket at the given address and says hello with the protocol version', () => {
    connect();
    expect(world.sockets).toHaveLength(1);
    expect(world.socket().url).toBe('ws://game.test/ws');
    expect(world.socket().sent).toEqual([]); // nothing before the socket is open

    world.socket().events.opened();
    expect(world.socket().sent).toEqual([{ type: 'hello', protocol: PROTOCOL_VERSION, token: null }]);
  });

  it('welcome: reports online, hands the message on, then calls onReady; the token goes into the next hello', () => {
    connect();
    welcome('token-1');
    // (In plain Node the token cannot be stored durably, hence the warning; see the test further down.)
    expect(log).toEqual(['token not saved', 'status online', 'message welcome', 'ready']);

    // The socket drops; the next one introduces itself with the token it was given.
    world.socket().events.closed();
    world.advance(RECONNECT_FIRST_DELAY_MS);
    world.socket().events.opened();
    expect(world.socket().sent).toEqual([{ type: 'hello', protocol: PROTOCOL_VERSION, token: 'token-1' }]);
  });

  it('send returns false before welcome, true after it, and false again once the socket is lost; nothing is queued', () => {
    connect();
    const first = world.socket();
    expect(connection.send({ type: 'resync' })).toBe(false);
    first.events.opened();
    expect(connection.send({ type: 'resync' })).toBe(false); // open, but not welcomed yet

    serverSends(first, { type: 'welcome', protocol: PROTOCOL_VERSION, token: 'token-1' });
    expect(connection.send({ type: 'createGame', name: 'Ada' })).toBe(true);
    expect(first.sent).toEqual([
      { type: 'hello', protocol: PROTOCOL_VERSION, token: null },
      { type: 'createGame', name: 'Ada' },
    ]);

    first.events.closed();
    expect(connection.send({ type: 'resync' })).toBe(false);

    // The messages refused above are gone for good: the new socket carries only its own hello.
    world.advance(RECONNECT_FIRST_DELAY_MS);
    welcome();
    expect(world.socket()).not.toBe(first);
    expect(world.socket().sent).toEqual([{ type: 'hello', protocol: PROTOCOL_VERSION, token: 'token-1' }]);
  });

  it('every message from the server is handed on in order; pong is one of them', () => {
    connect();
    const socket = welcome();
    log.length = 0;
    serverSends(socket, { type: 'pong' });
    serverSends(socket, { type: 'left' });
    expect(log).toEqual(['message pong', 'message left']);
  });

  it('frames that are not JSON objects with a string type are ignored', () => {
    connect();
    const socket = welcome();
    log.length = 0;

    for (const frame of ['', 'not json', '42', 'null', '"text"', '[1,2]', '{"type":7}', '{"kind":"lobby"}']) {
      socket.events.frame(frame);
    }

    expect(log).toEqual([]);
    expect(connection.send({ type: 'resync' })).toBe(true); // and the socket is still fine
  });

  it('a lost socket: onDisconnect, status reconnecting, then new attempts after 0.5 s, 1 s, 2 s, 4 s, 8 s and 8 s again', () => {
    connect();
    welcome();
    log.length = 0;

    world.socket().events.closed();
    expect(log).toEqual(['disconnect', 'status reconnecting']);

    // Each new socket fails at once; the waits double up to the limit. (No jitter: random is 0.)
    const waits = [500, 1000, 2000, 4000, 8000, 8000];
    expect(waits[0]).toBe(RECONNECT_FIRST_DELAY_MS);
    expect(waits[waits.length - 1]).toBe(RECONNECT_MAX_DELAY_MS);
    for (const wait of waits) {
      const before = world.sockets.length;
      world.advance(wait - 1);
      expect(world.sockets).toHaveLength(before); // not yet
      world.advance(1);
      expect(world.sockets).toHaveLength(before + 1);
      world.socket().events.closed();
    }
  });

  it('the wait starts again at 0.5 s once a connection has succeeded', () => {
    connect();
    world.socket().events.closed(); // 1st failure
    world.advance(500);
    world.socket().events.closed(); // 2nd failure
    world.advance(1000);
    welcome(); // third time lucky

    world.socket().events.closed();
    const before = world.sockets.length;
    world.advance(RECONNECT_FIRST_DELAY_MS);
    expect(world.sockets).toHaveLength(before + 1);
  });

  it('jitter stretches a wait by at most a quarter', () => {
    world.random = 0.999;
    connect();
    world.socket().events.closed();

    const longest = RECONNECT_FIRST_DELAY_MS * (1 + RECONNECT_JITTER);
    world.advance(RECONNECT_FIRST_DELAY_MS);
    expect(world.sockets).toHaveLength(1); // the plain wait is not enough...
    world.advance(longest - RECONNECT_FIRST_DELAY_MS);
    expect(world.sockets).toHaveLength(2); // ...but the wait plus the largest jitter is
  });

  it('an error and a close for the same socket count as one loss', () => {
    connect();
    welcome();
    log.length = 0;
    const socket = world.socket();

    socket.events.closed(); // "error"
    socket.events.closed(); // "close"

    expect(log).toEqual(['disconnect', 'status reconnecting']);
    world.advance(RECONNECT_FIRST_DELAY_MS);
    expect(world.sockets).toHaveLength(2);
  });

  it('a browser that refuses to open sockets is retried like any other failure', () => {
    world.refuseSockets = true;
    connect();
    expect(log).toEqual(['disconnect', 'status reconnecting']);

    world.refuseSockets = false;
    world.advance(RECONNECT_FIRST_DELAY_MS);
    welcome();
    expect(log.slice(-3)).toEqual(['status online', 'message welcome', 'ready']);
  });

  it('a socket the server never welcomes is given up after HANDSHAKE_TIMEOUT_MS and tried again', () => {
    connect();
    const first = world.socket();
    first.events.opened();

    world.advance(HANDSHAKE_TIMEOUT_MS - 1);
    expect(first.closedByClient).toBe(false);
    world.advance(1);
    expect(first.closedByClient).toBe(true);
    expect(log).toEqual(['disconnect', 'status reconnecting']);

    world.advance(RECONNECT_FIRST_DELAY_MS);
    expect(world.sockets).toHaveLength(2);
  });

  it('pings every PING_INTERVAL_MS; a socket that answers is kept', () => {
    connect();
    const socket = welcome();
    const pings = (): number => socket.sent.filter((message) => message.type === 'ping').length;

    world.advance(PING_INTERVAL_MS - 1);
    expect(pings()).toBe(0);
    world.advance(1);
    expect(pings()).toBe(1);
    serverSends(socket, { type: 'pong' });

    world.advance(PING_INTERVAL_MS);
    expect(pings()).toBe(2);
    serverSends(socket, { type: 'pong' });

    world.advance(PONG_TIMEOUT_MS);
    expect(socket.closedByClient).toBe(false);
    expect(world.sockets).toHaveLength(1);
    expect(log).not.toContain('disconnect');
  });

  it('nothing arrives within PONG_TIMEOUT_MS after a ping: the socket is dropped and a new one is opened', () => {
    connect();
    const socket = welcome();
    log.length = 0;

    world.advance(PING_INTERVAL_MS); // the ping goes out
    world.advance(PONG_TIMEOUT_MS - 1);
    expect(socket.closedByClient).toBe(false);
    world.advance(1);
    expect(socket.closedByClient).toBe(true);
    expect(log).toEqual(['disconnect', 'status reconnecting']);

    world.advance(RECONNECT_FIRST_DELAY_MS);
    expect(world.sockets).toHaveLength(2);

    // Whatever the dropped socket still does is none of our business any more.
    socket.events.frame(JSON.stringify({ type: 'pong' }));
    socket.events.closed();
    expect(log).toEqual(['disconnect', 'status reconnecting']);
  });

  it('any frame counts as a sign of life, not only pong', () => {
    connect();
    const socket = welcome();

    world.advance(PING_INTERVAL_MS);
    world.advance(PONG_TIMEOUT_MS / 2);
    serverSends(socket, { type: 'presence', connected: ['p1'] }); // no pong, but the server is clearly there
    world.advance(PONG_TIMEOUT_MS);

    expect(socket.closedByClient).toBe(false);
    expect(log).not.toContain('disconnect');
  });

  it('a frame that arrived BEFORE the ping does not count as its answer', () => {
    connect();
    const socket = welcome();

    world.advance(PING_INTERVAL_MS - 1);
    serverSends(socket, { type: 'presence', connected: ['p1'] }); // just before the ping
    world.advance(1); // the ping goes out; from here on the server is silent
    world.advance(PONG_TIMEOUT_MS);

    expect(socket.closedByClient).toBe(true);
  });

  it('a background tab whose timers run a minute late does not drop a healthy socket', () => {
    connect();
    const socket = welcome();
    const pings = (): number => socket.sent.filter((message) => message.type === 'ping').length;

    // Five minutes in the background: timers only get to run once a minute.
    // The server answers every ping straight away, as a healthy one does.
    for (let minute = 1; minute <= 5; minute++) {
      world.sleep(60_000);
      world.advance(0); // the late timers all fire now
      expect(pings()).toBe(minute);
      serverSends(socket, { type: 'pong' });
    }

    expect(socket.closedByClient).toBe(false);
    expect(world.sockets).toHaveLength(1);
    expect(log).not.toContain('disconnect');
  });

  it('a late timer still notices a socket that really is dead', () => {
    connect();
    const socket = welcome();

    world.sleep(60_000);
    world.advance(0); // the late ping goes out; nobody answers
    world.sleep(60_000);
    world.advance(0); // the late check: a ping from a minute ago, and nothing since

    expect(socket.closedByClient).toBe(true);
    expect(log).toContain('disconnect');
  });

  it('waking up (online again, tab visible again) sends a ping at once and judges the socket by its answer', () => {
    connect();
    const socket = welcome();
    world.advance(5_000);

    world.wake();
    expect(socket.sent.filter((message) => message.type === 'ping')).toHaveLength(1);

    // A second wake-up while that ping is still unanswered does not send another one (or restart its clock).
    world.advance(PONG_TIMEOUT_MS / 2);
    world.wake();
    expect(socket.sent.filter((message) => message.type === 'ping')).toHaveLength(1);

    // The socket did not survive the sleep: ten seconds after the first ping it is dropped.
    world.advance(PONG_TIMEOUT_MS / 2);
    expect(socket.closedByClient).toBe(true);
  });

  it('waking up while waiting to reconnect tries at once', () => {
    connect();
    for (let failure = 0; failure < 5; failure++) {
      world.socket().events.closed();
      world.advance(RECONNECT_MAX_DELAY_MS);
    }
    world.socket().events.closed(); // now waiting the full 8 seconds
    const before = world.sockets.length;

    world.wake();
    expect(world.sockets).toHaveLength(before + 1);

    // The wait that was cut short does not open a second socket later.
    world.advance(RECONNECT_MAX_DELAY_MS);
    expect(world.sockets).toHaveLength(before + 1);
  });

  it('onTokenNotSaved is called once, not again after every reconnect', () => {
    // In plain Node there is no storage, so the token is never stored durably.
    connect();
    welcome();
    world.socket().events.closed();
    world.advance(RECONNECT_FIRST_DELAY_MS);
    welcome();

    expect(log.filter((entry) => entry === 'token not saved')).toHaveLength(1);
    expect(log.filter((entry) => entry === 'ready')).toHaveLength(2);
  });

  it('close stops everything: the socket is closed, no reconnect, no pings, send returns false', () => {
    connect();
    const socket = welcome();
    log.length = 0;

    connection.close();
    expect(socket.closedByClient).toBe(true);
    expect(world.pendingTimers()).toBe(0);
    expect(connection.send({ type: 'resync' })).toBe(false);

    // Nothing the old socket or the browser does afterwards has any effect.
    socket.events.closed();
    serverSends(socket, { type: 'pong' });
    world.wake();
    world.advance(10 * PING_INTERVAL_MS);
    expect(world.sockets).toHaveLength(1);
    expect(log).toEqual([]);
  });

  it('close while waiting to reconnect cancels the attempt', () => {
    connect();
    world.socket().events.closed();
    connection.close();
    world.advance(RECONNECT_MAX_DELAY_MS);
    expect(world.sockets).toHaveLength(1);
    expect(world.pendingTimers()).toBe(0);
  });

  it('without an address (no page) nothing is opened and send returns false', () => {
    world.environment.url = null;
    connect();
    world.advance(RECONNECT_MAX_DELAY_MS);
    expect(world.sockets).toEqual([]);
    expect(connection.send({ type: 'resync' })).toBe(false);
    expect(log).toEqual([]);
  });
});
