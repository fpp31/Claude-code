import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { PROTOCOL_VERSION } from '@domination/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MAX_MESSAGE_BYTES, loadConfig, projectRoot } from '../src/config';
import { startServer } from '../src/server';
import { hashToken } from '../src/tokens';
import { createFakeRules } from './fakeRules';
import { cleanUp, startTestServer, temporaryFolder } from './harness';

/**
 * The server tests (WP3). This file holds the section "connecting"; the
 * other sections live in files named after them:
 *
 *   parsing.test.ts      tokens, codes and parsing
 *   storage.test.ts      storage
 *   server.test.ts       connecting (this file)
 *   hostile.test.ts      hostile input: floods, bad frames, silence (added by WP3)
 *   rooms.test.ts        Room and RoomManager without sockets (added by WP3)
 *   lobby.test.ts        lobby flow
 *   actions.test.ts      authorisation and actions
 *   conflicts.test.ts    same-instant conflicts (real rules)
 *   reconnect.test.ts    reconnect and resume
 *   persistence.test.ts  persistence and restart
 *   leak.test.ts         NO LEAK on the wire (real rules)
 *
 * How they test: every test starts the REAL server with startServer() on
 * port 0 with a temporary data folder, and talks to it with real `ws`
 * clients (test/harness.ts). `afterEach(cleanUp)` closes every server and
 * socket and deletes the folders, so no process or timer is left behind.
 *
 * No test points at the real packages/client/dist: other people build into
 * it. The static-file tests use a temporary client folder of their own.
 *
 * THE FAKE RULES (test/fakeRules.ts, owned by WP3). The server never looks
 * inside a game state, so most tests run with a tiny fake `Rules` bundle
 * that is easy to predict and can be told to fail:
 *  - createGame(setup): the setup's players on sampleMap(), one Warrior each;
 *  - applyAction: moveUnit changes only the mover's own view, endTurn and
 *    cancelEndTurn behave like the real ones, everything else is refused;
 *    it throws on command;
 *  - buildPlayerView: sampleView()'s tiles, the viewer's own unit, the turn
 *    and the public player list; it throws for one player on command;
 *  - filterEvents: picks by audience (`to`), like the real one;
 *  - checkInvariants: reports whatever the test tells it to.
 *
 * TESTS WITH THE REAL RULES are the sections marked "(real rules)": the
 * conflict tests, the leak tests, the build-queue and job tests at the end
 * of actions.test.ts, and some persistence tests, one of which runs main.ts
 * as a real process with the real map generator. Most of them play on a
 * hand-drawn map, so that each test can say exactly where everybody starts;
 * for that they wrap the real rules:
 *     const rules = { ...realRules, createGame: (s) => createGame(s, () => ({ map, starts })) };
 * (test/realWorld.ts, which also has the helpers for queues, for ending a
 * turn and for getting a Worker built.)
 *
 * A SAVE OF AN OLDER VERSION. storage.test.ts and persistence.test.ts load a
 * real room file that phase 1 wrote (packages/shared/test/fixtures/, read
 * through test/phaseOneSave.ts and never edited): its game state has an
 * older layout, which storage brings up to date when it loads the file.
 * Storage does this with the shared package's own migrateGameState and
 * checkInvariants, whatever `Rules` bundle the server runs with.
 */

afterEach(cleanUp);

interface HttpAnswer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/**
 * One raw HTTP request. `path` is sent exactly as given: unlike fetch() or a
 * browser, this does not tidy "/../" away first, which is the whole point of
 * the path traversal tests.
 */
function httpRequest(port: number, path: string, method = 'GET'): Promise<HttpAnswer> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, method }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/**
 * A folder laid out like a real installation:
 *
 *   <root>/client/            the public folder (config.clientDir)
 *   <root>/client/assets/     hashed files
 *   <root>/secret.json        NOT public: next to the client folder
 *   <root>/data/              the saved games
 */
function installation() {
  const root = temporaryFolder();
  const clientDir = join(root, 'client');
  const dataDir = join(root, 'data');
  mkdirSync(join(clientDir, 'assets'), { recursive: true });
  mkdirSync(join(clientDir, '.git'), { recursive: true });
  mkdirSync(dataDir);
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>the game page</title>');
  writeFileSync(join(clientDir, 'assets', 'app-3f9a1c.js'), 'console.log("app");');
  writeFileSync(join(clientDir, 'assets', 'style-77b2e0.css'), 'body { margin: 0; }');
  writeFileSync(join(clientDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  // Files that exist in the public folder but must never be served.
  writeFileSync(join(clientDir, 'notes.txt'), 'PRIVATE-NOTES');
  writeFileSync(join(clientDir, 'server.ts'), 'PRIVATE-SOURCE');
  writeFileSync(join(clientDir, 'backup.zip'), 'PRIVATE-ZIP');
  writeFileSync(join(clientDir, 'noextension'), 'PRIVATE-NOEXT');
  writeFileSync(join(clientDir, '.env'), 'PRIVATE-ENV');
  writeFileSync(join(clientDir, '.hidden.json'), '{"private":"PRIVATE-DOTJSON"}');
  writeFileSync(join(clientDir, '.git', 'config.json'), '{"private":"PRIVATE-GIT"}');
  // Outside the public folder.
  writeFileSync(join(root, 'secret.json'), '{"private":"PRIVATE-OUTSIDE"}');
  return { root, clientDir, dataDir };
}

describe('connecting (WP3)', () => {
  it('hello with the right protocol gets welcome with a new token when none was sent', async () => {
    const server = await startTestServer();
    const first = await server.open();
    first.send({ type: 'hello', protocol: PROTOCOL_VERSION, token: null });
    const welcome = await first.nextOfType('welcome');
    expect(welcome.protocol).toBe(PROTOCOL_VERSION);
    expect(welcome.token).toMatch(/^[0-9a-f]{32}$/);

    // Another first-time visitor gets another token.
    const second = await server.open();
    second.send({ type: 'hello', protocol: PROTOCOL_VERSION, token: null });
    expect((await second.nextOfType('welcome')).token).not.toBe(welcome.token);
  });

  it('hello with a valid token gets the same token back', async () => {
    const server = await startTestServer();
    const token = 'feedfacefeedfacefeedfacefeedface';
    const client = await server.open();
    client.send({ type: 'hello', protocol: PROTOCOL_VERSION, token });
    expect((await client.nextOfType('welcome')).token).toBe(token);
  });

  it('hello with something that is not a token of ours gets a new token', async () => {
    const server = await startTestServer();
    for (const notAToken of ['', 'short', 'FEEDFACEFEEDFACEFEEDFACEFEEDFACE', 'g'.repeat(32), 'a'.repeat(33)]) {
      const client = await server.open();
      client.send({ type: 'hello', protocol: PROTOCOL_VERSION, token: notAToken });
      const welcome = await client.nextOfType('welcome');
      expect(welcome.token).toMatch(/^[0-9a-f]{32}$/);
      expect(welcome.token).not.toBe(notAToken);
    }
  });

  it('hello with the wrong protocol version gets error protocolMismatch and the socket is closed', async () => {
    const server = await startTestServer();
    const client = await server.open();
    client.send({ type: 'hello', protocol: PROTOCOL_VERSION + 1, token: null });
    await client.expectError('protocolMismatch');
    await client.waitForClose();
    // Nothing else was sent, and in particular no token.
    expect(client.frames).toHaveLength(1);
  });

  it('any message before hello gets error notReady', async () => {
    const server = await startTestServer();
    const client = await server.open();
    client.send({ type: 'ping' });
    await client.expectError('notReady');
    client.send({ type: 'createGame', name: 'Ada' });
    await client.expectError('notReady');
    client.send({ type: 'joinGame', code: 'AAAAA', name: 'Ada' });
    await client.expectError('notReady');
    client.send({ type: 'action', requestId: 1, turn: 1, action: { type: 'endTurn' } });
    await client.expectError('notReady');

    // The socket is still usable: hello works afterwards, and nothing was created meanwhile.
    await client.hello();
    client.send({ type: 'joinGame', code: 'AAAAA', name: 'Ada' });
    await client.expectError('noSuchGame');
  });

  it('a second hello on the same socket gets error badMessage and changes nothing', async () => {
    const server = await startTestServer({ rules: createFakeRules().rules });
    const client = await server.connect();
    const { code } = await client.createGame('Ada');

    client.send({ type: 'hello', protocol: PROTOCOL_VERSION, token: 'feedfacefeedfacefeedfacefeedface' });
    await client.expectError('badMessage');

    // Still the same player: the seat is still theirs.
    client.send({ type: 'chooseCiv', civ: 'maya' });
    expect((await client.nextLobby()).seats[0].civ).toBe('maya');
    expect(server.save(code).seats[0].tokenHash).toBe(hashToken(client.token));
  });

  it('garbage, binary and oversized frames get error badMessage or a closed socket, and the server keeps running', async () => {
    const server = await startTestServer();

    // Garbage and wrong shapes: badMessage, the socket stays open.
    const sloppy = await server.connect();
    for (const garbage of ['not json', '{"type":"nonsense"}', '[1,2,3]', '{"type":"action"}']) {
      sloppy.sendRaw(garbage);
      await sloppy.expectError('badMessage');
    }
    await sloppy.expectNothingPending();

    // A binary frame is never a message, even if its bytes spell one.
    const binary = await server.connect();
    binary.sendRaw(Buffer.from('{"type":"ping"}'));
    await binary.expectError('badMessage');
    await binary.expectNothingPending();

    // An oversized frame: the socket is closed without the frame being looked at.
    const greedy = await server.connect();
    greedy.sendRaw(JSON.stringify({ type: 'createGame', name: 'x'.repeat(MAX_MESSAGE_BYTES) }));
    expect(await greedy.waitForClose()).toBe(1009); // "message too big"

    // The largest frame that is allowed is still read (and refused for its content).
    const edge = await server.connect();
    edge.sendRaw(' '.repeat(MAX_MESSAGE_BYTES));
    await edge.expectError('badMessage');

    // The server is still there for everybody else.
    expect((await httpRequest(server.port, '/healthz')).body).toBe('ok');
    const polite = await server.connect();
    await polite.expectNothingPending();
  });

  it('ping gets pong', async () => {
    const server = await startTestServer();
    const client = await server.connect();
    client.send({ type: 'ping' });
    expect(await client.next()).toEqual({ type: 'pong' });
  });

  it('the WebSocket lives at /ws only', async () => {
    const server = await startTestServer();
    const refused = await new Promise<string>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/elsewhere`);
      socket.on('open', () => {
        socket.terminate();
        resolve('opened');
      });
      socket.on('error', () => resolve('refused'));
    });
    expect(refused).toBe('refused');
  });

  it('GET /healthz answers ok; GET / serves index.html; a path traversal attempt gets 404', async () => {
    const { clientDir, dataDir } = installation();
    const server = await startTestServer({ clientDir, dataDir });

    const health = await httpRequest(server.port, '/healthz');
    expect(health.status).toBe(200);
    expect(health.body).toBe('ok');

    for (const path of ['/', '/?g=K7QXM', '/index.html', '/?g=K7QXM&x=../../secret.json']) {
      const page = await httpRequest(server.port, path);
      expect(page.status, path).toBe(200);
      expect(page.body, path).toContain('the game page');
      expect(page.headers['content-type'], path).toContain('text/html');
      // Players must get new versions of the page.
      expect(page.headers['cache-control'], path).toBe('no-cache');
    }

    const traversals = [
      '/../secret.json',
      '/../../secret.json',
      '/assets/../../secret.json',
      '/assets/..%2f..%2fsecret.json',
      '/%2e%2e/secret.json',
      '/%2e%2e%2fsecret.json',
      '/..%5csecret.json',
      '/..\\secret.json',
      '/assets/..\\..\\secret.json',
      '/./../secret.json',
      '//secret.json',
      '/%00/../secret.json',
      '/..%00/secret.json',
      '/%c0%ae%c0%ae/secret.json',
      '/..;/secret.json',
      '/....//secret.json',
      // The data folder, by every name it might have.
      '/../data/rooms/AAAAA.json',
      '/%2e%2e/data/rooms/AAAAA.json',
      join(clientDir, '..', 'secret.json'),
      `/${join(clientDir, '..', 'secret.json')}`,
      '/C:/secret.json',
      '/%',
    ];
    for (const path of traversals) {
      const answer = await httpRequest(server.port, path);
      expect(answer.status, path).toBe(404);
      expect(answer.body, path).not.toContain('PRIVATE');
    }
  });

  it('serves the listed file types with their content types and cache rules', async () => {
    const { clientDir, dataDir } = installation();
    const server = await startTestServer({ clientDir, dataDir });

    const script = await httpRequest(server.port, '/assets/app-3f9a1c.js');
    expect(script.status).toBe(200);
    expect(script.body).toBe('console.log("app");');
    expect(script.headers['content-type']).toContain('javascript');
    // Hashed file names never change their contents, so they may be kept.
    expect(script.headers['cache-control']).toContain('max-age=31536000');

    const style = await httpRequest(server.port, '/assets/style-77b2e0.css?v=2');
    expect(style.status).toBe(200);
    expect(style.headers['content-type']).toContain('text/css');

    const icon = await httpRequest(server.port, '/favicon.svg');
    expect(icon.status).toBe(200);
    expect(icon.headers['content-type']).toContain('image/svg+xml');
    expect(icon.headers['cache-control']).toBe('no-cache');

    // A folder, a file that is not there.
    expect((await httpRequest(server.port, '/assets')).status).toBe(404);
    expect((await httpRequest(server.port, '/assets/')).status).toBe(404);
    expect((await httpRequest(server.port, '/assets/missing.js')).status).toBe(404);
  });

  it('a file type that is not on the list and a dot-file are answered with 404 even though they exist in clientDir', async () => {
    const { clientDir, dataDir } = installation();
    const server = await startTestServer({ clientDir, dataDir });

    for (const path of [
      '/notes.txt',
      '/server.ts',
      '/backup.zip',
      '/noextension',
      '/.env',
      '/.hidden.json',
      '/.git/config.json',
      '/%2egit/config.json',
      '/.git',
    ]) {
      const answer = await httpRequest(server.port, path);
      expect(answer.status, path).toBe(404);
      expect(answer.body, path).not.toContain('PRIVATE');
    }
  });

  // Making a link needs special rights on Windows; everywhere else this runs.
  it.skipIf(process.platform === 'win32')('a link inside the client folder that points out of it is answered with 404', async () => {
    const { root, clientDir, dataDir } = installation();
    symlinkSync(join(root, 'secret.json'), join(clientDir, 'link.json'));
    symlinkSync(root, join(clientDir, 'up'));
    const server = await startTestServer({ clientDir, dataDir });

    for (const path of ['/link.json', '/up/secret.json']) {
      const answer = await httpRequest(server.port, path);
      expect(answer.status, path).toBe(404);
      expect(answer.body, path).not.toContain('PRIVATE');
    }
  });

  it('methods other than GET answer 405', async () => {
    const server = await startTestServer();
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
      const answer = await httpRequest(server.port, '/', method);
      expect(answer.status, method).toBe(405);
    }
    expect((await httpRequest(server.port, '/healthz', 'POST')).status).toBe(405);
  });

  it('without a built client, GET / answers a plain-text hint to run "npm run build"', async () => {
    const neverBuilt = join(temporaryFolder(), 'dist');
    const server = await startTestServer({ clientDir: neverBuilt });

    const page = await httpRequest(server.port, '/');
    expect(page.headers['content-type']).toContain('text/plain');
    expect(page.body).toContain('npm run build');
    // The rest of the server works without the page.
    expect((await httpRequest(server.port, '/healthz')).body).toBe('ok');
    const client = await server.connect();
    await client.expectNothingPending();
  });

  it('startServer refuses to start when the data folder is the client folder or inside it', async () => {
    const { clientDir } = installation();
    const base = { port: 0, host: '127.0.0.1', clientDir, fixedSeed: null, sendPatches: true };
    const log = (): void => {};

    for (const dataDir of [clientDir, join(clientDir, 'data'), join(clientDir, 'assets', 'deep', 'data'), join(clientDir, 'x', '..')]) {
      await expect(startServer({ config: { ...base, dataDir }, log }), dataDir).rejects.toThrow();
    }

    // A folder NEXT to the client folder is fine, even if its name starts the same way.
    const running = await startServer({ config: { ...base, dataDir: `${clientDir}-data` }, log });
    await running.close();
  });

  it.skipIf(process.platform === 'win32')('startServer also refuses a data folder that is a link into the client folder', async () => {
    const { root, clientDir } = installation();
    mkdirSync(join(clientDir, 'saves'));
    symlinkSync(join(clientDir, 'saves'), join(root, 'looks-harmless'));
    const config = { port: 0, host: '127.0.0.1', clientDir, dataDir: join(root, 'looks-harmless'), fixedSeed: null, sendPatches: true };
    await expect(startServer({ config, log: () => {} })).rejects.toThrow();
  });

  it('startServer logs a warning when a fixed seed is configured', async () => {
    const seeded = await startTestServer({ fixedSeed: 'the-same-map-every-time' });
    expect(seeded.logs.some((line) => line.includes('FIXED SEED'))).toBe(true);
    // The warning does not print the seed itself.
    expect(seeded.logs.join('\n')).not.toContain('the-same-map-every-time');

    const random = await startTestServer();
    expect(random.logs.some((line) => line.includes('FIXED SEED'))).toBe(false);
  });

  it('startServer fails with an error when the port is already taken', async () => {
    const first = await startTestServer();
    const config = { port: first.port, host: '127.0.0.1', dataDir: temporaryFolder(), clientDir: first.clientDir, fixedSeed: null, sendPatches: true };
    await expect(startServer({ config, log: () => {} })).rejects.toThrow();
    // The server that has the port is not disturbed.
    expect((await httpRequest(first.port, '/healthz')).body).toBe('ok');
  });

  it('close() stops the server: the port is free again and open sockets are closed', async () => {
    const server = await startTestServer();
    const client = await server.connect();

    await server.close();
    await client.waitForClose();
    await expect(httpRequest(server.port, '/healthz')).rejects.toThrow();
    // Closing twice is harmless.
    await server.close();
  });
});

describe('settings (WP3)', () => {
  it('loadConfig uses the documented defaults, relative to the project folder', () => {
    const config = loadConfig({});
    expect(config.port).toBe(8787);
    expect(config.host).toBeNull();
    expect(config.dataDir).toBe(join(projectRoot(), 'data'));
    expect(config.clientDir).toBe(join(projectRoot(), 'packages', 'client', 'dist'));
    expect(config.fixedSeed).toBeNull();
    expect(config.sendPatches).toBe(true);
  });

  it('projectRoot is the folder that contains packages/server', () => {
    expect(join(projectRoot(), 'packages', 'server', 'test', 'server.test.ts')).toBe(import.meta.filename);
  });

  it('loadConfig reads every variable', () => {
    const config = loadConfig({
      PORT: '9000',
      HOST: '127.0.0.1',
      DOMINATION_DATA_DIR: 'my-saves',
      DOMINATION_CLIENT_DIR: join(projectRoot(), 'somewhere', 'dist'),
      DOMINATION_SEED: 'fixed',
      DOMINATION_FULL_SYNC: '1',
    });
    expect(config.port).toBe(9000);
    expect(config.host).toBe('127.0.0.1');
    // A relative path is resolved against the current working directory.
    expect(config.dataDir).toBe(join(process.cwd(), 'my-saves'));
    expect(config.clientDir).toBe(join(projectRoot(), 'somewhere', 'dist'));
    expect(config.fixedSeed).toBe('fixed');
    expect(config.sendPatches).toBe(false);
  });

  it('loadConfig accepts port 0 and 65535, and patches stay on unless DOMINATION_FULL_SYNC is exactly 1', () => {
    expect(loadConfig({ PORT: '0' }).port).toBe(0);
    expect(loadConfig({ PORT: '65535' }).port).toBe(65535);
    expect(loadConfig({ DOMINATION_FULL_SYNC: '0' }).sendPatches).toBe(true);
    expect(loadConfig({ DOMINATION_FULL_SYNC: '' }).sendPatches).toBe(true);
    // Empty variables count as not set.
    expect(loadConfig({ PORT: '', HOST: '', DOMINATION_SEED: '' })).toEqual(loadConfig({}));
  });

  it('loadConfig throws for a PORT that is not a whole number from 0 to 65535', () => {
    for (const port of ['65536', '-1', '80.5', 'abc', '8787x', ' 8787', '1e3', '0x50', '999999']) {
      expect(() => loadConfig({ PORT: port }), port).toThrow();
    }
  });
});
