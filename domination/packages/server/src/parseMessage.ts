/**
 * Checking untrusted input. Everything that arrives on a socket goes through
 * `parseClientMessage` before any other code looks at it.
 */

import type { ClientMessage } from '@domination/shared';

/**
 * Turns the text of one WebSocket frame into a ClientMessage, or returns
 * null if it is not exactly a well-formed message. Never throws.
 *
 * Hand-written checks, no schema library. For every message type: the value
 * is a JSON object, `type` is known, every field of that type is present
 * with the right JavaScript type, and there are no extra fields that matter.
 * In particular:
 *  - numbers are finite whole numbers (`protocol`, `requestId`, `turn`,
 *    every path entry) and not negative;
 *  - strings have sane lengths: `name` at most 200 characters (it is cleaned
 *    and cut to RULES.maxNameLength later), `code` at most 16, `token` at
 *    most 64, ids at most 32;
 *  - `civ` is one of CIV_IDS and `mapSize` one of MAP_SIZE_IDS;
 *  - `action.type` is one of the five action types with exactly its fields;
 *    `path` is an array of at most RULES.maxPathLength whole numbers;
 *    `item` is `{ kind: 'unit', unitType: <one of UNIT_TYPE_IDS> }`.
 *
 * The result is rebuilt field by field (never the parsed object itself), so
 * unexpected extra properties cannot travel further into the server.
 *
 * Whether a message makes sense right now (is there such a game, is it this
 * player's unit...) is NOT checked here; the room and the rules do that.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  throw new Error('not implemented: parseClientMessage');
}

/**
 * Cleans a player name: removes control characters, collapses runs of white
 * space into one space, trims, and cuts to RULES.maxNameLength characters.
 * Returns null if nothing is left. (Names are only ever shown through
 * textContent on the client, never as HTML.)
 */
export function cleanPlayerName(raw: string): string | null {
  throw new Error('not implemented: cleanPlayerName');
}
