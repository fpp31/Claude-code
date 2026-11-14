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

import { SERVER_ERROR_MESSAGE, diffViews, jsonEqual, ruleError } from '@domination/shared';
import type {
  Action,
  AddressedEvent,
  CivId,
  GameCode,
  GameEvent,
  GameSetup,
  GameState,
  MapSizeId,
  PlayerId,
  PlayerView,
  ProtocolErrorCode,
  ServerMessage,
} from '@domination/shared';
import { deliver, gameSyncDelivery } from './deliveries';
import type { Delivery } from './deliveries';
import { describeError, errorMessage, failure } from './errors';
import type { RoomFile } from './roomFile';
import {
  civIsTakenByAnother,
  connectedPlayers,
  lobbyDeliveries,
  lobbyViewFor,
  seatIsConnected,
  takeSeat,
  withCiv,
  withoutSeat,
} from './roomLobby';
import type { LinkMap } from './roomLobby';
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

const OK: Outcome = { ok: true };

export class Room {
  /** The room's save file. Never edited in place: every change replaces it with a new object (commit rule). */
  private file: RoomFile;
  private readonly deps: RoomDeps;
  /**
   * The attached sockets and the seat each one sits on. Like the file it is
   * replaced, never edited, so a change that fails half-way leaves it alone.
   */
  private links: LinkMap = new Map();

  /**
   * @param file  the room's save file: a brand-new one (see RoomManager) or
   *              one loaded from disk at start-up. The room owns it from now on.
   */
  constructor(file: RoomFile, deps: RoomDeps) {
    this.file = file;
    this.deps = deps;
  }

  get code(): GameCode {
    return this.file.code;
  }

  /** True once the host has started the game. */
  get started(): boolean {
    return this.file.game !== null;
  }

  /** True if a seat belongs to this token hash. */
  hasSeat(tokenHash: string): boolean {
    return this.file.seats.some((seat) => seat.tokenHash === tokenHash);
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
    // 1. Already attached here: a second attach would double every update.
    if (this.links.has(link)) return this.resync(link);

    // 2. The token owns a seat: the player comes back to it. Nothing is saved.
    const ownSeat = this.file.seats.find((seat) => seat.tokenHash === tokenHash);
    if (ownSeat !== undefined) return this.attach(link, ownSeat.playerId, this.file);

    // 3. A seat has to be taken, which changes the file.
    const taken = takeSeat(this.file, tokenHash, name);
    if (!taken.ok) return taken;
    const attached = this.attach(link, taken.playerId, taken.file);
    if (attached.ok && taken.takenOver) {
      // Worth a line in the log: a seat changed hands (see SeatRecord.tokenHash).
      this.deps.log(`Game ${this.code}: seat ${taken.playerId}, which had been freed by hand, was taken by a new browser.`);
    }
    return attached;
  }

  /**
   * The socket closed, or it has moved to another game. Removes the link.
   * If its seat has no links left, tells the others (`lobby` or `presence`).
   * Nothing is saved: connection status is not part of the save.
   * Does nothing if the link is not attached.
   */
  detach(link: ClientLink): void {
    const playerId = this.links.get(link);
    if (playerId === undefined) return;

    const links = this.linksWithout([link]);
    this.commit(this.file, links, this.departureDeliveries(links, playerId));
  }

  /**
   * Handles `leaveGame`. The room sends the `left` messages itself.
   *
   *  - The link is not attached to this room -> 'notInGame'.
   *  - Lobby: the seat is given up. Commit the file without it (if it was
   *    the host's, the lowest remaining seat with a connected player becomes
   *    host, or the lowest remaining seat if nobody is connected; a failed
   *    save -> 'serverError' and nothing changes). Then send `left` to EVERY link of
   *    that seat (the calling socket and the player's other tabs) and detach
   *    them all, and send `lobby` to the links of the other seats.
   *    If it was the LAST seat, nothing is saved: send `left`, detach, and
   *    return `roomEmpty: true`; the caller then asks the RoomManager to
   *    remove the room and its file.
   *  - Running game: only this link is detached and gets `left`; the seat is
   *    kept (tell the others with `presence` if the seat has no link left).
   */
  leave(link: ClientLink): { ok: true; roomEmpty: boolean } | Failure {
    const playerId = this.links.get(link);
    if (playerId === undefined) return failure('notInGame');

    // Running game: the seat is kept, only this socket goes.
    if (this.file.game !== null) {
      const links = this.linksWithout([link]);
      const deliveries: Delivery[] = [{ link, message: { type: 'left' } }, ...this.departureDeliveries(links, playerId)];
      this.commit(this.file, links, deliveries);
      return { ok: true, roomEmpty: false };
    }

    // Lobby: the seat is given up, and with it every socket (tab) of that player.
    const leaving = [...this.links].filter(([, seat]) => seat === playerId).map(([seatLink]) => seatLink);
    const links = this.linksWithout(leaving);
    const farewells: Delivery[] = leaving.map((seatLink) => ({ link: seatLink, message: { type: 'left' } }));

    if (this.file.seats.length === 1) {
      // The last seat: nothing is saved, because the caller deletes the room and its file.
      this.commit(this.file, links, farewells);
      return { ok: true, roomEmpty: true };
    }

    const next = withoutSeat(this.file, playerId, links);
    const committed = this.commit(next, links, [...farewells, ...lobbyDeliveries(next, links)]);
    return committed ? { ok: true, roomEmpty: false } : failure('serverError');
  }

  /** Lobby only ('notInGame' otherwise). 'civTaken' if another seat has it. Commit, then send `lobby` to all. */
  chooseCiv(link: ClientLink, civ: CivId): Outcome {
    const playerId = this.lobbySeatOf(link);
    if (playerId === null) return failure('notInGame');
    if (civIsTakenByAnother(this.file, playerId, civ)) return failure('civTaken');

    return this.commitLobbyChange(withCiv(this.file, playerId, civ));
  }

  /** Lobby only, host only ('notHost'). Commit, then send `lobby` to all. */
  setMapSize(link: ClientLink, mapSize: MapSizeId): Outcome {
    const playerId = this.lobbySeatOf(link);
    if (playerId === null) return failure('notInGame');
    if (playerId !== this.file.hostId) return failure('notHost');

    return this.commitLobbyChange({ ...this.file, mapSize });
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
    const playerId = this.lobbySeatOf(link);
    if (playerId === null) return failure('notInGame');
    if (playerId !== this.file.hostId) return failure('notHost');

    // 1. PREPARE. Nothing has happened yet if any of this throws.
    let next: RoomFile;
    let deliveries: Delivery[];
    try {
      const setup: GameSetup = {
        seed: this.deps.newSeed(),
        settings: { mapSize: this.file.mapSize, turnMode: 'simultaneous' },
        players: this.file.seats.map((seat) => ({ id: seat.playerId, name: seat.name, civ: seat.civ })),
      };
      const game = this.deps.rules.createGame(setup);
      const views = this.viewsOfAllSeats(game);
      const connected = this.connectedPlayers();

      next = { ...this.file, game };
      deliveries = [];
      for (const [attached, seat] of this.links) {
        deliveries.push(gameSyncDelivery(attached, this.code, attached.seq + 1, viewOf(views, seat), connected, []));
      }
    } catch (error) {
      this.logFailure('starting the game', error);
      return failure('serverError');
    }

    // 2. SAVE and 3. ADOPT AND SEND.
    if (!this.commit(next, this.links, deliveries)) return failure('serverError');
    this.deps.log(`Game ${this.code} was started with ${next.seats.length} player(s).`);
    return OK;
  }

  /**
   * Handles an `action` message: THE COMMIT PATH for a running game.
   *
   *  1. The link must be attached to a seat of a started game, otherwise
   *     send `error notInGame` (no requestId: the action never reached a
   *     game) and stop.
   *  2. result = rules.applyAction(state, seat.playerId, turn, action). The
   *     player id comes from the seat. The rules never modify `state`.
   *  3. Rejected -> send `actionRejected` to this link only, with the error
   *     rebuilt from its code (ruleError(result.error.code)): the code and
   *     its standard sentence, never a text the rules made up. Nothing else
   *     happens; no other player can tell.
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
    // 1. Who is asking? The seat of the socket, never anything in the message.
    const playerId = this.links.get(link);
    const game = this.file.game;
    if (playerId === undefined || game === null) {
      link.send(errorMessage('notInGame'));
      return;
    }

    let next: RoomFile;
    let deliveries: Delivery[];
    try {
      // 2. The rules judge the wish. They never modify `game`.
      const result = this.deps.rules.applyAction(game, playerId, turn, action);

      // 3. Refused: only the sender hears about it.
      if (!result.ok) {
        // The error is rebuilt from its code, so nothing but the standard sentence can travel.
        link.send({ type: 'actionRejected', requestId, error: ruleError(result.error.code) });
        return;
      }
      // 4. Accepted, but nothing changed: nothing to save, nobody else to tell.
      if (!result.changed) {
        link.send({ type: 'actionOk', requestId });
        return;
      }

      // 5. PREPARE every seat's view and every socket's message.
      next = { ...this.file, game: result.state };
      deliveries = this.updateDeliveries(result.state, result.events);
    } catch (error) {
      this.logFailure(`an action of ${playerId} (${action.type})`, error);
      link.send(serverErrorRejection(requestId));
      return;
    }

    // 6. SAVE, 7. ADOPT, 8. SEND. A failed save leaves everything as it was.
    if (!this.commit(next, this.links, deliveries)) {
      link.send(serverErrorRejection(requestId));
      return;
    }

    // 9. The actor's own update went out in step 8, so this arrives after it.
    link.send({ type: 'actionOk', requestId });
  }

  /**
   * Handles `resync` (and a `joinGame` from a link that is already attached
   * here): sends this link only a fresh `gameSync` (running game: seq =
   * link.seq + 1, a fresh buildPlayerView, no events; lastView is replaced)
   * or `lobby` (lobby). 'notInGame' if the link is not attached;
   * 'serverError' if the view cannot be built (nothing is sent).
   */
  resync(link: ClientLink): Outcome {
    const playerId = this.links.get(link);
    if (playerId === undefined) return failure('notInGame');

    let delivery: Delivery;
    try {
      const game = this.file.game;
      if (game === null) {
        delivery = { link, message: { type: 'lobby', lobby: lobbyViewFor(this.file, this.links, playerId) } };
      } else {
        const view = this.deps.rules.buildPlayerView(game, playerId);
        delivery = gameSyncDelivery(link, this.code, link.seq + 1, view, this.connectedPlayers(), []);
      }
    } catch (error) {
      this.logFailure(`a resync for ${playerId}`, error);
      return failure('serverError');
    }

    this.commit(this.file, this.links, [delivery]);
    return OK;
  }

  /** Players with at least one attached link, in seat order. */
  connectedPlayers(): PlayerId[] {
    return connectedPlayers(this.file, this.links);
  }

  // -------------------------------------------------------------------------
  // The commit rule
  // -------------------------------------------------------------------------

  /**
   * Steps 2 and 3 of the commit rule, for EVERY change to this room.
   *
   * @param file        the next room file. If it is the current one (the
   *                    change is only about who is attached), nothing is saved.
   * @param links       the sockets attached after the change
   * @param deliveries  every message of the change, already worked out
   *
   * Returns false if the save failed (the reason is in the log): the room is
   * then exactly as it was and nothing has been sent.
   */
  private commit(file: RoomFile, links: LinkMap, deliveries: Delivery[]): boolean {
    // SAVE. If this throws, stop: nothing has changed.
    if (file !== this.file) {
      try {
        this.deps.storage.save(file);
      } catch (error) {
        this.logFailure('saving', error);
        return false;
      }
    }

    // ADOPT. From here on the change has happened; nothing below can fail.
    for (const link of links.keys()) {
      // A socket that is new to this room starts counting its updates from zero.
      if (!this.links.has(link)) {
        link.seq = 0;
        link.lastView = null;
      }
    }
    this.file = file;
    this.links = links;

    // SEND.
    for (const delivery of deliveries) deliver(delivery);
    return true;
  }

  /** A change to the lobby that every attached socket is told about with a fresh `lobby`. */
  private commitLobbyChange(next: RoomFile): Outcome {
    return this.commit(next, this.links, lobbyDeliveries(next, this.links)) ? OK : failure('serverError');
  }

  // -------------------------------------------------------------------------
  // Preparing messages (pure: nothing here changes the room)
  // -------------------------------------------------------------------------

  /**
   * Attaches `link` to the seat `playerId` under `file`: the current file
   * when a player comes back to their seat (nothing is saved), or the next
   * file when the seat was just taken (it is saved first).
   */
  private attach(link: ClientLink, playerId: PlayerId, file: RoomFile): Outcome {
    const links = new Map(this.links).set(link, playerId);

    let deliveries: Delivery[];
    try {
      if (file.game === null) {
        deliveries = lobbyDeliveries(file, links);
      } else {
        // The view is built first: a seat that cannot be shown is not attached.
        const view = this.deps.rules.buildPlayerView(file.game, playerId);
        const connected = connectedPlayers(file, links);
        // A link that is new to the room starts at seq 0, so its first gameSync carries 1.
        deliveries = [gameSyncDelivery(link, file.code, 1, view, connected, [])];
        if (!seatIsConnected(this.links, playerId)) {
          for (const other of this.links.keys()) {
            deliveries.push({ link: other, message: { type: 'presence', connected } });
          }
        }
      }
    } catch (error) {
      this.logFailure(`attaching a socket to ${playerId}`, error);
      return failure('serverError');
    }

    return this.commit(file, links, deliveries) ? OK : failure('serverError');
  }

  /**
   * What the remaining sockets are told after a socket of `playerId` has
   * gone: nothing if that seat still has another socket, otherwise the new
   * `lobby` or `presence`.
   */
  private departureDeliveries(remaining: LinkMap, playerId: PlayerId): Delivery[] {
    if (seatIsConnected(remaining, playerId)) return [];
    if (this.file.game === null) return lobbyDeliveries(this.file, remaining);

    const connected = connectedPlayers(this.file, remaining);
    return [...remaining.keys()].map((link) => ({ link, message: { type: 'presence', connected } }));
  }

  /**
   * Step 5 of the action path: the view and the events of EVERY seat in the
   * new state, then what each attached socket will be sent (if anything).
   * Throws if any seat's view cannot be built, attached or not, so that a
   * state which cannot be shown to one of its players is never saved.
   */
  private updateDeliveries(game: GameState, events: AddressedEvent[]): Delivery[] {
    const views = this.viewsOfAllSeats(game);
    const eventsOf = new Map<PlayerId, GameEvent[]>();
    for (const seat of this.file.seats) {
      eventsOf.set(seat.playerId, this.deps.rules.filterEvents(events, seat.playerId));
    }

    const connected = this.connectedPlayers();
    const deliveries: Delivery[] = [];
    for (const [link, playerId] of this.links) {
      const view = viewOf(views, playerId);
      const news = eventsOf.get(playerId) ?? [];

      if (this.deps.sendPatches && link.lastView !== null) {
        const patch = diffViews(link.lastView, view);
        // Silence hides activity out of sight: no change and no news means no message at all.
        if (patch === null && news.length === 0) continue;
        const message: ServerMessage = { type: 'gameUpdate', seq: link.seq + 1, patch: patch ?? {}, events: news };
        deliveries.push({ link, view, message });
      } else {
        if (link.lastView !== null && news.length === 0 && jsonEqual(link.lastView, view)) continue;
        deliveries.push(gameSyncDelivery(link, this.code, link.seq + 1, view, connected, news));
      }
    }
    return deliveries;
  }

  /** The view of every seat, attached or not. Throws if one of them cannot be built. */
  private viewsOfAllSeats(game: GameState): Map<PlayerId, PlayerView> {
    const views = new Map<PlayerId, PlayerView>();
    for (const seat of this.file.seats) {
      views.set(seat.playerId, this.deps.rules.buildPlayerView(game, seat.playerId));
    }
    return views;
  }

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  /** The seat of a socket that is attached while the game is still in the lobby; null otherwise. */
  private lobbySeatOf(link: ClientLink): PlayerId | null {
    if (this.file.game !== null) return null;
    return this.links.get(link) ?? null;
  }

  /** The attached sockets without the given ones (a new map; the current one is not touched). */
  private linksWithout(gone: ClientLink[]): LinkMap {
    const links = new Map(this.links);
    for (const link of gone) links.delete(link);
    return links;
  }

  /** Exceptions go to the server log in full, and nowhere else. */
  private logFailure(what: string, error: unknown): void {
    this.deps.log(`Game ${this.code}: ${what} failed. ${describeError(error)}`);
  }
}

/** The view of a seat out of a map that holds one for every seat. */
function viewOf(views: Map<PlayerId, PlayerView>, playerId: PlayerId): PlayerView {
  const view = views.get(playerId);
  if (view === undefined) throw new Error(`no view was built for ${playerId}`);
  return view;
}

/** The answer to an action that hit an internal problem: the constant sentence, never the exception. */
function serverErrorRejection(requestId: number): ServerMessage {
  return { type: 'actionRejected', requestId, error: { code: 'serverError', message: SERVER_ERROR_MESSAGE } };
}
