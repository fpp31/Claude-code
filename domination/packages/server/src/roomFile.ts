/**
 * The save file of one game ("room"): `<data dir>/rooms/<CODE>.json`.
 *
 * One file holds everything about a game: who sits where, the lobby
 * settings and, once started, the whole game state. It is rewritten (see
 * storage.ts) after every accepted change, so a server restart loses nothing.
 *
 * Nothing in this file is ever sent to a client as it is.
 */

import type { CivId, GameCode, GameState, MapSizeId, PlayerId } from '@domination/shared';

/** Version of the RoomFile layout. Bump it and add a migration in storage.ts when the layout changes. */
export const ROOM_FILE_FORMAT = 1;

export interface SeatRecord {
  playerId: PlayerId;
  /**
   * SHA-256 of the player's secret token (hex). The token itself is never
   * stored, so a save file can be shared for debugging without handing over
   * anybody's seat.
   *
   * null = the seat is UNCLAIMED: the next player who joins with a token
   * that has no seat in this game takes it over, keeping its name and civ
   * (Room.join). The server never writes null itself in phase 1. It is the
   * rescue for a player who lost their token (new browser, cleared site
   * data) in a game that runs for days: the server's owner stops the server,
   * sets this field to null in the save file and starts it again (README,
   * "A player lost their seat"). Later phases use the same field for empty
   * and AI seats.
   */
  tokenHash: string | null;
  name: string;
  civ: CivId;
}

export interface RoomFile {
  /** Always ROOM_FILE_FORMAT for files written by this code. */
  format: number;
  code: GameCode;
  /** When the game was created (ISO 8601, server clock). For humans only; never sent to clients. */
  createdAt: string;
  /** The seat that may change settings and start the game. */
  hostId: PlayerId;
  mapSize: MapSizeId;
  /** Taken seats in seat order. Kept after the start: it maps tokens to players for reconnecting. */
  seats: SeatRecord[];
  /** null while in the lobby; the full game state once the host has started the game. */
  game: GameState | null;
}
