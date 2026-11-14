/**
 * The lobby part of a room, as plain functions on its save file.
 *
 * Every function here only computes: it takes the current RoomFile and
 * returns a NEW one (or messages), and never edits what it was given. That
 * is the PREPARE step of the commit rule (see room.ts).
 */

import { CIV_IDS, RULES, maxPlayers, playerIdForSeat, seatOfPlayer } from '@domination/shared';
import type { CivId, LobbyView, PlayerId } from '@domination/shared';
import type { Delivery } from './deliveries';
import { failure } from './errors';
import { cleanPlayerName } from './parseMessage';
import type { ClientLink, Failure } from './room';
import type { RoomFile, SeatRecord } from './roomFile';

/** Who is attached to a room: every socket and the seat it sits on. */
export type LinkMap = ReadonlyMap<ClientLink, PlayerId>;

/** Players with at least one attached socket, in seat order. */
export function connectedPlayers(file: RoomFile, links: LinkMap): PlayerId[] {
  const attached = new Set(links.values());
  return file.seats.filter((seat) => attached.has(seat.playerId)).map((seat) => seat.playerId);
}

/** True if at least one socket is attached to this seat. */
export function seatIsConnected(links: LinkMap, playerId: PlayerId): boolean {
  for (const attachedTo of links.values()) {
    if (attachedTo === playerId) return true;
  }
  return false;
}

/**
 * The lobby as one player may see it. Built field by field: a seat's token
 * hash never goes into it.
 */
export function lobbyViewFor(file: RoomFile, links: LinkMap, you: PlayerId): LobbyView {
  const attached = new Set(links.values());
  return {
    code: file.code,
    you,
    hostId: file.hostId,
    mapSize: file.mapSize,
    maxPlayers: maxPlayers(),
    seats: file.seats.map((seat) => ({
      playerId: seat.playerId,
      name: seat.name,
      civ: seat.civ,
      connected: attached.has(seat.playerId),
    })),
  };
}

/** The `lobby` message for every attached socket, each with its own `you`. */
export function lobbyDeliveries(file: RoomFile, links: LinkMap): Delivery[] {
  const deliveries: Delivery[] = [];
  for (const [link, playerId] of links) {
    deliveries.push({ link, message: { type: 'lobby', lobby: lobbyViewFor(file, links, playerId) } });
  }
  return deliveries;
}

/**
 * A token without a seat wants one (step 3 of Room.join). Returns the next
 * room file and the seat it gives, or why there is none to be had:
 *   a. the lowest seat whose tokenHash is null (freed by hand), in a lobby
 *      or a running game: it keeps its playerId, name and civ;
 *   b. else, in a lobby that is not full: a new seat with the lowest free
 *      seat id, the first civilization nobody has, and the cleaned name;
 *   c. else 'gameAlreadyStarted' (running game) or 'gameFull' (lobby).
 * Taking a seat needs a name ('nameRequired' / 'badName'), but whether there
 * is a seat at all is answered first.
 *
 * `takenOver` is true for case a: an existing seat changed hands.
 */
export function takeSeat(
  file: RoomFile,
  tokenHash: string,
  name: string | null,
): { ok: true; file: RoomFile; playerId: PlayerId; takenOver: boolean } | Failure {
  const freed = file.seats.find((seat) => seat.tokenHash === null);
  const lobbyHasRoom = file.game === null && file.seats.length < maxPlayers();
  if (freed === undefined && !lobbyHasRoom) {
    return failure(file.game === null ? 'gameFull' : 'gameAlreadyStarted');
  }

  // Only somebody who pressed Join (and so typed a name) takes a seat.
  if (name === null) return failure('nameRequired');
  const cleanName = cleanPlayerName(name);
  if (cleanName === null) return failure('badName');

  if (freed !== undefined) {
    // The name was only checked: the seat keeps the name the game already uses.
    const seats = file.seats.map((seat) => (seat === freed ? { ...seat, tokenHash } : seat));
    return { ok: true, file: { ...file, seats }, playerId: freed.playerId, takenOver: true };
  }

  const seat: SeatRecord = {
    playerId: lowestFreeSeatId(file.seats),
    tokenHash,
    name: cleanName,
    civ: firstFreeCiv(file.seats),
  };
  const seats = [...file.seats, seat].sort((a, b) => seatOfPlayer(a.playerId) - seatOfPlayer(b.playerId));
  return { ok: true, file: { ...file, seats }, playerId: seat.playerId, takenOver: false };
}

/**
 * The room file after a seat was given up. If it was the host's, the host's
 * job goes to the lowest remaining seat whose player is connected: only the
 * host can start the game, so handing the job to somebody who has closed
 * the page would leave the others waiting for a start nobody can press.
 * If nobody is connected, the lowest remaining seat becomes host.
 *
 * @param links  the sockets that stay attached (those of the leaving seat already taken out)
 */
export function withoutSeat(file: RoomFile, playerId: PlayerId, links: LinkMap): RoomFile {
  const seats = file.seats.filter((seat) => seat.playerId !== playerId);
  if (file.hostId !== playerId || seats.length === 0) return { ...file, seats };
  const present = seats.find((seat) => seatIsConnected(links, seat.playerId));
  return { ...file, seats, hostId: (present ?? seats[0]).playerId };
}

/** The room file after a seat changed its civilization. */
export function withCiv(file: RoomFile, playerId: PlayerId, civ: CivId): RoomFile {
  const seats = file.seats.map((seat) => (seat.playerId === playerId ? { ...seat, civ } : seat));
  return { ...file, seats };
}

/** True if a seat other than `playerId` has this civilization. */
export function civIsTakenByAnother(file: RoomFile, playerId: PlayerId, civ: CivId): boolean {
  return file.seats.some((seat) => seat.playerId !== playerId && seat.civ === civ);
}

function lowestFreeSeatId(seats: SeatRecord[]): PlayerId {
  for (let seat = 1; seat <= RULES.maxSeats; seat++) {
    const id = playerIdForSeat(seat);
    if (!seats.some((taken) => taken.playerId === id)) return id;
  }
  throw new Error('lowestFreeSeatId: every seat is taken');
}

function firstFreeCiv(seats: SeatRecord[]): CivId {
  for (const civ of CIV_IDS) {
    if (!seats.some((seat) => seat.civ === civ)) return civ;
  }
  throw new Error('firstFreeCiv: every civilization is taken');
}
