/**
 * Putting the server together: one Node process, one port, serving both the
 * web page and the WebSocket.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WS_PATH } from '@domination/shared';
import { WebSocketServer } from 'ws';
import { MAX_MESSAGE_BYTES } from './config';
import type { ServerConfig } from './config';
import { createOtherVersionReport, handleConnection } from './connection';
import { describeError } from './errors';
import { createStaticHandler } from './httpStatic';
import { isInside, realPath } from './paths';
import { RoomManager } from './roomManager';
import { realRules } from './rules';
import type { Rules } from './rules';
import { createStorage } from './storage';
import type { Storage } from './storage';
import { newSeed } from './tokens';

export interface ServerOptions {
  config: ServerConfig;
  /** The rules engine to use. Default: realRules. Tests may pass a fake. */
  rules?: Rules;
  /** Where log lines go. Default: console.log. Tests may pass a collector or a no-op. */
  log?: (line: string) => void;
  /**
   * Where games are saved. Default: createStorage(config.dataDir, log), the
   * files described in storage.ts. Tests may pass one that fails on command,
   * to see what happens when the disk says no.
   */
  storage?: Storage;
  /**
   * How many messages a socket may send within one second before the extra
   * ones are dropped (connection.ts). Default: MAX_MESSAGES_PER_SECOND, and a
   * real server never changes it. Only for tests in which scripted players
   * play many turns in a fraction of a second, faster than any person could.
   */
  maxMessagesPerSecond?: number;
}

export interface RunningServer {
  /** The port actually in use (useful when config.port was 0). */
  port: number;
  /**
   * Stops the server: closes every socket and the listening port, and
   * resolves when done. Saves are synchronous, so there is nothing to flush.
   * Leaves no timers behind (important for tests).
   */
  close(): Promise<void>;
}

/**
 * Starts the server and resolves once it is listening.
 *
 * Start-up order (it matters):
 *  0. Safety checks on the settings:
 *       - throw a clear Error if config.dataDir is config.clientDir or lies
 *         inside it: the web server would hand out the save files (seeds
 *         and whole game states) to anybody who asks;
 *       - if config.fixedSeed is set, log one loud line: "FIXED SEED in use:
 *         every new game gets the same map. For tests only." (A forgotten
 *         DOMINATION_SEED would let anyone who has played one game know the
 *         whole map of the next.)
 *  1. createStorage(config.dataDir); new RoomManager; rooms.restore().
 *     ALL saved games are in memory before step 3.
 *  2. http.createServer(createStaticHandler(config.clientDir)).
 *  3. A `ws` WebSocketServer on the same http server, path WS_PATH,
 *     maxPayload MAX_MESSAGE_BYTES; each new socket goes to handleConnection.
 *  4. listen(config.port, config.host).
 *
 * The seed source for new games is config.fixedSeed if set, else newSeed().
 *
 * This function is what the tests and the end-to-end script use to run a
 * real server on a free port with a temporary data folder.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const config = options.config;
  const log = options.log ?? ((line: string) => console.log(line));

  // 0. Safety checks on the settings.
  if (isInside(realPath(config.clientDir), realPath(config.dataDir))) {
    throw new Error(
      `The folder for saved games (${config.dataDir}) is the folder of the web page (${config.clientDir}) ` +
        'or lies inside it. Everything in that folder is public, so the server will not start. ' +
        'Choose another DOMINATION_DATA_DIR.',
    );
  }
  if (config.fixedSeed !== null) {
    log('WARNING: FIXED SEED in use: every new game gets the same map. For tests only.');
  }

  // 1. Every saved game is in memory before anybody can connect.
  const storage = options.storage ?? createStorage(config.dataDir, log);
  const rooms = new RoomManager({
    rules: options.rules ?? realRules,
    storage,
    newSeed: () => config.fixedSeed ?? newSeed(),
    sendPatches: config.sendPatches,
    log,
  });
  const restored = rooms.restore();
  log(`Saved games loaded: ${restored}.`);

  // 2. The web page.
  const httpServer = createServer(createStaticHandler(config.clientDir));

  // 3. The WebSocket, on the same port.
  const webSockets = new WebSocketServer({ server: httpServer, path: WS_PATH, maxPayload: MAX_MESSAGE_BYTES });
  const reportOtherVersion = createOtherVersionReport(log);
  webSockets.on('connection', (socket) => {
    try {
      handleConnection(socket, rooms, log, options.maxMessagesPerSecond, reportOtherVersion);
    } catch (error) {
      log(`A new connection could not be set up. ${describeError(error)}`);
      socket.terminate();
    }
  });
  // `ws` passes the http server's errors on; without a listener they would stop the process.
  webSockets.on('error', (error) => log(`Network problem: ${describeError(error)}`));

  // 4. Listen. A port that is already taken rejects the promise with a clear system error.
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    const onListening = (): void => {
      httpServer.off('error', reject);
      resolve();
    };
    if (config.host === null) httpServer.listen(config.port, onListening);
    else httpServer.listen(config.port, config.host, onListening);
  });
  const port = (httpServer.address() as AddressInfo).port;

  let closing: Promise<void> | null = null;
  function close(): Promise<void> {
    // Asked twice: the same promise, the work is done once.
    closing ??= new Promise<void>((resolve) => {
      // Each socket's 'close' event stops its timer and detaches it from its room.
      for (const socket of webSockets.clients) socket.terminate();
      webSockets.close(() => {
        httpServer.close(() => resolve());
        // Browsers keep idle connections open for the next request; do not wait for those.
        httpServer.closeAllConnections();
      });
    });
    return closing;
  }

  return { port, close };
}
