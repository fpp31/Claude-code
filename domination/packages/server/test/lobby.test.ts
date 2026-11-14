import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CIV_IDS, GAME_CODE_ALPHABET, RULES, SERVER_ERROR_MESSAGE, maxPlayers } from '@domination/shared';
import type { LobbyView } from '@domination/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOM_FILE_FORMAT } from '../src/roomFile';
import { hashToken } from '../src/tokens';
import { CANARY, createFakeRules, fakeUnitId } from './fakeRules';
import { cleanUp, failingStorage, gameWith, lobbyWith, newDiskControl, startTestServer } from './harness';
import type { TestClient, TestServer } from './harness';

/**
 * The lobby: creating a game, joining by code, civilizations, map size,
 * leaving and starting. Socket level, with the fake rules (the lobby does
 * not depend on the rules of the game).
 */

afterEach(cleanUp);

function fakeServer(): Promise<TestServer> {
  return startTestServer({ rules: createFakeRules().rules });
}

/** The lobby as this client sees it right now (asks the server again, like a page reload would). */
async function currentLobby(client: TestClient, code: string): Promise<LobbyView> {
  return client.joinLobby(code, null);
}

describe('lobby flow (WP3)', () => {
  it('createGame puts the creator on seat p1 as host and sends the lobby with a 5-character code', async () => {
    const server = await fakeServer();
    const creator = await server.connect();
    const lobby = await creator.createGame('Ada');

    expect(lobby.code).toHaveLength(5);
    for (const character of lobby.code) expect(GAME_CODE_ALPHABET).toContain(character);
    expect(lobby).toEqual({
      code: lobby.code,
      you: 'p1',
      hostId: 'p1',
      mapSize: 'small',
      maxPlayers: maxPlayers(),
      seats: [{ playerId: 'p1', name: 'Ada', civ: CIV_IDS[0], connected: true }],
    });
    await creator.expectNothingPending();

    // The game is on disk at once, as a lobby, with the hash of the token and never the token.
    const saved = server.save(lobby.code);
    expect(saved.format).toBe(ROOM_FILE_FORMAT);
    expect(saved.code).toBe(lobby.code);
    expect(saved.hostId).toBe('p1');
    expect(saved.game).toBeNull();
    expect(saved.seats).toEqual([{ playerId: 'p1', tokenHash: hashToken(creator.token), name: 'Ada', civ: CIV_IDS[0] }]);
    expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false);
    expect(server.saveText(lobby.code)).not.toContain(creator.token);
  });

  it('two games get two different codes', async () => {
    const server = await fakeServer();
    const first = await (await server.connect()).createGame('Ada');
    const second = await (await server.connect()).createGame('Ben');
    expect(second.code).not.toBe(first.code);
  });

  it('names are cleaned on the server; a name with nothing left is refused with badName and creates nothing', async () => {
    const server = await fakeServer();
    const creator = await server.connect();
    const lobby = await creator.createGame('   A\u0000d\u0007a \n\t  Lovelace‮   ');
    expect(lobby.seats[0].name).toBe('Ada Lovelace');

    const guest = await server.connect();
    const joined = await guest.joinLobby(lobby.code, `  ${'x'.repeat(150)}  `);
    expect(joined.seats[1].name).toBe('x'.repeat(RULES.maxNameLength));
    expect((await creator.nextLobby()).seats[1].name).toBe('x'.repeat(RULES.maxNameLength));

    const nameless = await server.connect();
    for (const name of ['', '     ', '\u0000\u0001', '\n\t']) {
      nameless.send({ type: 'createGame', name });
      await nameless.expectError('badName');
    }
    // Only the one game exists.
    expect(readdirSync(join(server.dataDir, 'rooms'))).toEqual([`${lobby.code}.json`]);
  });

  it('joinGame by code (any letter case) takes the lowest free seat and the first free civilization, and every socket receives the new lobby', async () => {
    const server = await fakeServer();
    const ada = await server.connect();
    const { code } = await ada.createGame('Ada');

    const ben = await server.connect();
    const benLobby = await ben.joinLobby(`  ${code.toLowerCase()} `, 'Ben');
    expect(benLobby.you).toBe('p2');
    expect(benLobby.seats).toEqual([
      { playerId: 'p1', name: 'Ada', civ: CIV_IDS[0], connected: true },
      { playerId: 'p2', name: 'Ben', civ: CIV_IDS[1], connected: true },
    ]);
    // The host is told too, with the same lobby but its own `you`.
    expect(await ada.nextLobby()).toEqual({ ...benLobby, you: 'p1' });

    const cleo = await server.connect();
    const cleoLobby = await cleo.joinLobby(code, 'Cleo');
    expect(cleoLobby.you).toBe('p3');
    expect(cleoLobby.seats[2]).toEqual({ playerId: 'p3', name: 'Cleo', civ: CIV_IDS[2], connected: true });
    expect(await ada.nextLobby()).toEqual({ ...cleoLobby, you: 'p1' });
    expect(await ben.nextLobby()).toEqual({ ...cleoLobby, you: 'p2' });

    for (const client of [ada, ben, cleo]) await client.expectNothingPending();
    expect(server.save(code).seats.map((seat) => seat.playerId)).toEqual(['p1', 'p2', 'p3']);
    expect(server.save(code).seats[1].tokenHash).toBe(hashToken(ben.token));
  });

  it('a seat and a civilization that were given up are handed out again, lowest first', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben', 'Cleo']);
    const [ada, ben, cleo] = clients;

    // Cleo takes the last civilization, then Ben (p2, the second civilization) leaves.
    cleo.send({ type: 'chooseCiv', civ: CIV_IDS[5] });
    for (const client of clients) await client.nextLobby();
    ben.send({ type: 'leaveGame' });
    await ben.nextOfType('left');
    for (const client of [ada, cleo]) await client.nextLobby();

    // The newcomer gets seat p2 (the lowest free one), listed in seat order, and the first free civilization.
    const dana = await server.connect();
    const lobby = await dana.joinLobby(code, 'Dana');
    expect(lobby.you).toBe('p2');
    expect(lobby.seats.map((seat) => [seat.playerId, seat.name, seat.civ])).toEqual([
      ['p1', 'Ada', CIV_IDS[0]],
      ['p2', 'Dana', CIV_IDS[1]],
      ['p3', 'Cleo', CIV_IDS[5]],
    ]);
    expect(server.save(code).seats.map((seat) => seat.playerId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('joinGame without a name for a new seat gets nameRequired and takes no seat; an empty name gets badName', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada']);
    const before = server.saveText(code);

    const visitor = await server.connect();
    visitor.send({ type: 'joinGame', code, name: null });
    await visitor.expectError('nameRequired');
    visitor.send({ type: 'joinGame', code, name: '   ' });
    await visitor.expectError('badName');
    visitor.send({ type: 'joinGame', code, name: '\u0000' });
    await visitor.expectError('badName');

    // No seat was taken, nothing was saved, the host heard nothing, and the visitor is in no game.
    expect(server.saveText(code)).toBe(before);
    await clients[0].expectNothingPending();
    visitor.send({ type: 'chooseCiv', civ: 'maya' });
    await visitor.expectError('notInGame');
  });

  it('joinGame with an unknown code gets noSuchGame', async () => {
    const server = await fakeServer();
    await lobbyWith(server, ['Ada']);
    const visitor = await server.connect();

    for (const code of ['ZZZZZ', 'zzzzz', '', 'AB', 'TOOLONGCODE', '../..', 'AAAA0', '     ']) {
      visitor.send({ type: 'joinGame', code, name: 'Ben' });
      await visitor.expectError('noSuchGame');
    }
  });

  it('the lobby is full after maxPlayers() seats: gameFull (also when sent without a name)', async () => {
    const server = await fakeServer();
    const names = ['Ada', 'Ben', 'Cleo', 'Dana', 'Emil', 'Freya', 'Gus', 'Hana'].slice(0, maxPlayers());
    const { code, clients } = await lobbyWith(server, names);

    const lobby = await currentLobby(clients[0], code);
    expect(lobby.seats).toHaveLength(maxPlayers());
    // Every civilization is taken exactly once.
    expect(lobby.seats.map((seat) => seat.civ).sort()).toEqual([...CIV_IDS].sort());
    const before = server.saveText(code);

    const late = await server.connect();
    late.send({ type: 'joinGame', code, name: 'Late' });
    await late.expectError('gameFull');
    late.send({ type: 'joinGame', code, name: null });
    await late.expectError('gameFull');

    expect(server.saveText(code)).toBe(before);
    for (const client of clients) await client.expectNothingPending();
  });

  it('chooseCiv changes the civilization; picking a taken one gets civTaken', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    ben.send({ type: 'chooseCiv', civ: 'norse' });
    const lobby = await ben.nextLobby();
    expect(lobby.seats.map((seat) => seat.civ)).toEqual(['rome', 'norse']);
    expect(await ada.nextLobby()).toEqual({ ...lobby, you: 'p1' });
    expect(server.save(code).seats[1].civ).toBe('norse');

    // Ada's civilization is taken.
    const before = server.saveText(code);
    ben.send({ type: 'chooseCiv', civ: 'rome' });
    await ben.expectError('civTaken');
    expect(server.saveText(code)).toBe(before);
    await ada.expectNothingPending();

    // The one Ben gave up is free again.
    ada.send({ type: 'chooseCiv', civ: 'egypt' });
    expect((await ada.nextLobby()).seats.map((seat) => seat.civ)).toEqual(['egypt', 'norse']);
    await ben.nextLobby();

    // Choosing the civilization one already has is not an error.
    ada.send({ type: 'chooseCiv', civ: 'egypt' });
    expect((await ada.nextLobby()).seats.map((seat) => seat.civ)).toEqual(['egypt', 'norse']);
  });

  it('only the host can setMapSize and startGame (notHost)', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const before = server.saveText(code);

    ben.send({ type: 'setMapSize', mapSize: 'large' });
    await ben.expectError('notHost');
    ben.send({ type: 'startGame' });
    await ben.expectError('notHost');
    expect(server.saveText(code)).toBe(before);
    await ada.expectNothingPending();

    ada.send({ type: 'setMapSize', mapSize: 'large' });
    const lobby = await ada.nextLobby();
    expect(lobby.mapSize).toBe('large');
    expect(await ben.nextLobby()).toEqual({ ...lobby, you: 'p2' });
    expect(server.save(code).mapSize).toBe('large');
  });

  it('lobby messages from a socket that is in no game get notInGame', async () => {
    const server = await fakeServer();
    const loner = await server.connect();
    loner.send({ type: 'chooseCiv', civ: 'maya' });
    await loner.expectError('notInGame');
    loner.send({ type: 'setMapSize', mapSize: 'large' });
    await loner.expectError('notInGame');
    loner.send({ type: 'startGame' });
    await loner.expectError('notInGame');
    loner.send({ type: 'leaveGame' });
    await loner.expectError('notInGame');
    loner.send({ type: 'resync' });
    await loner.expectError('notInGame');
  });

  it('chooseCiv, setMapSize and startGame are lobby only: in a running game they get notInGame', async () => {
    const server = await fakeServer();
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const before = server.saveText(code);

    for (const client of clients) {
      client.send({ type: 'chooseCiv', civ: 'maya' });
      await client.expectError('notInGame');
      client.send({ type: 'setMapSize', mapSize: 'large' });
      await client.expectError('notInGame');
      client.send({ type: 'startGame' });
      await client.expectError('notInGame');
    }
    expect(server.saveText(code)).toBe(before);
  });

  it('when the host leaves, a player who has closed the page is passed over: the next one who is there becomes host', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben', 'Cleo']);
    const [ada, ben, cleo] = clients;

    // Ben closes his page without pressing Leave: he keeps his seat, but nobody sits on it.
    await ben.close();
    expect((await ada.nextLobby()).seats.map((seat) => seat.connected)).toEqual([true, false, true]);
    await cleo.nextLobby();

    // The host leaves. Ben (p2) would be next in line, but he could not press Start: Cleo (p3) becomes host.
    ada.send({ type: 'leaveGame' });
    await ada.nextOfType('left');
    const afterAda = await cleo.nextLobby();
    expect(afterAda.seats.map((seat) => [seat.playerId, seat.connected])).toEqual([['p2', false], ['p3', true]]);
    expect(afterAda.hostId).toBe('p3');
    expect(server.save(code).hostId).toBe('p3');

    // And she really has the host's rights.
    cleo.send({ type: 'setMapSize', mapSize: 'large' });
    expect((await cleo.nextLobby()).mapSize).toBe('large');
  });

  it('when the host leaves and nobody else is connected, the lowest remaining seat becomes host', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben', 'Cleo']);
    const [ada, ben, cleo] = clients;
    await ben.close();
    await cleo.close();
    await ada.nextLobby();
    await ada.nextLobby();

    ada.send({ type: 'leaveGame' });
    await ada.nextOfType('left');
    expect(server.save(code).hostId).toBe('p2');
    expect(server.save(code).seats.map((seat) => seat.playerId)).toEqual(['p2', 'p3']);
  });

  it('leaveGame frees the seat; the lowest remaining seat becomes host; the last one leaving deletes the room and its file', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben', 'Cleo']);
    const [ada, ben, cleo] = clients;

    // The host leaves: Ben (p2) is the lowest remaining seat and becomes host.
    ada.send({ type: 'leaveGame' });
    await ada.nextOfType('left');
    const afterAda = await ben.nextLobby();
    expect(afterAda.hostId).toBe('p2');
    expect(afterAda.seats.map((seat) => seat.playerId)).toEqual(['p2', 'p3']);
    expect(await cleo.nextLobby()).toEqual({ ...afterAda, you: 'p3' });
    expect(server.save(code).hostId).toBe('p2');
    expect(server.save(code).seats.map((seat) => seat.name)).toEqual(['Ben', 'Cleo']);
    await ada.expectNothingPending();

    // Somebody who is not the host leaves: the host stays.
    cleo.send({ type: 'leaveGame' });
    await cleo.nextOfType('left');
    const afterCleo = await ben.nextLobby();
    expect(afterCleo.hostId).toBe('p2');
    expect(afterCleo.seats.map((seat) => seat.playerId)).toEqual(['p2']);

    // The new host really has the host's rights.
    ben.send({ type: 'setMapSize', mapSize: 'medium' });
    expect((await ben.nextLobby()).mapSize).toBe('medium');

    // The last one leaves: the game is gone, from memory and from disk.
    ben.send({ type: 'leaveGame' });
    await ben.nextOfType('left');
    expect(existsSync(server.savePath(code))).toBe(false);
    expect(readdirSync(join(server.dataDir, 'rooms'))).toEqual([]);
    ada.send({ type: 'joinGame', code, name: 'Ada' });
    await ada.expectError('noSuchGame');
  });

  it('leaveGame in the lobby sends `left` to every socket of that seat (a second tab too), and those sockets then get notInGame', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    // Ben opens the game in a second tab (same token).
    const benTab = await server.connect(ben.token);
    expect((await benTab.joinLobby(code, null)).you).toBe('p2');
    await ada.nextLobby();
    await ben.nextLobby();

    benTab.send({ type: 'leaveGame' });
    expect(await benTab.next()).toEqual({ type: 'left' });
    expect(await ben.next()).toEqual({ type: 'left' });
    expect((await ada.nextLobby()).seats.map((seat) => seat.playerId)).toEqual(['p1']);

    // Both of Ben's sockets are out of the game now.
    for (const socket of [ben, benTab]) {
      socket.send({ type: 'chooseCiv', civ: 'maya' });
      await socket.expectError('notInGame');
      socket.send({ type: 'leaveGame' });
      await socket.expectError('notInGame');
      socket.send({ type: 'resync' });
      await socket.expectError('notInGame');
    }
    await ada.expectNothingPending();
    expect(server.save(code).seats.map((seat) => seat.name)).toEqual(['Ada']);
  });

  it('the last seat leaving from one tab also sends `left` to its other tab', async () => {
    const server = await fakeServer();
    const ada = await server.connect();
    const { code } = await ada.createGame('Ada');
    const adaTab = await server.connect(ada.token);
    await adaTab.joinLobby(code, null);
    await ada.nextLobby();

    ada.send({ type: 'leaveGame' });
    expect(await ada.next()).toEqual({ type: 'left' });
    expect(await adaTab.next()).toEqual({ type: 'left' });
    expect(existsSync(server.savePath(code))).toBe(false);
    adaTab.send({ type: 'startGame' });
    await adaTab.expectError('notInGame');
  });

  it('a single player can start a game', async () => {
    const { rules, control } = createFakeRules();
    const server = await startTestServer({ rules });
    const solo = await server.connect();
    const { code } = await solo.createGame('Ada');

    solo.send({ type: 'setMapSize', mapSize: 'medium' });
    await solo.nextLobby();
    solo.send({ type: 'startGame' });
    const sync = await solo.nextOfType('gameSync');
    expect(sync.code).toBe(code);
    expect(sync.seq).toBe(1);
    expect(sync.view.you).toBe('p1');
    expect(sync.view.turn).toBe(1);
    expect(sync.connected).toEqual(['p1']);
    expect(sync.events).toEqual([]);
    await solo.expectNothingPending();

    // What the rules were asked to create: the lobby's settings, a random seed, the seats in seat order.
    expect(control.setups).toHaveLength(1);
    expect(control.setups[0].settings).toEqual({ mapSize: 'medium', turnMode: 'simultaneous' });
    expect(control.setups[0].players).toEqual([{ id: 'p1', name: 'Ada', civ: CIV_IDS[0] }]);
    expect(control.setups[0].seed).toMatch(/^[0-9a-f]{32}$/);
    expect(server.save(code).game?.turn).toBe(1);
  });

  it('every game gets a seed of its own', async () => {
    const { rules, control } = createFakeRules();
    const server = await startTestServer({ rules });
    for (const name of ['Ada', 'Ben']) {
      const player = await server.connect();
      await player.createGame(name);
      player.send({ type: 'startGame' });
      await player.nextOfType('gameSync');
    }
    expect(control.setups[0].seed).not.toBe(control.setups[1].seed);
  });

  it('startGame sends every attached socket a gameSync with its own view', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben', 'Cleo']);
    // Ben also has a second tab open.
    const benTab = await server.connect(clients[1].token);
    await benTab.joinLobby(code, null);
    for (const client of clients) await client.nextLobby();

    clients[0].send({ type: 'startGame' });
    const everybody: [TestClient, string][] = [
      [clients[0], 'p1'],
      [clients[1], 'p2'],
      [clients[2], 'p3'],
      [benTab, 'p2'],
    ];
    for (const [client, seat] of everybody) {
      const sync = await client.nextOfType('gameSync');
      expect(sync.code).toBe(code);
      expect(sync.seq).toBe(1);
      expect(sync.view.you).toBe(seat);
      // In the fake game a player sees exactly their own unit.
      expect(sync.view.units.map((unit) => unit.id)).toEqual([fakeUnitId(seat)]);
      expect(sync.view.players.map((player) => player.name)).toEqual(['Ada', 'Ben', 'Cleo']);
      expect(sync.connected).toEqual(['p1', 'p2', 'p3']);
      expect(sync.events).toEqual([]);
      await client.expectNothingPending();
    }
  });

  it('startGame includes a seat with no socket attached; the game then waits for that seat', async () => {
    const { rules, control } = createFakeRules();
    const server = await startTestServer({ rules });
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    // Ben closes the page before the start.
    await ben.close();
    expect((await ada.nextLobby()).seats.map((seat) => seat.connected)).toEqual([true, false]);

    ada.send({ type: 'startGame' });
    const sync = await ada.nextOfType('gameSync');
    expect(sync.view.players.map((player) => player.id)).toEqual(['p1', 'p2']);
    expect(sync.connected).toEqual(['p1']);
    expect(control.setups[0].players.map((player) => player.name)).toEqual(['Ada', 'Ben']);

    // Ada ends her turn: the turn does not resolve, because Ben has not.
    await ada.actOk(1, { type: 'endTurn' });
    expect(ada.view?.turn).toBe(1);
    expect(ada.view?.players.map((player) => player.endedTurn)).toEqual([true, false]);
    expect(server.save(code).game?.turn).toBe(1);

    // Ben comes back to his seat and ends his turn: now it resolves.
    const benAgain = await server.connect(ben.token);
    benAgain.send({ type: 'joinGame', code, name: null });
    expect((await benAgain.nextOfType('gameSync')).view.you).toBe('p2');
    await ada.nextOfType('presence');
    await benAgain.actOk(1, { type: 'endTurn' });
    await ada.nextOfType('gameUpdate');
    expect(ada.view?.turn).toBe(2);
  });

  it('if the rules cannot create the game, the host gets serverError and the room stays in the lobby exactly as it was', async () => {
    const { rules, control } = createFakeRules();
    const server = await startTestServer({ rules });
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const before = server.saveText(code);

    control.createGameThrows = true;
    ada.send({ type: 'startGame' });
    const answer = await ada.nextOfType('error');
    expect(answer.code).toBe('serverError');
    expect(answer.message).toBe(SERVER_ERROR_MESSAGE);
    await ben.expectNothingPending();
    expect(server.saveText(code)).toBe(before);
    expect(server.logs.join('\n')).toContain(CANARY);
    for (const client of clients) expect(client.frames.join('\n')).not.toContain(CANARY);

    // Still a lobby: its messages work, and a second try succeeds.
    ben.send({ type: 'chooseCiv', civ: 'maya' });
    await ben.nextLobby();
    await ada.nextLobby();
    control.createGameThrows = false;
    ada.send({ type: 'startGame' });
    await ada.nextOfType('gameSync');
    await ben.nextOfType('gameSync');
  });

  it('if a seat cannot be shown its view at the start, nothing starts (serverError, still the lobby)', async () => {
    const { rules, control } = createFakeRules();
    const server = await startTestServer({ rules });
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
    const before = server.saveText(code);

    // Ben is not even connected; his view must still be buildable before anything is saved.
    await clients[1].close();
    await clients[0].nextLobby();
    control.viewThrowsFor = 'p2';
    clients[0].send({ type: 'startGame' });
    await clients[0].expectError('serverError');
    expect(server.saveText(code)).toBe(before);
  });

  it('joining a started game without a seat gets gameAlreadyStarted (with or without a name)', async () => {
    const server = await fakeServer();
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const before = server.saveText(code);

    const late = await server.connect();
    late.send({ type: 'joinGame', code, name: 'Late' });
    await late.expectError('gameAlreadyStarted');
    late.send({ type: 'joinGame', code, name: null });
    await late.expectError('gameAlreadyStarted');

    expect(server.saveText(code)).toBe(before);
    for (const client of clients) await client.expectNothingPending();
  });

  it('a lobby message never contains a token or a token hash', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben', 'Cleo']);
    clients[1].send({ type: 'chooseCiv', civ: 'norse' });
    for (const client of clients) await client.nextLobby();
    clients[2].send({ type: 'leaveGame' });
    await clients[2].nextOfType('left');
    await clients[0].nextLobby();
    await clients[1].nextLobby();

    const hashes = server.save(code).seats.map((seat) => seat.tokenHash);
    hashes.push(hashToken(clients[2].token));
    for (const client of clients) {
      for (const frame of client.frames) {
        const message = JSON.parse(frame);
        // The one place a token appears is the `welcome`, and it is the client's own.
        if (message.type === 'welcome') {
          expect(message.token).toBe(client.token);
          continue;
        }
        for (const other of clients) expect(frame).not.toContain(other.token);
        for (const hash of hashes) expect(frame).not.toContain(hash);
        expect(frame).not.toContain('tokenHash');
        if (message.type === 'lobby') {
          expect(Object.keys(message.lobby).sort()).toEqual(['code', 'hostId', 'mapSize', 'maxPlayers', 'seats', 'you']);
          for (const seat of message.lobby.seats) {
            expect(Object.keys(seat).sort()).toEqual(['civ', 'connected', 'name', 'playerId']);
          }
        }
      }
    }
  });

  it('joinGame for the room the socket is already attached to re-sends the lobby (or a gameSync) and does not attach it twice: the next update arrives once, with seq + 1', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    // In the lobby: only the asking socket gets the lobby again; the name is ignored.
    const again = await ada.joinLobby(code, 'Somebody Else');
    expect(again.seats.map((seat) => seat.name)).toEqual(['Ada', 'Ben']);
    await ben.expectNothingPending();
    // The next change arrives exactly once on the socket that asked twice.
    ben.send({ type: 'chooseCiv', civ: 'maya' });
    await ada.nextLobby();
    await ada.expectNothingPending();
    await ben.nextLobby();

    // In the running game: a fresh gameSync with the next seq.
    ada.send({ type: 'startGame' });
    expect((await ada.nextOfType('gameSync')).seq).toBe(1);
    await ben.nextOfType('gameSync');
    ada.send({ type: 'joinGame', code, name: null });
    expect((await ada.nextOfType('gameSync')).seq).toBe(2);
    ada.send({ type: 'joinGame', code: code.toLowerCase(), name: 'Ada' });
    expect((await ada.nextOfType('gameSync')).seq).toBe(3);
    await ben.expectNothingPending();

    // The next update arrives once, with seq + 1.
    await ben.actOk(1, { type: 'endTurn' });
    const update = await ada.nextOfType('gameUpdate');
    expect(update.seq).toBe(4);
    await ada.expectNothingPending();
    expect(server.save(code).seats).toHaveLength(2);
  });

  it('a failed joinGame (noSuchGame, gameFull, nameRequired) leaves the socket attached to the game it was in', async () => {
    const server = await fakeServer();
    const names = ['Ada', 'Ben', 'Cleo', 'Dana', 'Emil', 'Freya', 'Gus', 'Hana'].slice(0, maxPlayers());
    const full = await lobbyWith(server, names);
    const open = await lobbyWith(server, ['Zoe']);
    const home = await lobbyWith(server, ['Wanderer', 'Friend']);
    const [wanderer, friend] = home.clients;

    wanderer.send({ type: 'joinGame', code: 'ZZZZZ', name: 'Wanderer' });
    await wanderer.expectError('noSuchGame');
    wanderer.send({ type: 'joinGame', code: full.code, name: 'Wanderer' });
    await wanderer.expectError('gameFull');
    wanderer.send({ type: 'joinGame', code: open.code, name: null });
    await wanderer.expectError('nameRequired');
    wanderer.send({ type: 'joinGame', code: open.code, name: '   ' });
    await wanderer.expectError('badName');

    // Still attached at home: the friend never saw the wanderer go, and lobby messages still work there.
    await friend.expectNothingPending();
    wanderer.send({ type: 'setMapSize', mapSize: 'large' });
    expect((await wanderer.nextLobby()).code).toBe(home.code);
    expect((await friend.nextLobby()).seats.map((seat) => seat.connected)).toEqual([true, true]);
    // And nobody in the other games heard anything.
    for (const client of [...full.clients, ...open.clients]) await client.expectNothingPending();
  });

  it('createGame while in a game moves the socket to the new game; the seat in the old one is kept', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    const second = await ben.createGame('Ben again');
    expect(second.code).not.toBe(code);
    expect(second.you).toBe('p1');

    // The first game still has Ben's seat, shown as not connected.
    const first = await ada.nextLobby();
    expect(first.seats).toEqual([
      { playerId: 'p1', name: 'Ada', civ: CIV_IDS[0], connected: true },
      { playerId: 'p2', name: 'Ben', civ: CIV_IDS[1], connected: false },
    ]);
    expect(server.save(code).seats).toHaveLength(2);

    // Changes in the first game no longer reach Ben's socket.
    ada.send({ type: 'setMapSize', mapSize: 'large' });
    await ada.nextLobby();
    await ben.expectNothingPending();
  });

  it('if saving fails during a lobby change (join, leave, chooseCiv, setMapSize, start) the sender gets serverError and nobody sees the change', async () => {
    const disk = newDiskControl();
    const server = await startTestServer({
      rules: createFakeRules().rules,
      wrapStorage: (real) => failingStorage(real, disk),
    });
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const newcomer = await server.connect();
    const before = server.saveText(code);
    const lobbyBefore = await currentLobby(ada, code);

    disk.failSaves = true;
    const attempts: [TestClient, () => void][] = [
      [newcomer, () => newcomer.send({ type: 'joinGame', code, name: 'Cleo' })],
      [ben, () => ben.send({ type: 'leaveGame' })],
      [ben, () => ben.send({ type: 'chooseCiv', civ: 'maya' })],
      [ada, () => ada.send({ type: 'setMapSize', mapSize: 'large' })],
      [ada, () => ada.send({ type: 'startGame' })],
      [newcomer, () => newcomer.send({ type: 'createGame', name: 'Cleo' })],
    ];
    for (const [sender, attempt] of attempts) {
      attempt();
      const answer = await sender.nextOfType('error');
      expect(answer.code).toBe('serverError');
      expect(answer.message).toBe(SERVER_ERROR_MESSAGE);
      // Nobody was told anything, and the disk is as it was.
      for (const client of [ada, ben, newcomer]) await client.expectNothingPending();
      expect(server.saveText(code)).toBe(before);
    }
    // The failed createGame left no game behind.
    expect(readdirSync(join(server.dataDir, 'rooms'))).toEqual([`${code}.json`]);

    // Memory is as it was too: same lobby, Ben still in it, the newcomer in no game.
    disk.failSaves = false;
    expect(await currentLobby(ada, code)).toEqual(lobbyBefore);
    expect((await currentLobby(ben, code)).you).toBe('p2');
    newcomer.send({ type: 'resync' });
    await newcomer.expectError('notInGame');

    // And every one of those changes works once the disk does.
    ben.send({ type: 'chooseCiv', civ: 'maya' });
    expect((await ben.nextLobby()).seats[1].civ).toBe('maya');
    await ada.nextLobby();
  });

  it('a save failure is logged with its cause', async () => {
    const disk = newDiskControl();
    disk.failSaves = true;
    const server = await startTestServer({
      rules: createFakeRules().rules,
      wrapStorage: (real) => failingStorage(real, disk),
    });
    const client = await server.connect();
    client.send({ type: 'createGame', name: 'Ada' });
    await client.expectError('serverError');
    expect(server.logs.join('\n')).toContain('the disk is full');
    expect(client.frames.join('\n')).not.toContain('the disk is full');
  });
});
