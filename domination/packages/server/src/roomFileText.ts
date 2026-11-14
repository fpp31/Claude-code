/**
 * A room file as text: writing one out, and checking one that was read back.
 *
 * The check matters because a save file is the one thing on the server that
 * people edit by hand (README, "A player lost their seat"): a slip of the
 * keyboard must be caught when the server starts, not in the middle of a game.
 */

import { CIV_IDS, MAP_SIZE_IDS, RULES, playerIdForSeat } from '@domination/shared';
import type { CivId, GameCode, GameState, MapSizeId } from '@domination/shared';
import type { RoomFile, SeatRecord } from './roomFile';

/** What a stored token hash looks like: SHA-256 as 64 lower-case hex characters. */
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The text that is written to disk for a room.
 *
 * The small things a person may need to read or change (above all the seats)
 * come first, one per line; the game state, which nobody edits by hand,
 * follows as one long line. Only the fields of RoomFile are written, whatever
 * else the object may carry.
 */
export function serializeRoomFile(file: RoomFile): string {
  const lines = [
    '{',
    `  "format": ${JSON.stringify(file.format)},`,
    `  "code": ${JSON.stringify(file.code)},`,
    `  "createdAt": ${JSON.stringify(file.createdAt)},`,
    `  "hostId": ${JSON.stringify(file.hostId)},`,
    `  "mapSize": ${JSON.stringify(file.mapSize)},`,
    '  "seats": [',
    file.seats.map(seatLine).join(',\n'),
    '  ],',
    `  "game": ${JSON.stringify(file.game)}`,
    '}',
    '',
  ];
  return lines.join('\n');
}

function seatLine(seat: SeatRecord): string {
  const fields = [
    `"playerId": ${JSON.stringify(seat.playerId)}`,
    `"tokenHash": ${JSON.stringify(seat.tokenHash)}`,
    `"name": ${JSON.stringify(seat.name)}`,
    `"civ": ${JSON.stringify(seat.civ)}`,
  ];
  return `    { ${fields.join(', ')} }`;
}

/** The outcome of checking a room file: the file, or one sentence saying what is wrong with it. */
export type CheckedRoomFile = { ok: true; file: RoomFile } | { ok: false; problem: string };

/**
 * Checks the parsed contents of `<code>.json` (already at ROOM_FILE_FORMAT)
 * and rebuilds the RoomFile field by field.
 *
 * Only the envelope is checked here: code, settings and seats. The game
 * state inside is the rules engine's business; of it this function only
 * makes sure that it is an object with a layout number (`schema`), which
 * storage.ts then compares with STATE_SCHEMA, and that its players are
 * exactly the seats. A seat line that was deleted or renamed by hand would
 * otherwise load without a word and freeze the game: every turn would wait
 * for a player nobody can be, or every action would fail.
 */
export function checkRoomFile(content: Record<string, unknown>, code: GameCode): CheckedRoomFile {
  const { format, createdAt, hostId, game } = content;

  if (typeof format !== 'number') return bad('it has no file format number');
  if (content.code !== code) return bad(`the code inside it is not ${code}`);
  if (typeof createdAt !== 'string') return bad('"createdAt" is missing');

  const mapSize = MAP_SIZE_IDS.find((id) => id === content.mapSize);
  if (mapSize === undefined) return bad('"mapSize" is not a known map size');

  if (!Array.isArray(content.seats) || content.seats.length === 0) return bad('it has no seats');
  if (content.seats.length > RULES.maxSeats) return bad('it has too many seats');
  const seats: SeatRecord[] = [];
  let lastSeatNumber = 0;
  for (const entry of content.seats) {
    const seat = checkSeat(entry);
    if (typeof seat === 'string') return bad(seat);
    // Seat order is relied on everywhere (it is the players' order in the game).
    const seatNumber = seatNumberOf(seat.playerId);
    if (seatNumber <= lastSeatNumber) return bad('the seats are not in seat order (p1, p2, ...)');
    lastSeatNumber = seatNumber;
    seats.push(seat);
  }

  if (typeof hostId !== 'string' || !seats.some((seat) => seat.playerId === hostId)) {
    return bad('"hostId" is not one of the seats');
  }

  // A secret opens one seat. If two seats carried the same one, its owner
  // would always get the first and nobody could ever sit on the second.
  for (const [index, seat] of seats.entries()) {
    const twin = seats.slice(0, index).find((earlier) => earlier.tokenHash !== null && earlier.tokenHash === seat.tokenHash);
    if (twin !== undefined) return bad(`seats ${twin.playerId} and ${seat.playerId} have the same "tokenHash"`);
  }

  if (game !== null) {
    if (typeof game !== 'object' || Array.isArray(game)) return bad('"game" is neither null nor a game state');
    const { schema, players } = game as Record<string, unknown>;
    if (typeof schema !== 'number' || !Number.isInteger(schema)) return bad('the game state has no layout number');
    const mismatch = seatsVersusPlayers(seats, players);
    if (mismatch !== null) return bad(mismatch);
  }

  return {
    ok: true,
    file: { format, code, createdAt, hostId, mapSize: mapSize as MapSizeId, seats, game: game as GameState | null },
  };
}

function bad(problem: string): CheckedRoomFile {
  return { ok: false, problem };
}

/**
 * A started game's seats must be its players, one seat each. Returns a
 * sentence naming the first seat or player that does not fit, or null.
 */
function seatsVersusPlayers(seats: SeatRecord[], players: unknown): string | null {
  if (!Array.isArray(players)) return 'the game state has no list of players';
  const playerIds = players.map((player: unknown) =>
    typeof player === 'object' && player !== null ? (player as Record<string, unknown>).id : undefined,
  );
  const stray = seats.find((seat) => !playerIds.includes(seat.playerId));
  if (stray !== undefined) {
    return `seat ${stray.playerId} is not a player of the game inside (a seat's "playerId" must stay as it was)`;
  }
  const seatless = playerIds.find((id) => !seats.some((seat) => seat.playerId === id));
  if (seatless !== undefined) {
    return `player ${String(seatless)} of the game inside has no seat (a seat's line cannot be deleted)`;
  }
  return null;
}

/** One entry of "seats", rebuilt; or a sentence saying what is wrong with it. */
function checkSeat(entry: unknown): SeatRecord | string {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return 'a seat is not an object';
  const { playerId, tokenHash, name, civ } = entry as Record<string, unknown>;

  if (typeof playerId !== 'string' || seatNumberOf(playerId) === 0) {
    return 'a seat has a "playerId" that is not p1, p2, ...';
  }
  if (tokenHash !== null && (typeof tokenHash !== 'string' || !TOKEN_HASH_PATTERN.test(tokenHash))) {
    return `the "tokenHash" of seat ${playerId} is neither null nor 64 hex characters`;
  }
  if (typeof name !== 'string' || name === '') return `seat ${playerId} has no name`;
  const knownCiv = CIV_IDS.find((id) => id === civ);
  if (knownCiv === undefined) return `seat ${playerId} has an unknown civilization`;

  return { playerId, tokenHash, name, civ: knownCiv as CivId };
}

/** 'p3' -> 3. Returns 0 for anything that is not the name of a seat. */
function seatNumberOf(playerId: string): number {
  for (let seat = 1; seat <= RULES.maxSeats; seat++) {
    if (playerIdForSeat(seat) === playerId) return seat;
  }
  return 0;
}
