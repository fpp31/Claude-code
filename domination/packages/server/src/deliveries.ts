/**
 * Messages that have been worked out but not sent yet.
 *
 * The commit rule (see room.ts) wants every message of a change to exist
 * BEFORE the change is saved, and to be sent only AFTER. A Delivery is such
 * a message, waiting.
 */

import type { GameCode, GameEvent, PlayerId, PlayerView, ServerMessage } from '@domination/shared';
import type { ClientLink } from './room';

export interface Delivery {
  link: ClientLink;
  message: ServerMessage;
  /**
   * Set for `gameSync` and `gameUpdate`: the view this socket has once the
   * message has arrived. It becomes the link's `lastView`.
   */
  view?: PlayerView;
}

/**
 * Sends one prepared message and, for a view message, updates the socket's
 * bookkeeping (`seq` and `lastView`). Cannot fail: `link.send` never throws.
 */
export function deliver(delivery: Delivery): void {
  const { link, message, view } = delivery;
  if ((message.type === 'gameSync' || message.type === 'gameUpdate') && view !== undefined) {
    link.seq = message.seq;
    link.lastView = view;
  }
  link.send(message);
}

/** A full view for one socket. `seq` is the number this message will carry. */
export function gameSyncDelivery(
  link: ClientLink,
  code: GameCode,
  seq: number,
  view: PlayerView,
  connected: PlayerId[],
  events: GameEvent[],
): Delivery {
  return { link, view, message: { type: 'gameSync', code, seq, view, connected, events } };
}
