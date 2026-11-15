/**
 * The wording of everything the server refuses, in one place.
 *
 * Programs and tests look at the CODE; the message is plain English for the
 * player and may be edited freely.
 */

import { SERVER_ERROR_MESSAGE } from '@domination/shared';
import type { ProtocolErrorCode, ServerMessage } from '@domination/shared';
import type { Failure } from './room';

export const PROTOCOL_ERROR_MESSAGES: Record<ProtocolErrorCode, string> = {
  protocolMismatch: 'This page is out of date. Please reload it.',
  badMessage: 'The server did not understand that message.',
  notReady: 'The connection is not ready yet.',
  noSuchGame: 'There is no game with that code.',
  gameNotLoaded: 'This game is on the server but could not be opened. Ask the person who runs the server.',
  nameRequired: 'Enter a name to join this game.',
  badName: 'Please enter a name.',
  gameFull: 'This game is full.',
  gameAlreadyStarted: 'This game has already started.',
  notInGame: 'You are not in a game where that is possible right now.',
  notHost: 'Only the host can do that.',
  civTaken: 'Another player already has that civilization.',
  rateLimited: 'Too many messages at once. Please slow down.',
  // The one sentence a client is ever told about an internal problem. Never the text of an exception.
  serverError: SERVER_ERROR_MESSAGE,
};

/** A refused lobby operation, with the standard message for its code. */
export function failure(code: ProtocolErrorCode): Failure {
  return { ok: false, code, message: PROTOCOL_ERROR_MESSAGES[code] };
}

/** The `error` message that tells a client about a refusal. */
export function errorMessage(code: ProtocolErrorCode): ServerMessage {
  return { type: 'error', code, message: PROTOCOL_ERROR_MESSAGES[code] };
}

/** What goes into the server log about a caught exception: everything, since only the server's owner reads it. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}
