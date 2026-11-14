/**
 * Saving and loading games on disk. No database: one JSON file per game.
 *
 *   <data dir>/rooms/K7QXM.json           the current save of game K7QXM
 *   <data dir>/rooms/K7QXM.json.tmp       exists only for an instant during a save
 *   <data dir>/rooms/K7QXM.json.corrupt   an unreadable save, moved aside (never deleted)
 *
 * Backing up is copying the data folder; restoring is copying it back while
 * the server is stopped.
 */

import type { GameCode } from '@domination/shared';
import type { RoomFile } from './roomFile';

export interface Storage {
  /**
   * Reads every saved game. Called once at start-up, BEFORE the server
   * starts listening, so a reconnecting player is never told "no such game".
   *  - Creates the folders if they do not exist.
   *  - Deletes leftover `.tmp` files (a crash in the middle of a save).
   *  - A file that cannot be read or parsed is renamed to `.corrupt`,
   *    reported through the log function, and skipped. The server still
   *    starts.
   *  - Files with an older `format` are upgraded in memory by the migration
   *    steps in this module (none exist yet for format 1). A started game
   *    whose `game.schema` is older than STATE_SCHEMA is upgraded by the
   *    game-state migrations of the shared package (none exist yet for
   *    schema 1; they live next to STATE_SCHEMA so they stay pure and
   *    testable).
   *  - A file from ANOTHER VERSION of the game that cannot be brought up to
   *    date (`format` newer than ROOM_FILE_FORMAT, or `game.schema` still not
   *    equal to STATE_SCHEMA after the migrations) is LEFT EXACTLY AS IT IS
   *    and skipped, with a clear log line naming the file and both version
   *    numbers. It is neither renamed nor loaded: playing it with the wrong
   *    layout would damage it at the next save, and leaving it in place
   *    means it simply works again once the right code runs.
   */
  loadAll(): RoomFile[];

  /**
   * True if a save file for this code exists on disk, whether loadAll
   * returned it or skipped it. Used when picking the code of a new game, so
   * that a skipped file is never overwritten.
   */
  has(code: GameCode): boolean;

  /**
   * Writes one game ATOMICALLY and synchronously: write `<CODE>.json.tmp`,
   * flush it to disk (fsync), then rename it over `<CODE>.json`. A crash at
   * any moment leaves either the old or the new file, never half of one.
   * On Windows a rename can briefly fail with EPERM/EBUSY: retry a few times.
   * Throws if the save fails; the caller then keeps its old state.
   */
  save(file: RoomFile): void;

  /** Deletes the save of a game (an abandoned lobby). Does nothing if there is none. */
  remove(code: GameCode): void;
}

/**
 * @param dataDir  absolute path of the data folder (ServerConfig.dataDir)
 * @param log      receives one line per noteworthy event (corrupt file, ...)
 */
export function createStorage(dataDir: string, log: (line: string) => void): Storage {
  throw new Error('not implemented: createStorage');
}
