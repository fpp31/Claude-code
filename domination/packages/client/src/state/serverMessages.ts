/**
 * What each server message does to the store (work package WP4).
 *
 * This module runs in the unit tests, in plain Node, where there is no
 * window, address bar or storage. It therefore never touches `location`,
 * `history`, localStorage or sessionStorage itself: it calls the functions
 * of net/identity.ts, which are safe to call anywhere.
 */

import type { ClientMessage, GameEvent, PlayerView, ServerMessage } from '@domination/shared';
import type { Store } from './store';

/**
 * Applies one message from the server. `send` is used for the rare replies
 * the protocol itself requires (only `resync`).
 *
 *  welcome         nothing. (The connection module has already stored the
 *                  token; see net/connection.ts.)
 *  lobby           lobby = message.lobby, game = null, joining = null; put
 *                  the code in the address bar (setGameCodeInUrl) and
 *                  remember it as the last game (saveLastGame).
 *  gameSync        game = { code, view, connected, seq, awaitingSync: false },
 *                  lobby = null, joining = null, busy = false; address bar
 *                  and last game as for `lobby`; re-validate the selection;
 *                  toast the events.
 *  gameUpdate      ignored completely while game.awaitingSync is set (or
 *                  there is no game). If message.seq !== game.seq + 1 (a
 *                  missed update): change nothing except awaitingSync =
 *                  true, and send `resync` (once: the flag stops repeats).
 *                  Otherwise view = applyViewPatch(view, patch), seq =
 *                  message.seq; re-validate the selection; toast the events.
 *  presence        game.connected = message.connected.
 *  actionOk        busy = false.
 *  actionRejected  busy = false; error toast with error.message.
 *  left            lobby = null, game = null, selection = null, joining =
 *                  null, busy = false; remove ?g= from the address bar.
 *  error           busy = false, joining = null; error toast with the
 *                  message, except:
 *                  'protocolMismatch': reloadPageOnce(); if it returns false
 *                  (already reloaded once) set fatalMessage instead;
 *                  'noSuchGame' also clears ?g= so the home screen shows;
 *                  'nameRequired' shows no toast (the home screen, with the
 *                  code already filled in, asks for the name).
 *  pong            nothing (the connection module tracks liveness).
 *
 * Why `busy` is cleared by gameSync and by every error: an action that fails
 * before it reaches a game is answered with a plain `error` (no requestId),
 * and a gameSync after a reconnect means the old action's answer will never
 * come (protocol.ts, point 5). When the server runs with patches turned off,
 * a gameSync caused by ANOTHER player can clear `busy` while this client's
 * own action is still on its way; that is harmless (the server handles
 * messages in order, and every view is complete).
 *
 * "Re-validate the selection": if the selected unit or city is no longer in
 * the view (or no longer the player's), selection = null.
 *
 * Events are cosmetic. The store must end up correct if every event is ignored.
 */
export function handleServerMessage(store: Store, message: ServerMessage, send: (message: ClientMessage) => void): void {
  throw new Error('not implemented: handleServerMessage');
}

/**
 * A short sentence for a toast, or null for events that need none
 * (for example 'unitMoved'): "Rome grew to 2.", "Warrior completed in Rome.",
 * "Turn 8 has begun.", "You founded Ostia.".
 */
export function describeEvent(event: GameEvent, view: PlayerView): string | null {
  throw new Error('not implemented: describeEvent');
}
