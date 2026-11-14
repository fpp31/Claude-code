/**
 * Shared tools for the server tests (owned by WP3). Not a test file.
 *
 * Every test runs a REAL server (startServer) on a free port with a
 * temporary data folder and a temporary client folder of its own, and talks
 * to it with real WebSocket clients. Each test file ends every test with
 *
 *     afterEach(cleanUp);
 *
 * which closes every client and server opened through this module and
 * deletes the temporary folders, so nothing is left behind.
 *
 * How the clients keep tests honest: a TestClient hands out the messages it
 * received strictly IN ORDER, one per `next()`. A test therefore cannot
 * overlook a message it did not expect. `expectNothingPending()` proves that
 * nothing at all arrived: it sends a ping and insists that the very next
 * message is the pong. (The server handles one message completely before
 * the next, so anything it sent earlier would be in front of that pong.)
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, WS_PATH } from '@domination/shared';
import type {
  Action,
  ClientMessage,
  GameCode,
  LobbyView,
  PlayerView,
  ProtocolErrorCode,
  ServerMessage,
} from '@domination/shared';
import { applyViewPatch } from '@domination/shared';
import { expect } from 'vitest';
import WebSocket from 'ws';
import type { ServerConfig } from '../src/config';
import type { RoomFile } from '../src/roomFile';
import type { Rules } from '../src/rules';
import { startServer } from '../src/server';
import type { RunningServer } from '../src/server';
import { createStorage } from '../src/storage';
import type { Storage } from '../src/storage';

/** How long a test waits for a message before it gives up. Messages normally arrive within a few milliseconds. */
const WAIT_MS = 3000;

type MessageOfType<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

// ---------------------------------------------------------------------------
// Cleaning up
// ---------------------------------------------------------------------------

const openClients: TestClient[] = [];
const openServers: RunningServer[] = [];
const temporaryFolders: string[] = [];

/** Closes everything this module opened and deletes its temporary folders. Call it in afterEach. */
export async function cleanUp(): Promise<void> {
  for (const client of openClients.splice(0)) await client.close();
  for (const server of openServers.splice(0)) await server.close();
  for (const folder of temporaryFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
}

/** A new, empty temporary folder that cleanUp deletes. */
export function temporaryFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'domination-test-'));
  temporaryFolders.push(folder);
  return folder;
}

// ---------------------------------------------------------------------------
// The server under test
// ---------------------------------------------------------------------------

export interface TestServerOptions {
  /** The rules to run with. Default: the real ones. */
  rules?: Rules;
  /** Default: null (a random seed per game). */
  fixedSeed?: string | null;
  /** Default: true. */
  sendPatches?: boolean;
  /** Use this data folder instead of a new temporary one (restart tests). */
  dataDir?: string;
  /** Use this client folder instead of a new temporary one with a tiny index.html. */
  clientDir?: string;
  /** Wraps the real file storage, for example to make saving fail on command. */
  wrapStorage?: (real: Storage) => Storage;
  /**
   * Lifts the rate limit for tests whose scripted players send more than
   * MAX_MESSAGES_PER_SECOND messages within a second (whole games played in
   * a moment). Every other test runs with the real limit.
   */
  noRateLimit?: boolean;
}

export interface TestServer {
  port: number;
  dataDir: string;
  clientDir: string;
  /** Every line the server logged, in order. */
  logs: string[];
  /** Opens a socket WITHOUT saying hello. */
  open(): Promise<TestClient>;
  /** Opens a socket and says hello with this token (null = "first visit"). */
  connect(token?: string | null): Promise<TestClient>;
  /** Stops the server (cleanUp does it too). */
  close(): Promise<void>;
  /** The save file of a game as text, exactly as it is on disk. */
  saveText(code: GameCode): string;
  /** The save file of a game, parsed. */
  save(code: GameCode): RoomFile;
  /** Path of a game's save file. */
  savePath(code: GameCode): string;
}

/** A client folder with a tiny page of its own (tests never touch the real packages/client/dist). */
export function temporaryClientFolder(): string {
  const folder = temporaryFolder();
  writeFileSync(join(folder, 'index.html'), '<!doctype html><title>test page</title>');
  return folder;
}

export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const dataDir = options.dataDir ?? temporaryFolder();
  const clientDir = options.clientDir ?? temporaryClientFolder();
  const logs: string[] = [];
  const log = (line: string): void => {
    logs.push(line);
  };

  const config: ServerConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    clientDir,
    fixedSeed: options.fixedSeed ?? null,
    sendPatches: options.sendPatches ?? true,
  };
  const storage = options.wrapStorage?.(createStorage(dataDir, log));
  const maxMessagesPerSecond = options.noRateLimit ? Number.MAX_SAFE_INTEGER : undefined;
  const running = await startServer({ config, rules: options.rules, log, storage, maxMessagesPerSecond });
  openServers.push(running);

  const savePath = (code: GameCode): string => join(dataDir, 'rooms', `${code}.json`);
  const saveText = (code: GameCode): string => readFileSync(savePath(code), 'utf8');

  async function open(): Promise<TestClient> {
    const client = await TestClient.open(`ws://127.0.0.1:${running.port}${WS_PATH}`);
    openClients.push(client);
    return client;
  }

  async function connect(token: string | null = null): Promise<TestClient> {
    const client = await open();
    await client.hello(token);
    return client;
  }

  return {
    port: running.port,
    dataDir,
    clientDir,
    logs,
    open,
    connect,
    close: () => running.close(),
    saveText,
    save: (code) => JSON.parse(saveText(code)) as RoomFile,
    savePath,
  };
}

/** The switch and the counter of a `failingStorage`. */
export interface DiskControl {
  /** While true, every save throws. */
  failSaves: boolean;
  /** How many saves have succeeded. */
  saves: number;
}

export function newDiskControl(): DiskControl {
  return { failSaves: false, saves: 0 };
}

/** A storage that works like `real` (and counts its saves) until `control.failSaves` is switched on; then every save throws. */
export function failingStorage(real: Storage, control: DiskControl): Storage {
  return {
    loadAll: () => real.loadAll(),
    has: (code) => real.has(code),
    remove: (code) => real.remove(code),
    save(file) {
      if (control.failSaves) throw new Error('test: the disk is full');
      real.save(file);
      control.saves += 1;
    },
  };
}

// ---------------------------------------------------------------------------
// A WebSocket client that remembers everything
// ---------------------------------------------------------------------------

export class TestClient {
  /** Every frame received, as the exact text that came over the wire, in order. */
  readonly frames: string[] = [];
  /** The token the server answered `hello` with. */
  token = '';
  /** The last full view, kept up to date with every patch that passes through `next()`. */
  view: PlayerView | null = null;
  /** The `seq` of the last gameSync or gameUpdate that passed through `next()`. */
  seq = 0;

  private readonly socket: WebSocket;
  private readonly unread: ServerMessage[] = [];
  private waiting: ((message: ServerMessage | null) => void) | null = null;
  private closeCode: number | null = null;
  private closeWaiters: ((code: number) => void)[] = [];
  private nextRequestId = 1;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (data) => {
      const text = data.toString();
      this.frames.push(text);
      const message = JSON.parse(text) as ServerMessage;
      if (this.waiting !== null) {
        const resolve = this.waiting;
        this.waiting = null;
        resolve(message);
      } else {
        this.unread.push(message);
      }
    });
    socket.on('close', (code) => {
      this.closeCode = code;
      for (const resolve of this.closeWaiters.splice(0)) resolve(code);
      if (this.waiting !== null) {
        const resolve = this.waiting;
        this.waiting = null;
        resolve(null);
      }
    });
    socket.on('error', () => {
      // A refused or reset connection also ends in 'close'; tests look at that.
    });
  }

  static open(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const client = new TestClient(socket);
      socket.once('open', () => resolve(client));
      socket.once('error', reject);
    });
  }

  /** Sends a well-formed message. */
  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Sends anything at all: broken JSON, wrong shapes, binary data. */
  sendRaw(data: string | Buffer): void {
    this.socket.send(data);
  }

  /**
   * The next message, in the order the server sent them. Fails if none
   * arrives in time or the socket closes first. Views and `seq` are tracked
   * on the way: a gameUpdate must carry the previous seq plus one.
   */
  async next(): Promise<ServerMessage> {
    const message = this.unread.shift() ?? (await this.waitForMessage());
    if (message.type === 'gameSync') {
      this.view = message.view;
      this.seq = message.seq;
    }
    if (message.type === 'gameUpdate') {
      expect(message.seq, 'a gameUpdate carries the previous seq plus one').toBe(this.seq + 1);
      if (this.view === null) throw new Error('received a gameUpdate before any gameSync');
      this.view = applyViewPatch(this.view, message.patch);
      this.seq = message.seq;
    }
    return message;
  }

  private waitForMessage(): Promise<ServerMessage> {
    if (this.closeCode !== null) return Promise.reject(new Error('the socket is closed and no message is left'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new Error(`no message arrived within ${WAIT_MS} ms`));
      }, WAIT_MS);
      this.waiting = (message) => {
        clearTimeout(timer);
        if (message === null) reject(new Error('the socket closed while a message was awaited'));
        else resolve(message);
      };
    });
  }

  /** The next message, which must be of this type. */
  async nextOfType<T extends ServerMessage['type']>(type: T): Promise<MessageOfType<T>> {
    const message = await this.next();
    if (message.type !== type) {
      throw new Error(`expected a '${type}' message, got ${JSON.stringify(message).slice(0, 300)}`);
    }
    return message as MessageOfType<T>;
  }

  /** The next message must be an `error` with this code. */
  async expectError(code: ProtocolErrorCode): Promise<void> {
    const message = await this.nextOfType('error');
    expect(message.code).toBe(code);
  }

  /** Proves that no message is waiting and none is on its way (see the top of this file). */
  async expectNothingPending(): Promise<void> {
    this.send({ type: 'ping' });
    await this.nextOfType('pong');
  }

  /**
   * Reads everything that has been sent to this client so far and returns
   * it. (Sends a ping and reads up to its pong, like expectNothingPending.)
   */
  async drain(): Promise<ServerMessage[]> {
    this.send({ type: 'ping' });
    const messages: ServerMessage[] = [];
    for (;;) {
      const message = await this.next();
      if (message.type === 'pong') return messages;
      messages.push(message);
    }
  }

  /** Says hello and returns the token the server answered with. */
  async hello(token: string | null = null): Promise<string> {
    this.send({ type: 'hello', protocol: PROTOCOL_VERSION, token });
    this.token = (await this.nextOfType('welcome')).token;
    return this.token;
  }

  /** Creates a game and returns the lobby the creator is sent. */
  async createGame(name: string): Promise<LobbyView> {
    this.send({ type: 'createGame', name });
    return (await this.nextOfType('lobby')).lobby;
  }

  /** Joins (or comes back to) a game that is in the lobby and returns the lobby this client is sent. */
  async joinLobby(code: string, name: string | null): Promise<LobbyView> {
    this.send({ type: 'joinGame', code, name });
    return (await this.nextOfType('lobby')).lobby;
  }

  /** The next `lobby` message. */
  async nextLobby(): Promise<LobbyView> {
    return (await this.nextOfType('lobby')).lobby;
  }

  /**
   * Sends an action and reads on until its answer. Returns the answer and
   * every message that came before it (the actor's own gameUpdate, if any).
   */
  async act(turn: number, action: Action): Promise<{ reply: ServerMessage; before: ServerMessage[] }> {
    const requestId = this.sendAction(turn, action);
    return this.readReply(requestId);
  }

  /** Sends an action without waiting for anything; returns its requestId (for `readReply`). */
  sendAction(turn: number, action: Action): number {
    const requestId = this.nextRequestId++;
    this.send({ type: 'action', requestId, turn, action });
    return requestId;
  }

  /** Reads on until the answer to the action `requestId` (or a plain `error`). */
  async readReply(requestId: number): Promise<{ reply: ServerMessage; before: ServerMessage[] }> {
    const before: ServerMessage[] = [];
    for (;;) {
      const message = await this.next();
      const isAnswer =
        ((message.type === 'actionOk' || message.type === 'actionRejected') && message.requestId === requestId) ||
        message.type === 'error';
      if (isAnswer) return { reply: message, before };
      before.push(message);
    }
  }

  /** Sends an action that must be accepted; returns the messages that came before the actionOk. */
  async actOk(turn: number, action: Action): Promise<ServerMessage[]> {
    const { reply, before } = await this.act(turn, action);
    if (reply.type !== 'actionOk') throw new Error(`expected actionOk, got ${JSON.stringify(reply)}`);
    return before;
  }

  /** Sends an action that must be rejected; returns the error code. */
  async actRejected(turn: number, action: Action): Promise<string> {
    const { reply, before } = await this.act(turn, action);
    if (reply.type !== 'actionRejected') throw new Error(`expected actionRejected, got ${JSON.stringify(reply)}`);
    expect(before, 'a rejected action sends its actor nothing but the rejection').toEqual([]);
    return reply.error.code;
  }

  /** Resolves with the close code once the socket is closed (by either side). */
  waitForClose(): Promise<number> {
    if (this.closeCode !== null) return Promise.resolve(this.closeCode);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the socket was not closed within ${WAIT_MS} ms`)), WAIT_MS);
      this.closeWaiters.push((code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  /** Cuts the connection from this side, the way a lost network does (no goodbye), and waits until it is closed. */
  async close(): Promise<void> {
    if (this.closeCode !== null) return;
    const closed = new Promise<void>((resolve) => this.closeWaiters.push(() => resolve()));
    this.socket.terminate();
    await closed;
  }
}

// ---------------------------------------------------------------------------
// Getting to a lobby or a running game quickly
// ---------------------------------------------------------------------------

export interface Table {
  server: TestServer;
  code: GameCode;
  /** The players' sockets in seat order: clients[0] is the host on seat p1. */
  clients: TestClient[];
}

/**
 * A lobby with one player per name. Afterwards every client has read every
 * message it was sent (nothing is pending).
 */
export async function lobbyWith(server: TestServer, names: string[]): Promise<Table> {
  const clients: TestClient[] = [];
  const host = await server.connect();
  const { code } = await host.createGame(names[0]);
  clients.push(host);

  for (const name of names.slice(1)) {
    const client = await server.connect();
    await client.joinLobby(code, name);
    // Everybody who was already there is told about the newcomer.
    for (const earlier of clients) await earlier.nextLobby();
    clients.push(client);
  }
  return { server, code, clients };
}

/**
 * A running game with one player per name: the host has pressed Start and
 * every client has read its first gameSync (so `client.view` is set).
 */
export async function gameWith(server: TestServer, names: string[]): Promise<Table> {
  const table = await lobbyWith(server, names);
  table.clients[0].send({ type: 'startGame' });
  for (const client of table.clients) await client.nextOfType('gameSync');
  return table;
}
