/**
 * One WebSocket connection: from raw text frames to calls on a Room.
 */

import { PROTOCOL_VERSION, SERVER_SILENCE_TIMEOUT_MS } from '@domination/shared';
import type { ClientMessage } from '@domination/shared';
import type { RawData, WebSocket } from 'ws';
import { MAX_BAD_MESSAGES, MAX_MESSAGES_PER_SECOND, MAX_SEND_BACKLOG_BYTES } from './config';
import { describeError, errorMessage } from './errors';
import { parseClientMessage } from './parseMessage';
import type { ClientLink, Outcome, Room } from './room';
import type { RoomManager } from './roomManager';
import { hashToken, isValidToken, newToken, normalizeGameCode } from './tokens';

/** WebSocket close code "policy violation": the server ends a connection that does not keep to the rules. */
const CLOSE_POLICY_VIOLATION = 1008;

/** How many different protocol numbers of other versions get a log line of their own (see createOtherVersionReport). */
const MAX_OTHER_VERSIONS_REPORTED = 8;

/**
 * Makes the function that reports a page of another protocol version to the
 * person who runs the server. ONE per server: it writes one log line the
 * first time a number is seen and nothing after that, so a tab that keeps
 * reconnecting cannot fill the log. Somebody who makes numbers up gets
 * MAX_OTHER_VERSIONS_REPORTED lines and one that says no more will follow.
 *
 * Why the line is there: a server that hands out a page of another version
 * (the code was updated and `npm run build` was forgotten) turns every
 * player away, and without this line its own output looks like an ordinary
 * start.
 */
export function createOtherVersionReport(log: (line: string) => void): (protocol: number) => void {
  const seen = new Set<number>();
  return (protocol) => {
    if (seen.has(protocol) || seen.size > MAX_OTHER_VERSIONS_REPORTED) return;
    seen.add(protocol);
    if (seen.size > MAX_OTHER_VERSIONS_REPORTED) {
      log('Pages of yet another protocol version connected. Further ones are no longer reported.');
      return;
    }
    const versions = `it speaks protocol ${protocol}, this server protocol ${PROTOCOL_VERSION}`;
    if (protocol < PROTOCOL_VERSION) {
      log(
        `A page of an older version connected (${versions}) and was told to reload. If players still see ` +
          '"not the same version" after reloading, the page this server hands out was not built again: ' +
          'stop the server, run "npm run build" and restart it.',
      );
    } else {
      log(
        `A page of a newer version connected (${versions}) and was told to reload. The page was built from ` +
          'newer code than this server is running: restart the server (and run "npm run build" first if the code changed since).',
      );
    }
  };
}

/**
 * Takes over a freshly opened socket. Everything a socket can do goes
 * through here. It makes one ClientLink for the socket (room.ts) whose
 * `send` writes JSON to the socket and NEVER throws: if the socket is not
 * open any more the message is dropped.
 *
 *  - Every incoming frame is parsed with parseClientMessage. Not a valid
 *    message -> `error badMessage` (after MAX_BAD_MESSAGES of those, close
 *    the socket with code 1008, "policy violation").
 *  - More than MAX_MESSAGES_PER_SECOND messages in a second -> the extra
 *    ones are dropped with `error rateLimited`.
 *  - `hello` must come first; anything else before it -> `error notReady`.
 *    A wrong `protocol` -> `error protocolMismatch`, then close (1008), and
 *    one line in the log the first time that number is seen. Otherwise
 *    remember the token (make a new one with newToken if the client sent
 *    null or something that is not a valid token; a token of the right
 *    form is taken as it is, whether the server ever saw it or not: pages
 *    make their own on a first visit, see tokens.ts) and answer `welcome`.
 *    The token is kept only in memory, as its hash; never log it.
 *    A second `hello` on the same socket -> `error badMessage`.
 *  - `ping` -> `pong`.
 *
 *  - A socket is attached to at most ONE room, and this module remembers
 *    which. The ROOM is the authority, though: it may have dropped the link
 *    in the meantime (the seat was given up from another tab), and then
 *    answers 'notInGame'.
 *  - `joinGame`: normalise the code (normalizeGameCode); unknown code ->
 *    `error noSuchGame`, or `error gameNotLoaded` if a save with that code
 *    lies on disk and was not loaded at start-up (RoomManager.isOnDiskOnly).
 *    Then call room.join FIRST and look at the outcome:
 *      * failed -> send the `error`; the socket stays attached to whatever
 *        room it was in before, untouched;
 *      * succeeded and it is a different room than before -> only now
 *        detach the link from the old room (oldRoom.detach) and remember
 *        the new one. The old seat is kept; only `leaveGame` gives up a seat.
 *    Joining the room the socket is already attached to is fine: Room.join
 *    treats it as a resync.
 *  - `createGame`: rooms.createRoom; on success detach from the old room as
 *    above; on failure nothing changes.
 *  - `leaveGame`: room.leave (the room sends `left` itself). On success
 *    forget the room; if it reports `roomEmpty`, remove it
 *    (RoomManager.removeRoom).
 *  - `chooseCiv`, `setMapSize`, `startGame`, `action`, `resync` are passed
 *    to the attached room; without one -> `error notInGame`.
 *  - A failed Outcome from a room becomes an `error` message with its code
 *    and message.
 *
 *  - LIVENESS: a socket from which NO frame has arrived for
 *    SERVER_SILENCE_TIMEOUT_MS is cut off (any frame counts, valid or not).
 *    The limit is generous on purpose; see the note on liveness in
 *    shared/src/protocol.ts before changing it.
 *  - BACKLOG: a socket that has stopped reading, so that more than
 *    MAX_SEND_BACKLOG_BYTES wait to be sent to it, is cut off as well.
 *    Both of these end the connection at once (terminate) instead of with
 *    a polite close: the other side is not listening any more.
 *  - On close (for any reason): detach from the room and stop the timers.
 *
 * An exception while handling a message must never take the server down:
 * catch it, write it to `log`, and answer `error serverError` with
 * SERVER_ERROR_MESSAGE. Never put the exception's own text into a message
 * for a client (it may name things the player must not know about).
 *
 * @param maxMessagesPerSecond  the rate limit; MAX_MESSAGES_PER_SECOND unless
 *                              a test says otherwise (ServerOptions.maxMessagesPerSecond)
 * @param reportOtherVersion    told the protocol number of every `hello`
 *                              that is turned away (createOtherVersionReport,
 *                              one per server); without one nothing is reported
 */
export function handleConnection(
  socket: WebSocket,
  rooms: RoomManager,
  log: (line: string) => void,
  maxMessagesPerSecond: number = MAX_MESSAGES_PER_SECOND,
  reportOtherVersion: (protocol: number) => void = () => {},
): void {
  /** SHA-256 of this socket's token; null until `hello` has been answered. The token itself is not kept. */
  let tokenHash: string | null = null;
  /** The room this socket was last attached to. The room has the final word on whether it still is. */
  let room: Room | null = null;
  /** How many frames were not valid messages. */
  let badMessages = 0;
  /**
   * Rate limit: when the current one-second window began, and how many
   * frames arrived in it. (The first frame always opens a fresh window.)
   */
  let windowStart = Number.NEGATIVE_INFINITY;
  let framesInWindow = 0;
  /** True once the connection is finished (closed, or being closed by us): later frames are ignored. */
  let over = false;

  const link: ClientLink = {
    seq: 0,
    lastView: null,
    send(message) {
      // MUST NEVER THROW (see ClientLink.send): whatever goes wrong, the message is dropped.
      try {
        if (socket.readyState !== socket.OPEN) return;
        if (socket.bufferedAmount > MAX_SEND_BACKLOG_BYTES) {
          // The other side has stopped reading; see MAX_SEND_BACKLOG_BYTES.
          // Only cut the line here: a room may be in the middle of sending,
          // so leaving the room waits for the 'close' event below.
          over = true;
          socket.terminate();
          return;
        }
        socket.send(JSON.stringify(message));
      } catch (error) {
        log(`A message could not be sent and was dropped. ${describeError(error)}`);
      }
    },
  };

  // LIVENESS: re-armed by every frame; if it ever fires, the socket has been silent for too long.
  const silenceTimer = setTimeout(() => {
    try {
      finish();
      socket.terminate();
    } catch (error) {
      log(`Closing a silent connection failed. ${describeError(error)}`);
    }
  }, SERVER_SILENCE_TIMEOUT_MS);

  /** The end of this connection, for whatever reason: stop the timer and leave the room. Safe to call twice. */
  function finish(): void {
    over = true;
    clearTimeout(silenceTimer);
    const attachedTo = room;
    room = null;
    attachedTo?.detach(link);
  }

  /** Ends a connection that does not keep to the rules. */
  function closeSocket(reason: string): void {
    finish();
    socket.close(CLOSE_POLICY_VIOLATION, reason);
  }

  function sendFailure(outcome: Outcome): void {
    if (!outcome.ok) link.send(errorMessage(outcome.code));
  }

  /** Answers a frame that was not a valid message; the fifth one ends the connection. */
  function refuseBadMessage(): void {
    badMessages += 1;
    link.send(errorMessage('badMessage'));
    if (badMessages >= MAX_BAD_MESSAGES) closeSocket('too many bad messages');
  }

  /** Counts a frame and says whether it is one too many for this second. */
  function isOverRateLimit(): boolean {
    // performance.now() never jumps, unlike the wall clock.
    const now = performance.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      framesInWindow = 0;
    }
    framesInWindow += 1;
    return framesInWindow > maxMessagesPerSecond;
  }

  /**
   * The socket is now attached to `target` (a join or a create succeeded).
   * Only now is it detached from the room it was in before; its seat there
   * is kept.
   */
  function moveTo(target: Room): void {
    if (room !== null && room !== target) room.detach(link);
    room = target;
  }

  function onFrame(data: RawData, isBinary: boolean): void {
    if (isOverRateLimit()) {
      link.send(errorMessage('rateLimited'));
      return;
    }

    // The protocol is JSON text; a binary frame is never a message.
    const message = isBinary ? null : parseClientMessage(textOf(data));
    if (message === null) {
      refuseBadMessage();
      return;
    }

    if (tokenHash === null) {
      if (message.type === 'hello') onHello(message.protocol, message.token);
      else link.send(errorMessage('notReady'));
      return;
    }
    onMessage(message, tokenHash);
  }

  function onHello(protocol: number, token: string | null): void {
    if (protocol !== PROTOCOL_VERSION) {
      link.send(errorMessage('protocolMismatch'));
      closeSocket('protocol mismatch');
      reportOtherVersion(protocol);
      return;
    }
    // A token of the right form is taken as it is. Anything else (null from a page that could not make one) gets a fresh one.
    const accepted = isValidToken(token) ? token : newToken();
    tokenHash = hashToken(accepted);
    link.send({ type: 'welcome', protocol: PROTOCOL_VERSION, token: accepted });
  }

  /** A valid message from a socket that has said hello. `hash` is its token hash. */
  function onMessage(message: ClientMessage, hash: string): void {
    switch (message.type) {
      case 'hello':
        // Already greeted: a second hello is not part of the conversation.
        refuseBadMessage();
        return;

      case 'ping':
        link.send({ type: 'pong' });
        return;

      case 'createGame': {
        const created = rooms.createRoom(link, hash, message.name);
        if (created.ok) moveTo(created.room);
        else sendFailure(created);
        return;
      }

      case 'joinGame': {
        const code = normalizeGameCode(message.code);
        const target = code === null ? null : rooms.findRoom(code);
        if (target === null) {
          // A save that is on disk but was not loaded is not "no such game":
          // the player's page keeps the code and waits for the repair.
          const onDisk = code !== null && rooms.isOnDiskOnly(code);
          link.send(errorMessage(onDisk ? 'gameNotLoaded' : 'noSuchGame'));
          return;
        }
        // Join FIRST. If it fails, the socket stays in the room it was in, untouched.
        const joined = target.join(link, hash, message.name);
        if (joined.ok) moveTo(target);
        else sendFailure(joined);
        return;
      }

      case 'leaveGame': {
        if (room === null) {
          link.send(errorMessage('notInGame'));
          return;
        }
        const leftRoom = room;
        const left = leftRoom.leave(link); // the room sends `left` itself
        if (!left.ok) {
          // 'notInGame' means the room had already let go of this socket.
          if (left.code === 'notInGame') room = null;
          sendFailure(left);
          return;
        }
        room = null;
        if (left.roomEmpty) rooms.removeRoom(leftRoom.code);
        return;
      }

      case 'chooseCiv':
        if (room === null) link.send(errorMessage('notInGame'));
        else sendFailure(room.chooseCiv(link, message.civ));
        return;

      case 'setMapSize':
        if (room === null) link.send(errorMessage('notInGame'));
        else sendFailure(room.setMapSize(link, message.mapSize));
        return;

      case 'startGame':
        if (room === null) link.send(errorMessage('notInGame'));
        else sendFailure(room.start(link));
        return;

      case 'resync':
        if (room === null) link.send(errorMessage('notInGame'));
        else sendFailure(room.resync(link));
        return;

      case 'action':
        // The room answers actions itself (actionOk / actionRejected carry the requestId).
        if (room === null) link.send(errorMessage('notInGame'));
        else room.action(link, message.requestId, message.turn, message.action);
        return;

      default: {
        // If a message type is ever added to the protocol, this line stops compiling until it is handled here.
        const unhandled: never = message;
        throw new Error(`unhandled message type: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  socket.on('message', (data, isBinary) => {
    if (over) return;
    silenceTimer.refresh(); // any frame counts as a sign of life, valid or not
    try {
      onFrame(data, isBinary);
    } catch (error) {
      // Never the exception's own text to the client: it may name things the player must not know.
      log(`A message could not be handled. ${describeError(error)}`);
      link.send(errorMessage('serverError'));
    }
  });

  socket.on('close', () => {
    try {
      finish();
    } catch (error) {
      log(`Cleaning up a closed connection failed. ${describeError(error)}`);
    }
  });

  // Without a listener, an 'error' event (an oversized or broken frame, a
  // connection reset) would stop the whole server. The socket closes itself
  // afterwards and 'close' above does the cleaning up.
  socket.on('error', () => {});
}

/** The text of a frame. `ws` hands it over as bytes, in one piece or several. */
function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
