/**
 * Server settings, read from environment variables once at start-up.
 */

export interface ServerConfig {
  /** TCP port for both the web page and the WebSocket. 0 = let the system pick a free one (tests). */
  port: number;
  /** Network interface to listen on, or null for all interfaces (needed for friends on the LAN/internet). */
  host: string | null;
  /** Absolute path of the folder that holds the saved games. */
  dataDir: string;
  /**
   * Absolute path of the built client (packages/client/dist). Everything in
   * this folder is public. It must not contain the data folder; startServer
   * refuses to start if it does.
   */
  clientDir: string;
  /**
   * If set, every new game uses this seed instead of a random one. Only for
   * tests and the end-to-end script, which need the same map every time.
   * Never on a real server: all games would share one map, which defeats the
   * fog of war. startServer logs a loud warning when it is set.
   */
  fixedSeed: string | null;
  /**
   * true (default): send `gameUpdate` patches after the first full sync.
   * false: send a full `gameSync` on every change. A safety switch: if a
   * patch bug is suspected, turn patches off without touching anything else.
   */
  sendPatches: boolean;
}

/** Largest WebSocket message the server accepts, in bytes. */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/** A socket that sends more messages than this within one second gets `rateLimited` errors. */
export const MAX_MESSAGES_PER_SECOND = 30;

/**
 * Absolute path of the project folder (the one that contains package.json
 * and packages/), worked out from the location of this source file.
 * Nothing in the project uses an absolute path of its own, so the whole
 * folder can be moved or renamed freely.
 */
export function projectRoot(): string {
  throw new Error('not implemented: projectRoot');
}

/**
 * Reads the settings from environment variables (pass `process.env`).
 *
 *   PORT                  port number, default 8787
 *   HOST                  interface to listen on, default all interfaces
 *   DOMINATION_DATA_DIR   saved-games folder, default <project root>/data
 *                         (a relative path is resolved against the current
 *                         working directory)
 *   DOMINATION_CLIENT_DIR built client, default <project root>/packages/client/dist
 *   DOMINATION_SEED       fixed seed for every new game (tests only)
 *   DOMINATION_FULL_SYNC  set to 1 to turn patches off (sendPatches = false)
 *
 * Throws an Error with a clear message for a PORT that is not a whole number
 * from 0 to 65535.
 */
export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  throw new Error('not implemented: loadConfig');
}
