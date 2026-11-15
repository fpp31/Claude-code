/**
 * Checking untrusted input. Everything that arrives on a socket goes through
 * `parseClientMessage` before any other code looks at it.
 */

import { CIV_IDS, IMPROVEMENT_IDS, MAP_SIZE_IDS, RULES, UNIT_TYPE_IDS } from '@domination/shared';
import type { Action, BuildItem, ClientMessage } from '@domination/shared';

/** Longest strings accepted in a message (see parseClientMessage). */
const MAX_NAME_INPUT_LENGTH = 200;
const MAX_CODE_INPUT_LENGTH = 16;
const MAX_TOKEN_INPUT_LENGTH = 64;
const MAX_ID_LENGTH = 32;

/**
 * The longest build queue a message may carry. Far above RULES.maxQueueLength
 * on purpose: a list that is only too long for the rules is still a
 * message, and the rules answer it ('queueFull') with its request id. This
 * number only keeps absurd lists out, like the limits on strings.
 */
const MAX_QUEUE_INPUT_LENGTH = 64;

/** Any JSON object, before its fields have been checked. */
type Fields = Record<string, unknown>;

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
 *  - `action.type` is one of the seven action types with exactly its fields;
 *    `path` is an array of at most RULES.maxPathLength whole numbers;
 *    `queue` is an array of at most 64 entries, each
 *    `{ kind: 'unit', unitType: <one of UNIT_TYPE_IDS> }` (whether it is too
 *    long for the rules is the rules' answer); `improvement` is one of
 *    IMPROVEMENT_IDS.
 *
 * The result is rebuilt field by field (never the parsed object itself), so
 * unexpected extra properties cannot travel further into the server.
 *
 * Whether a message makes sense right now (is there such a game, is it this
 * player's unit...) is NOT checked here; the room and the rules do that.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(value)) return null;

  switch (value.type) {
    case 'hello': {
      const { protocol, token } = value;
      if (!isWholeNumber(protocol)) return null;
      if (token !== null && !isShortString(token, MAX_TOKEN_INPUT_LENGTH)) return null;
      return { type: 'hello', protocol, token };
    }
    case 'createGame': {
      const { name } = value;
      if (!isShortString(name, MAX_NAME_INPUT_LENGTH)) return null;
      return { type: 'createGame', name };
    }
    case 'joinGame': {
      const { code, name } = value;
      if (!isShortString(code, MAX_CODE_INPUT_LENGTH)) return null;
      if (name !== null && !isShortString(name, MAX_NAME_INPUT_LENGTH)) return null;
      return { type: 'joinGame', code, name };
    }
    case 'chooseCiv': {
      const civ = CIV_IDS.find((id) => id === value.civ);
      return civ === undefined ? null : { type: 'chooseCiv', civ };
    }
    case 'setMapSize': {
      const mapSize = MAP_SIZE_IDS.find((id) => id === value.mapSize);
      return mapSize === undefined ? null : { type: 'setMapSize', mapSize };
    }
    case 'action': {
      const { requestId, turn } = value;
      if (!isWholeNumber(requestId) || !isWholeNumber(turn)) return null;
      const action = parseAction(value.action);
      return action === null ? null : { type: 'action', requestId, turn, action };
    }
    case 'leaveGame':
      return { type: 'leaveGame' };
    case 'startGame':
      return { type: 'startGame' };
    case 'resync':
      return { type: 'resync' };
    case 'ping':
      return { type: 'ping' };
    default:
      return null;
  }
}

/** The `action` field of an `action` message, checked and rebuilt; null if it is not one of the action types. */
function parseAction(value: unknown): Action | null {
  if (!isObject(value)) return null;

  switch (value.type) {
    case 'moveUnit': {
      const { unitId, path } = value;
      if (!isShortString(unitId, MAX_ID_LENGTH)) return null;
      if (!Array.isArray(path) || path.length > RULES.maxPathLength) return null;
      const steps: number[] = [];
      for (const step of path) {
        if (!isWholeNumber(step)) return null;
        steps.push(step);
      }
      return { type: 'moveUnit', unitId, path: steps };
    }
    case 'foundCity': {
      const { unitId } = value;
      if (!isShortString(unitId, MAX_ID_LENGTH)) return null;
      return { type: 'foundCity', unitId };
    }
    case 'setBuildQueue': {
      const { cityId, queue } = value;
      if (!isShortString(cityId, MAX_ID_LENGTH)) return null;
      if (!Array.isArray(queue) || queue.length > MAX_QUEUE_INPUT_LENGTH) return null;
      const items: BuildItem[] = [];
      for (const entry of queue) {
        const item = parseBuildItem(entry);
        if (item === null) return null;
        items.push(item);
      }
      return { type: 'setBuildQueue', cityId, queue: items };
    }
    case 'startJob': {
      const { unitId } = value;
      if (!isShortString(unitId, MAX_ID_LENGTH)) return null;
      const improvement = IMPROVEMENT_IDS.find((id) => id === value.improvement);
      return improvement === undefined ? null : { type: 'startJob', unitId, improvement };
    }
    case 'stopJob': {
      const { unitId } = value;
      if (!isShortString(unitId, MAX_ID_LENGTH)) return null;
      return { type: 'stopJob', unitId };
    }
    case 'endTurn':
      return { type: 'endTurn' };
    case 'cancelEndTurn':
      return { type: 'cancelEndTurn' };
    default:
      return null;
  }
}

/** Something a city can build: in phase 1 only `{ kind: 'unit', unitType }`. */
function parseBuildItem(value: unknown): BuildItem | null {
  if (!isObject(value) || value.kind !== 'unit') return null;
  const unitType = UNIT_TYPE_IDS.find((id) => id === value.unitType);
  return unitType === undefined ? null : { kind: 'unit', unitType };
}

/** A JSON object (not null, not an array). */
function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A whole number that is not negative. Number.isSafeInteger also says no to
 * NaN, to infinity (JSON such as 1e999 parses to it) and to numbers so large
 * that they are no longer exact.
 */
function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A string of at most `maxLength` characters. */
function isShortString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

/**
 * Characters that must not appear in a name: control characters, invisible
 * "format" characters (zero-width characters and the marks that reverse the
 * writing direction, which could make a name look like somebody else's or
 * garble the text next to it) and broken halves of a character pair.
 */
const UNWANTED_IN_NAMES = /[\p{Cc}\p{Cf}\p{Cs}]/gu;

/**
 * Cleans a player name, in this order: every run of white space (tabs and
 * line breaks included) becomes one space; control characters, invisible
 * format characters and broken character halves are removed; the name is
 * trimmed and cut to RULES.maxNameLength whole characters. So 'Ada\tLovelace'
 * becomes 'Ada Lovelace', not 'AdaLovelace'.
 * Returns null if nothing is left. (Names are only ever shown through
 * textContent on the client, never as HTML.)
 */
export function cleanPlayerName(raw: string): string | null {
  // White space first, so that a tab or a line break between two words
  // becomes a space instead of gluing the words together.
  const spaced = raw.replace(/\s+/g, ' ');
  const visible = spaced.replace(UNWANTED_IN_NAMES, '').replace(/ +/g, ' ').trim();
  // Array.from counts whole characters, so an emoji is never cut in half.
  const cut = Array.from(visible).slice(0, RULES.maxNameLength).join('').trim();
  return cut === '' ? null : cut;
}
