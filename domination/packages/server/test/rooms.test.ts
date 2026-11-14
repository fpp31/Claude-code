import type { ServerMessage } from '@domination/shared';
import { describe, expect, it } from 'vitest';
import type { ClientLink } from '../src/room';
import type { RoomFile } from '../src/roomFile';
import { RoomManager } from '../src/roomManager';
import type { Storage } from '../src/storage';
import { hashToken } from '../src/tokens';
import { createFakeRules } from './fakeRules';

/**
 * Room and RoomManager on their own, without sockets or disk: the small
 * questions other code asks them (which rooms exist, has the game started,
 * does this token have a seat, who is connected).
 */

/** A storage that keeps its files in memory. */
function memoryStorage(): Storage & { files: Map<string, RoomFile> } {
  const files = new Map<string, RoomFile>();
  return {
    files,
    loadAll: () => [...files.values()],
    has: (code) => files.has(code),
    save: (file) => void files.set(file.code, file),
    remove: (code) => void files.delete(code),
  };
}

/** A stand-in for a socket: it only remembers what it was sent. */
function fakeLink(): ClientLink & { sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  return { seq: 0, lastView: null, sent, send: (message) => void sent.push(message) };
}

function newManager(storage: Storage = memoryStorage()) {
  const logs: string[] = [];
  const manager = new RoomManager({
    rules: createFakeRules().rules,
    storage,
    newSeed: () => 'rooms-test-seed',
    sendPatches: true,
    log: (line) => void logs.push(line),
  });
  return { manager, logs };
}

const ADA = hashToken('a'.repeat(32));
const BEN = hashToken('b'.repeat(32));

describe('rooms without sockets (WP3)', () => {
  it('createRoom makes a room that can be found by its code; removeRoom forgets it and deletes its file', () => {
    const storage = memoryStorage();
    const { manager } = newManager(storage);
    expect(manager.roomCount).toBe(0);

    const created = manager.createRoom(fakeLink(), ADA, 'Ada');
    if (!created.ok) throw new Error('createRoom failed');
    const code = created.room.code;
    expect(manager.roomCount).toBe(1);
    expect(manager.findRoom(code)).toBe(created.room);
    expect(manager.findRoom('ZZZZZ')).toBeNull();
    expect(storage.files.has(code)).toBe(true);

    manager.removeRoom(code);
    expect(manager.roomCount).toBe(0);
    expect(manager.findRoom(code)).toBeNull();
    expect(storage.files.has(code)).toBe(false);
  });

  it('createRoom with a name that cleans to nothing makes no room', () => {
    const storage = memoryStorage();
    const { manager } = newManager(storage);
    const refused = manager.createRoom(fakeLink(), ADA, ' \n ');
    expect(refused).toMatchObject({ ok: false, code: 'badName' });
    expect(manager.roomCount).toBe(0);
    expect(storage.files.size).toBe(0);
  });

  it('a room knows whether it has started, which tokens have a seat, and who is connected', () => {
    const { manager } = newManager();
    const adaLink = fakeLink();
    const benLink = fakeLink();
    const created = manager.createRoom(adaLink, ADA, 'Ada');
    if (!created.ok) throw new Error('createRoom failed');
    const room = created.room;

    expect(room.started).toBe(false);
    expect(room.hasSeat(ADA)).toBe(true);
    expect(room.hasSeat(BEN)).toBe(false);
    expect(room.connectedPlayers()).toEqual(['p1']);

    expect(room.join(benLink, BEN, 'Ben')).toEqual({ ok: true });
    expect(room.hasSeat(BEN)).toBe(true);
    expect(room.connectedPlayers()).toEqual(['p1', 'p2']);

    expect(room.start(adaLink)).toEqual({ ok: true });
    expect(room.started).toBe(true);

    // Seat order, whatever order the sockets came and went in.
    room.detach(adaLink);
    expect(room.connectedPlayers()).toEqual(['p2']);
    room.detach(adaLink); // not attached any more: nothing happens
    expect(room.join(adaLink, ADA, null)).toEqual({ ok: true });
    expect(room.connectedPlayers()).toEqual(['p1', 'p2']);
    expect(room.hasSeat(ADA)).toBe(true);
  });

  it('a socket that attaches gets seq 0 and no last view; its first gameSync carries seq 1', () => {
    const { manager } = newManager();
    const link = fakeLink();
    // Leftovers from an earlier game on the same socket.
    link.seq = 41;
    const created = manager.createRoom(link, ADA, 'Ada');
    if (!created.ok) throw new Error('createRoom failed');
    expect(link.seq).toBe(0);
    expect(link.lastView).toBeNull();

    created.room.start(link);
    const sync = link.sent[link.sent.length - 1];
    expect(sync).toMatchObject({ type: 'gameSync', seq: 1 });
    expect(link.seq).toBe(1);
    expect(link.lastView).toEqual(sync.type === 'gameSync' ? sync.view : null);
  });

  it('restore makes a room for every saved game and returns their number', () => {
    const storage = memoryStorage();
    const first = newManager(storage);
    const lobby = first.manager.createRoom(fakeLink(), ADA, 'Ada');
    const game = first.manager.createRoom(fakeLink(), BEN, 'Ben');
    if (!lobby.ok || !game.ok) throw new Error('createRoom failed');
    const benLink = fakeLink();
    game.room.join(benLink, BEN, null);
    game.room.start(benLink);

    // A new manager on the same storage, as after a restart.
    const second = newManager(storage);
    expect(second.manager.restore()).toBe(2);
    expect(second.manager.roomCount).toBe(2);
    expect(second.manager.findRoom(lobby.room.code)?.started).toBe(false);
    expect(second.manager.findRoom(game.room.code)?.started).toBe(true);
    expect(second.manager.findRoom(game.room.code)?.hasSeat(BEN)).toBe(true);
    // Nobody is connected after a restart.
    expect(second.manager.findRoom(game.room.code)?.connectedPlayers()).toEqual([]);
  });
});
