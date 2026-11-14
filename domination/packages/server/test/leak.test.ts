import { cpSync } from 'node:fs';
import type { Action, PlayerView, ServerMessage } from '@domination/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { hashToken } from '../src/tokens';
import { cleanUp, gameWith, lobbyWith, startTestServer, temporaryFolder } from './harness';
import type { TestClient, TestServer } from './harness';
import { MEADOW_WIDTH, at, ownUnit, realRulesOnMeadow } from './realWorld';

/**
 * NOTHING HIDDEN ON THE WIRE. These tests look at the raw text of every
 * frame the server sends, with the real rules, in games where one player
 * does things the other cannot see.
 *
 * The stage: Ada (p1, Rome) starts at the west end of a long meadow, Ben
 * (p2, Egypt) at the east end, seventeen tiles apart. Units see two or three
 * tiles, a city sees three, so neither ever sees anything of the other.
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
  await ben.actOk(1, { type: 'setProduction', cityId: benCity.id, item: { kind: 'unit', unitType: 'scout' } });

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
    await ben.actOk(1, { type: 'setProduction', cityId: city.id, item: { kind: 'unit', unitType: 'settler' } });
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
          await ada.actOk(1, { type: 'setProduction', cityId: capital.id, item: { kind: 'unit', unitType: 'warrior' } });
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
        await ben.actOk(1, { type: 'setProduction', cityId: city.id, item: { kind: 'unit', unitType: 'warrior' } });
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
        await ben.actOk(2, { type: 'setProduction', cityId: city.id, item: { kind: 'unit', unitType: 'scout' } });
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
