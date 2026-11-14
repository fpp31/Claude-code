/**
 * The WebSocket connection to the server (work package WP4).
 *
 * This module knows about connecting, staying connected and reconnecting.
 * What messages MEAN is decided elsewhere (state/serverMessages.ts).
 */

import { PING_INTERVAL_MS, PONG_TIMEOUT_MS, PROTOCOL_VERSION } from '@domination/shared';
import type { ClientMessage, ServerMessage } from '@domination/shared';
import type { ConnectionStatus } from '../state/store';
import { loadToken, saveToken, webSocketUrl } from './identity';

export interface ConnectionHandlers {
  /** The connection status changed (shown in the top bar). */
  onStatus(status: ConnectionStatus): void;
  /**
   * The server answered `hello` with `welcome` on a NEW socket: the first
   * connect and every reconnect. The app (re)joins its game here by sending
   * `joinGame` with the code from the address bar, if there is one.
   */
  onReady(): void;
  /** Every message from the server, `welcome` and `pong` included, in order. */
  onMessage(message: ServerMessage): void;
  /**
   * The socket was lost. Actions that were waiting for an answer will never
   * get one: the app clears `busy`. They are NOT sent again; the full sync
   * after reconnecting shows whether they happened.
   */
  onDisconnect(): void;
  /**
   * The browser refused to store the token (storage blocked). The page still
   * knows who it is while it stays open; the app warns the player once that
   * closing the tab loses their seat. Called at most once.
   */
  onTokenNotSaved(): void;
}

export interface Connection {
  /**
   * Sends a message if the socket is open and `welcome` has arrived.
   * Returns false (and sends nothing) otherwise. Never queues.
   */
  send(message: ClientMessage): boolean;
  /** Closes the socket for good and stops all timers (used by tests and on page unload). */
  close(): void;
}

/** The first wait before trying to connect again; it doubles after every failure... */
export const RECONNECT_FIRST_DELAY_MS = 500;
/** ...up to this. */
export const RECONNECT_MAX_DELAY_MS = 8000;
/** Up to this share of the wait is added at random, so that all players do not come back in the same instant. */
export const RECONNECT_JITTER = 0.25;
/** A new socket that has not been welcomed by the server after this long is given up and tried again. */
export const HANDSHAKE_TIMEOUT_MS = PONG_TIMEOUT_MS;

/** What the connection is told about one socket. */
export interface SocketEvents {
  /** The socket is open: messages can be sent. */
  opened(): void;
  /** One frame arrived (its text; '' for a frame that is not text). */
  frame(text: string): void;
  /** The socket closed or failed. May be called more than once. */
  closed(): void;
}

/** What the connection does with one socket. */
export interface OpenSocket {
  send(text: string): void;
  close(): void;
}

/**
 * The few things the connection needs from the world around it. The app
 * uses browserEnvironment(); the unit tests pass a fake socket, a fake clock
 * and fake timers, so reconnecting and the liveness rules are tested in
 * plain Node without waiting for real seconds to pass.
 */
export interface ConnectionEnvironment {
  /** The address of the server's socket, or null if there is none (then nothing is ever opened). */
  url: string | null;
  /** Opens a socket and reports what happens on it. May throw (that counts as a failed attempt). */
  openSocket(url: string, events: SocketEvents): OpenSocket;
  /** The clock, in milliseconds. */
  now(): number;
  /** Like setTimeout: runs `run` once, `delayMs` from now or later. Returns something to pass to clearTimer. */
  setTimer(run: () => void, delayMs: number): unknown;
  /** Like clearTimeout. */
  clearTimer(timer: unknown): void;
  /** A number from 0 up to (not including) 1, for the reconnect jitter. */
  random(): number;
  /**
   * Calls `wake` whenever the browser says it is online again or the tab
   * becomes visible again. Returns a function that stops that.
   */
  onWake(wake: () => void): () => void;
}

/** The real thing: a browser WebSocket, the browser's clock and timers. */
export function browserEnvironment(): ConnectionEnvironment {
  return {
    url: webSocketUrl(),

    openSocket(url, events) {
      const socket = new WebSocket(url);
      socket.onopen = () => events.opened();
      socket.onmessage = (event) => events.frame(typeof event.data === 'string' ? event.data : '');
      socket.onclose = () => events.closed();
      socket.onerror = () => events.closed();
      return {
        send(text) {
          // A browser socket that is closing swallows messages without a word;
          // say so instead, so that `send` can honestly answer false.
          if (socket.readyState !== WebSocket.OPEN) throw new Error('the socket is not open');
          socket.send(text);
        },
        close: () => socket.close(),
      };
    },

    now: () => Date.now(),
    setTimer: (run, delayMs) => setTimeout(run, delayMs),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    random: () => Math.random(),

    onWake(wake) {
      if (typeof window === 'undefined') return () => {};
      const whenVisible = (): void => {
        if (document.visibilityState === 'visible') wake();
      };
      window.addEventListener('online', wake);
      window.addEventListener('pageshow', wake);
      document.addEventListener('visibilitychange', whenVisible);
      return () => {
        window.removeEventListener('online', wake);
        window.removeEventListener('pageshow', wake);
        document.removeEventListener('visibilitychange', whenVisible);
      };
    },
  };
}

/**
 * Opens the connection and keeps it open.
 *
 *  - URL: `ws://` or `wss://` (matching the page) + location.host + WS_PATH.
 *    The same address works in development (Vite passes /ws on to the
 *    server) and in production (the server serves the page itself).
 *  - On open: send `hello` with PROTOCOL_VERSION and loadToken().
 *  - On `welcome`: saveToken(token) (THIS module is the one place that
 *    stores the token; if saveToken returns false, tell the app through
 *    onTokenNotSaved), status 'online', call onReady.
 *  - Liveness: remember the time of the last frame RECEIVED (any frame) and
 *    of the last `ping` SENT. Send `ping` every PING_INTERVAL_MS. The socket
 *    is dead if a ping was sent at least PONG_TIMEOUT_MS ago and no frame
 *    has arrived since that ping; then drop it and reconnect. Make this
 *    check PONG_TIMEOUT_MS after every ping (a timer: if it fires late, the
 *    answer is still right) and again before sending the next ping. Also
 *    send a ping at once when the browser reports `online` or the tab
 *    becomes visible again (phones put background tabs to sleep).
 *    NEVER judge by "how long since the last frame" on a timer tick alone:
 *    a background tab's timers run about once a minute, and a healthy
 *    socket would be dropped over and over (see protocol.ts, LIVENESS).
 *  - On close or error: onDisconnect, status 'reconnecting', try again after
 *    0.5 s, doubling up to 8 s, with a little random jitter. Keep trying
 *    forever: games run for days.
 *  - Incoming frames are parsed with JSON.parse inside try/catch; anything
 *    that is not an object with a string `type` is ignored. (The server is
 *    trusted, so there is no full validation on this side.)
 *
 * Two additions in the same spirit: a new socket the server has not
 * welcomed within HANDSHAKE_TIMEOUT_MS is given up and tried again (a phone
 * that changed networks can leave a socket hanging half-open), and waking up
 * (`online`, tab visible) while waiting to reconnect tries at once instead
 * of sitting out the rest of the wait.
 *
 * @param environment  the outside world; only tests pass one (see ConnectionEnvironment)
 */
export function createConnection(
  handlers: ConnectionHandlers,
  environment: ConnectionEnvironment = browserEnvironment(),
): Connection {
  const { url } = environment;

  /** The socket in use, or null while waiting to try again. */
  let socket: OpenSocket | null = null;
  /** True once the server has answered `hello` with `welcome` on the current socket. */
  let ready = false;
  /** Set by close(): nothing may happen afterwards. */
  let closedForGood = false;
  /** Failed attempts in a row; decides how long to wait before the next one. */
  let failures = 0;
  let tokenWarningGiven = false;

  let reconnectTimer: unknown = null;
  let handshakeTimer: unknown = null;
  let pingTimer: unknown = null;
  let pongTimer: unknown = null;

  // Liveness (see the doc comment): when the last ping went out, and whether
  // anything at all has arrived since. Reset for every new socket.
  let pingSentAt: number | null = null;
  let frameSincePing = true;

  function stopTimer(timer: unknown): null {
    if (timer !== null) environment.clearTimer(timer);
    return null;
  }

  function stopSocketTimers(): void {
    handshakeTimer = stopTimer(handshakeTimer);
    pingTimer = stopTimer(pingTimer);
    pongTimer = stopTimer(pongTimer);
  }

  /** Puts one message on the wire. False if the socket would not take it. */
  function transmit(message: ClientMessage): boolean {
    if (socket === null) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  function connect(): void {
    if (closedForGood || url === null) return;
    reconnectTimer = stopTimer(reconnectTimer);
    ready = false;
    pingSentAt = null;
    frameSincePing = true;

    // Events of a socket that has been replaced or dropped must do nothing:
    // every callback first checks that it still belongs to the socket in use.
    let mine: OpenSocket | null = null;
    const isCurrent = (): boolean => mine !== null && socket === mine;
    try {
      mine = environment.openSocket(url, {
        opened() {
          if (isCurrent()) transmit({ type: 'hello', protocol: PROTOCOL_VERSION, token: loadToken() });
        },
        frame(text) {
          if (isCurrent()) receive(text);
        },
        closed() {
          if (isCurrent()) dropAndReconnect();
        },
      });
    } catch {
      mine = null;
    }

    if (mine === null) {
      // The browser would not even start (blocked, bad address): same as a failed attempt.
      lostSocket();
      return;
    }
    socket = mine;
    handshakeTimer = environment.setTimer(() => {
      handshakeTimer = null;
      if (!ready) dropAndReconnect();
    }, HANDSHAKE_TIMEOUT_MS);
  }

  /** Closes the current socket (if any) and starts the wait for the next attempt. */
  function dropAndReconnect(): void {
    const old = socket;
    socket = null; // first, so that the old socket's own "closed" event is ignored
    try {
      old?.close();
    } catch {
      // A socket that cannot even be closed is gone all the same.
    }
    lostSocket();
  }

  /** Tells the app, and schedules the next attempt: 0.5 s, 1 s, 2 s ... 8 s, plus a little jitter. */
  function lostSocket(): void {
    stopSocketTimers();
    socket = null;
    ready = false;
    if (closedForGood) return;

    handlers.onDisconnect();
    handlers.onStatus('reconnecting');
    if (closedForGood) return; // the app closed the connection from inside one of those two calls

    const wait = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_FIRST_DELAY_MS * 2 ** failures);
    failures += 1;
    reconnectTimer = environment.setTimer(connect, wait + wait * RECONNECT_JITTER * environment.random());
  }

  /** False once the app has closed the connection or the socket has been dropped (possibly by a handler just called). */
  function isUsable(): boolean {
    return !closedForGood && ready;
  }

  function receive(text: string): void {
    frameSincePing = true; // any frame at all proves the socket is alive

    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    if (typeof (message as { type?: unknown }).type !== 'string') return;
    const serverMessage = message as ServerMessage;

    if (serverMessage.type === 'welcome' && !ready) {
      ready = true;
      failures = 0;
      handshakeTimer = stopTimer(handshakeTimer);
      pingTimer = environment.setTimer(pingTick, PING_INTERVAL_MS);
      const stored = saveToken(serverMessage.token);
      if (!stored && !tokenWarningGiven) {
        tokenWarningGiven = true;
        handlers.onTokenNotSaved();
      }
      handlers.onStatus('online');
      handlers.onMessage(serverMessage);
      if (isUsable()) handlers.onReady();
      return;
    }

    handlers.onMessage(serverMessage);
  }

  // ---- Liveness -------------------------------------------------------------

  /** A ping went out at least PONG_TIMEOUT_MS ago and nothing has arrived since. */
  function socketIsDead(): boolean {
    return pingSentAt !== null && !frameSincePing && environment.now() - pingSentAt >= PONG_TIMEOUT_MS;
  }

  function sendPing(): void {
    transmit({ type: 'ping' });
    pingSentAt = environment.now();
    frameSincePing = false;
    pongTimer = stopTimer(pongTimer);
    pongTimer = environment.setTimer(pongCheck, PONG_TIMEOUT_MS);
  }

  /** Runs PONG_TIMEOUT_MS after a ping, or later: a late timer gives the same answer. */
  function pongCheck(): void {
    pongTimer = null;
    if (frameSincePing || pingSentAt === null) return;
    if (socketIsDead()) {
      dropAndReconnect();
      return;
    }
    // The timer fired a moment early by the clock: look again when the time is really up.
    const remaining = PONG_TIMEOUT_MS - (environment.now() - pingSentAt);
    pongTimer = environment.setTimer(pongCheck, Math.max(1, remaining));
  }

  /** Runs every PING_INTERVAL_MS (less often in a background tab, which is fine). */
  function pingTick(): void {
    pingTimer = null;
    if (socketIsDead()) {
      dropAndReconnect();
      return;
    }
    sendPing();
    pingTimer = environment.setTimer(pingTick, PING_INTERVAL_MS);
  }

  /** The browser is online again or the tab is back in front: find out quickly whether the socket survived. */
  function wake(): void {
    if (closedForGood) return;
    if (socket === null) {
      if (reconnectTimer !== null) connect(); // do not sit out the rest of the wait
      return;
    }
    if (!ready) return; // still saying hello: the handshake timer watches over that
    if (pingSentAt !== null && !frameSincePing) {
      // A ping is already on its way; its own check decides. (Sending another
      // one here would restart the clock every time the tab is shown.)
      if (socketIsDead()) dropAndReconnect();
      return;
    }
    pingTimer = stopTimer(pingTimer);
    sendPing();
    pingTimer = environment.setTimer(pingTick, PING_INTERVAL_MS);
  }

  const stopWakeListener = environment.onWake(wake);
  connect();

  return {
    send(message) {
      if (closedForGood || !ready) return false;
      return transmit(message);
    },

    close() {
      if (closedForGood) return;
      closedForGood = true;
      stopWakeListener();
      reconnectTimer = stopTimer(reconnectTimer);
      stopSocketTimers();
      const old = socket;
      socket = null;
      ready = false;
      try {
        old?.close();
      } catch {
        // Already gone.
      }
    },
  };
}
