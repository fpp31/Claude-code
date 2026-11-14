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

import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { STATE_SCHEMA } from '@domination/shared';
import type { GameCode } from '@domination/shared';
import { ROOM_FILE_FORMAT } from './roomFile';
import type { RoomFile } from './roomFile';
import { checkRoomFile, serializeRoomFile } from './roomFileText';
import { normalizeGameCode } from './tokens';

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
   *    game-state migrations of the shared package. None exist yet for
   *    schema 1, and the shared package exports no migration function yet:
   *    the first change to the layout of GameState adds one next to
   *    STATE_SCHEMA (so it stays pure and testable) and calls it at the
   *    marked place in this file.
   *  - The version numbers are looked at BEFORE the detailed check of the
   *    file, so a save from another version that also looks wrong to this
   *    one (an unknown civilization, say) is left alone, not moved aside as
   *    damaged.
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
   *
   * (A save that was moved aside as `.corrupt` counts too: its code stays
   * reserved, so the file can be repaired and put back without finding a
   * different game under its name.)
   */
  has(code: GameCode): boolean;

  /**
   * Writes one game ATOMICALLY and synchronously: write `<CODE>.json.tmp`,
   * flush it to disk (fsync), then rename it over `<CODE>.json`. A crash at
   * any moment leaves either the old or the new file, never half of one.
   * On Windows a rename can briefly fail with EPERM/EBUSY: retry a few times.
   * Throws if the save fails; the caller then keeps its old state.
   *
   * A disk that is nearly full may take only the first part of a file and
   * report no error. So the file is written until every byte is in it, its
   * size is checked, and only a complete file is renamed over the old save.
   */
  save(file: RoomFile): void;

  /** Deletes the save of a game (an abandoned lobby). Does nothing if there is none. */
  remove(code: GameCode): void;
}

/**
 * Upgrades of the room file layout, keyed by the format they start FROM:
 * ROOM_FILE_MIGRATIONS[1] would turn a format 1 file into a format 2 file.
 * None exist yet, because format 1 is the first.
 */
const ROOM_FILE_MIGRATIONS: Record<number, (older: Record<string, unknown>) => Record<string, unknown>> = {};

/** How often a rename is tried before a save gives up, and the pause between tries. */
const RENAME_ATTEMPTS = 5;
const RENAME_PAUSE_MS = 20;

/**
 * The system's "write these bytes to this open file" call, as storage uses
 * it: it returns how many bytes it took, which can be fewer than it was
 * given (a disk that is nearly full).
 */
export type WriteCall = (handle: number, bytes: Uint8Array, offset: number, length: number) => number;

/**
 * @param dataDir  absolute path of the data folder (ServerConfig.dataDir)
 * @param log      receives one line per noteworthy event (corrupt file, ...)
 * @param write    for tests only: stands in for the system's write call, so a
 *                 test can play a disk that runs full in the middle of a save
 */
export function createStorage(dataDir: string, log: (line: string) => void, write: WriteCall = writeSync): Storage {
  const roomsDir = join(dataDir, 'rooms');

  /**
   * The save file of a game. The code is checked first because it becomes
   * part of a file name: nothing but a real game code may get that far.
   */
  function pathOf(code: GameCode): string {
    if (normalizeGameCode(code) !== code) throw new Error(`storage: "${code}" is not a game code`);
    return join(roomsDir, `${code}.json`);
  }

  function loadAll(): RoomFile[] {
    mkdirSync(roomsDir, { recursive: true });

    const files: RoomFile[] = [];
    // Sorted, so that games are loaded (and reported) in the same order every time.
    for (const name of readdirSync(roomsDir).sort()) {
      const path = join(roomsDir, name);

      if (name.endsWith('.json.tmp')) {
        // A save that was interrupted before its rename: the real file next
        // to it (if any) is the last complete save.
        try {
          rmSync(path, { force: true });
        } catch (error) {
          log(`Saved games: could not delete the leftover ${name} (${describe(error)}).`);
        }
        continue;
      }
      if (!name.endsWith('.json')) continue; // .corrupt files, notes, backups: not ours to touch

      const code = name.slice(0, -'.json'.length);
      if (normalizeGameCode(code) !== code) {
        log(`Saved games: ignoring ${name} (its name is not a game code).`);
        continue;
      }

      const loaded = loadOne(path, name, code);
      if (loaded !== null) files.push(loaded);
    }
    return files;
  }

  /** Reads one save. Returns null (after logging and, for a broken file, moving it aside) if it cannot be played. */
  function loadOne(path: string, name: string, code: GameCode): RoomFile | null {
    let parsed: unknown;
    try {
      // Some editors (on Windows above all) put an invisible mark, U+FEFF,
      // in front of a file they save. JSON does not allow it; a save that
      // was edited by hand must not count as damaged because of it. The next
      // save writes the file without the mark.
      parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      moveAside(path, name, `it cannot be read (${describe(error)})`);
      return null;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      moveAside(path, name, 'it does not contain a saved game');
      return null;
    }
    let content = parsed as Record<string, unknown>;
    const format = content.format;
    if (typeof format !== 'number' || !Number.isInteger(format)) {
      moveAside(path, name, 'it has no file format number');
      return null;
    }

    // Another version of the game wrote this file: hands off.
    if (format > ROOM_FILE_FORMAT) {
      log(
        `Saved games: ${name} was left alone and NOT loaded. It has file format ${format}, ` +
          `this version of the game reads format ${ROOM_FILE_FORMAT}. Run the newer version to play it.`,
      );
      return null;
    }
    for (let from = format; from < ROOM_FILE_FORMAT; from++) {
      const migrate = ROOM_FILE_MIGRATIONS[from];
      if (migrate === undefined) {
        log(
          `Saved games: ${name} was left alone and NOT loaded. It has file format ${format}, ` +
            `which this version of the game (format ${ROOM_FILE_FORMAT}) cannot convert.`,
        );
        return null;
      }
      content = migrate(content);
    }

    // The game state has a version of its own. Migrations for older states
    // belong to the shared package, next to STATE_SCHEMA; none exist yet for
    // schema 1. When the first one is written, call it here, before this check.
    //
    // This comes BEFORE the file is checked in detail: a game from another
    // version may well look wrong to this one (a civilization it does not
    // know, say), and must still be left alone rather than moved aside.
    const schema = gameSchemaOf(content);
    if (schema !== null && schema !== STATE_SCHEMA) {
      log(
        `Saved games: ${name} was left alone and NOT loaded. Its game state has layout ${schema}, ` +
          `this version of the game plays layout ${STATE_SCHEMA}. Run the matching version to play it.`,
      );
      return null;
    }

    const checked = checkRoomFile(content, code);
    if (!checked.ok) {
      moveAside(path, name, checked.problem);
      return null;
    }
    return checked.file;
  }

  /** Renames a broken save to `.corrupt` (never deletes it) and reports it. */
  function moveAside(path: string, name: string, reason: string): void {
    // Never write over an earlier .corrupt file: pick the first free name.
    let target = `${path}.corrupt`;
    for (let n = 2; existsSync(target); n++) target = `${path}.corrupt.${n}`;
    try {
      renameSync(path, target);
      log(`Saved games: ${name} is damaged (${reason}). It was moved aside as ${target} and not loaded.`);
    } catch (error) {
      log(`Saved games: ${name} is damaged (${reason}) and could not be moved aside (${describe(error)}). Not loaded.`);
    }
  }

  function has(code: GameCode): boolean {
    const path = pathOf(code);
    return existsSync(path) || existsSync(`${path}.corrupt`);
  }

  function save(file: RoomFile): void {
    const path = pathOf(file.code);
    const temporary = `${path}.tmp`;
    const bytes = Buffer.from(serializeRoomFile(file), 'utf8');

    mkdirSync(roomsDir, { recursive: true });
    try {
      const handle = openSync(temporary, 'w');
      try {
        writeWhole(handle, bytes, write);
        // Without this the rename below could reach the disk before the
        // file's contents do, and a power cut would leave an empty save.
        fsyncSync(handle);
        // The last line of defence: a file that is not exactly as long as
        // the save must never replace the previous save.
        const size = fstatSync(handle).size;
        if (size !== bytes.length) {
          throw new Error(`the save file is ${size} bytes long instead of ${bytes.length} (is the disk full?)`);
        }
      } finally {
        closeSync(handle);
      }
      renameWithRetries(temporary, path);
    } catch (error) {
      // Tidy up the half-written file if possible; the error that matters is the first one.
      try {
        rmSync(temporary, { force: true });
      } catch {
        // Nothing more to do: loadAll deletes leftovers at the next start.
      }
      throw error;
    }
    flushFolder(roomsDir);
  }

  function remove(code: GameCode): void {
    rmSync(pathOf(code), { force: true });
  }

  return { loadAll, has, save, remove };
}

/** The layout number (`schema`) of the game state inside a parsed room file; null if there is no game or no number. */
function gameSchemaOf(content: Record<string, unknown>): number | null {
  const game = content.game;
  if (typeof game !== 'object' || game === null) return null;
  const schema = (game as Record<string, unknown>).schema;
  return typeof schema === 'number' && Number.isInteger(schema) ? schema : null;
}

/**
 * Writes all of `bytes` to an open file. One write call may take only part
 * of what it is given (it says how much), which happens when the disk is
 * nearly full; the rest is then written again, and that call fails with the
 * real reason ("no space left on device").
 */
function writeWhole(handle: number, bytes: Uint8Array, write: WriteCall): void {
  let done = 0;
  while (done < bytes.length) {
    const taken = write(handle, bytes, done, bytes.length - done);
    if (taken <= 0) throw new Error('the disk took no more of the save file (is it full?)');
    done += taken;
  }
}

/**
 * Renames `from` over `to`. On Windows a virus scanner or a backup tool that
 * is looking at the file makes the rename fail for a moment with EPERM,
 * EBUSY or EACCES, so those are tried again a few times.
 */
function renameWithRetries(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const passing = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!passing || attempt >= RENAME_ATTEMPTS) throw error;
      pause(RENAME_PAUSE_MS);
    }
  }
}

/**
 * Waits without giving up control. Saving is synchronous on purpose (no
 * other message may be handled between "saved" and "told the players"), so
 * an ordinary timer cannot be used here. Atomics.wait on a private memory
 * cell that nobody ever changes is the standard way to pause a thread.
 */
function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Asks the system to write the folder's list of files to disk, so that the
 * rename itself survives a power cut. Not every system allows this (Windows
 * does not); the save is complete and atomic without it, so a refusal is
 * ignored.
 */
function flushFolder(folder: string): void {
  try {
    const handle = openSync(folder, 'r');
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
  } catch {
    // Best effort only, see above.
  }
}

/** A short text for a log line about a caught error. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
