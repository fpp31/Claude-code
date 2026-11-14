import { EventEmitter } from 'node:events';
import { PROTOCOL_VERSION, SERVER_ERROR_MESSAGE, SERVER_SILENCE_TIMEOUT_MS } from '@domination/shared';
import type { ServerMessage } from '@domination/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { MAX_BAD_MESSAGES, MAX_MESSAGES_PER_SECOND, MAX_SEND_BACKLOG_BYTES } from '../src/config';
import { handleConnection } from '../src/connection';
import type { RoomFile } from '../src/roomFile';
import { RoomManager } from '../src/roomManager';
import type { Storage } from '../src/storage';
import { CANARY, createFakeRules, fakeUnitId } from './fakeRules';
import { cleanUp, gameWith, lobbyWith, startTestServer } from './harness';

/**
 * Hostile and broken clients: nothing they send may stop the server, harm a
 * save file, or disturb the other players.
 *
 * Most tests use real sockets. The few that depend on the clock (150 seconds
 * of silence, "30 messages within one second") hand `handleConnection` a
 * stand-in socket instead, so they can be exact and take no time.
 */

afterEach(async () => {
  vi.useRealTimers();
  await cleanUp();
});

/** The few things handleConnection uses of a `ws` socket, with everything it does written down. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: ServerMessage[] = [];
  closedWith: number | null = null;
  terminated = false;

  send(text: string): void {
    this.sent.push(JSON.parse(text) as ServerMessage);
  }
  close(code: number): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closedWith = code;
    this.emit('close', code);
  }
  terminate(): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.terminated = true;
    this.emit('close', 1006);
  }
  /** A text frame arrives from the client. */
  receive(message: unknown): void {
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    this.emit('message', Buffer.from(text), false);
  }
  get isOpen(): boolean {
    return this.readyState === 1;
  }
}

/** A storage that keeps its files in memory. */
function memoryStorage(): Storage {
  const files = new Map<string, RoomFile>();
  return {
    loadAll: () => [...files.values()],
    has: (code) => files.has(code),
    save: (file) => void files.set(file.code, file),
    remove: (code) => void files.delete(code),
  };
}

/** A room manager with fake rules and no disk, plus a way to plug stand-in sockets into it. */
function standInServer() {
  const logs: string[] = [];
  const log = (line: string): void => void logs.push(line);
  const rooms = new RoomManager({
    rules: createFakeRules().rules,
    storage: memoryStorage(),
    newSeed: () => 'stand-in-seed',
    sendPatches: true,
    log,
  });
  function connect(): FakeSocket {
    const socket = new FakeSocket();
    handleConnection(socket as unknown as WebSocket, rooms, log);
    return socket;
  }
  return { rooms, logs, connect };
}

const HELLO = { type: 'hello', protocol: PROTOCOL_VERSION, token: null };

describe('hostile input (WP3)', () => {
  it('the fifth frame that is not a valid message closes the socket', async () => {
    const server = await startTestServer();
    const client = await server.connect();

    for (let i = 1; i <= MAX_BAD_MESSAGES; i++) {
      client.sendRaw(`garbage number ${i}`);
      await client.expectError('badMessage');
    }
    expect(await client.waitForClose()).toBe(1008); // "policy violation"

    // One fewer leaves the socket open.
    const careless = await server.connect();
    for (let i = 1; i < MAX_BAD_MESSAGES; i++) {
      careless.sendRaw('{"type":"action","requestId":-1}');
      await careless.expectError('badMessage');
    }
    await careless.expectNothingPending();
  });

  it('more than MAX_MESSAGES_PER_SECOND messages in a second: the extra ones are dropped with error rateLimited', () => {
    const { connect } = standInServer();
    const socket = connect();

    // 100 messages in the same instant: the hello and 99 pings.
    socket.receive(HELLO);
    for (let i = 0; i < 99; i++) socket.receive({ type: 'ping' });

    const types = socket.sent.map((message) => (message.type === 'error' ? message.code : message.type));
    expect(types.slice(0, MAX_MESSAGES_PER_SECOND)).toEqual(['welcome', ...Array(MAX_MESSAGES_PER_SECOND - 1).fill('pong')]);
    expect(types.slice(MAX_MESSAGES_PER_SECOND)).toEqual(Array(100 - MAX_MESSAGES_PER_SECOND).fill('rateLimited'));
    // Being rate limited is not a reason to be thrown out.
    expect(socket.isOpen).toBe(true);
  });

  it('a rate-limited action is dropped: it never reaches the rules and gets a plain error without a requestId', () => {
    const { rules, control } = createFakeRules();
    const rooms = new RoomManager({ rules, storage: memoryStorage(), newSeed: () => 's', sendPatches: true, log: () => {} });
    const socket = new FakeSocket();
    handleConnection(socket as unknown as WebSocket, rooms, () => {});

    socket.receive(HELLO);
    socket.receive({ type: 'createGame', name: 'Ada' });
    socket.receive({ type: 'startGame' });
    // 3 messages so far; the next MAX - 3 actions fit into this second, the rest do not.
    for (let i = 1; i <= MAX_MESSAGES_PER_SECOND; i++) {
      socket.receive({ type: 'action', requestId: i, turn: 1, action: { type: 'moveUnit', unitId: fakeUnitId('p1'), path: [i] } });
    }

    expect(control.actionCalls).toBe(MAX_MESSAGES_PER_SECOND - 3);
    const dropped = socket.sent.slice(-3);
    for (const message of dropped) {
      expect(message).toMatchObject({ type: 'error', code: 'rateLimited' });
      expect(message).not.toHaveProperty('requestId');
    }
  });

  it('a flood on a real socket is answered message by message, and one second later the socket works again', async () => {
    const server = await startTestServer();
    const client = await server.connect();

    const flood = 500;
    for (let i = 0; i < flood; i++) client.send({ type: 'ping' });

    let pongs = 0;
    let limited = 0;
    for (let i = 0; i < flood; i++) {
      const message = await client.next();
      if (message.type === 'pong') pongs += 1;
      else if (message.type === 'error' && message.code === 'rateLimited') limited += 1;
      else throw new Error(`unexpected answer to a ping: ${JSON.stringify(message)}`);
    }
    expect(pongs + limited).toBe(flood);
    expect(pongs).toBeGreaterThanOrEqual(MAX_MESSAGES_PER_SECOND - 1);
    expect(limited).toBeGreaterThan(0);

    // The limit is per second, not a ban.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await client.expectNothingPending();
  });

  it('a flood of actions and rubbish from one player harms neither the save nor the other players', async () => {
    const server = await startTestServer({ rules: createFakeRules().rules });
    const { code, clients } = await gameWith(server, ['Flooder', 'Bystander']);
    const [flooder, bystander] = clients;

    const total = 400;
    for (let i = 0; i < total; i++) {
      // A mix: moves of the own unit, moves of somebody else's unit, end turns, cancels.
      if (i % 4 === 0) flooder.sendAction(1, { type: 'moveUnit', unitId: fakeUnitId('p1'), path: [i % 100] });
      if (i % 4 === 1) flooder.sendAction(1, { type: 'moveUnit', unitId: fakeUnitId('p2'), path: [1] });
      if (i % 4 === 2) flooder.sendAction(1, { type: 'endTurn' });
      if (i % 4 === 3) flooder.sendAction(1, { type: 'cancelEndTurn' });
    }
    // Every action gets exactly one answer of some kind; count them off.
    // (An accepted action's own update always comes before its answer, so
    // after the last answer the flooder's view is up to date.)
    let answers = 0;
    let limited = 0;
    while (answers < total) {
      const message = await flooder.next();
      if (message.type === 'actionOk' || message.type === 'actionRejected' || message.type === 'error') answers += 1;
      if (message.type === 'error') {
        expect(message.code).toBe('rateLimited');
        limited += 1;
      }
    }
    expect(limited).toBeGreaterThan(0);

    // The save file is complete, valid JSON and matches what the flooder was last shown.
    const saved = server.save(code);
    expect(saved.game?.turn).toBe(1);
    const savedUnit = saved.game?.units[fakeUnitId('p1')];
    expect(savedUnit?.tile).toBe(flooder.view?.units[0].tile);
    // Nobody's unit but the flooder's own moved.
    expect(saved.game?.units[fakeUnitId('p2')].tile).toBe(0);

    // The bystander was told nothing but public facts: who has ended the turn.
    const told = await bystander.drain();
    expect(told.length).toBeGreaterThan(0);
    for (const message of told) {
      if (message.type !== 'gameUpdate') throw new Error(`unexpected message: ${JSON.stringify(message)}`);
      expect(Object.keys(message.patch)).toEqual(['players']);
      expect(message.events).toEqual([]);
    }
    expect(bystander.view?.units).toEqual([
      { id: fakeUnitId('p2'), type: 'warrior', owner: 'p2', tile: 0, own: { movesLeft: 2, foundCityError: 'cannotFoundCity' } },
    ]);
    // And the bystander can still play.
    expect(await bystander.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p2'), path: [7] })).toHaveLength(1);
  });

  it('a socket that stops reading is cut off instead of filling the memory', () => {
    const { connect } = standInServer();
    const socket = connect();
    socket.receive(HELLO);
    expect(socket.sent).toHaveLength(1);

    // The client has megabytes of answers waiting that it never reads.
    socket.bufferedAmount = MAX_SEND_BACKLOG_BYTES + 1;
    socket.receive({ type: 'ping' });

    expect(socket.terminated).toBe(true);
    expect(socket.sent).toHaveLength(1); // nothing more was queued
  });

  it('sending to a socket that is closing or closed is silently dropped', () => {
    const { connect } = standInServer();
    const host = connect();
    const guest = connect();
    host.receive(HELLO);
    host.receive({ type: 'createGame', name: 'Ada' });
    const lobby = host.sent[1];
    if (lobby.type !== 'lobby') throw new Error('expected a lobby');
    guest.receive(HELLO);
    guest.receive({ type: 'joinGame', code: lobby.lobby.code, name: 'Ben' });

    // The host's socket is on its way out, but the server has not heard the 'close' yet.
    host.readyState = 2;
    const before = host.sent.length;
    expect(() => guest.receive({ type: 'chooseCiv', civ: 'maya' })).not.toThrow();
    expect(host.sent).toHaveLength(before);
    // The change itself happened.
    expect(guest.sent[guest.sent.length - 1]).toMatchObject({ type: 'lobby' });
  });

  it('a socket that is silent for SERVER_SILENCE_TIMEOUT_MS is closed; any frame, valid or not, counts as a sign of life', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { connect } = standInServer();

    // Never says anything.
    const silent = connect();
    vi.advanceTimersByTime(SERVER_SILENCE_TIMEOUT_MS - 1);
    expect(silent.isOpen).toBe(true);
    vi.advanceTimersByTime(1);
    expect(silent.terminated).toBe(true);

    // Says something (rubbish, even) after 100 seconds: the 150 seconds start again from there.
    const chatty = connect();
    vi.advanceTimersByTime(100_000);
    chatty.receive('this is not a message');
    vi.advanceTimersByTime(SERVER_SILENCE_TIMEOUT_MS - 1);
    expect(chatty.isOpen).toBe(true);
    chatty.receive({ type: 'ping' });
    vi.advanceTimersByTime(SERVER_SILENCE_TIMEOUT_MS - 1);
    expect(chatty.isOpen).toBe(true);
    vi.advanceTimersByTime(1);
    expect(chatty.terminated).toBe(true);
  });

  it('a background tab that pings once a minute is never dropped', () => {
    // The rate limit reads the clock through `performance`, so that is faked here too.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { connect } = standInServer();
    const socket = connect();
    socket.receive(HELLO);
    for (let minute = 0; minute < 60; minute++) {
      vi.advanceTimersByTime(60_000);
      socket.receive({ type: 'ping' });
    }
    expect(socket.isOpen).toBe(true);
    expect(socket.sent.filter((message) => message.type === 'pong')).toHaveLength(60);
  });

  it('a socket dropped for silence leaves its room, and a closed socket leaves no timer behind', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { connect } = standInServer();
    const host = connect();
    const guest = connect();
    host.receive(HELLO);
    host.receive({ type: 'createGame', name: 'Ada' });
    const lobby = host.sent[1];
    if (lobby.type !== 'lobby') throw new Error('expected a lobby');
    guest.receive(HELLO);
    guest.receive({ type: 'joinGame', code: lobby.lobby.code, name: 'Ben' });

    // The guest keeps talking, the host falls silent.
    vi.advanceTimersByTime(SERVER_SILENCE_TIMEOUT_MS - 1000);
    guest.receive({ type: 'ping' });
    vi.advanceTimersByTime(1000);
    expect(host.terminated).toBe(true);
    expect(guest.isOpen).toBe(true);

    // The guest is told that the host is no longer connected.
    const last = guest.sent[guest.sent.length - 1];
    if (last.type !== 'lobby') throw new Error('expected a lobby');
    expect(last.lobby.seats.map((seat) => seat.connected)).toEqual([false, true]);

    guest.close(1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an exception while handling a message is logged, answered with serverError, and the socket stays usable', async () => {
    // A storage whose "is this code taken?" question blows up: an exception outside any room.
    const server = await startTestServer({
      rules: createFakeRules().rules,
      wrapStorage: (real) => ({
        ...real,
        has: () => {
          throw new Error(`disk on fire ${CANARY}`);
        },
      }),
    });
    const client = await server.connect();

    client.send({ type: 'createGame', name: 'Ada' });
    const answer = await client.nextOfType('error');
    expect(answer.code).toBe('serverError');
    expect(answer.message).toBe(SERVER_ERROR_MESSAGE);

    // The details went to the log, not to the client.
    expect(server.logs.join('\n')).toContain(CANARY);
    expect(client.frames.join('\n')).not.toContain(CANARY);
    expect(client.frames.join('\n')).not.toContain('disk on fire');

    await client.expectNothingPending();
  });

  it('the token is never written to the log', async () => {
    const server = await startTestServer({ rules: createFakeRules().rules });
    const { clients } = await lobbyWith(server, ['Ada', 'Ben']);
    clients[0].sendRaw('garbage');
    await clients[0].expectError('badMessage');
    clients[0].send({ type: 'startGame' });
    await clients[0].nextOfType('gameSync');

    const log = server.logs.join('\n');
    for (const client of clients) {
      expect(client.token).toMatch(/^[0-9a-f]{32}$/);
      expect(log).not.toContain(client.token);
    }
  });
});
