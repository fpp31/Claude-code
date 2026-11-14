/**
 * All games of this server, by code.
 */

import { CIV_IDS, playerIdForSeat } from '@domination/shared';
import type { GameCode } from '@domination/shared';
import { describeError, failure } from './errors';
import { cleanPlayerName } from './parseMessage';
import type { ClientLink, Failure, RoomDeps } from './room';
import { Room } from './room';
import { ROOM_FILE_FORMAT } from './roomFile';
import type { RoomFile } from './roomFile';
import { newGameCode } from './tokens';

export class RoomManager {
  private readonly deps: RoomDeps;
  private readonly rooms = new Map<GameCode, Room>();

  constructor(deps: RoomDeps) {
    this.deps = deps;
  }

  /**
   * Loads every saved game from storage (storage.loadAll) and makes a Room
   * for each. Called once at start-up, before the server listens. For each
   * started game, runs rules.checkInvariants and logs any problems as
   * warnings (the game is loaded anyway). Returns the number of games.
   *
   * storage.loadAll only returns files this version of the code can play;
   * a save with an unknown file format or game-state layout is left alone on
   * disk and gets no Room (see storage.ts).
   */
  restore(): number {
    for (const file of this.deps.storage.loadAll()) {
      this.rooms.set(file.code, new Room(file, this.deps));
      if (file.game !== null) this.warnAboutProblems(file);
    }
    return this.rooms.size;
  }

  /**
   * Handles `createGame`. In this order:
   *  1. `name` must clean up to a non-empty name (cleanPlayerName),
   *     otherwise 'badName'.
   *  2. Pick a fresh code: newGameCode(isTaken), where a code is taken if a
   *     room in memory has it OR storage.has(code) is true (a save this
   *     version could not load must never be overwritten).
   *  3. Build the complete RoomFile: format, code, createdAt, mapSize
   *     'small', hostId 'p1', game null, and ONE seat: p1 with the cleaned
   *     name, the first civilization of CIV_IDS and the creator's token hash.
   *  4. storage.save(file). If it throws: log, no room is created, 'serverError'.
   *  5. Make the Room, remember it, and call room.join(link, tokenHash,
   *     null): the token already owns seat p1, so this takes the ordinary
   *     re-attach path and sends the creator the `lobby`.
   */
  createRoom(link: ClientLink, tokenHash: string, name: string): { ok: true; room: Room } | Failure {
    // 1. The name.
    const cleanName = cleanPlayerName(name);
    if (cleanName === null) return failure('badName');

    // 2. A code that no game has, in memory or on disk.
    const code = newGameCode((candidate) => this.rooms.has(candidate) || this.deps.storage.has(candidate));

    // 3. The complete file of the new game: a lobby with the creator on seat p1.
    const host = playerIdForSeat(1);
    const file: RoomFile = {
      format: ROOM_FILE_FORMAT,
      code,
      createdAt: new Date().toISOString(),
      hostId: host,
      mapSize: 'small',
      seats: [{ playerId: host, tokenHash, name: cleanName, civ: CIV_IDS[0] }],
      game: null,
    };

    // 4. Save first: a game exists only once it is on disk.
    try {
      this.deps.storage.save(file);
    } catch (error) {
      this.deps.log(`Creating game ${code} failed: it could not be saved. ${describeError(error)}`);
      return failure('serverError');
    }

    // 5. The room, and the creator's socket attached to seat p1 (the ordinary "come back to my seat" path).
    const room = new Room(file, this.deps);
    this.rooms.set(code, room);
    const joined = room.join(link, tokenHash, null);
    if (!joined.ok) {
      // Cannot happen in a lobby; but a game nobody can reach must not stay behind.
      this.removeRoom(code);
      return joined;
    }
    this.deps.log(`Game ${code} was created.`);
    return { ok: true, room };
  }

  /** The room with this (already normalised) code, or null. */
  findRoom(code: GameCode): Room | null {
    return this.rooms.get(code) ?? null;
  }

  /** Forgets a room and deletes its save file (an abandoned lobby; see Room.leave). */
  removeRoom(code: GameCode): void {
    this.rooms.delete(code);
    try {
      this.deps.storage.remove(code);
      this.deps.log(`Game ${code} was removed (its last player left the lobby).`);
    } catch (error) {
      // The room is gone from memory either way. A file that stays behind
      // comes back as a lobby at the next start, which does no harm.
      this.deps.log(`Game ${code}: its save file could not be deleted. ${describeError(error)}`);
    }
  }

  /** Number of rooms in memory (for logs and tests). */
  get roomCount(): number {
    return this.rooms.size;
  }

  /** The health check for a loaded game. Problems are logged; the game is loaded anyway. */
  private warnAboutProblems(file: RoomFile): void {
    if (file.game === null) return;
    let problems: string[];
    try {
      problems = this.deps.rules.checkInvariants(file.game);
    } catch (error) {
      problems = [`the health check itself failed: ${describeError(error)}`];
    }
    for (const problem of problems) {
      this.deps.log(`WARNING: saved game ${file.code} has a problem: ${problem}`);
    }
  }
}
