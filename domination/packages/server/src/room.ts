/**
 * One game on the server: its seats, its lobby, its game state and the
 * sockets currently attached to it.
 *
 * THE SERVER IS AUTHORITATIVE. Clients send wishes; the room decides who is
 * asking (from the socket, never from the message), lets the rules engine
 * judge the wish, saves, and only then tells each player what THEY may see.
 *
 * Everything here runs synchronously from start to finish. Node handles one
 * message at a time, so two messages can never interleave and there is
 * nothing to lock: "two actions in the same instant" always have an order,
 * and the first valid one wins.
 *
 * THE COMMIT RULE. Every change to a room, in the lobby or in the game, goes
 * through the same three steps, in this order:
 *
 *   1. PREPARE         Build the next RoomFile as a NEW object (never edit
 *                      the current one in place) and work out every message
 *                      that will be sent. This step only computes: if
 *                      anything in it throws, nothing has happened yet.
 *   2. SAVE            storage.save(next). If it throws, stop: the room keeps
 *                      its current file, nothing is sent to anybody, and the
 *                      caller is told 'serverError'.
 *   3. ADOPT AND SEND  Make `next` the room's file, then send the prepared
 *                      messages. Nothing in this step can fail: `link.send`
 *                      never throws.
 *
 * So the file on disk is never behind what any client has been told, memory
 * is never ahead of the disk, and a change is either completely done or did
 * not happen. Write ONE private helper for steps 2 and 3 and route every
 * mutation through it (join with a new seat, leave, chooseCiv, setMapSize,
 * start, action). Who is connected is not part of the file: attaching and
 * detaching a socket saves nothing.
 *
 * WHAT CLIENTS ARE TOLD ABOUT FAILURES. A 'serverError' always carries the
 * constant SERVER_ERROR_MESSAGE from the shared package. The text of a caught
 * exception goes to `deps.log` only: it may name hidden units or tiles.
 */

import type {
  Action,
  CivId,
  GameCode,
  MapSizeId,
  PlayerId,
  PlayerView,
  ProtocolErrorCode,
  ServerMessage,
} from '@domination/shared';
import type { RoomFile } from './roomFile';
import type { Rules } from './rules';
import type { Storage } from './storage';

/**
 * What a room knows about one attached socket. connection.ts creates one per
 * socket; the room fills in the bookkeeping fields while it is attached.
 */
export interface ClientLink {
  /**
   * Sends one message to this socket (as JSON). The parameter type is the
   * leak guard: only wire messages can be sent, and a GameState does not fit
   * into any of them.
   *
   * MUST NEVER THROW: a message for a socket that is closing or closed is
   * silently dropped (that client reconnects and gets a full sync). The
   * commit rule above relies on this.
   */
  send(message: ServerMessage): void;
  /**
   * Update counter of this socket: the `seq` of the last gameSync/gameUpdate
   * sent to it. The room sets it to 0 when the link is attached and adds one
   * for EVERY gameSync and gameUpdate it sends on the link (attach, resync,
   * full-sync mode and patches alike), so the first gameSync carries seq 1.
   */
  seq: number;
  /** The last view sent to this socket (to diff the next one against). The room sets it to null when the link is attached. */
  lastView: PlayerView | null;
}

/** Things a room needs from the outside. */
export interface RoomDeps {
  rules: Rules;
  storage: Storage;
  /** Returns the seed for a new game (random, or the fixed test seed). */
  newSeed(): string;
  /** See ServerConfig.sendPatches. */
  sendPatches: boolean;
  log(line: string): void;
}

/** A lobby operation that was refused. The caller sends an `error` message with this code and message. */
export interface Failure {
  ok: false;
  code: ProtocolErrorCode;
  /** Plain English, shown to the player. For 'serverError' always SERVER_ERROR_MESSAGE. */
  message: string;
}

/** Result of a lobby operation. */
export type Outcome = { ok: true } | Failure;

export class Room {
  /**
   * @param file  the room's save file: a brand-new one (see RoomManager) or
   *              one loaded from disk at start-up. The room owns it from now on.
   */
  constructor(file: RoomFile, deps: RoomDeps) {
    throw new Error('not implemented: Room');
  }

  get code(): GameCode {
    throw new Error('not implemented: Room.code');
  }

  /** True once the host has started the game. */
  get started(): boolean {
    throw new Error('not implemented: Room.started');
  }

  /** True if a seat belongs to this token hash. */
  hasSeat(tokenHash: string): boolean {
    throw new Error('not implemented: Room.hasSeat');
  }

  /**
   * Handles `joinGame` (and the creator's first attach, see
   * RoomManager.createRoom). On failure nothing changes and the link is not
   * attached. Decide in this order:
   *
   *  1. The link is ALREADY ATTACHED to this room: behave exactly like
   *     resync(link). Never attach a link twice (it would receive every
   *     update twice, the second with a wrong seq).
   *  2. The token hash OWNS A SEAT (lobby or running game): attach the link
   *     to that seat; `name` is ignored and nothing is saved. This is the
   *     reconnect path.
   *  3. Otherwise a seat has to be TAKEN. Which one:
   *       a. the lowest seat whose tokenHash is null (a seat freed by hand,
   *          see SeatRecord.tokenHash), in a lobby or in a running game: it
   *          keeps its playerId, name and civ and gets this token hash;
   *       b. else, in a lobby with fewer than maxPlayers() seats: a new seat
   *          with the LOWEST free seat id (p1..p8), the FIRST civilization
   *          in CIV_IDS order that no other seat has, and the cleaned name;
   *       c. else there is no seat to be had: 'gameAlreadyStarted' for a
   *          running game, 'gameFull' for a lobby.
   *     Taking a seat (a or b) needs the player to have pressed Join: `name`
   *     null -> 'nameRequired'; empty after cleanPlayerName -> 'badName'.
   *     (In case a the name is only checked, not stored: the seat keeps the
   *     name the game state already carries.) Commit the new file (commit
   *     rule; a failed save -> 'serverError'), then attach the link.
   *
   * After a successful attach (link.seq = 0, link.lastView = null):
   *  - lobby: send `lobby` to every attached link (each with its own `you`);
   *  - running game: send `gameSync` to this link only (a fresh
   *    buildPlayerView, no events), and `presence` to the other links if
   *    this seat just became connected. Build the view FIRST, before
   *    anything is saved or attached: if that throws, log it, change
   *    nothing, and return 'serverError'.
   * Several links may be attached to one seat (two tabs); each has its own
   * `seq` and `lastView`.
   */
  join(link: ClientLink, tokenHash: string, name: string | null): Outcome {
    throw new Error('not implemented: Room.join');
  }

  /**
   * The socket closed, or it has moved to another game. Removes the link.
   * If its seat has no links left, tells the others (`lobby` or `presence`).
   * Nothing is saved: connection status is not part of the save.
   * Does nothing if the link is not attached.
   */
  detach(link: ClientLink): void {
    throw new Error('not implemented: Room.detach');
  }

  /**
   * Handles `leaveGame`. The room sends the `left` messages itself.
   *
   *  - The link is not attached to this room -> 'notInGame'.
   *  - Lobby: the seat is given up. Commit the file without it (if it was
   *    the host's, the lowest remaining seat becomes host; a failed save ->
   *    'serverError' and nothing changes). Then send `left` to EVERY link of
   *    that seat (the calling socket and the player's other tabs) and detach
   *    them all, and send `lobby` to the links of the other seats.
   *    If it was the LAST seat, nothing is saved: send `left`, detach, and
   *    return `roomEmpty: true`; the caller then asks the RoomManager to
   *    remove the room and its file.
   *  - Running game: only this link is detached and gets `left`; the seat is
   *    kept (tell the others with `presence` if the seat has no link left).
   */
  leave(link: ClientLink): { ok: true; roomEmpty: boolean } | Failure {
    throw new Error('not implemented: Room.leave');
  }

  /** Lobby only ('notInGame' otherwise). 'civTaken' if another seat has it. Commit, then send `lobby` to all. */
  chooseCiv(link: ClientLink, civ: CivId): Outcome {
    throw new Error('not implemented: Room.chooseCiv');
  }

  /** Lobby only, host only ('notHost'). Commit, then send `lobby` to all. */
  setMapSize(link: ClientLink, mapSize: MapSizeId): Outcome {
    throw new Error('not implemented: Room.setMapSize');
  }

  /**
   * Handles `startGame`. Lobby only ('notInGame'), host only ('notHost').
   * One player is enough. Every seat becomes a player, whether a socket is
   * attached to it or not. The commit rule, spelled out:
   *
   *  1. PREPARE: setup = { seed: deps.newSeed(), settings: { mapSize,
   *     turnMode: 'simultaneous' }, players: the seats in seat order (id,
   *     name, civ) }; game = rules.createGame(setup); then build the view of
   *     EVERY seat with rules.buildPlayerView(game, seat).
   *  2. SAVE the file with `game` set.
   *  3. ADOPT it and send `gameSync` (that seat's view, no events) to every
   *     attached link.
   *
   * If step 1 or 2 throws: log it, the room stays in the lobby exactly as it
   * was, and the outcome is 'serverError'.
   */
  start(link: ClientLink): Outcome {
    throw new Error('not implemented: Room.start');
  }

  /**
   * Handles an `action` message: THE COMMIT PATH for a running game.
   *
   *  1. The link must be attached to a seat of a started game, otherwise
   *     send `error notInGame` (no requestId: the action never reached a
   *     game) and stop.
   *  2. result = rules.applyAction(state, seat.playerId, turn, action). The
   *     player id comes from the seat. The rules never modify `state`.
   *  3. Rejected -> send `actionRejected` (result.error) to this link only.
   *     Nothing else happens; no other player can tell.
   *  4. Accepted but `changed` is false -> send `actionOk`. No save, no
   *     broadcast.
   *  5. PREPARE. For EVERY seat, attached or not: view =
   *     rules.buildPlayerView(result.state, seat) and events =
   *     rules.filterEvents(result.events, seat). (Every seat, so that a state
   *     which cannot be shown to one of its players is never saved.) Then,
   *     for every attached link, decide what it will be sent:
   *       - sendPatches on and link.lastView set: patch = diffViews(lastView,
   *         view). If patch is null and there are no events for this player:
   *         NOTHING (silence hides activity out of sight). Otherwise a
   *         `gameUpdate` (with an empty patch `{}` if only events are new).
   *       - otherwise: a `gameSync` (full view), unless the view is
   *         deep-equal to lastView and there are no events: then nothing.
   *  6. SAVE the room file with result.state (storage.save).
   *  7. ADOPT result.state. From here on the action has happened, whatever
   *     else goes wrong.
   *  8. SEND each link its prepared message with seq = link.seq + 1, and
   *     remember link.seq and link.lastView = that view.
   *  9. Send `actionOk` to the acting link, AFTER its own update.
   *
   * Steps 2 to 6 sit in ONE try/catch. If anything in them throws (the
   * rules, a view, the save): log the exception, keep the old state, send
   * nothing to anybody else, and answer the actor `actionRejected` with code
   * 'serverError' and SERVER_ERROR_MESSAGE. Steps 7 to 9 are outside it and
   * cannot fail, so an actor is never told "rejected" about an action that
   * was saved.
   */
  action(link: ClientLink, requestId: number, turn: number, action: Action): void {
    throw new Error('not implemented: Room.action');
  }

  /**
   * Handles `resync` (and a `joinGame` from a link that is already attached
   * here): sends this link only a fresh `gameSync` (running game: seq =
   * link.seq + 1, a fresh buildPlayerView, no events; lastView is replaced)
   * or `lobby` (lobby). 'notInGame' if the link is not attached;
   * 'serverError' if the view cannot be built (nothing is sent).
   */
  resync(link: ClientLink): Outcome {
    throw new Error('not implemented: Room.resync');
  }

  /** Players with at least one attached link, in seat order. */
  connectedPlayers(): PlayerId[] {
    throw new Error('not implemented: Room.connectedPlayers');
  }
}
