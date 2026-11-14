import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_SCHEMA } from '@domination/shared';
import type { GameState } from '@domination/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOM_FILE_FORMAT } from '../src/roomFile';
import type { RoomFile } from '../src/roomFile';
import { serializeRoomFile } from '../src/roomFileText';
import { createStorage } from '../src/storage';
import type { WriteCall } from '../src/storage';
import { hashToken } from '../src/tokens';
import { createFakeRules } from './fakeRules';
import { cleanUp, startTestServer, temporaryFolder } from './harness';

/**
 * Saving and loading games on disk, tested on a real temporary folder.
 */

afterEach(cleanUp);

/** A storage on a fresh temporary folder, with its log lines collected. `write` plays the disk (see createStorage). */
function newStorage(dataDir = temporaryFolder(), write?: WriteCall) {
  const logs: string[] = [];
  const storage = createStorage(dataDir, (line) => logs.push(line), write);
  return { storage, logs, dataDir, roomsDir: join(dataDir, 'rooms') };
}

/** What a full disk answers: the error Node raises for "no space left on device". */
function noSpaceLeft(): Error {
  return Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
}

function lobbyFile(code: string, hostName = 'Ada'): RoomFile {
  return {
    format: ROOM_FILE_FORMAT,
    code,
    createdAt: '2026-01-02T03:04:05.000Z',
    hostId: 'p1',
    mapSize: 'medium',
    seats: [
      { playerId: 'p1', tokenHash: hashToken('a'.repeat(32)), name: hostName, civ: 'rome' },
      { playerId: 'p3', tokenHash: null, name: 'Cleo "the Great" \\ <b>', civ: 'china' },
    ],
    game: null,
  };
}

/** A room file with a started game in it (made by the fake rules; storage does not care what is inside). */
function startedFile(code: string): RoomFile {
  const file = lobbyFile(code);
  const game: GameState = createFakeRules().rules.createGame({
    seed: 'storage-test',
    settings: { mapSize: 'medium', turnMode: 'simultaneous' },
    players: file.seats.map((seat) => ({ id: seat.playerId, name: seat.name, civ: seat.civ })),
  });
  return { ...file, game };
}

describe('storage (WP3)', () => {
  it('save then loadAll returns a deep-equal room file', () => {
    const { storage, dataDir } = newStorage();
    const lobby = lobbyFile('AAAAA');
    const started = startedFile('BBBBB');
    storage.save(lobby);
    storage.save(started);

    // Loaded by a second storage on the same folder, as after a restart.
    const loaded = newStorage(dataDir).storage.loadAll();
    expect(loaded).toHaveLength(2);
    expect(loaded.find((file) => file.code === 'AAAAA')).toEqual(lobby);
    expect(loaded.find((file) => file.code === 'BBBBB')).toEqual(started);
  });

  it('the save file is plain JSON with the seats first, one per line (they are edited by hand)', () => {
    const file = startedFile('AAAAA');
    const text = serializeRoomFile(file);
    expect(JSON.parse(text)).toEqual(file);

    const lines = text.split('\n');
    const seatLines = lines.filter((line) => line.includes('"tokenHash"'));
    expect(seatLines).toHaveLength(2);
    expect(seatLines[1]).toContain('"tokenHash": null');
    // The seats come before the long line that holds the game state.
    const gameLine = lines.findIndex((line) => line.startsWith('  "game"'));
    expect(lines.findIndex((line) => line.includes('"tokenHash"'))).toBeLessThan(gameLine);
  });

  it('save leaves no .tmp file behind and replaces the previous save', () => {
    const { storage, roomsDir } = newStorage();
    storage.save(lobbyFile('AAAAA', 'First'));
    storage.save(lobbyFile('AAAAA', 'Second'));

    expect(readdirSync(roomsDir)).toEqual(['AAAAA.json']);
    const loaded = storage.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].seats[0].name).toBe('Second');
  });

  it('save never writes into the live file: a finished new file is renamed over it', () => {
    const { storage, roomsDir } = newStorage();
    const path = join(roomsDir, 'AAAAA.json');
    storage.save(lobbyFile('AAAAA', 'First'));
    const before = statSync(path).ino;
    storage.save(lobbyFile('AAAAA', 'Second'));

    // A file that was rewritten in place keeps its identity (inode number);
    // one that was replaced by a rename has a new one. Only the rename is
    // safe against a crash in the middle of the write.
    expect(statSync(path).ino).not.toBe(before);
    expect(JSON.parse(readFileSync(path, 'utf8')).seats[0].name).toBe('Second');
  });

  it('a save that fails throws, and the previous save is still there, untouched', () => {
    const { storage, roomsDir } = newStorage();
    storage.save(lobbyFile('AAAAA', 'First'));
    const before = readFileSync(join(roomsDir, 'AAAAA.json'), 'utf8');

    // A folder where the temporary file should go: the disk says no.
    mkdirSync(join(roomsDir, 'AAAAA.json.tmp'));
    expect(() => storage.save(lobbyFile('AAAAA', 'Second'))).toThrow();

    expect(readFileSync(join(roomsDir, 'AAAAA.json'), 'utf8')).toBe(before);
  });

  it('a disk that takes only the first part of the file: the save throws, the previous save is untouched, nothing is left behind', () => {
    // What a nearly full disk does: the first write call takes what still
    // fits and reports no error; only the next one says "no space left".
    const room = 100;
    let calls = 0;
    const nearlyFull: WriteCall = (handle, bytes, offset, length) => {
      calls++;
      if (calls > 1) throw noSpaceLeft();
      return writeSync(handle, bytes, offset, Math.min(length, room));
    };
    const dataDir = temporaryFolder();
    const { roomsDir } = newStorage(dataDir);
    newStorage(dataDir).storage.save(startedFile('AAAAA'));
    const before = readFileSync(join(roomsDir, 'AAAAA.json'), 'utf8');
    expect(before.length).toBeGreaterThan(room);

    const { storage } = newStorage(dataDir, nearlyFull);
    const next = { ...startedFile('AAAAA'), mapSize: 'large' as const };
    expect(() => storage.save(next)).toThrow(/ENOSPC/);

    expect(calls).toBe(2);
    expect(readFileSync(join(roomsDir, 'AAAAA.json'), 'utf8')).toBe(before);
    expect(readdirSync(roomsDir)).toEqual(['AAAAA.json']);
    // What a restart finds is the complete previous save.
    expect(newStorage(dataDir).storage.loadAll()).toEqual([startedFile('AAAAA')]);
  });

  it('a file the disk takes in small pieces is written completely', () => {
    const pieces: WriteCall = (handle, bytes, offset, length) => writeSync(handle, bytes, offset, Math.min(length, 7));
    const { storage, dataDir } = newStorage(temporaryFolder(), pieces);
    const file = startedFile('AAAAA');
    storage.save(file);

    expect(newStorage(dataDir).storage.loadAll()).toEqual([file]);
  });

  it('a file that is shorter than the save never replaces the previous save, whatever the disk reported', () => {
    // A disk that claims to have taken everything and kept only half of it.
    const lying: WriteCall = (handle, bytes, offset, length) => {
      writeSync(handle, bytes, offset, Math.floor(length / 2));
      return length;
    };
    const dataDir = temporaryFolder();
    const { roomsDir } = newStorage(dataDir);
    newStorage(dataDir).storage.save(lobbyFile('AAAAA', 'First'));
    const before = readFileSync(join(roomsDir, 'AAAAA.json'), 'utf8');

    expect(() => newStorage(dataDir, lying).storage.save(lobbyFile('AAAAA', 'Second'))).toThrow(/bytes long/);

    expect(readFileSync(join(roomsDir, 'AAAAA.json'), 'utf8')).toBe(before);
    expect(readdirSync(roomsDir)).toEqual(['AAAAA.json']);
  });

  it('save refuses a code that is not a game code (it becomes part of a file name)', () => {
    const { storage, dataDir } = newStorage();
    expect(() => storage.save({ ...lobbyFile('AAAAA'), code: '../../x' })).toThrow();
    expect(() => storage.has('../AAAAA')).toThrow();
    expect(() => storage.remove('..')).toThrow();
    expect(existsSync(join(dataDir, 'x.json'))).toBe(false);
  });

  it('loadAll creates the folders if they do not exist', () => {
    const dataDir = join(temporaryFolder(), 'not', 'there', 'yet');
    const { storage, roomsDir } = newStorage(dataDir);
    expect(storage.loadAll()).toEqual([]);
    expect(existsSync(roomsDir)).toBe(true);
  });

  it('loadAll deletes leftover .tmp files and still loads the real file', () => {
    const { storage, roomsDir } = newStorage();
    const file = lobbyFile('AAAAA');
    storage.save(file);
    // A crash in the middle of two saves: half a file next to a good one, and one with no good file at all.
    writeFileSync(join(roomsDir, 'AAAAA.json.tmp'), '{"format":1,"code":"AAAAA","sea');
    writeFileSync(join(roomsDir, 'BBBBB.json.tmp'), '{"format":1');

    expect(storage.loadAll()).toEqual([file]);
    expect(readdirSync(roomsDir)).toEqual(['AAAAA.json']);
  });

  it('loadAll moves an unreadable file aside as .corrupt, reports it, and loads the others', () => {
    const { storage, logs, roomsDir } = newStorage();
    const good = lobbyFile('AAAAA');
    storage.save(good);
    const broken: Record<string, string> = {
      'BBBBB.json': '{"format":1,"code":"BBBBB","seats":[{"playerId":"p1","tokenHash": nul',
      'CCCCC.json': '',
      'DDDDD.json': '[1,2,3]',
      // Readable JSON that is not a room: no seats.
      'EEEEE.json': JSON.stringify({ ...lobbyFile('EEEEE'), seats: [] }),
      // The code inside is another game's.
      'FFFFF.json': serializeRoomFile(lobbyFile('AAAAA')),
      // A hand-edit gone wrong: the hash was cut short instead of replaced by null.
      'GGGGG.json': serializeRoomFile(lobbyFile('GGGGG')).replace(hashToken('a'.repeat(32)), 'abc123'),
      'HHHHH.json': JSON.stringify({ ...lobbyFile('HHHHH'), hostId: 'p2' }),
      'JJJJJ.json': JSON.stringify({ ...lobbyFile('JJJJJ'), mapSize: 'gigantic' }),
    };
    for (const [name, text] of Object.entries(broken)) writeFileSync(join(roomsDir, name), text);

    expect(storage.loadAll()).toEqual([good]);

    const names = readdirSync(roomsDir).sort();
    expect(names).toEqual(['AAAAA.json', ...Object.keys(broken).map((name) => `${name}.corrupt`)].sort());
    for (const [name, text] of Object.entries(broken)) {
      // Moved aside, never deleted or changed.
      expect(readFileSync(join(roomsDir, `${name}.corrupt`), 'utf8')).toBe(text);
      expect(logs.some((line) => line.includes(name))).toBe(true);
    }
  });

  it('a save that an editor wrote back with a byte-order mark in front still loads, and the next save drops the mark', () => {
    const { storage, logs, roomsDir } = newStorage();
    const file = startedFile('AAAAA');
    const path = join(roomsDir, 'AAAAA.json');
    storage.loadAll(); // makes the folder
    writeFileSync(path, `\uFEFF${serializeRoomFile(file)}`);
    expect([...readFileSync(path).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    expect(storage.loadAll()).toEqual([file]);
    expect(logs).toEqual([]);
    expect(readdirSync(roomsDir)).toEqual(['AAAAA.json']);

    storage.save(file);
    expect(readFileSync(path)[0]).toBe('{'.charCodeAt(0));
  });

  it('a started game whose seats were edited so that they are no longer its players is moved aside with a sentence naming the seat', () => {
    const { storage, logs, roomsDir } = newStorage();
    const good = startedFile('AAAAA');
    storage.save(good);
    const hash = hashToken('a'.repeat(32));
    const text = (code: string) => serializeRoomFile(startedFile(code));
    const edited: Record<string, { text: string; says: string }> = {
      // A seat renamed: nobody can ever be that player, and the rules do not know p4.
      'BBBBB.json': { text: text('BBBBB').replace('"playerId": "p3"', '"playerId": "p4"'), says: 'seat p4' },
      // A seat's line deleted (an owner trying to remove an absent player): every turn would wait for p3.
      'CCCCC.json': { text: text('CCCCC').replace(/,\n {4}\{ "playerId": "p3".*\}/, ''), says: 'player p3' },
      // One player's hash pasted into another seat: the second seat can never be reached.
      'DDDDD.json': { text: text('DDDDD').replace('"tokenHash": null', `"tokenHash": "${hash}"`), says: 'seats p1 and p3' },
    };
    for (const [name, { text: content }] of Object.entries(edited)) {
      // Each edit really happened, and left a file that is still good JSON.
      expect(content).not.toBe(text(name.slice(0, 5)));
      expect(() => JSON.parse(content)).not.toThrow();
      writeFileSync(join(roomsDir, name), content);
    }

    expect(storage.loadAll()).toEqual([good]);

    for (const [name, { text: content, says }] of Object.entries(edited)) {
      expect(readFileSync(join(roomsDir, `${name}.corrupt`), 'utf8')).toBe(content);
      expect(logs.find((line) => line.includes(name))).toContain(says);
    }
    expect(readdirSync(roomsDir).sort()).toEqual(['AAAAA.json', ...Object.keys(edited).map((name) => `${name}.corrupt`)].sort());
  });

  it('the one edit the README describes, a tokenHash set to null, loads', () => {
    const { storage, logs, roomsDir } = newStorage();
    const file = startedFile('AAAAA');
    storage.loadAll();
    const hash = hashToken('a'.repeat(32));
    writeFileSync(join(roomsDir, 'AAAAA.json'), serializeRoomFile(file).replace(`"tokenHash": "${hash}"`, '"tokenHash": null'));

    const loaded = storage.loadAll();
    expect(loaded).toHaveLength(1);
    // Two seats without an owner are fine: null is not a secret two seats share.
    expect(loaded[0].seats.map((seat) => seat.tokenHash)).toEqual([null, null]);
    expect(logs).toEqual([]);
  });

  it('a second corrupt file with the same name does not overwrite the first', () => {
    const { storage, roomsDir } = newStorage();
    storage.loadAll();
    writeFileSync(join(roomsDir, 'AAAAA.json'), 'first wreck');
    storage.loadAll();
    writeFileSync(join(roomsDir, 'AAAAA.json'), 'second wreck');
    storage.loadAll();

    expect(readFileSync(join(roomsDir, 'AAAAA.json.corrupt'), 'utf8')).toBe('first wreck');
    expect(readFileSync(join(roomsDir, 'AAAAA.json.corrupt.2'), 'utf8')).toBe('second wreck');
  });

  it('loadAll leaves files alone that are not saves: notes, backups, names that are not codes', () => {
    const { storage, logs, roomsDir } = newStorage();
    storage.save(lobbyFile('AAAAA'));
    const others: Record<string, string> = {
      'readme.txt': 'my notes',
      'AAAAA copy.json': 'a backup made by hand',
      'aaaaa.json.bak': 'another one',
      'TOOLONG.json': '{}',
    };
    for (const [name, text] of Object.entries(others)) writeFileSync(join(roomsDir, name), text);

    expect(storage.loadAll()).toHaveLength(1);
    for (const [name, text] of Object.entries(others)) {
      expect(readFileSync(join(roomsDir, name), 'utf8')).toBe(text);
    }
    expect(logs.some((line) => line.includes('TOOLONG.json'))).toBe(true);
  });

  it('loadAll leaves a file with a newer format, or a game with another state schema, byte-identical on disk, reports it, and does not return it', () => {
    const { storage, logs, roomsDir } = newStorage();
    const good = lobbyFile('AAAAA');
    storage.save(good);

    const newerFormat = serializeRoomFile({ ...lobbyFile('BBBBB'), format: ROOM_FILE_FORMAT + 1 }).replace('"mapSize"', '"somethingNew": 1,\n  "mapSize"');
    const newerSchema = serializeRoomFile(startedFile('CCCCC')).replace(`"schema":${STATE_SCHEMA}`, `"schema":${STATE_SCHEMA + 1}`);
    const olderSchema = serializeRoomFile(startedFile('DDDDD')).replace(`"schema":${STATE_SCHEMA}`, `"schema":${STATE_SCHEMA - 1}`);
    // Each replacement really happened.
    expect(newerSchema).toContain(`"schema":${STATE_SCHEMA + 1}`);
    expect(olderSchema).toContain(`"schema":${STATE_SCHEMA - 1}`);
    // A game from a newer version that also has things this version does not know (a new civilization).
    const newerEverything = newerSchema.replace('"code": "CCCCC"', '"code": "EEEEE"').replace('"civ": "rome"', '"civ": "atlantis"');
    expect(newerEverything).toContain('atlantis');
    const otherVersions: Record<string, string> = {
      'BBBBB.json': newerFormat,
      'CCCCC.json': newerSchema,
      'DDDDD.json': olderSchema,
      'EEEEE.json': newerEverything,
    };
    for (const [name, text] of Object.entries(otherVersions)) writeFileSync(join(roomsDir, name), text);

    expect(storage.loadAll()).toEqual([good]);

    // Neither renamed nor changed.
    expect(readdirSync(roomsDir).sort()).toEqual(['AAAAA.json', 'BBBBB.json', 'CCCCC.json', 'DDDDD.json', 'EEEEE.json']);
    for (const [name, text] of Object.entries(otherVersions)) {
      expect(readFileSync(join(roomsDir, name), 'utf8')).toBe(text);
    }
    // Reported with the file name and both version numbers.
    const aboutFormat = logs.find((line) => line.includes('BBBBB.json'));
    expect(aboutFormat).toContain(String(ROOM_FILE_FORMAT + 1));
    expect(aboutFormat).toContain(String(ROOM_FILE_FORMAT));
    const aboutSchema = logs.find((line) => line.includes('CCCCC.json'));
    expect(aboutSchema).toContain(String(STATE_SCHEMA + 1));
    expect(aboutSchema).toContain(String(STATE_SCHEMA));
    expect(logs.some((line) => line.includes('DDDDD.json'))).toBe(true);
    expect(logs.some((line) => line.includes('EEEEE.json'))).toBe(true);
  });

  it('has is true for loaded and for skipped files, false for unknown codes; a new game never gets the code of a skipped file', async () => {
    const { storage, dataDir, roomsDir } = newStorage();
    storage.save(lobbyFile('AAAAA'));
    writeFileSync(join(roomsDir, 'BBBBB.json'), serializeRoomFile({ ...lobbyFile('BBBBB'), format: ROOM_FILE_FORMAT + 1 }));
    writeFileSync(join(roomsDir, 'CCCCC.json'), 'not a save at all');
    expect(storage.loadAll().map((file) => file.code)).toEqual(['AAAAA']);

    expect(storage.has('AAAAA')).toBe(true); // loaded
    expect(storage.has('BBBBB')).toBe(true); // skipped: another version
    expect(storage.has('CCCCC')).toBe(true); // moved aside as .corrupt: its code stays reserved
    expect(storage.has('DDDDD')).toBe(false);

    // A new game on a server whose random codes keep hitting files on disk:
    // the storage below claims that every code except one is taken.
    const server = await startTestServer({
      dataDir,
      rules: createFakeRules().rules,
      wrapStorage: (real) => ({ ...real, has: (code) => real.has(code) || !code.startsWith('Z') }),
    });
    const skippedBefore = readFileSync(join(roomsDir, 'BBBBB.json'), 'utf8');
    const creator = await server.connect();
    const lobby = await creator.createGame('Ada');
    // The code that was handed out is one the storage called free, never one it called taken.
    expect(lobby.code.startsWith('Z')).toBe(true);
    expect(readFileSync(join(roomsDir, 'BBBBB.json'), 'utf8')).toBe(skippedBefore);
  });

  it('remove deletes a save and does nothing if there is none', () => {
    const { storage, roomsDir } = newStorage();
    storage.save(lobbyFile('AAAAA'));
    storage.save(lobbyFile('BBBBB'));

    storage.remove('AAAAA');
    expect(readdirSync(roomsDir)).toEqual(['BBBBB.json']);
    expect(storage.has('AAAAA')).toBe(false);

    expect(() => storage.remove('AAAAA')).not.toThrow();
    expect(() => storage.remove('CCCCC')).not.toThrow();
    expect(readdirSync(roomsDir)).toEqual(['BBBBB.json']);
  });
});
