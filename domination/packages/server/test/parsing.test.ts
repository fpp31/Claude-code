import {
  CIV_IDS,
  GAME_CODE_ALPHABET,
  GAME_CODE_LENGTH,
  IMPROVEMENT_IDS,
  MAP_SIZE_IDS,
  PROTOCOL_VERSION,
  RULES,
  UNIT_TYPE_IDS,
} from '@domination/shared';
import type { BuildItem, ClientMessage } from '@domination/shared';
import { describe, expect, it } from 'vitest';
import { cleanPlayerName, parseClientMessage } from '../src/parseMessage';
import { hashToken, isValidToken, newGameCode, newSeed, newToken, normalizeGameCode } from '../src/tokens';

/**
 * Tokens, game codes and the checking of untrusted input: plain functions,
 * tested without a server.
 */

/** One valid example of every message type a client can send. */
const VALID_MESSAGES: ClientMessage[] = [
  { type: 'hello', protocol: PROTOCOL_VERSION, token: null },
  { type: 'hello', protocol: PROTOCOL_VERSION, token: '0123456789abcdef0123456789abcdef' },
  { type: 'createGame', name: 'Ada' },
  { type: 'joinGame', code: 'K7QXM', name: 'Ben' },
  { type: 'joinGame', code: 'k7qxm', name: null },
  { type: 'leaveGame' },
  { type: 'chooseCiv', civ: 'egypt' },
  { type: 'setMapSize', mapSize: 'large' },
  { type: 'startGame' },
  { type: 'action', requestId: 1, turn: 1, action: { type: 'moveUnit', unitId: 'u1_k7m2qd', path: [5, 6, 7] } },
  { type: 'action', requestId: 2, turn: 3, action: { type: 'foundCity', unitId: 'u1_x3fp9a' } },
  {
    type: 'action',
    requestId: 3,
    turn: 3,
    action: {
      type: 'setBuildQueue',
      cityId: 'c1_r6wz2e',
      queue: [{ kind: 'unit', unitType: 'settler' }, { kind: 'unit', unitType: 'worker' }],
    },
  },
  // An empty list is a message too: it stops the city.
  { type: 'action', requestId: 5, turn: 3, action: { type: 'setBuildQueue', cityId: 'c1_r6wz2e', queue: [] } },
  // One entry more than the rules allow is still a message: the rules answer it ('queueFull'), with its request id.
  {
    type: 'action',
    requestId: 6,
    turn: 3,
    action: { type: 'setBuildQueue', cityId: 'c1_r6wz2e', queue: queueOf(RULES.maxQueueLength + 1) },
  },
  { type: 'action', requestId: 7, turn: 4, action: { type: 'startJob', unitId: 'u1_m4wq7e', improvement: 'farm' } },
  { type: 'action', requestId: 8, turn: 4, action: { type: 'stopJob', unitId: 'u1_m4wq7e' } },
  { type: 'action', requestId: 4, turn: 9, action: { type: 'endTurn' } },
  { type: 'action', requestId: 0, turn: 0, action: { type: 'cancelEndTurn' } },
  { type: 'resync' },
  { type: 'ping' },
];

/** The longest build queue the message check lets through (MAX_QUEUE_INPUT_LENGTH in parseMessage.ts). */
const LONGEST_QUEUE_IN_A_MESSAGE = 64;

/** A build queue of `length` Warriors. (A function declaration, so the list above can use it.) */
function queueOf(length: number): BuildItem[] {
  return Array.from({ length }, (): BuildItem => ({ kind: 'unit', unitType: 'warrior' }));
}

/** The message as JSON text with one field changed (or, with `undefined`, removed). */
function withField(message: object, path: string[], value: unknown): string {
  const copy = JSON.parse(JSON.stringify(message));
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key];
  const last = path[path.length - 1];
  if (value === undefined) delete target[last];
  else target[last] = value;
  return JSON.stringify(copy);
}

const MOVE: ClientMessage = {
  type: 'action',
  requestId: 1,
  turn: 1,
  action: { type: 'moveUnit', unitId: 'u1_k7m2qd', path: [5] },
};
const QUEUE: ClientMessage = {
  type: 'action',
  requestId: 1,
  turn: 1,
  action: { type: 'setBuildQueue', cityId: 'c1_r6wz2e', queue: [{ kind: 'unit', unitType: 'warrior' }] },
};
const START_JOB: ClientMessage = {
  type: 'action',
  requestId: 1,
  turn: 1,
  action: { type: 'startJob', unitId: 'u1_m4wq7e', improvement: 'mine' },
};
const STOP_JOB: ClientMessage = {
  type: 'action',
  requestId: 1,
  turn: 1,
  action: { type: 'stopJob', unitId: 'u1_m4wq7e' },
};
/** What a phase 1 page would still send. The action no longer exists. */
const SET_PRODUCTION = {
  type: 'action',
  requestId: 1,
  turn: 1,
  action: { type: 'setProduction', cityId: 'c1_r6wz2e', item: { kind: 'unit', unitType: 'warrior' } },
};

describe('tokens, codes and parsing (WP3)', () => {
  it('newToken makes 32 hex characters, different every time; hashToken is stable and 64 hex characters', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const token = newToken();
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      expect(isValidToken(token)).toBe(true);
      tokens.add(token);
    }
    expect(tokens.size).toBe(200);

    const token = '0123456789abcdef0123456789abcdef';
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(hashToken('0123456789abcdef0123456789abcdee'));
    // The well-known SHA-256 of "abc": the hash is the standard one, not something home-made.
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('isValidToken accepts only exactly 32 lower-case hex characters', () => {
    expect(isValidToken('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isValidToken('0123456789ABCDEF0123456789ABCDEF')).toBe(false);
    expect(isValidToken('0123456789abcdef0123456789abcde')).toBe(false);
    expect(isValidToken('0123456789abcdef0123456789abcdef0')).toBe(false);
    expect(isValidToken('0123456789abcdef0123456789abcdeg')).toBe(false);
    expect(isValidToken('0123456789abcdef0123456789abcdef\n')).toBe(false);
    expect(isValidToken('')).toBe(false);
    expect(isValidToken(null)).toBe(false);
    expect(isValidToken(12345678901234567890123456789012)).toBe(false);
  });

  it('newSeed makes 32 hex characters, different every time', () => {
    expect(newSeed()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSeed()).not.toBe(newSeed());
  });

  it('newGameCode uses only GAME_CODE_ALPHABET, has GAME_CODE_LENGTH characters and avoids taken codes', () => {
    for (let i = 0; i < 200; i++) {
      const code = newGameCode(() => false);
      expect(code).toHaveLength(GAME_CODE_LENGTH);
      for (const character of code) expect(GAME_CODE_ALPHABET).toContain(character);
      expect(normalizeGameCode(code)).toBe(code);
    }

    // The first three codes drawn are "taken": the function must draw a fourth and return that one.
    const refused: string[] = [];
    const code = newGameCode((candidate) => {
      if (refused.length >= 3) return false;
      refused.push(candidate);
      return true;
    });
    expect(refused).toHaveLength(3);
    expect(refused).not.toContain(code);
  });

  it('normalizeGameCode trims and upper-cases, and rejects wrong lengths and characters', () => {
    expect(normalizeGameCode('K7QXM')).toBe('K7QXM');
    expect(normalizeGameCode('  k7qxm \n')).toBe('K7QXM');
    expect(normalizeGameCode('k7Qxm')).toBe('K7QXM');

    expect(normalizeGameCode('')).toBeNull();
    expect(normalizeGameCode('K7QX')).toBeNull();
    expect(normalizeGameCode('K7QXMM')).toBeNull();
    expect(normalizeGameCode('K7 XM')).toBeNull();
    // Look-alike characters are not in the alphabet.
    expect(normalizeGameCode('K7QX0')).toBeNull();
    expect(normalizeGameCode('K7QXO')).toBeNull();
    expect(normalizeGameCode('K7QX1')).toBeNull();
    expect(normalizeGameCode('K7QXI')).toBeNull();
    expect(normalizeGameCode('K7QXL')).toBeNull();
    // Nothing that could be part of a file path.
    expect(normalizeGameCode('../..')).toBeNull();
    expect(normalizeGameCode('K7/XM')).toBeNull();
    expect(normalizeGameCode('K7.XM')).toBeNull();
  });

  it('parseClientMessage accepts one valid example of every message type', () => {
    for (const message of VALID_MESSAGES) {
      expect(parseClientMessage(JSON.stringify(message)), JSON.stringify(message)).toEqual(message);
    }
    // Every type of the protocol is in the list above (the compiler checks the reverse).
    const types = new Set(VALID_MESSAGES.map((message) => message.type));
    expect([...types].sort()).toEqual(
      ['action', 'chooseCiv', 'createGame', 'hello', 'joinGame', 'leaveGame', 'ping', 'resync', 'setMapSize', 'startGame'],
    );
    // And every action type of the game (the compiler checks the reverse here too).
    const actionTypes = new Set(VALID_MESSAGES.flatMap((message) => (message.type === 'action' ? [message.action.type] : [])));
    expect([...actionTypes].sort()).toEqual(
      ['cancelEndTurn', 'endTurn', 'foundCity', 'moveUnit', 'setBuildQueue', 'startJob', 'stopJob'],
    );
    // Every id of the tables is accepted, and the longest allowed path.
    for (const civ of CIV_IDS) expect(parseClientMessage(JSON.stringify({ type: 'chooseCiv', civ }))).not.toBeNull();
    for (const mapSize of MAP_SIZE_IDS) {
      expect(parseClientMessage(JSON.stringify({ type: 'setMapSize', mapSize }))).not.toBeNull();
    }
    for (const unitType of UNIT_TYPE_IDS) {
      const text = withField(QUEUE, ['action', 'queue'], [{ kind: 'unit', unitType }]);
      expect(parseClientMessage(text), unitType).toEqual(JSON.parse(text));
    }
    for (const improvement of IMPROVEMENT_IDS) {
      const text = withField(START_JOB, ['action', 'improvement'], improvement);
      expect(parseClientMessage(text), improvement).toEqual(JSON.parse(text));
    }
    const longestPath = Array.from({ length: RULES.maxPathLength }, (_, i) => i);
    expect(parseClientMessage(withField(MOVE, ['action', 'path'], longestPath))).not.toBeNull();
    expect(parseClientMessage(withField(MOVE, ['action', 'path'], []))).not.toBeNull();
  });

  it('a build queue that is too long for the rules is still a message, up to 64 entries: whether it is too long is the rules\' answer', () => {
    // The limit of the message check lies well above the limit of the rules,
    // so that "too long" is answered by the rules, with a request id.
    expect(RULES.maxQueueLength).toBeLessThan(LONGEST_QUEUE_IN_A_MESSAGE);
    for (const length of [0, 1, RULES.maxQueueLength, RULES.maxQueueLength + 1, LONGEST_QUEUE_IN_A_MESSAGE]) {
      const text = withField(QUEUE, ['action', 'queue'], queueOf(length));
      const parsed = parseClientMessage(text);
      expect(parsed, `${length} entries`).toEqual(JSON.parse(text));
      if (parsed?.type !== 'action' || parsed.action.type !== 'setBuildQueue') throw new Error('not a setBuildQueue');
      // Every entry arrives, in its place: nothing is cut off to make the list fit.
      expect(parsed.action.queue).toHaveLength(length);
    }
    // Duplicates and any order are fine: the list is carried as it was sent.
    const mixed: BuildItem[] = (['worker', 'warrior', 'worker', 'settler', 'scout', 'warrior'] as const).map(
      (unitType): BuildItem => ({ kind: 'unit', unitType }),
    );
    const parsedMixed = parseClientMessage(withField(QUEUE, ['action', 'queue'], mixed));
    expect(parsedMixed).toMatchObject({ action: { queue: mixed } });
    // One more than that is not a message at all.
    expect(parseClientMessage(withField(QUEUE, ['action', 'queue'], queueOf(LONGEST_QUEUE_IN_A_MESSAGE + 1)))).toBeNull();
  });

  it('parseClientMessage returns null for bad JSON, unknown types, missing fields, wrong field types, negative or fractional numbers, over-long strings and over-long paths', () => {
    const bad: string[] = [
      // Not JSON, or not a JSON object.
      '',
      'hello',
      '{',
      '{"type":"ping"',
      'null',
      'true',
      '42',
      '"ping"',
      '[]',
      '[{"type":"ping"}]',
      // Unknown or missing type.
      '{}',
      '{"type":"shutdown"}',
      '{"type":"PING"}',
      '{"type":null}',
      '{"type":7}',
      '{"type":["ping"]}',
      '{"type":"constructor"}',
      '{"type":"__proto__"}',
      // hello
      withField({ type: 'hello', protocol: 1, token: null }, ['protocol'], undefined),
      withField({ type: 'hello', protocol: 1, token: null }, ['token'], undefined),
      withField({ type: 'hello', protocol: 1, token: null }, ['protocol'], '1'),
      withField({ type: 'hello', protocol: 1, token: null }, ['protocol'], 1.5),
      withField({ type: 'hello', protocol: 1, token: null }, ['protocol'], -1),
      withField({ type: 'hello', protocol: 1, token: null }, ['token'], 12345),
      withField({ type: 'hello', protocol: 1, token: null }, ['token'], 'x'.repeat(65)),
      // createGame / joinGame
      '{"type":"createGame"}',
      '{"type":"createGame","name":null}',
      '{"type":"createGame","name":["Ada"]}',
      JSON.stringify({ type: 'createGame', name: 'x'.repeat(201) }),
      '{"type":"joinGame","name":"Ben"}',
      '{"type":"joinGame","code":"K7QXM"}',
      '{"type":"joinGame","code":12345,"name":"Ben"}',
      '{"type":"joinGame","code":"K7QXM","name":5}',
      JSON.stringify({ type: 'joinGame', code: 'K'.repeat(17), name: 'Ben' }),
      JSON.stringify({ type: 'joinGame', code: 'K7QXM', name: 'x'.repeat(201) }),
      // chooseCiv / setMapSize
      '{"type":"chooseCiv"}',
      '{"type":"chooseCiv","civ":"atlantis"}',
      '{"type":"chooseCiv","civ":0}',
      '{"type":"chooseCiv","civ":"toString"}',
      '{"type":"setMapSize"}',
      '{"type":"setMapSize","mapSize":"huge"}',
      '{"type":"setMapSize","mapSize":["small"]}',
      // action: the envelope
      withField(MOVE, ['requestId'], undefined),
      withField(MOVE, ['turn'], undefined),
      withField(MOVE, ['action'], undefined),
      withField(MOVE, ['requestId'], '1'),
      withField(MOVE, ['requestId'], -1),
      withField(MOVE, ['requestId'], 0.5),
      withField(MOVE, ['turn'], -1),
      withField(MOVE, ['turn'], 1.5),
      withField(MOVE, ['turn'], null),
      withField(MOVE, ['action'], null),
      withField(MOVE, ['action'], 'endTurn'),
      withField(MOVE, ['action'], []),
      withField(MOVE, ['action'], {}),
      withField(MOVE, ['action'], { type: 'nuke' }),
      // Numbers too large to be exact, or not finite once parsed.
      '{"type":"action","requestId":1e999,"turn":1,"action":{"type":"endTurn"}}',
      '{"type":"action","requestId":1,"turn":1e30,"action":{"type":"endTurn"}}',
      // action: moveUnit
      withField(MOVE, ['action', 'unitId'], undefined),
      withField(MOVE, ['action', 'unitId'], 7),
      withField(MOVE, ['action', 'unitId'], 'u'.repeat(33)),
      withField(MOVE, ['action', 'path'], undefined),
      withField(MOVE, ['action', 'path'], 5),
      withField(MOVE, ['action', 'path'], '5'),
      withField(MOVE, ['action', 'path'], { 0: 5, length: 1 }),
      withField(MOVE, ['action', 'path'], [5, '6']),
      withField(MOVE, ['action', 'path'], [5, -6]),
      withField(MOVE, ['action', 'path'], [5, 6.5]),
      withField(MOVE, ['action', 'path'], [5, null]),
      withField(MOVE, ['action', 'path'], [[5]]),
      withField(MOVE, ['action', 'path'], Array.from({ length: RULES.maxPathLength + 1 }, (_, i) => i)),
      // action: foundCity
      '{"type":"action","requestId":1,"turn":1,"action":{"type":"foundCity"}}',
      '{"type":"action","requestId":1,"turn":1,"action":{"type":"foundCity","unitId":null}}',
      // action: setBuildQueue
      withField(QUEUE, ['action', 'cityId'], undefined),
      withField(QUEUE, ['action', 'cityId'], 7),
      withField(QUEUE, ['action', 'cityId'], null),
      withField(QUEUE, ['action', 'cityId'], 'c'.repeat(33)),
      withField(QUEUE, ['action', 'queue'], undefined),
      withField(QUEUE, ['action', 'queue'], null),
      withField(QUEUE, ['action', 'queue'], 'warrior'),
      withField(QUEUE, ['action', 'queue'], { kind: 'unit', unitType: 'warrior' }),
      withField(QUEUE, ['action', 'queue'], { 0: { kind: 'unit', unitType: 'warrior' }, length: 1 }),
      withField(QUEUE, ['action', 'queue'], 3),
      withField(QUEUE, ['action', 'queue'], queueOf(LONGEST_QUEUE_IN_A_MESSAGE + 1)),
      withField(QUEUE, ['action', 'queue'], [null]),
      withField(QUEUE, ['action', 'queue'], ['warrior']),
      withField(QUEUE, ['action', 'queue'], [[{ kind: 'unit', unitType: 'warrior' }]]),
      withField(QUEUE, ['action', 'queue'], [{ kind: 'unit' }]),
      withField(QUEUE, ['action', 'queue'], [{ unitType: 'warrior' }]),
      withField(QUEUE, ['action', 'queue'], [{ kind: 'building', unitType: 'warrior' }]),
      withField(QUEUE, ['action', 'queue'], [{ kind: 'unit', unitType: 'dragon' }]),
      withField(QUEUE, ['action', 'queue'], [{ kind: 'unit', unitType: 'Warrior' }]),
      withField(QUEUE, ['action', 'queue'], [{ kind: 'unit', unitType: ['warrior'] }]),
      withField(QUEUE, ['action', 'queue'], [{ kind: 'unit', unitType: 'toString' }]),
      // One bad entry spoils the list, wherever it stands.
      withField(QUEUE, ['action', 'queue'], [...queueOf(3), null]),
      withField(QUEUE, ['action', 'queue'], [...queueOf(3), { kind: 'unit', unitType: 'dragon' }, ...queueOf(2)]),
      // action: startJob
      withField(START_JOB, ['action', 'unitId'], undefined),
      withField(START_JOB, ['action', 'unitId'], 7),
      withField(START_JOB, ['action', 'unitId'], 'u'.repeat(33)),
      withField(START_JOB, ['action', 'improvement'], undefined),
      withField(START_JOB, ['action', 'improvement'], 'road'),
      withField(START_JOB, ['action', 'improvement'], 'Farm'),
      withField(START_JOB, ['action', 'improvement'], 'toString'),
      withField(START_JOB, ['action', 'improvement'], 0),
      withField(START_JOB, ['action', 'improvement'], null),
      withField(START_JOB, ['action', 'improvement'], ['farm']),
      withField(START_JOB, ['action', 'improvement'], { improvement: 'farm' }),
      // action: stopJob
      withField(STOP_JOB, ['action', 'unitId'], undefined),
      withField(STOP_JOB, ['action', 'unitId'], null),
      withField(STOP_JOB, ['action', 'unitId'], 'u'.repeat(33)),
      // action: setProduction, which phase 1 had. It no longer exists.
      JSON.stringify(SET_PRODUCTION),
      withField(SET_PRODUCTION, ['action', 'queue'], [{ kind: 'unit', unitType: 'warrior' }]),
    ];
    for (const text of bad) {
      expect(parseClientMessage(text), text.slice(0, 120)).toBeNull();
    }
  });

  it('parseClientMessage never throws, whatever it is given', () => {
    const nasty = [
      '\u0000',
      '{"type":"action","action":{"type":"moveUnit","unitId":{"toString":null},"path":[]},"requestId":1,"turn":1}',
      `{"type":"joinGame","code":"K7QXM","name":"${'x'.repeat(100_000)}"}`,
      `[${'['.repeat(5000)}${']'.repeat(5000)}]`,
      '{"__proto__":{"type":"ping"}}',
      '{"type":"action","requestId":1,"turn":1,"action":{"type":"setBuildQueue","cityId":"c1_a","queue":[{"kind":"unit","unitType":{"toString":null}}]}}',
      '{"type":"action","requestId":1,"turn":1,"action":{"type":"setBuildQueue","cityId":"c1_a","queue":[{"__proto__":{"kind":"unit","unitType":"warrior"}}]}}',
      '{"type":"action","requestId":1,"turn":1,"action":{"type":"setBuildQueue","cityId":"c1_a","queue":{"length":1e999}}}',
      '{"type":"action","requestId":1,"turn":1,"action":{"type":"startJob","unitId":"u1_a","improvement":{"valueOf":null}}}',
      `{"type":"action","requestId":1,"turn":1,"action":{"type":"setBuildQueue","cityId":"c1_a","queue":[${'{"kind":"unit","unitType":"warrior"},'.repeat(20_000)}null]}}`,
    ];
    for (const text of nasty) {
      expect(() => parseClientMessage(text)).not.toThrow();
      expect(parseClientMessage(text)).toBeNull();
    }
  });

  it('parseClientMessage drops unexpected extra properties', () => {
    const cases: [text: string, expected: ClientMessage][] = [
      ['{"type":"ping","playerId":"p1"}', { type: 'ping' }],
      ['{"type":"startGame","seed":"my-seed","force":true}', { type: 'startGame' }],
      [
        '{"type":"hello","protocol":1,"token":null,"tokenHash":"abc","admin":true}',
        { type: 'hello', protocol: 1, token: null },
      ],
      ['{"type":"createGame","name":"Ada","hostId":"p2","code":"AAAAA"}', { type: 'createGame', name: 'Ada' }],
      [
        '{"type":"action","requestId":1,"turn":2,"playerId":"p2","action":{"type":"moveUnit","unitId":"u1_a","path":[3],"owner":"p2","teleport":true}}',
        { type: 'action', requestId: 1, turn: 2, action: { type: 'moveUnit', unitId: 'u1_a', path: [3] } },
      ],
      [
        '{"type":"action","requestId":1,"turn":2,"action":{"type":"setBuildQueue","cityId":"c1_a","queue":[{"kind":"unit","unitType":"scout","cost":0,"turns":1},{"kind":"unit","unitType":"worker","free":true}],"free":true,"item":{"kind":"unit","unitType":"settler"},"productionStored":999}}',
        {
          type: 'action',
          requestId: 1,
          turn: 2,
          action: {
            type: 'setBuildQueue',
            cityId: 'c1_a',
            queue: [{ kind: 'unit', unitType: 'scout' }, { kind: 'unit', unitType: 'worker' }],
          },
        },
      ],
      [
        '{"type":"action","requestId":1,"turn":2,"action":{"type":"startJob","unitId":"u1_a","improvement":"farm","tile":77,"turnsWorked":3,"owner":"p2"}}',
        { type: 'action', requestId: 1, turn: 2, action: { type: 'startJob', unitId: 'u1_a', improvement: 'farm' } },
      ],
      [
        '{"type":"action","requestId":1,"turn":2,"action":{"type":"stopJob","unitId":"u1_a","improvement":"mine","keepProgress":true}}',
        { type: 'action', requestId: 1, turn: 2, action: { type: 'stopJob', unitId: 'u1_a' } },
      ],
      ['{"type":"action","requestId":1,"turn":2,"action":{"type":"endTurn","playerId":"p2"}}', {
        type: 'action',
        requestId: 1,
        turn: 2,
        action: { type: 'endTurn' },
      }],
    ];
    for (const [text, expected] of cases) {
      const parsed = parseClientMessage(text);
      // toStrictEqual: exactly these fields, no others.
      expect(parsed, text).toStrictEqual(expected);
    }
  });

  it('parseClientMessage does not let a "__proto__" property through', () => {
    const parsed = parseClientMessage('{"type":"ping","__proto__":{"admin":true}}');
    expect(parsed).toStrictEqual({ type: 'ping' });
    expect((parsed as unknown as Record<string, unknown>).admin).toBeUndefined();
    expect(Object.keys(parsed ?? {})).toEqual(['type']);
  });

  it('cleanPlayerName trims, removes control characters, limits the length and returns null for empty names', () => {
    expect(cleanPlayerName('Ada')).toBe('Ada');
    expect(cleanPlayerName('   Ada   ')).toBe('Ada');
    expect(cleanPlayerName('Ada \t\n  Lovelace')).toBe('Ada Lovelace');
    expect(cleanPlayerName('A\u0000d\u0007a\u001b')).toBe('Ada');
    expect(cleanPlayerName('Ada\u007f\u0085')).toBe('Ada');

    // Cut to the longest allowed name, and never ending in a space.
    const long = cleanPlayerName('x'.repeat(RULES.maxNameLength + 30));
    expect(long).toBe('x'.repeat(RULES.maxNameLength));
    const cutAtSpace = cleanPlayerName(`${'y'.repeat(RULES.maxNameLength - 1)} zzz`);
    expect(cutAtSpace).toBe('y'.repeat(RULES.maxNameLength - 1));

    // Nothing left: no name.
    expect(cleanPlayerName('')).toBeNull();
    expect(cleanPlayerName('    ')).toBeNull();
    expect(cleanPlayerName('\n\t\r')).toBeNull();
    expect(cleanPlayerName('\u0000\u0001\u0002')).toBeNull();

    // Markup is left alone on purpose: names are only ever shown as text.
    expect(cleanPlayerName('<b>Ada</b>')).toBe('<b>Ada</b>');
  });

  it('cleanPlayerName removes invisible and direction-reversing characters, and never cuts a character in half', () => {
    // Zero-width space, right-to-left override, byte-order mark: all invisible.
    expect(cleanPlayerName('A​d‮a﻿')).toBe('Ada');
    expect(cleanPlayerName('​‎‮')).toBeNull();
    // Half of a character pair (cannot be shown, and breaks some tools).
    expect(cleanPlayerName('Ada\ud83d')).toBe('Ada');
    // A name of emoji is cut between characters, not inside one.
    const emoji = cleanPlayerName('\u{1F600}'.repeat(RULES.maxNameLength + 5));
    expect(emoji).toBe('\u{1F600}'.repeat(RULES.maxNameLength));
    // Other alphabets are welcome.
    expect(cleanPlayerName('Zoë Müller')).toBe('Zoë Müller');
    expect(cleanPlayerName('アダ')).toBe('アダ');
  });
});
