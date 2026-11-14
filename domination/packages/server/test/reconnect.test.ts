import { readFileSync, writeFileSync } from 'node:fs';
import { CIV_IDS } from '@domination/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { hashToken } from '../src/tokens';
import { createFakeRules, fakeUnitId } from './fakeRules';
import { cleanUp, gameWith, lobbyWith, startTestServer } from './harness';
import type { TestServer } from './harness';

/**
 * Coming back: a new socket with the same token gets its old seat, in the
 * lobby and in a running game; sockets come and go without the game
 * noticing more than "connected" or "not connected". Socket level, with the
 * fake rules.
 */

afterEach(cleanUp);

function fakeServer(dataDir?: string): Promise<TestServer> {
  return startTestServer({ rules: createFakeRules().rules, dataDir });
}

/**
 * What the README tells the server's owner to do for a player who lost
 * their token: in the save file, replace the seat's "tokenHash": "..." by
 * "tokenHash": null. The server must be stopped while this is done.
 */
function freeSeatByHand(path: string, tokenHash: string): void {
  const text = readFileSync(path, 'utf8');
  const edited = text.replace(`"tokenHash": "${tokenHash}"`, '"tokenHash": null');
  expect(edited, 'the hash to replace was found in the save file').not.toBe(text);
  writeFileSync(path, edited);
}

describe('reconnect and resume (WP3)', () => {
  it('a new socket with the same token re-attaches to the same seat (lobby) and gets the lobby', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const before = server.saveText(code);

    await ben.close();
    expect((await ada.nextLobby()).seats.map((seat) => seat.connected)).toEqual([true, false]);

    // The page reloads: same token, joinGame without a name.
    const benAgain = await server.connect(ben.token);
    const lobby = await benAgain.joinLobby(code, null);
    expect(lobby.you).toBe('p2');
    expect(lobby.seats).toEqual([
      { playerId: 'p1', name: 'Ada', civ: CIV_IDS[0], connected: true },
      { playerId: 'p2', name: 'Ben', civ: CIV_IDS[1], connected: true },
    ]);
    expect(await ada.nextLobby()).toEqual({ ...lobby, you: 'p1' });

    // No new seat, nothing saved; and the seat is really Ben's again.
    expect(server.saveText(code)).toBe(before);
    benAgain.send({ type: 'chooseCiv', civ: 'maya' });
    expect((await benAgain.nextLobby()).seats[1].civ).toBe('maya');
  });

  it('coming back with a name does not rename the seat or take a second one', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
    await clients[1].close();
    await clients[0].nextLobby();

    const benAgain = await server.connect(clients[1].token);
    const lobby = await benAgain.joinLobby(code, 'Benjamin');
    expect(lobby.you).toBe('p2');
    expect(lobby.seats.map((seat) => seat.name)).toEqual(['Ada', 'Ben']);
  });

  it('a new socket with the same token re-attaches to the same seat (running game) and gets a full gameSync with seq 1', async () => {
    const server = await fakeServer();
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    // Ben plays a little, so his old socket is well past seq 1.
    await ben.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p2'), path: [33] });
    await ben.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p2'), path: [34] });
    expect(ben.seq).toBe(3);
    const viewBefore = ben.view;
    const before = server.saveText(code);
    await ben.close();
    expect(await ada.next()).toEqual({ type: 'presence', connected: ['p1'] });

    const benAgain = await server.connect(ben.token);
    benAgain.send({ type: 'joinGame', code, name: null });
    const sync = await benAgain.nextOfType('gameSync');
    expect(sync.seq).toBe(1);
    expect(sync.code).toBe(code);
    expect(sync.view).toEqual(viewBefore);
    expect(sync.view.you).toBe('p2');
    expect(sync.connected).toEqual(['p1', 'p2']);
    expect(sync.events).toEqual([]);
    await benAgain.expectNothingPending();
    expect(await ada.next()).toEqual({ type: 'presence', connected: ['p1', 'p2'] });
    expect(server.saveText(code)).toBe(before);

    // The new socket counts on from 1.
    await benAgain.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p2'), path: [35] });
    expect(benAgain.seq).toBe(2);
  });

  it('a different token cannot take over a seat', async () => {
    const server = await fakeServer();
    const lobby = await lobbyWith(server, ['Ada', 'Ben']);
    const game = await gameWith(server, ['Cleo', 'Dana']);

    const stranger = await server.connect();
    expect(stranger.token).not.toBe(lobby.clients[0].token);

    // In a running game there is no seat for a stranger, whatever name they give.
    for (const name of ['Cleo', 'Dana', null]) {
      stranger.send({ type: 'joinGame', code: game.code, name });
      await stranger.expectError('gameAlreadyStarted');
    }
    // In a lobby a stranger using somebody's name gets a NEW seat, not that player's.
    const joined = await stranger.joinLobby(lobby.code, 'Ada');
    expect(joined.you).toBe('p3');
    expect(joined.hostId).toBe('p1');
    stranger.send({ type: 'startGame' });
    await stranger.expectError('notHost');

    // A token that is almost right (one character off) is a different token.
    const almost = `${game.clients[0].token.slice(0, 31)}${game.clients[0].token.endsWith('0') ? '1' : '0'}`;
    const forger = await server.connect(almost);
    forger.send({ type: 'joinGame', code: game.code, name: null });
    await forger.expectError('gameAlreadyStarted');
    // Neither is the stored hash itself (cut to token length or not).
    const hash = server.save(game.code).seats[0].tokenHash ?? '';
    const replayer = await server.connect(hash.slice(0, 32));
    replayer.send({ type: 'joinGame', code: game.code, name: null });
    await replayer.expectError('gameAlreadyStarted');

    expect(server.save(game.code).seats.map((seat) => seat.tokenHash)).toEqual(
      game.clients.map((client) => hashToken(client.token)),
    );
  });

  it('disconnecting marks the seat as not connected for the others (lobby message / presence) and reconnecting restores it', async () => {
    const server = await fakeServer();
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben', 'Cleo']);
    const [ada, ben, cleo] = clients;

    // Lobby: the others get a new lobby.
    await cleo.close();
    for (const other of [ada, ben]) {
      expect((await other.nextLobby()).seats.map((seat) => seat.connected)).toEqual([true, true, false]);
    }
    const cleoAgain = await server.connect(cleo.token);
    await cleoAgain.joinLobby(code, null);
    for (const other of [ada, ben]) {
      expect((await other.nextLobby()).seats.map((seat) => seat.connected)).toEqual([true, true, true]);
    }

    // Running game: the others get `presence`.
    ada.send({ type: 'startGame' });
    for (const client of [ada, ben, cleoAgain]) await client.nextOfType('gameSync');
    await ben.close();
    for (const other of [ada, cleoAgain]) {
      expect(await other.next()).toEqual({ type: 'presence', connected: ['p1', 'p3'] });
    }
    const benAgain = await server.connect(ben.token);
    benAgain.send({ type: 'joinGame', code, name: null });
    expect((await benAgain.nextOfType('gameSync')).connected).toEqual(['p1', 'p2', 'p3']);
    for (const other of [ada, cleoAgain]) {
      expect(await other.next()).toEqual({ type: 'presence', connected: ['p1', 'p2', 'p3'] });
    }
    // The one who came back is not sent a `presence` on top of the gameSync.
    await benAgain.expectNothingPending();
  });

  it('a seat with two sockets stays connected until the last one is gone', async () => {
    const server = await fakeServer();
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    // A second tab attaches: Ben was connected already, so nobody is told anything.
    const benTab = await server.connect(ben.token);
    benTab.send({ type: 'joinGame', code, name: null });
    await benTab.nextOfType('gameSync');
    await ada.expectNothingPending();
    await ben.expectNothingPending();

    // One of the two closes: still connected.
    await ben.close();
    await ada.expectNothingPending();
    await benTab.expectNothingPending();
    // The other closes too: now the seat is not connected.
    await benTab.close();
    expect(await ada.next()).toEqual({ type: 'presence', connected: ['p1'] });
  });

  it('leaveGame in a running game only detaches that socket: the seat is kept and can be re-joined', async () => {
    const server = await fakeServer();
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const before = server.saveText(code);

    ben.send({ type: 'leaveGame' });
    expect(await ben.next()).toEqual({ type: 'left' });
    expect(await ada.next()).toEqual({ type: 'presence', connected: ['p1'] });
    expect(server.saveText(code)).toBe(before);

    // Out of the game for now: actions get notInGame, and the game's updates no longer arrive.
    ben.send({ type: 'action', requestId: 1, turn: 1, action: { type: 'endTurn' } });
    await ben.expectError('notInGame');
    await ada.actOk(1, { type: 'endTurn' });
    await ben.expectNothingPending();

    // The same socket joins again and is back on its seat.
    ben.send({ type: 'joinGame', code, name: null });
    const sync = await ben.nextOfType('gameSync');
    expect(sync.seq).toBe(1);
    expect(sync.view.you).toBe('p2');
    expect(sync.view.players.map((player) => player.endedTurn)).toEqual([true, false]);
    expect(await ada.next()).toEqual({ type: 'presence', connected: ['p1', 'p2'] });
  });

  it('a disconnected player is waited for: the turn does not resolve without them', async () => {
    const server = await fakeServer();
    const { code, clients } = await gameWith(server, ['Ada', 'Ben', 'Cleo']);
    const [ada, ben, cleo] = clients;

    await cleo.close();
    for (const other of [ada, ben]) await other.nextOfType('presence');

    // Everybody who is connected ends the turn.
    await ada.actOk(1, { type: 'endTurn' });
    await ben.nextOfType('gameUpdate');
    await ben.actOk(1, { type: 'endTurn' });
    await ada.nextOfType('gameUpdate');
    expect(ada.view?.turn).toBe(1);
    expect(ada.view?.players.map((player) => player.endedTurn)).toEqual([true, true, false]);
    expect(server.save(code).game?.turn).toBe(1);

    // Cleo comes back, sees who is waiting, and ends the turn: now it resolves.
    const cleoAgain = await server.connect(cleo.token);
    cleoAgain.send({ type: 'joinGame', code, name: null });
    const sync = await cleoAgain.nextOfType('gameSync');
    expect(sync.view.players.map((player) => player.endedTurn)).toEqual([true, true, false]);
    for (const other of [ada, ben]) await other.nextOfType('presence');
    await cleoAgain.actOk(1, { type: 'endTurn' });
    for (const other of [ada, ben]) {
      await other.nextOfType('gameUpdate');
      expect(other.view?.turn).toBe(2);
    }
    expect(server.save(code).game?.turn).toBe(2);
  });

  it('two sockets on one seat each get their own seq; resync on one does not disturb the other', async () => {
    const server = await fakeServer();
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    // The first tab is at seq 3 when the second one opens.
    await ada.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p1'), path: [20] });
    await ada.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p1'), path: [21] });
    const adaTab = await server.connect(ada.token);
    adaTab.send({ type: 'joinGame', code, name: null });
    expect((await adaTab.nextOfType('gameSync')).seq).toBe(1);
    expect(ada.seq).toBe(3);

    // A change reaches both, each with its own next number.
    await ben.actOk(1, { type: 'endTurn' });
    expect((await ada.nextOfType('gameUpdate')).seq).toBe(4);
    expect((await adaTab.nextOfType('gameUpdate')).seq).toBe(2);

    // The second tab resyncs twice: only its own counter moves, and the first tab hears nothing.
    adaTab.send({ type: 'resync' });
    expect((await adaTab.nextOfType('gameSync')).seq).toBe(3);
    adaTab.send({ type: 'resync' });
    expect((await adaTab.nextOfType('gameSync')).seq).toBe(4);
    await ada.expectNothingPending();
    await ben.expectNothingPending();

    // The next change: 5 on both, by coincidence of this test; each still counted on its own.
    await adaTab.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p1'), path: [22] });
    expect(adaTab.seq).toBe(5);
    expect((await ada.nextOfType('gameUpdate')).seq).toBe(5);
    expect(ada.view).toEqual(adaTab.view);
  });

  it('resync sends a fresh gameSync with seq + 1, and the next gameUpdate continues from it', async () => {
    const server = await fakeServer();
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    await ada.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p1'), path: [50] });
    expect(ada.seq).toBe(2);
    const viewBefore = ada.view;

    ada.send({ type: 'resync' });
    const sync = await ada.nextOfType('gameSync');
    expect(sync.seq).toBe(3);
    expect(sync.code).toBe(code);
    expect(sync.view).toEqual(viewBefore);
    expect(sync.connected).toEqual(['p1', 'p2']);
    expect(sync.events).toEqual([]);
    await ben.expectNothingPending();

    // The next update is a patch against the view that was just sent, numbered on from it.
    const requestId = ada.sendAction(1, { type: 'moveUnit', unitId: fakeUnitId('p1'), path: [51] });
    const update = await ada.nextOfType('gameUpdate');
    expect(update.seq).toBe(4);
    expect(Object.keys(update.patch)).toEqual(['units']);
    expect(await ada.next()).toEqual({ type: 'actionOk', requestId });
  });

  it('resync in the lobby sends the lobby to the asking socket only', async () => {
    const server = await fakeServer();
    const { clients } = await lobbyWith(server, ['Ada', 'Ben']);
    clients[1].send({ type: 'resync' });
    const lobby = await clients[1].nextLobby();
    expect(lobby.you).toBe('p2');
    expect(lobby.seats).toHaveLength(2);
    await clients[0].expectNothingPending();
  });

  it('a socket that joins another game is detached from the first one, and its seat there is kept', async () => {
    const server = await fakeServer();
    const first = await gameWith(server, ['Ada', 'Ben']);
    const second = await lobbyWith(server, ['Cleo']);
    const [ada, ben] = first.clients;
    const [cleo] = second.clients;
    const firstSave = server.saveText(first.code);

    // Ben's socket joins the second game.
    const lobby = await ben.joinLobby(second.code, 'Ben');
    expect(lobby.you).toBe('p2');
    await cleo.nextLobby();

    // In the first game Ben's seat is still there, but not connected.
    expect(await ada.next()).toEqual({ type: 'presence', connected: ['p1'] });
    expect(server.saveText(first.code)).toBe(firstSave);

    // What happens in the first game no longer reaches Ben's socket...
    await ada.actOk(1, { type: 'endTurn' });
    await ben.expectNothingPending();
    // ...and his messages go to the game he is in now.
    ben.send({ type: 'action', requestId: 1, turn: 1, action: { type: 'endTurn' } });
    await ben.expectError('notInGame'); // the second game is still a lobby
    ben.send({ type: 'chooseCiv', civ: 'norse' });
    expect((await ben.nextLobby()).code).toBe(second.code);
    await cleo.nextLobby();

    // Going back is the ordinary reconnect: same seat, and Ada's ended turn is there to see.
    ben.send({ type: 'joinGame', code: first.code, name: null });
    const sync = await ben.nextOfType('gameSync');
    expect(sync.view.you).toBe('p2');
    expect(sync.view.players.map((player) => player.endedTurn)).toEqual([true, false]);
    expect(await ada.next()).toEqual({ type: 'presence', connected: ['p1', 'p2'] });
    // Leaving the second game's socket behind: Cleo sees Ben's seat there as not connected.
    expect((await cleo.nextLobby()).seats.map((seat) => seat.connected)).toEqual([true, false]);
  });

  it('a socket that moves from a running game to a lobby starts counting from seq 1 again when that game starts', async () => {
    const server = await fakeServer();
    const running = await gameWith(server, ['Ada', 'Ben']);
    const waiting = await lobbyWith(server, ['Cleo']);
    const [, ben] = running.clients;
    const [cleo] = waiting.clients;

    // Ben's socket is well past seq 1 in the running game...
    await ben.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p2'), path: [5] });
    await ben.actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p2'), path: [6] });
    expect(ben.seq).toBe(3);

    // ...then joins Cleo's lobby, and Cleo starts that game.
    await ben.joinLobby(waiting.code, 'Ben');
    await cleo.nextLobby();
    cleo.send({ type: 'startGame' });
    await cleo.nextOfType('gameSync');
    const sync = await ben.nextOfType('gameSync');
    expect(sync.code).toBe(waiting.code);
    expect(sync.seq).toBe(1);
    // And the first update there is a patch against THAT game's view, numbered 2.
    await cleo.actOk(1, { type: 'endTurn' });
    const update = await ben.nextOfType('gameUpdate');
    expect(update.seq).toBe(2);
    expect(Object.keys(update.patch)).toEqual(['players']);
  });

  it('a seat whose tokenHash was set to null in the save file is taken over by the next token that joins with a name (lobby and running game), keeping its name and civ; with name null the answer is nameRequired', async () => {
    // Two games: one stays in the lobby, one is started. In both, Ben is the player who lost his token.
    const first = await fakeServer();
    const lobby = await lobbyWith(first, ['Ada', 'Ben', 'Cleo']);
    const game = await gameWith(first, ['Ada', 'Ben', 'Cleo']);
    for (const table of [lobby, game]) {
      table.clients[1].send({ type: 'chooseCiv', civ: 'norse' });
    }
    // (chooseCiv is refused in the running game; in the lobby everybody gets the new lobby.)
    for (const client of lobby.clients) await client.nextLobby();
    await game.clients[1].expectError('notInGame');
    await game.clients[1].actOk(1, { type: 'moveUnit', unitId: fakeUnitId('p2'), path: [44] });
    const benOldToken = { lobby: lobby.clients[1].token, game: game.clients[1].token };
    const dataDir = first.dataDir;
    await first.close();

    // The server's owner frees Ben's seat in both files, by hand, while the server is stopped.
    freeSeatByHand(first.savePath(lobby.code), hashToken(benOldToken.lobby));
    freeSeatByHand(first.savePath(game.code), hashToken(benOldToken.game));

    const server = await fakeServer(dataDir);
    for (const code of [lobby.code, game.code]) {
      const before = server.saveText(code);

      // Opening the link (no name) takes nothing.
      const newBen = await server.connect();
      newBen.send({ type: 'joinGame', code, name: null });
      await newBen.expectError('nameRequired');
      newBen.send({ type: 'joinGame', code, name: '   ' });
      await newBen.expectError('badName');
      expect(server.saveText(code)).toBe(before);

      // Pressing Join (with any name) gives the freed seat: p2, with the old name and civilization.
      newBen.send({ type: 'joinGame', code, name: 'Benny on a new phone' });
      const answer = await newBen.next();
      if (answer.type === 'lobby') {
        expect(code).toBe(lobby.code);
        expect(answer.lobby.you).toBe('p2');
        expect(answer.lobby.seats[1]).toEqual({ playerId: 'p2', name: 'Ben', civ: 'norse', connected: true });
        expect(answer.lobby.seats).toHaveLength(3);
      } else if (answer.type === 'gameSync') {
        expect(code).toBe(game.code);
        expect(answer.view.you).toBe('p2');
        expect(answer.view.players[1]).toEqual({ id: 'p2', name: 'Ben', civ: 'egypt', endedTurn: false });
        // The seat's own things are there: the unit stands where the old Ben left it.
        expect(answer.view.units).toMatchObject([{ id: fakeUnitId('p2'), tile: 44 }]);
      } else {
        throw new Error(`unexpected answer: ${JSON.stringify(answer)}`);
      }

      // The server's owner can see in the log that the seat changed hands.
      expect(server.logs.some((line) => line.includes(code) && line.includes('p2') && line.includes('freed by hand'))).toBe(true);

      // The file now holds the new token's hash for that seat, and nothing else changed.
      const saved = server.save(code);
      expect(saved.seats[1]).toMatchObject({ playerId: 'p2', tokenHash: hashToken(newBen.token), name: 'Ben' });
      expect(saved.seats).toHaveLength(3);

      // From now on the seat is the new token's: a reconnect needs no name...
      const reconnected = await server.connect(newBen.token);
      reconnected.send({ type: 'joinGame', code, name: null });
      const again = await reconnected.next();
      expect(['lobby', 'gameSync']).toContain(again.type);
      // ...the old token no longer opens it (in the running game there is no other seat to give)...
      const oldBen = await server.connect(code === lobby.code ? benOldToken.lobby : benOldToken.game);
      oldBen.send({ type: 'joinGame', code, name: null });
      await oldBen.expectError(code === lobby.code ? 'nameRequired' : 'gameAlreadyStarted');
      // ...and the next stranger does not get it either.
      const stranger = await server.connect();
      stranger.send({ type: 'joinGame', code, name: 'Stranger' });
      const strangerAnswer = await stranger.next();
      if (code === game.code) expect(strangerAnswer).toMatchObject({ type: 'error', code: 'gameAlreadyStarted' });
      else expect(strangerAnswer).toMatchObject({ type: 'lobby', lobby: { you: 'p4' } });
    }
  });

  it('a player who still has a seat does not take a freed one; of several freed seats the lowest goes first', async () => {
    const first = await fakeServer();
    const { code, clients } = await gameWith(first, ['Ada', 'Ben', 'Cleo']);
    const dataDir = first.dataDir;
    await first.close();
    freeSeatByHand(first.savePath(code), hashToken(clients[1].token));
    freeSeatByHand(first.savePath(code), hashToken(clients[2].token));

    const server = await fakeServer(dataDir);
    // Ada has her seat: joining with a name is still only a reconnect.
    const ada = await server.connect(clients[0].token);
    ada.send({ type: 'joinGame', code, name: 'Ada' });
    expect((await ada.nextOfType('gameSync')).view.you).toBe('p1');

    const firstComer = await server.connect();
    firstComer.send({ type: 'joinGame', code, name: 'X' });
    expect((await firstComer.nextOfType('gameSync')).view.you).toBe('p2');
    const secondComer = await server.connect();
    secondComer.send({ type: 'joinGame', code, name: 'Y' });
    expect((await secondComer.nextOfType('gameSync')).view.you).toBe('p3');
    const thirdComer = await server.connect();
    thirdComer.send({ type: 'joinGame', code, name: 'Z' });
    await thirdComer.expectError('gameAlreadyStarted');

    expect(server.save(code).seats.map((seat) => seat.tokenHash)).toEqual([
      hashToken(clients[0].token),
      hashToken(firstComer.token),
      hashToken(secondComer.token),
    ]);
  });
});
