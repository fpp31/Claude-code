import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_SCHEMA, UNITS, checkInvariants, createGame, migrateGameState } from '@domination/shared';
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
import {
  PHASE_ONE_CODE,
  phaseOneCities,
  phaseOneSave,
  phaseOneSaveText,
  phaseOneSaveTextWith,
  putPhaseOneSave,
} from './phaseOneSave';

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

/** A layout number no version of the game ever wrote, and so one that nobody can convert. */
const NO_SUCH_LAYOUT = 0;

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

  it('loadAll leaves a file with a newer format, or a game with another state schema that nobody can convert, byte-identical on disk, reports it, and does not return it', () => {
    const { storage, logs, roomsDir } = newStorage();
    const good = lobbyFile('AAAAA');
    storage.save(good);

    const newerFormat = serializeRoomFile({ ...lobbyFile('BBBBB'), format: ROOM_FILE_FORMAT + 1 }).replace('"mapSize"', '"somethingNew": 1,\n  "mapSize"');
    const newerSchema = serializeRoomFile(startedFile('CCCCC')).replace(`"schema":${STATE_SCHEMA}`, `"schema":${STATE_SCHEMA + 1}`);
    // Older than the oldest layout anybody can convert. (STATE_SCHEMA - 1 would
    // not do: that layout is brought up to date, see the tests further down.)
    const olderSchema = serializeRoomFile(startedFile('DDDDD')).replace(`"schema":${STATE_SCHEMA}`, `"schema":${NO_SUCH_LAYOUT}`);
    // Each replacement really happened.
    expect(newerSchema).toContain(`"schema":${STATE_SCHEMA + 1}`);
    expect(olderSchema).toContain(`"schema":${NO_SUCH_LAYOUT}`);
    expect(migrateGameState({ schema: NO_SUCH_LAYOUT })).toBeNull();
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
    const aboutOlder = logs.find((line) => line.includes('DDDDD.json'));
    expect(aboutOlder).toContain(`layout ${NO_SUCH_LAYOUT}`);
    expect(aboutOlder).toContain(`layout ${STATE_SCHEMA}`);
    expect(logs.some((line) => line.includes('EEEEE.json'))).toBe(true);
    // One line each, and none of them was called damaged.
    expect(logs).toHaveLength(4);
    expect(logs.every((line) => line.includes('left alone and NOT loaded'))).toBe(true);
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

/**
 * A game that an older version of the game saved. The save is a real one:
 * the room file the phase 1 server wrote (see phaseOneSave.ts). Its game
 * state has layout 1; this version plays layout STATE_SCHEMA.
 */
describe('storage: a game saved by an older version (WP3, the phase 1 save)', () => {
  /** A storage on a fresh data folder that holds the phase 1 save (or `text` in its place) as PHASE.json. */
  function storageWithPhaseOneSave(text: string = phaseOneSaveText()) {
    const made = newStorage();
    const path = putPhaseOneSave(made.dataDir, text);
    return { ...made, path, text };
  }

  /** The one game `loaded` holds, which must be a started one. */
  function onlyGameOf(loaded: RoomFile[]): GameState {
    expect(loaded).toHaveLength(1);
    const game = loaded[0].game;
    if (game === null) throw new Error('the loaded room has no game');
    return game;
  }

  it('the phase 1 save is what these tests take it for: layout 1, four players, turn 29, seats p1 and p3 have ended the turn', () => {
    const save = phaseOneSave();
    expect(save.code).toBe(PHASE_ONE_CODE);
    expect(save.format).toBe(ROOM_FILE_FORMAT);
    expect(save.game.schema).toBe(1);
    expect(save.game.schema).toBeLessThan(STATE_SCHEMA);
    expect(save.game.turn).toBe(29);
    expect(save.game.players.map((player) => [player.id, player.endedTurn])).toEqual([
      ['p1', true],
      ['p2', false],
      ['p3', true],
      ['p4', false],
    ]);

    // Layout 1: a city has one `production` and no queue; at least one city
    // was building something and had production stored for it.
    const cities = phaseOneCities();
    expect(cities.length).toBeGreaterThan(0);
    for (const city of cities) {
      expect(city).toHaveProperty('production');
      expect(city).not.toHaveProperty('buildQueue');
    }
    expect(cities.some((city) => city.production !== null && city.productionStored > 0)).toBe(true);

    // The envelope around the game did not change with the layout of the
    // game: today's writer gives the phase 1 file back byte for byte.
    expect(serializeRoomFile(save as unknown as RoomFile)).toBe(phaseOneSaveText());
  });

  it('a game of an older layout is brought up to date when it is loaded; the file itself stays byte-identical until the first save', () => {
    const { storage, logs, roomsDir, path, text } = storageWithPhaseOneSave();
    const before = phaseOneSave();

    const loaded = storage.loadAll();
    const game = onlyGameOf(loaded);
    expect(game.schema).toBe(STATE_SCHEMA);

    // Everything around the game is as it was: code, seats, host, map size.
    expect({ ...loaded[0], game: null }).toEqual({ ...before, game: null });

    // The game is what the shared package's migration makes of the old one, and it is healthy.
    expect(game).toEqual(migrateGameState(before.game));
    expect(checkInvariants(game)).toEqual([]);

    // In the save's own words: every city builds what it was building, with
    // the production it had stored, and has no `production` any more.
    const cities = phaseOneCities();
    expect(Object.keys(game.cities)).toEqual(cities.map((city) => city.id));
    for (const old of cities) {
      const city = game.cities[old.id];
      expect(city.buildQueue, old.name).toEqual(old.production === null ? [] : [old.production]);
      expect(city.productionStored, old.name).toBe(old.productionStored);
      expect(city, old.name).not.toHaveProperty('production');
    }
    // Nothing is built anywhere, nobody is at work, nobody remembers an improvement.
    expect(game.map.tiles).toHaveLength(before.game.map.tiles.length);
    expect(game.map.tiles.every((tile) => tile.improvement === null)).toBe(true);
    expect(Object.keys(game.units)).toEqual(Object.keys(before.game.units));
    expect(Object.values(game.units).every((unit) => unit.job === null)).toBe(true);
    for (const player of game.players) {
      const remembered = Object.values(player.knowledge.remembered);
      expect(remembered.length).toBeGreaterThan(0);
      expect(remembered.every((seen) => seen.improvement === null)).toBe(true);
    }
    // And the game goes on in the middle of the turn it was saved in.
    expect(game.turn).toBe(before.game.turn);
    expect(game.players.map((player) => player.endedTurn)).toEqual(before.game.players.map((player) => player.endedTurn));

    // The file was not rewritten, not moved, and no copy of it was made.
    expect(readFileSync(path).equals(Buffer.from(text, 'utf8'))).toBe(true);
    expect(readdirSync(roomsDir)).toEqual([`${PHASE_ONE_CODE}.json`]);

    // One log line, naming the file and both layout numbers.
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(`${PHASE_ONE_CODE}.json`);
    expect(logs[0]).toContain(`layout ${before.game.schema}`);
    expect(logs[0]).toContain(`layout ${STATE_SCHEMA}`);
    expect(logs[0]).not.toContain('NOT loaded');
  });

  it('the first save after that writes the new layout', () => {
    const { storage, dataDir, roomsDir, path, text } = storageWithPhaseOneSave();
    const loaded = storage.loadAll();
    onlyGameOf(loaded);

    storage.save(loaded[0]);

    const written = readFileSync(path, 'utf8');
    expect(written).not.toBe(text);
    expect(written).toContain(`"schema":${STATE_SCHEMA}`);
    expect(written).not.toMatch(new RegExp(`"schema":${phaseOneSave().game.schema}\\b`));
    expect(written).toContain('"buildQueue":');
    expect(written).not.toContain('"production":');
    expect(text).toContain('"production":');
    expect(JSON.parse(written)).toEqual(loaded[0]);
    // The lines a person edits by hand (the seats above all) are as phase 1 wrote them.
    const upToTheGame = (save: string): string => save.slice(0, save.indexOf('  "game"'));
    expect(upToTheGame(written)).toBe(upToTheGame(text));
    // The old file was replaced; nothing is kept of it.
    expect(readdirSync(roomsDir)).toEqual([`${PHASE_ONE_CODE}.json`]);

    // A restart now finds an ordinary save of today: the same game, and nothing to report.
    const afterRestart = newStorage(dataDir);
    expect(afterRestart.storage.loadAll()).toEqual(loaded);
    expect(afterRestart.logs).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe(written);
  });

  it('loading twice before any save gives the same game', () => {
    const { storage, logs, dataDir, path, text } = storageWithPhaseOneSave();

    const first = storage.loadAll();
    const second = storage.loadAll();
    const afterRestart = newStorage(dataDir).storage.loadAll();
    onlyGameOf(first);

    expect(second).toEqual(first);
    expect(afterRestart).toEqual(first);
    // As text too: not even the order of the fields differs.
    expect(serializeRoomFile(second[0])).toBe(serializeRoomFile(first[0]));
    expect(serializeRoomFile(afterRestart[0])).toBe(serializeRoomFile(first[0]));
    // Each load makes a game of its own: changing one cannot reach another.
    expect(second[0].game).not.toBe(first[0].game);

    // Still the file phase 1 wrote, and each load said that it converted it.
    expect(readFileSync(path, 'utf8')).toBe(text);
    expect(logs).toHaveLength(2);
    expect(logs[1]).toBe(logs[0]);
  });

  it('a game whose older layout cannot be converted is left exactly as it is, reported, and not loaded', () => {
    const damaged: [what: string, text: string, says: string][] = [
      // The phase 1 save with its game's cities taken out.
      ['no cities', phaseOneSaveTextWith((game) => void delete game.cities), 'cities is not an object'],
      ['a tile that is no tile', phaseOneSaveTextWith((game) => void (game.map.tiles[3] = null as never)), 'tile 3 is not an object'],
      ['players that are no list', phaseOneSaveTextWith((game) => void (game.players = {} as never)), 'is not a list'],
    ];
    for (const [what, text, says] of damaged) {
      // The damage really is in the file, which is still good JSON and still says layout 1.
      expect(text, what).not.toBe(phaseOneSaveText());
      expect(JSON.parse(text).game.schema, what).toBe(phaseOneSave().game.schema);
      const { storage, logs, roomsDir, path } = storageWithPhaseOneSave(text);

      expect(storage.loadAll(), what).toEqual([]);

      // Neither changed nor moved aside as damaged: the right version of the game may still read it.
      expect(readFileSync(path, 'utf8'), what).toBe(text);
      expect(readdirSync(roomsDir), what).toEqual([`${PHASE_ONE_CODE}.json`]);
      expect(storage.has(PHASE_ONE_CODE), what).toBe(true);

      // Reported once: the file, both layout numbers, and what was wrong.
      expect(logs, what).toHaveLength(1);
      expect(logs[0]).toContain(`${PHASE_ONE_CODE}.json`);
      expect(logs[0]).toContain('left alone and NOT loaded');
      expect(logs[0]).toContain(`layout ${phaseOneSave().game.schema}`);
      expect(logs[0]).toContain(`layout ${STATE_SCHEMA}`);
      expect(logs[0], what).toContain(says);
    }
  });

  it('a game that converts into an unhealthy state is left exactly as it is, reported with its first problem, and not loaded; its code stays reserved', async () => {
    const unhealthy: [what: string, text: string][] = [
      // The phase 1 save with one unit put on a tile that is not on the map.
      [
        'a unit off the map',
        phaseOneSaveTextWith((game) => {
          const unit = Object.values(game.units)[0];
          unit.tile = game.map.tiles.length + 5;
        }),
      ],
      // A city that was building something this version does not know.
      [
        'a city building a dragon',
        phaseOneSaveTextWith((game) => {
          const city = Object.values(game.cities ?? {})[0];
          city.production = { kind: 'unit', unitType: 'dragon' as never };
        }),
      ],
    ];
    for (const [what, text] of unhealthy) {
      // The conversion itself goes through; it is the game that comes out of it that is not well.
      const converted = migrateGameState(JSON.parse(text).game);
      if (converted === null) throw new Error(`${what}: the save was not converted`);
      const problems = checkInvariants(converted);
      expect(problems.length, what).toBeGreaterThan(0);

      const { storage, logs, dataDir, roomsDir, path } = storageWithPhaseOneSave(text);
      expect(storage.loadAll(), what).toEqual([]);

      // Not rewritten (the first save would put the unhealthy game over what
      // phase 1 wrote), and not moved aside either.
      expect(readFileSync(path, 'utf8'), what).toBe(text);
      expect(readdirSync(roomsDir), what).toEqual([`${PHASE_ONE_CODE}.json`]);

      expect(logs, what).toHaveLength(1);
      expect(logs[0]).toContain(`${PHASE_ONE_CODE}.json`);
      expect(logs[0]).toContain('left alone and NOT loaded');
      expect(logs[0]).toContain(`layout ${phaseOneSave().game.schema}`);
      expect(logs[0]).toContain(`layout ${STATE_SCHEMA}`);
      expect(logs[0], what).toContain(`${problems.length} problem(s)`);
      expect(logs[0], what).toContain(problems[0]);

      // Its code stays reserved: no new game is ever saved over the file.
      expect(storage.has(PHASE_ONE_CODE), what).toBe(true);

      // A server on that folder starts without the game, and still does not touch the file.
      const server = await startTestServer({ dataDir });
      expect(server.logs).toContain('Saved games loaded: 0.');
      const ada = await server.connect('a'.repeat(32));
      ada.send({ type: 'joinGame', code: PHASE_ONE_CODE, name: null });
      await ada.expectError('gameNotLoaded');
      await ada.createGame('Ada');
      expect(readFileSync(path, 'utf8'), what).toBe(text);
      expect(readdirSync(roomsDir).sort(), what).toHaveLength(2);
      await cleanUp();
    }
  });

  /** What the log line of a converted save that is not healthy ends with: what to do, and that nothing was lost. */
  const REMEDY =
    'If you changed numbers in packages/shared/src/data, make the same change again and restart. The file has not been touched.';

  /** The phase 1 save with its first `count` Scouts given one move more than the table of this version allows. */
  function saveWithFastScouts(count: number): string {
    return phaseOneSaveTextWith((game) => {
      const scouts = Object.values(game.units).filter((unit) => unit.type === 'scout');
      expect(scouts.length).toBeGreaterThanOrEqual(count);
      for (const scout of scouts.slice(0, count)) scout.movesLeft = UNITS.scout.moves + 1;
    });
  }

  it('a phase 1 game played with tuned numbers (a Scout with one move more than the table allows) is not loaded, the log line ends with what to do, and the file is byte for byte unchanged', () => {
    const text = saveWithFastScouts(1);
    const converted = migrateGameState(JSON.parse(text).game);
    if (converted === null) throw new Error('the save was not converted');
    const problems = checkInvariants(converted);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`has ${UNITS.scout.moves + 1} moves left, expected 0 to ${UNITS.scout.moves}.`);

    const { storage, logs, roomsDir, path } = storageWithPhaseOneSave(text);
    expect(storage.loadAll()).toEqual([]);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(`${PHASE_ONE_CODE}.json was left alone and NOT loaded.`);
    expect(logs[0]).toContain(`1 problem(s): ${problems[0]} `);
    expect(logs[0].endsWith(REMEDY)).toBe(true);

    // Nothing is lost: the file is where it was, with every byte phase 1 wrote, and its code stays reserved.
    expect(readFileSync(path).equals(Buffer.from(text, 'utf8'))).toBe(true);
    expect(readdirSync(roomsDir)).toEqual([`${PHASE_ONE_CODE}.json`]);
    expect(storage.has(PHASE_ONE_CODE)).toBe(true);
  });

  it('the log line of a converted save that is not healthy names up to three problems: two of two, and the first three of five', () => {
    for (const count of [2, 5]) {
      const text = saveWithFastScouts(count);
      const converted = migrateGameState(JSON.parse(text).game);
      if (converted === null) throw new Error('the save was not converted');
      const problems = checkInvariants(converted);
      expect(problems, `${count} Scouts`).toHaveLength(count);
      expect(new Set(problems).size).toBe(count);

      const { storage, logs, path } = storageWithPhaseOneSave(text);
      expect(storage.loadAll(), `${count} Scouts`).toEqual([]);
      expect(logs, `${count} Scouts`).toHaveLength(1);
      const named = problems.slice(0, 3);
      const intro = count <= 3 ? `${count} problem(s): ` : `${count} problem(s), the first 3: `;
      expect(logs[0], `${count} Scouts`).toContain(`${intro}${named.join(' ')} ${REMEDY}`);
      for (const problem of problems.slice(3)) expect(logs[0], `${count} Scouts`).not.toContain(problem);
      expect(logs[0].endsWith(REMEDY)).toBe(true);
      expect(readFileSync(path).equals(Buffer.from(text, 'utf8'))).toBe(true);
    }
  });

  it('a layout number that is not a whole number (1.5) is no layout number: the save is moved aside as damaged, byte for byte', () => {
    const text = phaseOneSaveTextWith((game) => {
      game.schema = 1.5;
    });
    expect(JSON.parse(text).game.schema).toBe(1.5);
    const { storage, logs, roomsDir, path } = storageWithPhaseOneSave(text);

    expect(storage.loadAll()).toEqual([]);

    // Not "another version" (no version writes such a number): damaged, and moved aside like every damaged save.
    expect(readdirSync(roomsDir)).toEqual([`${PHASE_ONE_CODE}.json.corrupt`]);
    expect(readFileSync(`${path}.corrupt`).equals(Buffer.from(text, 'utf8'))).toBe(true);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(`${PHASE_ONE_CODE}.json is damaged (the game state has no layout number).`);
    expect(logs[0]).toContain('moved aside');
    expect(logs[0]).not.toContain('left alone');
    expect(storage.has(PHASE_ONE_CODE)).toBe(true);
  });

  it('a layout older than the oldest one this version can convert (0) is left alone, byte for byte, with "Run the matching version"', () => {
    const text = phaseOneSaveTextWith((game) => {
      game.schema = 0;
    });
    expect(JSON.parse(text).game.schema).toBe(0);
    expect(migrateGameState(JSON.parse(text).game)).toBeNull();
    const { storage, logs, roomsDir, path } = storageWithPhaseOneSave(text);

    expect(storage.loadAll()).toEqual([]);

    expect(readdirSync(roomsDir)).toEqual([`${PHASE_ONE_CODE}.json`]);
    expect(readFileSync(path).equals(Buffer.from(text, 'utf8'))).toBe(true);
    // The whole sentence: nothing was converted and nothing was checked, so it speaks of no "problem".
    expect(logs).toEqual([
      `Saved games: ${PHASE_ONE_CODE}.json was left alone and NOT loaded. Its game state has layout 0, ` +
        `this version of the game plays layout ${STATE_SCHEMA}. Run the matching version to play it.`,
    ]);
    expect(storage.has(PHASE_ONE_CODE)).toBe(true);
  });

  it('an older save that was edited by hand: a tokenHash set to null loads and is converted; a seat renamed by mistake is moved aside as damaged, byte for byte', () => {
    // The one edit the README describes, made in a save of the older version.
    const hash = hashToken('a'.repeat(32));
    const freed = phaseOneSaveText().replace(`"tokenHash": "${hash}"`, '"tokenHash": null');
    expect(freed).not.toBe(phaseOneSaveText());
    const good = storageWithPhaseOneSave(freed);
    const loaded = good.storage.loadAll();
    expect(onlyGameOf(loaded).schema).toBe(STATE_SCHEMA);
    expect(loaded[0].seats.map((seat) => seat.tokenHash)).toEqual([null, ...phaseOneSave().seats.slice(1).map((seat) => seat.tokenHash)]);
    expect(good.logs).toHaveLength(1);
    expect(readFileSync(good.path, 'utf8')).toBe(freed);

    // A slip of the keyboard in the seats: the game inside converts and is
    // healthy, but nobody could ever be seat p5. Like every damaged save it
    // is moved aside, with the text the older version wrote plus the slip.
    const slipped = phaseOneSaveText().replace('"playerId": "p4"', '"playerId": "p5"');
    expect(slipped).not.toBe(phaseOneSaveText());
    const bad = storageWithPhaseOneSave(slipped);
    expect(bad.storage.loadAll()).toEqual([]);
    expect(readdirSync(bad.roomsDir)).toEqual([`${PHASE_ONE_CODE}.json.corrupt`]);
    expect(readFileSync(`${bad.path}.corrupt`, 'utf8')).toBe(slipped);
    expect(bad.logs.find((line) => line.includes('is damaged'))).toContain('seat p5');
    expect(bad.storage.has(PHASE_ONE_CODE)).toBe(true);
  });

  it('only a converted game must pass the health check: a game of the current layout is loaded as it is, well or not', () => {
    // A real game of today with a unit on a tile that is not on the map.
    const file = lobbyFile('AAAAA');
    const game = createGame({
      seed: 'storage-test',
      settings: { mapSize: 'small', turnMode: 'simultaneous' },
      players: file.seats.map((seat) => ({ id: seat.playerId, name: seat.name, civ: seat.civ })),
    });
    Object.values(game.units)[0].tile = game.map.tiles.length + 5;
    expect(game.schema).toBe(STATE_SCHEMA);
    expect(checkInvariants(game).length).toBeGreaterThan(0);

    const { storage, logs } = newStorage();
    storage.save({ ...file, game });

    // Storage hands it over without a word; the room manager is the one that warns about it.
    expect(storage.loadAll()).toEqual([{ ...file, game }]);
    expect(logs).toEqual([]);
  });
});
