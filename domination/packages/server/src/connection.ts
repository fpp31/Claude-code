/**
 * One WebSocket connection: from raw text frames to calls on a Room.
 */

import type { WebSocket } from 'ws';
import type { RoomManager } from './roomManager';

/**
 * Takes over a freshly opened socket. Everything a socket can do goes
 * through here. It makes one ClientLink for the socket (room.ts) whose
 * `send` writes JSON to the socket and NEVER throws: if the socket is not
 * open any more the message is dropped.
 *
 *  - Every incoming frame is parsed with parseClientMessage. Not a valid
 *    message -> `error badMessage` (after 5 of those, close the socket).
 *  - More than MAX_MESSAGES_PER_SECOND messages in a second -> the extra
 *    ones are dropped with `error rateLimited`.
 *  - `hello` must come first; anything else before it -> `error notReady`.
 *    A wrong `protocol` -> `error protocolMismatch`, then close. Otherwise
 *    remember the token (make a new one with newToken if the client sent
 *    null or something that is not a valid token) and answer `welcome`.
 *    The token is kept only in memory, as its hash; never log it.
 *    A second `hello` on the same socket -> `error badMessage`.
 *  - `ping` -> `pong`.
 *
 *  - A socket is attached to at most ONE room, and this module remembers
 *    which. The ROOM is the authority, though: it may have dropped the link
 *    in the meantime (the seat was given up from another tab), and then
 *    answers 'notInGame'.
 *  - `joinGame`: normalise the code (normalizeGameCode); unknown code ->
 *    `error noSuchGame`. Then call room.join FIRST and look at the outcome:
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
 *    SERVER_SILENCE_TIMEOUT_MS is closed (any frame counts, valid or not).
 *    The limit is generous on purpose; see the note on liveness in
 *    shared/src/protocol.ts before changing it.
 *  - On close (for any reason): detach from the room and stop the timers.
 *
 * An exception while handling a message must never take the server down:
 * catch it, write it to `log`, and answer `error serverError` with
 * SERVER_ERROR_MESSAGE. Never put the exception's own text into a message
 * for a client (it may name things the player must not know about).
 */
export function handleConnection(socket: WebSocket, rooms: RoomManager, log: (line: string) => void): void {
  throw new Error('not implemented: handleConnection');
}
