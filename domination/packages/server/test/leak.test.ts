import { cpSync } from 'node:fs';
import { IMPROVEMENTS, RULES, UNITS } from '@domination/shared';
import type { Action, CityFocusId, PlayerView, ServerMessage } from '@domination/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { hashToken } from '../src/tokens';
import { cleanUp, gameWith, lobbyWith, startTestServer, temporaryFolder } from './harness';
import type { TestClient, TestServer } from './harness';
import {
  MEADOW_WIDTH,
  at,
  endTurn,
  ownCity,
  ownUnit,
  ownWater,
  queueItems,
  queueOf,
  raiseBoat,
  raiseWorker,
  realRulesOnMeadow,
  realRulesOnShore,
  setFocus,
  setQueue,
  turnOf,
} from './realWorld';

/**
 * NOTHING HIDDEN ON THE WIRE. These tests look at the raw text of every
 * frame the server sends, with the real rules, in games where one player
 * does things the other cannot see.
 *
 * The stage: Ada (p1, Rome) starts at the west end of a long meadow, Ben
 * (p2, Egypt) at the east end, seventeen tiles apart. Units see two or three
 * tiles, a city sees three, so neither ever sees anything of the other.
 * (The one test that puts a city IN the other player's sight says so.)
 *
 * The last group (round 3: boats, nets, "Grow first / Build first") plays
 * on the same meadow with the sea on its south side, LONG_SHORE.
 */

afterEach(cleanUp);

const SEED = 'leak-test-seed-5d1f';
const ADA_START: [number, number] = [3, 5];
const BEN_START: [number, number] = [20, 5];

function meadowServer(options: { dataDir?: string; sendPatches?: boolean } = {}): Promise<TestServer> {
  // These tests play many turns in a moment, far faster than the rate limit allows a person to click.
  return startTestServer({ rules: realRulesOnMeadow([ADA_START, BEN_START]), fixedSeed: SEED, noRateLimit: true, ...options });
}

/** Both players end the current turn (Ben first), and both read everything they are sent. */
async function endTurnForBoth(ada: TestClient, ben: TestClient): Promise<void> {
  const turn = ada.view?.turn ?? 0;
  await ben.actOk(turn, { type: 'endTurn' });
  await ada.actOk(turn, { type: 'endTurn' });
  await ada.drain();
  await ben.drain();
  expect(ada.view?.turn).toBe(turn + 1);
  expect(ben.view?.turn).toBe(turn + 1);
}

/** Every string that names something of this player's: unit ids, city ids, city names. */
function ownSecrets(view: PlayerView | null, into: Set<string>): void {
  for (const unit of view?.units ?? []) if (unit.owner === view?.you) into.add(unit.id);
  for (const city of view?.cities ?? []) {
    if (city.owner === view?.you) {
      into.add(city.id);
      into.add(city.name);
    }
  }
}

/**
 * A game in which both players are busy out of each other's sight for
 * several turns: each founds a capital, Ben's builds a Scout, units walk
 * about. Returns everything each of them could give away.
 */
async function playApart(server: TestServer) {
  const table = await gameWith(server, ['Ada', 'Ben']);
  const [ada, ben] = table.clients;
  const adaSecrets = new Set<string>();
  const benSecrets = new Set<string>();
  const remember = (): void => {
    ownSecrets(ada.view, adaSecrets);
    ownSecrets(ben.view, benSecrets);
  };
  remember();

  // Turn 1: both found their capital where they stand; Ben orders a Scout.
  await ada.actOk(1, { type: 'foundCity', unitId: ownUnit(ada.view, 'settler').id });
  await ben.actOk(1, { type: 'foundCity', unitId: ownUnit(ben.view, 'settler').id });
  remember();
  const benCity = ben.view?.cities.find((city) => city.owner === 'p2');
  if (benCity === undefined) throw new Error('Ben has no city');
  await ben.actOk(1, { type: 'setBuildQueue', cityId: benCity.id, queue: [{ kind: 'unit', unitType: 'scout' }] });

  // Then turn after turn: Ben's Warrior paces east and west, until the Scout is built.
  const warrior = ownUnit(ben.view, 'warrior');
  for (let round = 0; round < 12; round++) {
    const turn = ben.view?.turn ?? 0;
    const position = ownUnit(ben.view, 'warrior').tile;
    const step = position === warrior.tile ? position + 1 : warrior.tile;
    await ben.actOk(turn, { type: 'moveUnit', unitId: warrior.id, path: [step] });
    // Something refused, too: a rejection must not reach the other player either.
    expect(await ben.actRejected(turn, { type: 'foundCity', unitId: warrior.id })).toBe('cannotFoundCity');
    await endTurnForBoth(ada, ben);
    remember();
    if (ben.view?.units.some((unit) => unit.type === 'scout')) break;
  }
  expect(ben.view?.units.filter((unit) => unit.owner === 'p2').map((unit) => unit.type).sort()).toEqual(['scout', 'warrior']);

  return { ...table, ada, ben, adaSecrets, benSecrets };
}

/** Every property name that occurs anywhere inside a JSON value. */
function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      allKeys(inner, into);
    }
  }
  return into;
}

describe('NO LEAK on the wire (WP3, real rules)', () => {
  it('canary: with a hidden foreign city (unique name) and hidden unit ids, no frame sent to the other player ever contains them', async () => {
    const server = await meadowServer();
    const { ada, ben, adaSecrets, benSecrets } = await playApart(server);

    // The secrets are real: Ben's capital by name, two unit ids of his start, the Scout's, the city's.
    expect(benSecrets).toContain('Thebes');
    expect(adaSecrets).toContain('Rome');
    expect(benSecrets.size).toBe(5);
    expect(adaSecrets.size).toBe(4);

    const adaFrames = ada.frames.join('\n');
    const benFrames = ben.frames.join('\n');
    for (const secret of benSecrets) {
      // The check can fail: Ben himself was told every one of them...
      expect(benFrames.includes(secret), `Ben was told "${secret}"`).toBe(true);
      // ...and Ada none.
      expect(adaFrames.includes(secret), `Ada was told "${secret}"`).toBe(false);
    }
    for (const secret of adaSecrets) {
      expect(adaFrames.includes(secret), `Ada was told "${secret}"`).toBe(true);
      expect(benFrames.includes(secret), `Ben was told "${secret}"`).toBe(false);
    }

    // What Ada knows of the map ends long before Ben's half of it.
    const view = ada.view;
    if (view === null) throw new Error('Ada has no view');
    expect(view.units.every((unit) => unit.owner === 'p1')).toBe(true);
    expect(view.cities.every((city) => city.owner === 'p1')).toBe(true);
    view.tiles.forEach((tile, index) => {
      if (index % MEADOW_WIDTH >= 10) expect(tile, `tile ${index}`).toBeNull();
      if (tile !== null) expect(tile.owner === null || tile.owner === 'p1').toBe(true);
    });
    // No news about the other player either: every event Ada got is her own or the turn counter.
    for (const frame of ada.frames) {
      const message = JSON.parse(frame) as ServerMessage;
      if (message.type !== 'gameUpdate' && message.type !== 'gameSync') continue;
      for (const event of message.events) {
        if (event.type !== 'turnStarted') expect(event.playerId).toBe('p1');
      }
    }
  });

  it('a player whose view did not change receives nothing: hidden moves, a hidden city and hidden rejections send the other player no frame', async () => {
    const server = await meadowServer();
    const { clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const adaFrames = ada.frames.length;

    const settler = ownUnit(ben.view, 'settler');
    const warrior = ownUnit(ben.view, 'warrior');
    const hidden: Action[] = [
      { type: 'moveUnit', unitId: warrior.id, path: [at(19, 5), at(18, 5)] },
      { type: 'moveUnit', unitId: settler.id, path: [at(21, 5)] },
      { type: 'foundCity', unitId: settler.id },
    ];
    for (const action of hidden) {
      expect((await ben.actOk(1, action)).map((message) => message.type)).toEqual(['gameUpdate']);
      await ada.expectNothingPending();
    }
    const city = ben.view?.cities[0];
    if (city === undefined) throw new Error('Ben has no city');
    await ben.actOk(1, { type: 'setBuildQueue', cityId: city.id, queue: [{ kind: 'unit', unitType: 'settler' }] });
    expect(await ben.actRejected(1, { type: 'moveUnit', unitId: warrior.id, path: [at(17, 5)] })).toBe('noMovesLeft');
    await ada.expectNothingPending();

    // Apart from the pongs that prove it, Ada's socket carried nothing at all.
    expect(ada.frames.slice(adaFrames).every((frame) => frame === '{"type":"pong"}')).toBe(true);

    // The one thing Ada may learn, she does: Ben has ended his turn.
    await ben.actOk(1, { type: 'endTurn' });
    const update = await ada.nextOfType('gameUpdate');
    expect(Object.keys(update.patch)).toEqual(['players']);
    expect(update.events).toEqual([]);
  });

  it("twin worlds: two same-seed games in which player B acts differently out of A's sight (founding the same number of cities in both, because city names follow founding order); every frame A receives is identical in both", async () => {
    // Both worlds begin as copies of one saved lobby, so that the game code
    // and the players' tokens are the same in both and frames can be
    // compared as raw text.
    const origin = await meadowServer();
    const lobby = await lobbyWith(origin, ['Ada', 'Ben']);
    const [adaToken, benToken] = lobby.clients.map((client) => client.token);
    await origin.close();

    /** What Ben does in a turn, out of Ada's sight. Each world gets its own script. */
    type BenScript = (ben: TestClient, turn: number) => Promise<void>;

    async function playWorld(benScript: BenScript): Promise<{ ada: TestClient; ben: TestClient }> {
      const dataDir = temporaryFolder();
      cpSync(origin.dataDir, dataDir, { recursive: true });
      const server = await meadowServer({ dataDir });

      const ada = await server.connect(adaToken);
      await ada.joinLobby(lobby.code, null);
      const ben = await server.connect(benToken);
      await ben.joinLobby(lobby.code, null);
      await ada.nextLobby();
      ada.send({ type: 'startGame' });
      await ada.nextOfType('gameSync');
      await ben.nextOfType('gameSync');

      // Ada plays the same in every world: a step east, a capital, Warriors.
      const adaWarrior = ownUnit(ada.view, 'warrior');
      for (let turn = 1; turn <= 9; turn++) {
        if (turn === 1) {
          await ada.actOk(1, { type: 'moveUnit', unitId: adaWarrior.id, path: [at(4, 5)] });
          await ada.actOk(1, { type: 'foundCity', unitId: ownUnit(ada.view, 'settler').id });
          const capital = ada.view?.cities[0];
          if (capital === undefined) throw new Error('Ada has no city');
          await ada.actOk(1, { type: 'setBuildQueue', cityId: capital.id, queue: [{ kind: 'unit', unitType: 'warrior' }] });
        }

        await benScript(ben, turn);
        // Whatever Ben just did, Ada's socket carried nothing.
        await ada.expectNothingPending();

        await ben.actOk(turn, { type: 'endTurn' });
        await ada.nextOfType('gameUpdate');
        await ada.actOk(turn, { type: 'endTurn' });
        await ben.drain();
        expect(ada.view?.turn).toBe(turn + 1);
      }
      return { ada, ben };
    }

    // World 1: Ben settles at once where he stands, builds a Warrior, and walks his Warrior west.
    const first = await playWorld(async (ben, turn) => {
      const warrior = ownUnit(ben.view, 'warrior');
      if (turn === 1) {
        await ben.actOk(1, { type: 'foundCity', unitId: ownUnit(ben.view, 'settler').id });
        const city = ben.view?.cities[0];
        if (city === undefined) throw new Error('Ben has no city');
        await ben.actOk(1, { type: 'setBuildQueue', cityId: city.id, queue: [{ kind: 'unit', unitType: 'warrior' }] });
      }
      if (turn <= 2) await ben.actOk(turn, { type: 'moveUnit', unitId: warrior.id, path: [warrior.tile - 1, warrior.tile - 2] });
    });

    // World 2: Ben walks his Settler east first, settles a turn later and elsewhere, builds Scouts,
    // and his Warrior goes the other way, every turn.
    const second = await playWorld(async (ben, turn) => {
      const warrior = ownUnit(ben.view, 'warrior');
      if (turn === 1) {
        const settler = ownUnit(ben.view, 'settler');
        await ben.actOk(1, { type: 'moveUnit', unitId: settler.id, path: [settler.tile + 1] });
      }
      if (turn === 2) {
        await ben.actOk(2, { type: 'foundCity', unitId: ownUnit(ben.view, 'settler').id });
        const city = ben.view?.cities[0];
        if (city === undefined) throw new Error('Ben has no city');
        await ben.actOk(2, { type: 'setBuildQueue', cityId: city.id, queue: [{ kind: 'unit', unitType: 'scout' }] });
      }
      // Up one row and down again, turn after turn.
      const home = at(20, 5);
      await ben.actOk(turn, { type: 'moveUnit', unitId: warrior.id, path: [warrior.tile === home ? at(20, 4) : home] });
    });

    // The worlds really are different: Ben's own picture of them differs...
    expect(second.ben.view).not.toEqual(first.ben.view);
    expect(first.ben.view?.cities[0].tile).toBe(at(20, 5));
    expect(second.ben.view?.cities[0].tile).toBe(at(21, 5));
    expect(first.ben.view?.units.map((unit) => unit.type).sort()).toEqual(['warrior', 'warrior']);
    expect(second.ben.view?.units.map((unit) => unit.type).sort()).toEqual(['scout', 'warrior']);
    // ...and he founded one city in each.
    expect(first.ben.view?.cities.map((city) => city.name)).toEqual(['Thebes']);
    expect(second.ben.view?.cities.map((city) => city.name)).toEqual(['Thebes']);

    // And Ada cannot tell them apart: every frame she received, byte for byte, in order.
    expect(first.ada.frames.length).toBeGreaterThan(30);
    expect(second.ada.frames).toEqual(first.ada.frames);
  });

  it('no frame ever contains the seed, an rng state, a token, a token hash or an event audience list (`to`)', async () => {
    for (const sendPatches of [true, false]) {
      const server = await meadowServer({ sendPatches });
      const { code, ada, ben } = await playApart(server);

      // A few more kinds of frames: a resync, a second tab, a reconnect, presence, a stranger turned away.
      ada.send({ type: 'resync' });
      await ada.nextOfType('gameSync');
      const benTab = await server.connect(ben.token);
      benTab.send({ type: 'joinGame', code, name: null });
      await benTab.nextOfType('gameSync');
      await ben.close();
      await benTab.close();
      await ada.nextOfType('presence');
      const stranger = await server.connect();
      stranger.send({ type: 'joinGame', code, name: 'Stranger' });
      await stranger.expectError('gameAlreadyStarted');

      const saved = server.save(code);
      const game = saved.game;
      if (game === null) throw new Error('the game was not saved');
      const sockets = [ada, ben, benTab, stranger];
      const tokens = sockets.map((socket) => socket.token);
      // Secrets of the save file: the seed, every random stream, every seat's token hash.
      const savedSecrets = [
        SEED,
        JSON.stringify(game.rng),
        ...game.players.map((player) => JSON.stringify(player.idRng)),
        ...saved.seats.map((seat) => seat.tokenHash ?? 'no hash'),
      ];
      const forbiddenTexts = [...savedSecrets, ...tokens.map((token) => hashToken(token))];
      // Names of things that exist only in the save file or the game state.
      const forbiddenKeys = [
        'to', 'seed', 'rng', 'idRng', 'knowledge', 'explored', 'remembered', 'citiesFounded',
        'tokenHash', 'schema', 'settings', 'map', 'createdAt', 'format',
      ];
      // The check can fail: the save file holds every one of these.
      const saveText = server.saveText(code);
      for (const text of savedSecrets) expect(saveText.includes(text), `the save holds ${text}`).toBe(true);
      for (const key of forbiddenKeys.filter((name) => name !== 'to')) {
        expect(saveText.includes(`"${key}"`), `the save has a "${key}"`).toBe(true);
      }

      let frames = 0;
      for (const socket of sockets) {
        for (const frame of socket.frames) {
          frames += 1;
          const message = JSON.parse(frame) as ServerMessage;
          for (const text of forbiddenTexts) {
            expect(frame.includes(text), `${text} in a ${message.type}`).toBe(false);
          }

          const keys = allKeys(message);
          for (const key of forbiddenKeys) expect(keys.has(key), `"${key}" in a ${message.type}`).toBe(false);

          // A token appears in one frame only: the `welcome`, and there it is the socket's own.
          if (message.type === 'welcome') {
            expect(message.token).toBe(socket.token);
            expect(Object.keys(message).sort()).toEqual(['protocol', 'token', 'type']);
          } else {
            expect(keys.has('token'), `a token field in a ${message.type}`).toBe(false);
            for (const token of tokens) expect(frame.includes(token), `a token in a ${message.type}`).toBe(false);
          }
        }
      }
      expect(frames).toBeGreaterThan(50);
      await cleanUp();
    }
  });
});

/**
 * Orders are private: what a city is told to build and what a Worker is told
 * to do reach nobody but their owner, in sight or out of it.
 */
describe('NO LEAK on the wire: build queues and jobs (WP3, real rules)', () => {
  /** The frames a socket received from frame `from` on, without the pongs that only answer a test's own pings. */
  function framesSince(client: TestClient, from: number): string[] {
    return client.frames.slice(from).filter((frame) => frame !== '{"type":"pong"}');
  }

  it("a player's Worker starting, doing and finishing a job out of the other player's sight sends that player nothing but the turn changes", async () => {
    /**
     * One world. In both, Ada does nothing but end her turns, after Ben. If
     * `benWorks`, Ben founds his capital, has it build a Worker, and the
     * Worker builds a farm from start to finish; otherwise Ben, too, only
     * ends his turns, until the same turn is reached.
     */
    async function playWorld(benWorks: boolean, lastTurn: number) {
      const server = await meadowServer();
      const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
      const [ada, ben] = clients;
      const fromTheStart = ada.frames.length;
      let farmTile = -1;
      let workerId = '';

      if (benWorks) {
        const worker = await raiseWorker(ben, [ben, ada]);
        workerId = worker.id;
        // One step east of the city, onto Ben's own meadow; then the job, in the same turn.
        farmTile = worker.tile + 1;
        await ben.actOk(turnOf(ben), { type: 'moveUnit', unitId: worker.id, path: [farmTile] });
        await ben.actOk(turnOf(ben), { type: 'startJob', unitId: worker.id, improvement: 'farm' });
        await ada.expectNothingPending();

        // The work, turn after turn: Ben is told how far it is; the tile is still bare.
        const turns = IMPROVEMENTS.farm.turns;
        for (let worked = 0; worked < turns; worked++) {
          expect(ownUnit(ben.view, 'worker').own?.job).toEqual({
            improvement: 'farm',
            turnsWorked: worked,
            turnsTotal: turns,
            turnsLeft: turns - worked,
          });
          expect(ben.view?.tiles[farmTile]?.improvement).toBeNull();
          await endTurn([ben, ada]);
        }
        // Finished: the farm stands, the Worker is free again, and Ben (only Ben) got the news.
        expect(ben.view?.tiles[farmTile]?.improvement).toBe('farm');
        expect(ownUnit(ben.view, 'worker').own?.job).toBeNull();
        expect(server.save(code).game?.map.tiles[farmTile].improvement).toBe('farm');
        expect(ben.frames.filter((frame) => frame.includes('"improvementBuilt"'))).toHaveLength(1);
      }
      while (turnOf(ada) < lastTurn) await endTurn([ben, ada]);

      return { ada, ben, turn: turnOf(ada), farmTile, workerId, adaFrames: framesSince(ada, fromTheStart) };
    }

    const busy = await playWorld(true, 0);
    // The job really took place over several turns, and Ada's socket was busy all the while.
    expect(busy.turn).toBeGreaterThan(IMPROVEMENTS.farm.turns + 2);
    expect(busy.adaFrames.length).toBeGreaterThan(3 * IMPROVEMENTS.farm.turns);

    // Everything Ada was sent after the start: Ben has ended his turn; the
    // turn has changed; the answers to her own End Turns. No tile, no unit,
    // no city, and no news but the turn counter.
    for (const frame of busy.adaFrames) {
      const message = JSON.parse(frame) as ServerMessage;
      if (message.type === 'actionOk') continue;
      if (message.type !== 'gameUpdate') throw new Error(`Ada was sent a ${message.type}: ${frame.slice(0, 200)}`);
      expect(Object.keys(message.patch).filter((key) => key !== 'players' && key !== 'turn'), frame.slice(0, 200)).toEqual([]);
      expect(message.events.filter((event) => event.type !== 'turnStarted'), frame.slice(0, 200)).toEqual([]);
    }
    // In words, over every frame from her first: nothing names the Worker, the job or the farm.
    const everythingAdaGot = busy.ada.frames.join('\n');
    const everythingBenGot = busy.ben.frames.join('\n');
    for (const secret of [busy.workerId, '"worker"', '"farm"', 'improvementBuilt', '"turnsWorked":0', '"turnsLeft"']) {
      // The check can fail: Ben was told every one of them.
      expect(everythingBenGot.includes(secret), `Ben was told ${secret}`).toBe(true);
      expect(everythingAdaGot.includes(secret), `Ada was told ${secret}`).toBe(false);
    }
    // What she knows of the tile is what she knew at the start: nothing.
    expect(busy.ada.view?.tiles[busy.farmTile]).toBeNull();

    // And she cannot tell this world from one in which Ben never did a
    // thing: every frame after the start is the same, byte for byte.
    const idle = await playWorld(false, busy.turn);
    expect(idle.turn).toBe(busy.turn);
    expect(idle.ben.view?.cities).toEqual([]);
    expect(busy.adaFrames).toEqual(idle.adaFrames);
  });

  it('editing a build queue sends the other player nothing at all', async () => {
    // Here the city is IN the other player's sight: Ada's Warrior walks up
    // to Ben's capital and watches it. A queue is an order, and orders are
    // private wherever the city stands.
    const server = await startTestServer({ rules: realRulesOnMeadow([[6, 5], [10, 5]]), fixedSeed: SEED, noRateLimit: true });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    await ben.actOk(1, { type: 'foundCity', unitId: ownUnit(ben.view, 'settler').id });
    await ada.actOk(1, { type: 'moveUnit', unitId: ownUnit(ada.view, 'warrior').id, path: [at(7, 5), at(8, 5)] });
    await ada.drain();
    await ben.drain();
    const thebes = ownCity(ben.view);
    const seenByAda = { id: thebes.id, owner: 'p2', name: 'Thebes', tile: at(10, 5), population: 1, visible: true, own: null };
    expect(ada.view?.cities).toStrictEqual([seenByAda]);
    const adaFrames = ada.frames.length;
    const adaView = ada.view;

    // Ben adds, moves up, removes, fills the queue to the brim and empties it.
    const edits = [
      queueOf('warrior'),
      queueOf('warrior', 'scout', 'worker'),
      queueOf('scout', 'warrior', 'worker'),
      queueOf('scout', 'worker'),
      queueOf(...Array.from({ length: RULES.maxQueueLength }, () => 'settler' as const)),
      [],
      queueOf('worker', 'worker'),
    ];
    for (const queue of edits) {
      // Ben himself is sent his city with the new queue...
      const told = await ben.actOk(1, setQueue(thebes.id, queue));
      expect(told.map((message) => message.type)).toEqual(['gameUpdate']);
      expect(queueItems(ownCity(ben.view))).toEqual(queue);
      // ...and Ada, who is looking at the city, nothing.
      await ada.expectNothingPending();
    }
    // Edits that are refused, or change nothing, are as silent.
    const tooLong = queueOf(...Array.from({ length: RULES.maxQueueLength + 1 }, () => 'scout' as const));
    expect(await ben.actRejected(1, setQueue(thebes.id, tooLong))).toBe('queueFull');
    expect(await ben.actOk(1, setQueue(thebes.id, queueOf('worker', 'worker')))).toEqual([]);
    await ada.expectNothingPending();
    expect(framesSince(ada, adaFrames)).toEqual([]);
    expect(ada.view).toBe(adaView);

    // Ada cannot edit it, and the answer is the one for a city that does not exist.
    expect(await ada.actRejected(1, setQueue(thebes.id, queueOf('warrior')))).toBe('noSuchCity');
    expect(await ada.actRejected(1, setQueue('c2_nosuch', queueOf('warrior')))).toBe('noSuchCity');
    await ben.expectNothingPending();
    expect(server.save(code).game?.cities[thebes.id].buildQueue).toEqual(queueOf('worker', 'worker'));

    // A turn goes by and the city saves production for its Worker. Ada is
    // sent the turn and her own Warrior's fresh moves; of the city, nothing.
    await ben.actOk(1, { type: 'endTurn' });
    await ada.actOk(1, { type: 'endTurn' });
    await ben.drain();
    expect(ownCity(ben.view).own.productionStored).toBeGreaterThan(0);
    for (const frame of framesSince(ada, adaFrames)) {
      const message = JSON.parse(frame) as ServerMessage;
      if (message.type === 'gameUpdate') expect(Object.keys(message.patch)).not.toContain('cities');
    }
    expect(ada.view?.turn).toBe(2);
    expect(ada.view?.cities).toStrictEqual([seenByAda]);

    // Not one frame Ada ever received says anything about a queue.
    const everythingAdaGot = ada.frames.join('\n');
    const everythingBenGot = ben.frames.join('\n');
    for (const secret of ['buildQueue', 'buildOptions', 'productionStored', 'queueFull', '"held"', '"worker"']) {
      expect(everythingBenGot.includes(secret), `Ben was told ${secret}`).toBe(true);
      expect(everythingAdaGot.includes(secret), `Ada was told ${secret}`).toBe(false);
    }
  });
});

/**
 * Round 3. A boat is a unit like any other: another player is shown its
 * type, owner and tile while the tile is in their sight, and nothing when it
 * is not. A net is an improvement like a farm. A boat's job is an order, and
 * how a city places its citizens ("Grow first / Build first") is its
 * owner's business: neither reaches anybody else, in sight or out of it.
 */
describe('NO LEAK on the wire: boats, nets and "Grow first / Build first" (round 3, real rules)', () => {
  /** The frames a socket received from frame `from` on, without the pongs that only answer a test's own pings. */
  function framesSince(client: TestClient, from: number): string[] {
    return client.frames.slice(from).filter((frame) => frame !== '{"type":"pong"}');
  }

  function shoreServer(adaStart: [number, number], benStart: [number, number]): Promise<TestServer> {
    return startTestServer({ rules: realRulesOnShore([adaStart, benStart]), fixedSeed: SEED, noRateLimit: true });
  }

  it("leak: nothing the other seat is sent changes when the actor's focus is flipped, and none of it holds the actor's jobs or a boat out of sight", async () => {
    /** What Ben does in a world, out of Ada's sight. Ada only ever ends her turns, after Ben. */
    type BenPlays = 'ends his turns' | 'fishes' | 'fishes and presses Grow / Build';

    /**
     * One world, played to the turn `lastTurn`. Ada (inland, west) and Ben
     * (on the shore, east) are seventeen tiles apart. Unless he only ends
     * his turns, Ben founds his capital, has it build a Fishing Boat, sails
     * the boat, nets a coast tile from start to finish, and begins a second
     * net that he works on for a turn and then gives up. In the third kind
     * of world he also presses "Build first" and "Grow first" all the
     * while, and so plays a different game: his city grows and builds at
     * another pace.
     */
    async function playWorld(benPlays: BenPlays, lastTurn: number) {
      const server = await shoreServer([3, 3], [20, 7]);
      const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
      const [ada, ben] = clients;
      const fromTheStart = ada.frames.length;
      const net = IMPROVEMENTS.fishingNet;
      let boatId = '';
      let firstNet = -1;
      let presses = 0;

      /** In the world with presses: Ben presses this button of his capital. Ada's socket carries nothing. */
      async function press(focus: CityFocusId): Promise<void> {
        if (benPlays !== 'fishes and presses Grow / Build') return;
        const told = await ben.actOk(turnOf(ben), setFocus(ownCity(ben.view).id, focus));
        expect(told.map((message) => message.type)).toEqual(['gameUpdate']);
        expect(ownCity(ben.view).own.focus).toBe(focus);
        presses += 1;
        await ada.expectNothingPending();
      }
      /** One turn: in the world with presses Ben first flips the choice (and, every third turn, flips it twice more). */
      async function nextTurn(): Promise<void> {
        const turn = turnOf(ben);
        await press(turn % 2 === 0 ? 'grow' : 'build');
        if (turn % 3 === 0) {
          await press(turn % 2 === 0 ? 'build' : 'grow');
          await press(turn % 2 === 0 ? 'grow' : 'build');
        }
        await endTurn([ben, ada]);
      }

      if (benPlays !== 'ends his turns') {
        // The capital on the shore, and a Fishing Boat as the one entry of its queue.
        await ben.actOk(1, { type: 'foundCity', unitId: ownUnit(ben.view, 'settler').id });
        const thebes = ownCity(ben.view).id;
        expect(ownWater(ben.view).length).toBeGreaterThan(0);
        await ben.actOk(1, setQueue(thebes, queueOf('fishingBoat')));
        await ada.expectNothingPending();
        while (!ben.view?.units.some((unit) => unit.type === 'fishingBoat')) await nextTurn();
        const boat = ownUnit(ben.view, 'fishingBoat');
        boatId = boat.id;

        // The boat sails one tile along the coast and begins a net there, in the same turn.
        expect(boat.tile).toBe(at(21, 8));
        firstNet = at(22, 8);
        await ben.actOk(turnOf(ben), { type: 'moveUnit', unitId: boat.id, path: [firstNet] });
        await ben.actOk(turnOf(ben), { type: 'startJob', unitId: boat.id, improvement: 'fishingNet' });
        await ada.expectNothingPending();
        for (let worked = 0; worked < net.turns; worked++) {
          expect(ownUnit(ben.view, 'fishingBoat').own?.job).toMatchObject({ improvement: 'fishingNet', turnsWorked: worked });
          await nextTurn();
        }
        // Finished: the net stands, and Ben (only Ben) got the news.
        expect(ben.view?.tiles[firstNet]?.improvement).toBe('fishingNet');
        expect(server.save(code).game?.map.tiles[firstNet].improvement).toBe('fishingNet');
        expect(ben.frames.filter((frame) => frame.includes('"improvementBuilt"'))).toHaveLength(1);

        // A second net, two tiles on: begun, worked on for one turn, and given up.
        const secondNet = at(21, 9);
        await ben.actOk(turnOf(ben), { type: 'moveUnit', unitId: boat.id, path: [at(22, 9), secondNet] });
        await ben.actOk(turnOf(ben), { type: 'startJob', unitId: boat.id, improvement: 'fishingNet' });
        await nextTurn();
        expect(ownUnit(ben.view, 'fishingBoat').own?.job).toMatchObject({ improvement: 'fishingNet', turnsWorked: 1 });
        await ben.actOk(turnOf(ben), { type: 'stopJob', unitId: boat.id });
        expect(ownUnit(ben.view, 'fishingBoat').own?.job).toBeNull();
        await ada.expectNothingPending();
      }
      // Every world must reach the same turn, or their frames could not be compared.
      expect(turnOf(ada), `${benPlays}: the play fits into ${lastTurn} turns`).toBeLessThanOrEqual(lastTurn);
      while (turnOf(ada) < lastTurn) await nextTurn();

      return { ada, ben, boatId, firstNet, presses, adaFrames: framesSince(ada, fromTheStart) };
    }

    const LAST_TURN = 24;
    const pressing = await playWorld('fishes and presses Grow / Build', LAST_TURN);
    // Ben pressed often, his last press stands, and Ada's socket was busy all the while.
    expect(pressing.presses).toBeGreaterThan(LAST_TURN);
    expect(ownCity(pressing.ben.view).own.focus).toBe('build');
    expect(pressing.adaFrames.length).toBeGreaterThan(3 * LAST_TURN - 6);

    // Everything Ada was sent after the start: Ben has ended his turn; the
    // turn has changed; the answers to her own End Turns. No tile, no unit,
    // no city, and no news but the turn counter.
    for (const frame of pressing.adaFrames) {
      const message = JSON.parse(frame) as ServerMessage;
      if (message.type === 'actionOk') continue;
      if (message.type !== 'gameUpdate') throw new Error(`Ada was sent a ${message.type}: ${frame.slice(0, 200)}`);
      expect(Object.keys(message.patch).filter((key) => key !== 'players' && key !== 'turn'), frame.slice(0, 200)).toEqual([]);
      expect(message.events.filter((event) => event.type !== 'turnStarted'), frame.slice(0, 200)).toEqual([]);
    }
    // In words, over every frame from her first: nothing names the boat, its job, the net, the city or its choice.
    const everythingAdaGot = pressing.ada.frames.join('\n');
    const everythingBenGot = pressing.ben.frames.join('\n');
    const secrets = [
      pressing.boatId, '"fishingBoat"', '"fishingNet"', 'improvementBuilt', 'unitBuilt', '"turnsWorked"', '"turnsLeft"',
      'Thebes', '"focus"', '"build"', '"worked"', 'buildQueue', '"coast"',
    ];
    for (const secret of secrets) {
      // The check can fail: Ben was told every one of them.
      expect(everythingBenGot.includes(secret), `Ben was told ${secret}`).toBe(true);
      expect(everythingAdaGot.includes(secret), `Ada was told ${secret}`).toBe(false);
    }
    // What she knows of the fished tile is what she knew at the start: nothing.
    expect(pressing.ada.view?.tiles[pressing.firstNet]).toBeNull();
    expect(pressing.ada.view?.units.every((unit) => unit.owner === 'p1')).toBe(true);
    expect(pressing.ada.view?.cities).toEqual([]);

    // The same play without a single press is another game for Ben...
    const fishing = await playWorld('fishes', LAST_TURN);
    expect(fishing.presses).toBe(0);
    expect(ownCity(fishing.ben.view).own.focus).toBe('grow');
    expect(fishing.ben.view).not.toEqual(pressing.ben.view);
    expect(ownCity(fishing.ben.view).own.foodStored).not.toBe(ownCity(pressing.ben.view).own.foodStored);
    // ...and for Ada the very same: every frame after the start, byte for byte.
    expect(fishing.adaFrames).toEqual(pressing.adaFrames);

    // Nor can she tell either from a world in which Ben never did a thing.
    const idle = await playWorld('ends his turns', LAST_TURN);
    expect(idle.ben.view?.cities).toEqual([]);
    expect(idle.adaFrames).toEqual(pressing.adaFrames);
  });

  it('in sight: the other player is shown a boat and a finished net like any unit and any improvement, and never the job, the queue or the choice of Grow or Build; a press sends them no frame', async () => {
    // Ben's capital stands on the shore at (20, 7). Ada never founds a city:
    // her Settler and her Warrior walk up to two tiles from Thebes and watch
    // it. The Settler sees three tiles far: the city, the land around it and
    // the coast tiles (20, 8) and (21, 8) in front of it; (22, 8) it does not.
    const server = await shoreServer([16, 7], [20, 7]);
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const net = IMPROVEMENTS.fishingNet;
    await ben.actOk(1, { type: 'foundCity', unitId: ownUnit(ben.view, 'settler').id });
    for (const type of ['settler', 'warrior'] as const) {
      await ada.actOk(1, { type: 'moveUnit', unitId: ownUnit(ada.view, type).id, path: [at(17, 7), at(18, 7)] });
    }
    await ada.drain();
    await ben.drain();
    const thebes = ownCity(ben.view).id;
    const inSight = at(21, 8);
    const outOfSight = at(22, 8);
    expect(ada.view?.tiles[inSight]).toStrictEqual({ terrain: 'coast', feature: null, improvement: null, owner: 'p2', visible: true });
    expect(ada.view?.tiles[outOfSight]).toBeNull();

    /** Thebes as Ada sees it: the public facts and nothing else. */
    const seenByAda = (population: number) => ({ id: thebes, owner: 'p2', name: 'Thebes', tile: at(20, 7), population, visible: true, own: null });
    expect(ada.view?.cities).toStrictEqual([seenByAda(1)]);
    /** Ben's Warrior, which stands in Thebes for the whole game, as Ada sees it. */
    const warriorSeenByAda = { id: ownUnit(ben.view, 'warrior').id, type: 'warrior', owner: 'p2', tile: at(20, 7), own: null };
    /** The units of Ben's that Ada's view holds, in the view's own order. */
    const bensUnitsInAdasView = () => ada.view?.units.filter((unit) => unit.owner === 'p2');
    /** These units as a view lists them: sorted by id. */
    const asListed = <Seen extends { id: string }>(units: Seen[]): Seen[] => [...units].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(bensUnitsInAdasView()).toStrictEqual([warriorSeenByAda]);

    // Ben presses "Build first", "Grow first" and "Build first" again, and
    // the button the city is already on. He is sent his city each time it
    // changed; Ada, who is looking at the city, is sent nothing at all.
    let adaFrames = ada.frames.length;
    let adaView = ada.view;
    for (const focus of ['build', 'grow', 'build'] as const) {
      const told = await ben.actOk(1, setFocus(thebes, focus));
      expect(told.map((message) => (message.type === 'gameUpdate' ? Object.keys(message.patch) : message.type))).toEqual([['cities']]);
      expect(ownCity(ben.view).own.focus).toBe(focus);
      await ada.expectNothingPending();
    }
    expect(await ben.actOk(1, setFocus(thebes, 'build'))).toEqual([]);
    await ada.expectNothingPending();
    expect(framesSince(ada, adaFrames)).toEqual([]);
    expect(ada.view).toBe(adaView);
    // She cannot press for him, and the answer is the one for a city that does not exist.
    expect(await ada.actRejected(1, setFocus(thebes, 'grow'))).toBe('noSuchCity');
    expect(await ada.actRejected(1, setFocus('c2_nosuch', 'grow'))).toBe('noSuchCity');
    await ben.expectNothingPending();
    expect(server.save(code).game?.cities[thebes].focus).toBe('build');

    // Thebes builds a Fishing Boat, on "Build first" all the way. The boat
    // appears on the coast tile in Ada's sight, and she is shown what
    // anybody may know of a unit: its id, type, owner and tile.
    const boat = await raiseBoat(ben, [ben, ada]);
    expect(boat.tile).toBe(inSight);
    const boatSeenByAda = { id: boat.id, type: 'fishingBoat', owner: 'p2', tile: inSight, own: null };
    expect(bensUnitsInAdasView()).toStrictEqual(asListed([warriorSeenByAda, boatSeenByAda]));
    expect(ada.view?.cities).toStrictEqual([seenByAda(ownCity(ben.view).population)]);

    // The boat begins a net where it lies. That is an order: Ada's socket carries nothing.
    adaFrames = ada.frames.length;
    adaView = ada.view;
    await ben.actOk(turnOf(ben), { type: 'startJob', unitId: boat.id, improvement: 'fishingNet' });
    await ada.expectNothingPending();
    expect(framesSince(ada, adaFrames)).toEqual([]);
    expect(ada.view).toBe(adaView);
    // Turn after turn Ben is told how far the work is. Ada sees the same
    // boat on the same bare tile, and nothing says that it is at work.
    for (let worked = 0; worked < net.turns; worked++) {
      expect(ownUnit(ben.view, 'fishingBoat').own?.job).toMatchObject({ improvement: 'fishingNet', turnsWorked: worked });
      expect(bensUnitsInAdasView()).toStrictEqual(asListed([warriorSeenByAda, boatSeenByAda]));
      expect(ada.view?.tiles[inSight]?.improvement).toBeNull();
      await endTurn([ben, ada]);
    }
    // Finished. The net is on a tile Ada sees, so she sees the net; the news of it went to Ben alone.
    expect(ben.view?.tiles[inSight]?.improvement).toBe('fishingNet');
    expect(ada.view?.tiles[inSight]).toStrictEqual({ terrain: 'coast', feature: null, improvement: 'fishingNet', owner: 'p2', visible: true });
    expect(bensUnitsInAdasView()).toStrictEqual(asListed([warriorSeenByAda, boatSeenByAda]));

    // The boat sails one tile on, out of Ada's sight: it is gone from her
    // view (a unit is never remembered), and so is everything it does there.
    await ben.actOk(turnOf(ben), { type: 'moveUnit', unitId: boat.id, path: [outOfSight] });
    const gone = await ada.nextOfType('gameUpdate');
    expect(Object.keys(gone.patch)).toEqual(['units']);
    expect(gone.events).toEqual([]);
    expect(bensUnitsInAdasView()).toStrictEqual([warriorSeenByAda]);
    adaFrames = ada.frames.length;
    await ben.actOk(turnOf(ben), { type: 'startJob', unitId: boat.id, improvement: 'fishingNet' });
    await ada.expectNothingPending();
    expect(framesSince(ada, adaFrames)).toEqual([]);
    for (let worked = 0; worked < net.turns; worked++) await endTurn([ben, ada]);
    // The second net stands, in Ben's view and in the file. Ada knows of one net, and of no boat.
    expect(ben.view?.tiles[outOfSight]?.improvement).toBe('fishingNet');
    expect(server.save(code).game?.map.tiles.flatMap((tile, index) => (tile.improvement === null ? [] : [[index, tile.improvement]]))).toEqual([
      [inSight, 'fishingNet'],
      [outOfSight, 'fishingNet'],
    ]);
    expect(ada.view?.tiles[outOfSight]).toBeNull();
    expect(ada.view?.tiles.flatMap((tile, index) => (tile?.improvement ? [index] : []))).toEqual([inSight]);
    expect(bensUnitsInAdasView()).toStrictEqual([warriorSeenByAda]);
    expect(server.save(code).game?.units[boat.id]).toMatchObject({ tile: outOfSight, movesLeft: UNITS.fishingBoat.moves, job: null });

    // Every frame Ada was ever sent, taken apart: a city of Ben's is the
    // seven public facts and no more; a unit of his has no details; and the
    // only news she got is her own and the turn counter.
    let citiesSeen = 0;
    let boatsSeen = 0;
    for (const frame of ada.frames) {
      const message = JSON.parse(frame) as ServerMessage;
      if (message.type !== 'gameUpdate' && message.type !== 'gameSync') continue;
      const cities = message.type === 'gameSync' ? message.view.cities : (message.patch.cities ?? []);
      const units = message.type === 'gameSync' ? message.view.units : (message.patch.units ?? []);
      for (const city of cities) {
        citiesSeen += 1;
        expect(city).toStrictEqual(seenByAda(city.population));
      }
      for (const unit of units.filter((candidate) => candidate.owner === 'p2')) {
        if (unit.id === boat.id) boatsSeen += 1;
        expect(unit).toStrictEqual(unit.id === boat.id ? boatSeenByAda : warriorSeenByAda);
      }
      for (const event of message.events) {
        if (event.type !== 'turnStarted') expect(event.playerId).toBe('p1');
      }
    }
    // The check can fail: she was sent the city more than once (it grew) and the boat at least once.
    expect(citiesSeen).toBeGreaterThan(1);
    expect(boatsSeen).toBeGreaterThan(0);
    // And in words: of the job, the queue, the menu and the choice, not one.
    const everythingAdaGot = ada.frames.join('\n');
    const everythingBenGot = ben.frames.join('\n');
    const secrets = [
      '"turnsWorked"', '"turnsLeft"', '"job":{', 'improvementBuilt', 'unitBuilt', '"focus"', '"worked"',
      'buildQueue', 'buildOptions', 'productionStored', '"scoutBoat"',
    ];
    for (const secret of secrets) {
      expect(everythingBenGot.includes(secret), `Ben was told ${secret}`).toBe(true);
      expect(everythingAdaGot.includes(secret), `Ada was told ${secret}`).toBe(false);
    }
  });
});
