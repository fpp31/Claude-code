/**
 * Putting the server together: one Node process, one port, serving both the
 * web page and the WebSocket.
 */

import type { ServerConfig } from './config';
import type { Rules } from './rules';

export interface ServerOptions {
  config: ServerConfig;
  /** The rules engine to use. Default: realRules. Tests may pass a fake. */
  rules?: Rules;
  /** Where log lines go. Default: console.log. Tests may pass a collector or a no-op. */
  log?: (line: string) => void;
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
  throw new Error('not implemented: startServer');
}
