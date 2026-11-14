/**
 * The WebSocket connection to the server (work package WP4).
 *
 * This module knows about connecting, staying connected and reconnecting.
 * What messages MEAN is decided elsewhere (state/serverMessages.ts).
 */

import type { ClientMessage, ServerMessage } from '@domination/shared';
import type { ConnectionStatus } from '../state/store';

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
 */
export function createConnection(handlers: ConnectionHandlers): Connection {
  throw new Error('not implemented: createConnection');
}
