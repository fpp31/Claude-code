/**
 * Server settings, read from environment variables once at start-up.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** A socket is closed after this many frames that were not valid messages (`badMessage`). */
export const MAX_BAD_MESSAGES = 5;

/**
 * A socket that has this many bytes waiting to be sent is cut off. Messages
 * pile up like that only when the other side has stopped reading (a dead
 * connection, or somebody flooding the server without listening to the
 * answers), and they would otherwise fill the server's memory. A healthy
 * client that is cut off simply reconnects and gets a full view.
 */
export const MAX_SEND_BACKLOG_BYTES = 8 * 1024 * 1024;

/**
 * Absolute path of the project folder (the one that contains package.json
 * and packages/), worked out from the location of this source file.
 * Nothing in the project uses an absolute path of its own, so the whole
 * folder can be moved or renamed freely.
 */
export function projectRoot(): string {
  // This file is <project root>/packages/server/src/config.ts: three folders up.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
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
  const root = projectRoot();
  return {
    port: readPort(env.PORT),
    host: nonEmpty(env.HOST),
    // path.resolve leaves an absolute path alone and resolves a relative one
    // against the current working directory.
    dataDir: resolve(nonEmpty(env.DOMINATION_DATA_DIR) ?? resolve(root, 'data')),
    clientDir: resolve(nonEmpty(env.DOMINATION_CLIENT_DIR) ?? resolve(root, 'packages', 'client', 'dist')),
    fixedSeed: nonEmpty(env.DOMINATION_SEED),
    sendPatches: env.DOMINATION_FULL_SYNC !== '1',
  };
}

/** An environment variable that is missing or empty counts as "not set". */
function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

/** PORT as a number; 8787 if it is not set. Throws for anything that is not a whole number from 0 to 65535. */
function readPort(value: string | undefined): number {
  const text = nonEmpty(value);
  if (text === null) return 8787;
  // Digits only: Number('') is 0 and Number('1e3') is 1000, neither of which anybody means.
  if (!/^[0-9]{1,5}$/.test(text) || Number(text) > 65535) {
    throw new Error(`PORT must be a whole number from 0 to 65535, but it is "${text}".`);
  }
  return Number(text);
}
