import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROTOCOL_VERSION, WS_PATH } from '@domination/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { projectRoot } from '../src/config';
import { ROOM_FILE_FORMAT } from '../src/roomFile';
import { hashToken } from '../src/tokens';
import { createFakeRules, fakeUnitId } from './fakeRules';
import { TestClient, cleanUp, gameWith, lobbyWith, startTestServer, temporaryClientFolder, temporaryFolder } from './harness';
import type { TestServer } from './harness';

/**
 * The saved file is the truth: a server that stops, or is killed, and starts
 * again on the same data folder has every lobby and every game exactly as
 * the players last saw them.
 */

/** Server processes started by a test (the "kill" test); always stopped again, by their own process id. */
const childProcesses: ChildProcess[] = [];

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await cleanUp();
});

function fakeServer(dataDir?: string): Promise<TestServer> {
  return startTestServer({ rules: createFakeRules().rules, dataDir });
}

describe('persistence and restart (WP3)', () => {
  it('stop the server and start a new one on the same data folder: lobbies and running games are back, with deep-equal views', async () => {
    const first = await fakeServer();
    const lobby = await lobbyWith(first, ['Ada', 'Ben']);
    const game = await gameWith(first, ['Cleo', 'Dana', 'Emil']);

    // Some history in both: a civilization and a map size chosen, units moved, a turn ended.
    lobby.clients[1].send({ type: 'chooseCiv', civ: 'norse' });
    for (const client of lobby.clients) await client.nextLobby();
    lobby.clients[0].send({ type: 'setMapSize', mapSize: 'large' });
    const lobbyBefore = await lobby.clients[0].nextLobby();
    await lobby.clients[1].nextLobby();

    const [cleo, dana, emil] = game.clients;
    await cleo.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p1'), path: [25] });
    await dana.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p2'), path: [60] });
    for (const player of game.clients) {
      await player.actOk(1, { type: 'endTurn' });
      for (const other of game.clients) if (other !== player) await other.nextOfType('gameUpdate');
    }
    await emil.actOk(2, { type: 'endTurn' });
    for (const other of [cleo, dana]) await other.nextOfType('gameUpdate');
    const viewsBefore = game.clients.map((client) => client.view);
    expect(viewsBefore[0]?.turn).toBe(2);
    const filesBefore = [first.saveText(lobby.code), first.saveText(game.code)];

    await first.close();
    const second = await fakeServer(first.dataDir);
    expect(second.logs).toContain('Saved games loaded: 2.');

    // Loading changed nothing on disk.
    expect([second.saveText(lobby.code), second.saveText(game.code)]).toEqual(filesBefore);

    // The lobby is back: same seats, civilizations, host, map size. (Only "connected" is not saved.)
    const ada = await second.connect(lobby.clients[0].token);
    const lobbyAfter = await ada.joinLobby(lobby.code, null);
    expect(lobbyAfter).toEqual({
      ...lobbyBefore,
      seats: lobbyBefore.seats.map((seat) => ({ ...seat, connected: seat.playerId === 'p1' })),
    });

    // The running game is back: every player's view is deep-equal to the last one they had.
    for (const [index, old] of game.clients.entries()) {
      const client = await second.connect(old.token);
      client.send({ type: 'joinGame', code: game.code, name: null });
      const sync = await client.nextOfType('gameSync');
      expect(sync.seq).toBe(1);
      expect(sync.view).toEqual(viewsBefore[index]);
    }
  });

  it('after a restart players reconnect with their old tokens to their old seats', async () => {
    const first = await fakeServer();
    const { code, clients } = await gameWith(first, ['Ada', 'Ben']);
    await clients[0].actOk(1, { type: 'endTurn' });
    await clients[1].nextOfType('gameUpdate');
    await first.close();

    const second = await fakeServer(first.dataDir);
    // In the other order than they joined, to show the seat follows the token and nothing else.
    const ben = await second.connect(clients[1].token);
    ben.send({ type: 'joinGame', code, name: null });
    const benSync = await ben.nextOfType('gameSync');
    expect(benSync.view.you).toBe('p2');
    expect(benSync.connected).toEqual(['p2']);

    const ada = await second.connect(clients[0].token);
    ada.send({ type: 'joinGame', code, name: null });
    const adaSync = await ada.nextOfType('gameSync');
    expect(adaSync.view.you).toBe('p1');
    expect(adaSync.view.players.map((player) => player.endedTurn)).toEqual([true, false]);
    expect(await ben.next()).toEqual({ type: 'presence', connected: ['p1', 'p2'] });

    // The game simply goes on: same turn, and Ben's End Turn resolves it.
    await ben.actOk(1, { type: 'endTurn' });
    await ada.nextOfType('gameUpdate');
    expect(ada.view?.turn).toBe(2);

    // Somebody without one of the old tokens is still a stranger.
    const stranger = await second.connect();
    stranger.send({ type: 'joinGame', code, name: 'Ada' });
    await stranger.expectError('gameAlreadyStarted');
  });

  it('the save file is written after every accepted action (kill without close, restart, nothing is lost)', async () => {
    // The first server is never closed or told to flush anything: a second
    // one is started on the same folder while the first still runs, exactly
    // as if the first had been killed at that moment. Whatever the first
    // had only in memory would be missing in the second.
    const first = await fakeServer();
    const { code, clients } = await gameWith(first, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    const steps: (() => Promise<unknown>)[] = [
      () => ada.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p1'), path: [7] }),
      () => ben.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p2'), path: [8] }),
      () => ada.actOk(1, { type: 'endTurn' }),
      () => ada.actOk(1, { type: 'cancelEndTurn' }),
      () => ada.actOk(1, { type: 'endTurn' }),
      () => ben.actOk(1, { type: 'endTurn' }),
      () => ben.actOk(2, { type: 'moveUnit', unitId: fakeUnitId('p2'), path: [9] }),
    ];
    for (const step of steps) {
      await step();
      // Read everything that was sent, so both views are up to date.
      await ada.drain();
      await ben.drain();

      const afterKill = await fakeServer(first.dataDir);
      for (const old of [ada, ben]) {
        const client = await afterKill.connect(old.token);
        client.send({ type: 'joinGame', code, name: null });
        expect((await client.nextOfType('gameSync')).view).toEqual(old.view);
        await client.close();
      }
      await afterKill.close();
    }
    expect(ada.view?.turn).toBe(2);
  });

  // The same with a real process and a real kill: `npm start` as a child
  // process, stopped with SIGKILL in the middle of a game. This also proves
  // that main.ts, the settings from the environment and the real rules work
  // together.
  describe('a killed server process (real rules)', () => {
    /**
     * Starts the server's main.ts on a free port and resolves with the port
     * once it is listening. It runs as ONE process ("node --import tsx
     * main.ts", not the tsx command, which would start the server as a child
     * of its own), so that killing this process really kills the server.
     */
    function startServerProcess(dataDir: string, clientDir: string): Promise<number> {
      const main = join(projectRoot(), 'packages', 'server', 'src', 'main.ts');
      const child = spawn(process.execPath, ['--import', 'tsx', main], {
        cwd: projectRoot(),
        env: {
          ...process.env,
          PORT: '0',
          HOST: '127.0.0.1',
          DOMINATION_DATA_DIR: dataDir,
          DOMINATION_CLIENT_DIR: clientDir,
          DOMINATION_SEED: '',
          DOMINATION_FULL_SYNC: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      childProcesses.push(child);
      return new Promise((resolve, reject) => {
        let output = '';
        const onData = (chunk: Buffer): void => {
          output += chunk.toString();
          const match = /Domination server running: http:\/\/localhost:(\d+)/.exec(output);
          if (match) resolve(Number(match[1]));
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', reject);
        child.on('exit', () => reject(new Error(`the server process stopped before it was listening:\n${output}`)));
      });
    }

    async function connectTo(port: number, token: string | null): Promise<TestClient> {
      const client = await TestClient.open(`ws://127.0.0.1:${port}${WS_PATH}`);
      client.send({ type: 'hello', protocol: PROTOCOL_VERSION, token });
      client.token = (await client.nextOfType('welcome')).token;
      return client;
    }

    it('kill -9 in the middle of a game, start again: same seats, same turn, same views', async () => {
      const dataDir = temporaryFolder();
      const clientDir = temporaryClientFolder();
      const port = await startServerProcess(dataDir, clientDir);

      const ada = await connectTo(port, null);
      const ben = await connectTo(port, null);
      try {
        const { code } = await ada.createGame('Ada');
        await ben.joinLobby(code, 'Ben');
        await ada.nextLobby();
        ada.send({ type: 'startGame' });
        await ada.nextOfType('gameSync');
        await ben.nextOfType('gameSync');

        // Ada founds her capital; both end the first turn; Ada ends the second.
        const settler = ada.view?.units.find((unit) => unit.type === 'settler');
        if (settler === undefined) throw new Error('Ada has no settler');
        await ada.actOk(1, { type: 'foundCity', unitId: settler.id });
        await ada.actOk(1, { type: 'endTurn' });
        await ben.actOk(1, { type: 'endTurn' });
        await ada.actOk(2, { type: 'endTurn' });
        await ada.drain();
        await ben.drain();
        expect(ada.view?.turn).toBe(2);
        expect(ada.view?.cities).toHaveLength(1);

        // Kill. No goodbye, no flush.
        const server = childProcesses[0];
        const gone = new Promise((resolve) => server.once('exit', resolve));
        server.kill('SIGKILL');
        await gone;
        await ada.waitForClose();
        await ben.waitForClose();

        const newPort = await startServerProcess(dataDir, clientDir);
        for (const old of [ada, ben]) {
          const client = await connectTo(newPort, old.token);
          try {
            client.send({ type: 'joinGame', code, name: null });
            const sync = await client.nextOfType('gameSync');
            expect(sync.view).toEqual(old.view);
          } finally {
            await client.close();
          }
        }
      } finally {
        await ada.close();
        await ben.close();
      }
    }, 30_000);
  });

  it('a corrupt save does not stop the server from starting', async () => {
    const first = await fakeServer();
    const good = await gameWith(first, ['Ada', 'Ben']);
    const doomed = await lobbyWith(first, ['Cleo']);
    await first.close();

    // One save is cut off in the middle; another file is plain rubbish.
    const doomedPath = first.savePath(doomed.code);
    const cutOff = readFileSync(doomedPath, 'utf8').slice(0, 60);
    writeFileSync(doomedPath, cutOff);
    const rubbishPath = join(first.dataDir, 'rooms', 'ZZZZZ.json');
    writeFileSync(rubbishPath, '\u0000\u0001 not json at all');

    const second = await fakeServer(first.dataDir);
    expect(second.logs).toContain('Saved games loaded: 1.');

    // The good game is playable.
    const ada = await second.connect(good.clients[0].token);
    ada.send({ type: 'joinGame', code: good.code, name: null });
    expect((await ada.nextOfType('gameSync')).view.you).toBe('p1');

    // The broken ones are reported, moved aside (never deleted), and not there to join.
    for (const [path, original] of [[doomedPath, cutOff], [rubbishPath, '\u0000\u0001 not json at all']]) {
      expect(existsSync(path)).toBe(false);
      expect(readFileSync(`${path}.corrupt`, 'utf8')).toBe(original);
    }
    expect(second.logs.some((line) => line.includes(`${doomed.code}.json`))).toBe(true);
    expect(second.logs.some((line) => line.includes('ZZZZZ.json'))).toBe(true);
    const cleo = await second.connect(doomed.clients[0].token);
    cleo.send({ type: 'joinGame', code: doomed.code, name: null });
    await cleo.expectError('noSuchGame');
  });

  it('a save from another version of the game is left untouched, is not loaded, and keeps its code', async () => {
    const first = await fakeServer();
    const { code, clients } = await lobbyWith(first, ['Ada']);
    await first.close();

    const path = first.savePath(code);
    const fromTheFuture = readFileSync(path, 'utf8').replace(`"format": ${ROOM_FILE_FORMAT}`, `"format": ${ROOM_FILE_FORMAT + 1}`);
    writeFileSync(path, fromTheFuture);

    const second = await fakeServer(first.dataDir);
    expect(second.logs).toContain('Saved games loaded: 0.');
    expect(second.logs.some((line) => line.includes(`${code}.json`) && line.includes(String(ROOM_FILE_FORMAT + 1)))).toBe(true);

    const ada = await second.connect(clients[0].token);
    ada.send({ type: 'joinGame', code, name: null });
    await ada.expectError('noSuchGame');
    // New games are made next to it, never over it.
    for (let i = 0; i < 5; i++) await (await second.connect()).createGame(`Player ${i}`);
    expect(readFileSync(path, 'utf8')).toBe(fromTheFuture);
    expect(readdirSync(join(first.dataDir, 'rooms'))).toHaveLength(6);
  });

  it('a loaded game is checked: problems are logged as warnings and the game is loaded anyway', async () => {
    const first = await fakeServer();
    const { code, clients } = await gameWith(first, ['Ada']);
    await first.close();

    const { rules, control } = createFakeRules();
    control.invariantProblems = ['unit u1_fake00 stands on water', 'two cities are too close'];
    const second = await startTestServer({ rules, dataDir: first.dataDir });

    for (const problem of control.invariantProblems) {
      expect(second.logs.some((line) => line.includes('WARNING') && line.includes(code) && line.includes(problem))).toBe(true);
    }
    const ada = await second.connect(clients[0].token);
    ada.send({ type: 'joinGame', code, name: null });
    await ada.nextOfType('gameSync');
  });

  it('a token is stored only as its SHA-256 hash: no save file contains a token', async () => {
    const server = await fakeServer();
    const lobby = await lobbyWith(server, ['Ada', 'Ben']);
    const game = await gameWith(server, ['Cleo', 'Dana']);
    await game.clients[0].actOk(1, { type: 'endTurn' });

    const everyFile = readdirSync(join(server.dataDir, 'rooms'))
      .map((name) => readFileSync(join(server.dataDir, 'rooms', name), 'utf8'))
      .join('\n');
    for (const client of [...lobby.clients, ...game.clients]) {
      expect(everyFile).not.toContain(client.token);
      expect(everyFile).toContain(hashToken(client.token));
    }
  });

  it('the fixed seed (config.fixedSeed) gives the same map twice', async () => {
    // What the rules are asked for: with a fixed seed, the same seed for every game.
    const { rules, control } = createFakeRules();
    const server = await startTestServer({ rules, fixedSeed: 'always-the-same' });
    for (const name of ['Ada', 'Ben']) {
      const player = await server.connect();
      await player.createGame(name);
      player.send({ type: 'startGame' });
      await player.nextOfType('gameSync');
    }
    expect(control.setups.map((setup) => setup.seed)).toEqual(['always-the-same', 'always-the-same']);
  });

  describe('the fixed seed (real rules)', () => {
    /** Starts a one-player game and returns what that player sees. */
    async function firstView(server: TestServer) {
      const player = await server.connect();
      await player.createGame('Ada');
      player.send({ type: 'startGame' });
      return (await player.nextOfType('gameSync')).view;
    }

    it('with a fixed seed two games show the same map; without one they do not', async () => {
      const seeded = await startTestServer({ fixedSeed: 'always-the-same' });
      const first = await firstView(seeded);
      const second = await firstView(seeded);
      expect(first.tiles.some((tile) => tile !== null)).toBe(true);
      expect(second).toEqual(first);

      // And on another server with the same seed.
      const seededElsewhere = await startTestServer({ fixedSeed: 'always-the-same' });
      expect(await firstView(seededElsewhere)).toEqual(first);

      // Random seeds: two games, two maps.
      const random = await startTestServer();
      const third = await firstView(random);
      const fourth = await firstView(random);
      expect(fourth.tiles).not.toEqual(third.tiles);
    });
  });
});
