/**
 * All games of this server, by code.
 */

import type { GameCode } from '@domination/shared';
import type { ClientLink, Failure, RoomDeps } from './room';
import { Room } from './room';

export class RoomManager {
  constructor(deps: RoomDeps) {
    throw new Error('not implemented: RoomManager');
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
    throw new Error('not implemented: RoomManager.restore');
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
    throw new Error('not implemented: RoomManager.createRoom');
  }

  /** The room with this (already normalised) code, or null. */
  findRoom(code: GameCode): Room | null {
    throw new Error('not implemented: RoomManager.findRoom');
  }

  /** Forgets a room and deletes its save file (an abandoned lobby; see Room.leave). */
  removeRoom(code: GameCode): void {
    throw new Error('not implemented: RoomManager.removeRoom');
  }

  /** Number of rooms in memory (for logs and tests). */
  get roomCount(): number {
    throw new Error('not implemented: RoomManager.roomCount');
  }
}
