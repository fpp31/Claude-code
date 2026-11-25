import { IMPROVEMENTS, RULES, RULE_ERROR_MESSAGES, SERVER_ERROR_MESSAGE, UNITS, UNIT_TYPE_IDS } from '@domination/shared';
import type { GameEvent, ServerMessage } from '@domination/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_BAD_MESSAGES } from '../src/config';
import { CANARY, createFakeRules, fakeUnitId } from './fakeRules';
import { cleanUp, failingStorage, gameWith, lobbyWith, newDiskControl, startTestServer } from './harness';
import type { TestClient, TestServer } from './harness';
import {
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
 * Actions in a running game: who may act, what the actor and the others are
 * told, and what happens when something goes wrong on the way. Socket level,
 * with the fake rules: in the fake game a move changes only the mover's own
 * view, and ending the turn changes everybody's.
 *
 * The second group plays build queues and a Worker's job with the real
 * rules; the third, at the end of the file, boats, a fishing net and the
 * "Grow first / Build first" choice of a city (round 3).
 */

afterEach(cleanUp);

/** A move of the player's own (fake) unit to `tile`. */
function moveOwnUnit(seat: string, tile: number) {
  return { type: 'moveUnit' as const, unitId: fakeUnitId(seat), path: [tile] };
}

/** True if none of the frames this client received contains the text. */
function neverSaw(client: TestClient, text: string): boolean {
  return client.frames.every((frame) => !frame.includes(text));
}

describe('authorisation and actions (WP3)', () => {
  it("the acting player is taken from the socket's seat: a player cannot move another player's unit (noSuchUnit)", async () => {
    const server = await startTestServer({ rules: createFakeRules().rules });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const before = server.saveText(code);

    // Ben names Ada's unit. The server asks the rules as Ben, and Ben has no such unit.
    expect(await ben.actRejected(1, moveOwnUnit('p1', 9))).toBe('noSuchUnit');
    // Naming a player in the message changes nothing: extra fields never get past the parser.
    ben.sendRaw(
      JSON.stringify({
        type: 'action',
        requestId: 77,
        turn: 1,
        playerId: 'p1',
        action: { type: 'moveUnit', unitId: fakeUnitId('p1'), path: [9], playerId: 'p1', owner: 'p1' },
      }),
    );
    const { reply } = await ben.readReply(77);
    expect(reply).toMatchObject({ type: 'actionRejected', requestId: 77, error: { code: 'noSuchUnit' } });

    expect(server.saveText(code)).toBe(before);
    await ada.expectNothingPending();

    // The same unit moves when its owner says so.
    await ada.actOk(1, moveOwnUnit('p1', 9));
    expect(server.save(code).game?.units[fakeUnitId('p1')].tile).toBe(9);
  });

  it('an action from a socket that is not in a started game gets error notInGame (no actionRejected)', async () => {
    const { rules, control } = createFakeRules();
    const server = await startTestServer({ rules });

    // In no game at all.
    const loner = await server.connect();
    loner.send({ type: 'action', requestId: 5, turn: 1, action: { type: 'endTurn' } });
    const first = await loner.nextOfType('error');
    expect(first.code).toBe('notInGame');
    expect(first).not.toHaveProperty('requestId');

    // In a lobby.
    const { clients } = await lobbyWith(server, ['Ada', 'Ben']);
    clients[1].send({ type: 'action', requestId: 6, turn: 1, action: { type: 'endTurn' } });
    const second = await clients[1].nextOfType('error');
    expect(second.code).toBe('notInGame');
    expect(second).not.toHaveProperty('requestId');
    await clients[0].expectNothingPending();

    // After leaving a running game.
    clients[0].send({ type: 'startGame' });
    for (const client of clients) await client.nextOfType('gameSync');
    clients[1].send({ type: 'leaveGame' });
    await clients[1].nextOfType('left');
    clients[1].send({ type: 'action', requestId: 7, turn: 1, action: { type: 'endTurn' } });
    await clients[1].expectError('notInGame');

    // The rules were never asked.
    expect(control.actionCalls).toBe(0);
  });

  it('every action that reaches a started game gets exactly one actionOk or actionRejected with its requestId', async () => {
    const { rules, control } = createFakeRules();
    const server = await startTestServer({ rules });
    const { clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada] = clients;

    // One of each outcome, with request ids in no particular order (0 and a very large one included).
    const sent: [requestId: number, message: object, expected: string][] = [
      [41, { turn: 1, action: moveOwnUnit('p1', 3) }, 'actionOk'], // accepted
      [0, { turn: 1, action: moveOwnUnit('p2', 3) }, 'actionRejected'], // refused by the rules
      [9007199254740991, { turn: 1, action: { type: 'cancelEndTurn' } }, 'actionOk'], // accepted, nothing changed
      [7, { turn: 99, action: { type: 'endTurn' } }, 'actionRejected'], // stale
      [7, { turn: 1, action: { type: 'foundCity', unitId: fakeUnitId('p1') } }, 'actionRejected'], // same id again
    ];
    for (const [requestId, rest] of sent) ada.sendRaw(JSON.stringify({ type: 'action', requestId, ...rest }));
    const received = await ada.drain();

    // And one for which the rules blow up.
    control.applyActionThrows = true;
    ada.sendRaw(JSON.stringify({ type: 'action', requestId: 8, turn: 1, action: { type: 'endTurn' } }));
    sent.push([8, {}, 'actionRejected']);
    received.push(...(await ada.drain()));

    // Exactly one answer each, in the order the actions were sent, each with its own request id.
    const answers = received.filter((message) => message.type !== 'gameUpdate');
    expect(answers.map((message) => [message.type, (message as { requestId?: number }).requestId])).toEqual(
      sent.map(([requestId, , expected]) => [expected, requestId]),
    );
    expect(control.actionCalls).toBe(sent.length);
  });

  it('an accepted action sends the actor a gameUpdate (seq + 1) before the actionOk', async () => {
    const server = await startTestServer({ rules: createFakeRules().rules });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada] = clients;
    expect(ada.seq).toBe(1);

    const requestId = ada.sendAction(1, moveOwnUnit('p1', 23));
    const update = await ada.nextOfType('gameUpdate');
    expect(update.seq).toBe(2);
    // Only what changed: the units section. And the actor's own news.
    expect(Object.keys(update.patch)).toEqual(['units']);
    expect(update.patch.units?.[0].tile).toBe(23);
    expect(update.events).toEqual([
      { type: 'unitMoved', playerId: 'p1', unitId: fakeUnitId('p1'), from: 0, path: [23], stoppedEarly: false },
    ]);
    expect(await ada.next()).toEqual({ type: 'actionOk', requestId });
    await ada.expectNothingPending();

    // Saved before anybody was told.
    expect(server.save(code).game?.units[fakeUnitId('p1')].tile).toBe(23);

    // And the next one counts on.
    await ada.actOk(1, moveOwnUnit('p1', 24));
    expect(ada.seq).toBe(3);
  });

  it('a rejected action changes nothing: the save file is byte-identical and nobody else receives anything', async () => {
    const disk = newDiskControl();
    const server = await startTestServer({
      rules: createFakeRules().rules,
      wrapStorage: (real) => failingStorage(real, disk),
    });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const before = server.saveText(code);
    const savesBefore = disk.saves;
    const viewBefore = ada.view;

    expect(await ada.actRejected(1, moveOwnUnit('p2', 5))).toBe('noSuchUnit');
    expect(await ada.actRejected(1, { type: 'moveUnit', unitId: fakeUnitId('p1'), path: [] })).toBe('badPath');
    expect(await ada.actRejected(1, { type: 'foundCity', unitId: fakeUnitId('p1') })).toBe('cannotFoundCity');
    expect(await ada.actRejected(1, { type: 'setBuildQueue', cityId: 'c1_nope', queue: [{ kind: 'unit', unitType: 'scout' }] })).toBe('noSuchCity');
    expect(await ada.actRejected(1, { type: 'startJob', unitId: fakeUnitId('p1'), improvement: 'farm' })).toBe('cannotImprove');
    expect(await ada.actRejected(1, { type: 'stopJob', unitId: fakeUnitId('p1') })).toBe('noSuchUnit');

    expect(server.saveText(code)).toBe(before);
    expect(disk.saves).toBe(savesBefore);
    await ben.expectNothingPending();
    await ada.expectNothingPending();
    // A fresh view is the same as before, too.
    ada.send({ type: 'resync' });
    expect((await ada.nextOfType('gameSync')).view).toEqual(viewBefore);
  });

  it('a refusal reaches the client as its code and the standard sentence for that code, and nothing else', async () => {
    const { rules, control } = createFakeRules();
    const server = await startTestServer({ rules });
    const { clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada] = clients;

    // The rules answer with a text of their own and an extra field (a bug, or a later phase being careless).
    control.talkativeRefusals = true;
    const { reply } = await ada.act(1, moveOwnUnit('p2', 5));
    expect(reply).toStrictEqual({
      type: 'actionRejected',
      requestId: expect.any(Number),
      error: { code: 'noSuchUnit', message: RULE_ERROR_MESSAGES.noSuchUnit },
    });
    expect(neverSaw(ada, CANARY)).toBe(true);
  });

  it('an accepted action that changes nothing is answered with actionOk, and is neither saved nor broadcast', async () => {
    const disk = newDiskControl();
    const server = await startTestServer({
      rules: createFakeRules().rules,
      wrapStorage: (real) => failingStorage(real, disk),
    });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const before = server.saveText(code);
    const savesBefore = disk.saves;

    // Cancel without having ended the turn: accepted, but there is nothing to cancel.
    expect(await ada.actOk(1, { type: 'cancelEndTurn' })).toEqual([]);
    expect(disk.saves).toBe(savesBefore);
    expect(server.saveText(code)).toBe(before);
    await ben.expectNothingPending();
    expect(ada.seq).toBe(1);
  });

  it('an action with an old turn number is rejected with staleTurn', async () => {
    const server = await startTestServer({ rules: createFakeRules().rules });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    // Both end turn 1; the game is in turn 2.
    await ada.actOk(1, { type: 'endTurn' });
    await ben.nextOfType('gameUpdate');
    await ben.actOk(1, { type: 'endTurn' });
    await ada.nextOfType('gameUpdate');
    expect(ada.view?.turn).toBe(2);
    const before = server.saveText(code);

    // A late click that still carries turn 1 (it must never end turn 2).
    expect(await ada.actRejected(1, { type: 'endTurn' })).toBe('staleTurn');
    expect(await ada.actRejected(1, moveOwnUnit('p1', 4))).toBe('staleTurn');
    expect(await ada.actRejected(3, { type: 'endTurn' })).toBe('staleTurn');
    expect(server.saveText(code)).toBe(before);
    await ben.expectNothingPending();
    expect(ada.view?.players.map((player) => player.endedTurn)).toEqual([false, false]);
  });

  it('a player whose view did not change receives no message at all', async () => {
    const server = await startTestServer({ rules: createFakeRules().rules });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben', 'Cleo']);
    const [ada, ben, cleo] = clients;
    const benFrames = ben.frames.length;
    const cleoFrames = cleo.frames.length;

    // Ada moves her unit three times. In the fake game only Ada can see it.
    for (const tile of [11, 12, 13]) {
      const before = await ada.actOk(1, moveOwnUnit('p1', tile));
      expect(before.map((message) => message.type)).toEqual(['gameUpdate']);
    }
    expect(server.save(code).game?.units[fakeUnitId('p1')].tile).toBe(13);

    await ben.expectNothingPending();
    await cleo.expectNothingPending();
    // Not a single frame, apart from the pong that proves it.
    expect(ben.frames.slice(benFrames)).toEqual(['{"type":"pong"}']);
    expect(cleo.frames.slice(cleoFrames)).toEqual(['{"type":"pong"}']);

    // Something everybody may know (Ada ended her turn) does reach them.
    await ada.actOk(1, { type: 'endTurn' });
    for (const other of [ben, cleo]) {
      const update = await other.nextOfType('gameUpdate');
      expect(Object.keys(update.patch)).toEqual(['players']);
      expect(update.events).toEqual([]);
    }
  });

  it('events reach only the players they are addressed to, without the audience list', async () => {
    const server = await startTestServer({ rules: createFakeRules().rules });
    const { clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    await ada.actOk(1, moveOwnUnit('p1', 2));
    await ada.actOk(1, { type: 'endTurn' });
    await ben.nextOfType('gameUpdate');
    // Ben's endTurn resolves the turn: 'turnStarted' goes to everybody.
    const benMessages = await ben.actOk(1, { type: 'endTurn' });
    expect(benMessages).toHaveLength(1);
    expect(benMessages[0]).toMatchObject({ type: 'gameUpdate', events: [{ type: 'turnStarted', turn: 2 }] });
    expect(await ada.nextOfType('gameUpdate')).toMatchObject({ patch: { turn: 2 }, events: [{ type: 'turnStarted', turn: 2 }] });

    // Ben never heard about Ada's move, and no frame carries an audience list.
    expect(neverSaw(ben, 'unitMoved')).toBe(true);
    for (const client of clients) expect(neverSaw(client, '"to"')).toBe(true);
  });

  it('two tabs of one player both get the update; only the tab that acted gets the actionOk', async () => {
    const server = await startTestServer({ rules: createFakeRules().rules });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada] = clients;
    const adaTab = await server.connect(ada.token);
    adaTab.send({ type: 'joinGame', code, name: null });
    await adaTab.nextOfType('gameSync');

    await ada.actOk(1, moveOwnUnit('p1', 31));
    const update = await adaTab.nextOfType('gameUpdate');
    expect(update.patch.units?.[0].tile).toBe(31);
    await adaTab.expectNothingPending();
    expect(adaTab.view).toEqual(ada.view);
  });

  it('if saving fails (inject a storage that throws) the actor gets actionRejected serverError and the state is unchanged', async () => {
    const disk = newDiskControl();
    const server = await startTestServer({
      rules: createFakeRules().rules,
      wrapStorage: (real) => failingStorage(real, disk),
    });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const before = server.saveText(code);
    const viewBefore = ada.view;

    disk.failSaves = true;
    for (const action of [moveOwnUnit('p1', 17), { type: 'endTurn' as const }]) {
      const { reply, before: earlier } = await ada.act(1, action);
      expect(reply).toMatchObject({ type: 'actionRejected', error: { code: 'serverError', message: SERVER_ERROR_MESSAGE } });
      // Not even the actor was sent an update for a change that was not saved.
      expect(earlier).toEqual([]);
    }
    await ben.expectNothingPending();
    expect(server.saveText(code)).toBe(before);
    expect(server.logs.join('\n')).toContain('the disk is full');
    expect(neverSaw(ada, 'the disk is full')).toBe(true);

    // Memory was not ahead of the disk either: a fresh view shows the old state...
    ada.send({ type: 'resync' });
    expect((await ada.nextOfType('gameSync')).view).toEqual(viewBefore);
    // ...and once the disk works again, the same action goes through with the next seq.
    disk.failSaves = false;
    const messages = await ada.actOk(1, moveOwnUnit('p1', 17));
    expect(messages).toHaveLength(1);
    expect(server.save(code).game?.units[fakeUnitId('p1')].tile).toBe(17);
  });

  it('if the rules throw, the actor gets actionRejected serverError and the server keeps running', async () => {
    const { rules, control } = createFakeRules();
    const server = await startTestServer({ rules });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const before = server.saveText(code);

    control.applyActionThrows = true;
    const { reply, before: earlier } = await ada.act(1, moveOwnUnit('p1', 17));
    expect(reply).toMatchObject({ type: 'actionRejected', error: { code: 'serverError', message: SERVER_ERROR_MESSAGE } });
    expect(earlier).toEqual([]);
    await ben.expectNothingPending();
    expect(server.saveText(code)).toBe(before);

    // The server and both sockets carry on as if nothing had happened.
    control.applyActionThrows = false;
    await ada.actOk(1, moveOwnUnit('p1', 17));
    await ben.actOk(1, moveOwnUnit('p2', 18));
    const visitor = await server.connect();
    await visitor.expectNothingPending();
  });

  it('if buildPlayerView throws for ANOTHER seat (attached or not), the actor gets actionRejected serverError, the save file is byte-identical and nobody receives an update', async () => {
    const { rules, control } = createFakeRules();
    const server = await startTestServer({ rules });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben', 'Cleo']);
    const [ada, ben, cleo] = clients;
    const before = server.saveText(code);

    // Ben is attached; his view of the new state cannot be built.
    control.viewThrowsFor = 'p2';
    let outcome = await ada.act(1, { type: 'endTurn' });
    expect(outcome.reply).toMatchObject({ type: 'actionRejected', error: { code: 'serverError' } });
    expect(outcome.before).toEqual([]);
    for (const other of [ben, cleo]) await other.expectNothingPending();
    expect(server.saveText(code)).toBe(before);

    // The same with Cleo, whose seat has no socket attached at all.
    control.viewThrowsFor = null;
    await cleo.close();
    await ada.nextOfType('presence');
    await ben.nextOfType('presence');
    control.viewThrowsFor = 'p3';
    outcome = await ada.act(1, { type: 'endTurn' });
    expect(outcome.reply).toMatchObject({ type: 'actionRejected', error: { code: 'serverError' } });
    expect(outcome.before).toEqual([]);
    await ben.expectNothingPending();
    expect(server.saveText(code)).toBe(before);

    // Even an action that only changes the actor's own view is refused: a
    // state that cannot be shown to one of its players is never saved.
    outcome = await ada.act(1, moveOwnUnit('p1', 17));
    expect(outcome.reply).toMatchObject({ type: 'actionRejected', error: { code: 'serverError' } });
    expect(server.saveText(code)).toBe(before);

    control.viewThrowsFor = null;
    await ada.actOk(1, { type: 'endTurn' });
    await ben.nextOfType('gameUpdate');
  });

  it('serverError never quotes the exception: fake rules throw an Error containing a canary string; no frame on any socket contains it, the log does', async () => {
    const { rules, control } = createFakeRules();
    const server = await startTestServer({ rules });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    // The rules throw.
    control.applyActionThrows = true;
    await ada.act(1, { type: 'endTurn' });
    control.applyActionThrows = false;
    // A view throws: during an action, on resync, and when a socket attaches.
    control.viewThrowsFor = 'p2';
    await ada.act(1, { type: 'endTurn' });
    ben.send({ type: 'resync' });
    await ben.expectError('serverError');
    const benTab = await server.connect(ben.token);
    benTab.send({ type: 'joinGame', code, name: null });
    await benTab.expectError('serverError');
    control.viewThrowsFor = null;

    const everySocket = [ada, ben, benTab];
    for (const client of everySocket) await client.expectNothingPending();
    for (const client of everySocket) {
      expect(neverSaw(client, CANARY)).toBe(true);
      expect(neverSaw(client, 'fake ')).toBe(true); // not even the start of the exception text
      for (const frame of client.frames) {
        const message = JSON.parse(frame) as ServerMessage;
        if (message.type === 'error' && message.code === 'serverError') expect(message.message).toBe(SERVER_ERROR_MESSAGE);
        if (message.type === 'actionRejected') expect(message.error.message).toBe(SERVER_ERROR_MESSAGE);
      }
    }
    // Four failures, four log entries with the details.
    expect(server.logs.filter((line) => line.includes(CANARY))).toHaveLength(4);

    // The tab that could not be attached is in no game, and was not
    // half-attached either: what happens in the game does not reach it.
    benTab.send({ type: 'resync' });
    await benTab.expectError('notInGame');
    await ada.actOk(1, { type: 'endTurn' });
    await ben.nextOfType('gameUpdate');
    await benTab.expectNothingPending();
  });

  it('with patches turned off (sendPatches false) every change arrives as a full gameSync whose seq is the previous seq + 1', async () => {
    const server = await startTestServer({ rules: createFakeRules().rules, sendPatches: false });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    expect(ada.seq).toBe(1);

    // Ada moves: a full view for Ada, with her news; nothing for Ben, whose view is the same.
    const requestId = ada.sendAction(1, moveOwnUnit('p1', 40));
    const first = await ada.nextOfType('gameSync');
    expect(first.seq).toBe(2);
    expect(first.code).toBe(code);
    expect(first.view.units[0].tile).toBe(40);
    expect(first.connected).toEqual(['p1', 'p2']);
    expect(first.events.map((event) => event.type)).toEqual(['unitMoved']);
    expect(await ada.next()).toEqual({ type: 'actionOk', requestId });
    await ben.expectNothingPending();

    // Ada ends her turn: both views change, both get a full view.
    await ada.actOk(1, { type: 'endTurn' });
    expect(ada.seq).toBe(3);
    const forBen = await ben.nextOfType('gameSync');
    expect(forBen.seq).toBe(2);
    expect(forBen.view.players.map((player) => player.endedTurn)).toEqual([true, false]);

    // Ben ends his: the turn resolves.
    await ben.actOk(1, { type: 'endTurn' });
    expect(ben.seq).toBe(3);
    const resolved = await ada.nextOfType('gameSync');
    expect(resolved.seq).toBe(4);
    expect(resolved.view.turn).toBe(2);
    expect(resolved.events).toEqual([{ type: 'turnStarted', turn: 2 }]);

    // Not one patch was sent.
    for (const client of clients) expect(neverSaw(client, 'gameUpdate')).toBe(true);
  });
});

/**
 * Build queues and jobs, with the real rules: Ada (p1) and Ben (p2) at the
 * two ends of the long meadow, out of each other's sight.
 */
describe('build queues and jobs through the server (WP3, real rules)', () => {
  function meadowServer(): Promise<TestServer> {
    // Whole turns are played in a moment, far faster than the rate limit allows a person to click.
    return startTestServer({ rules: realRulesOnMeadow([[3, 5], [20, 5]]), noRateLimit: true });
  }

  /** A second tab of the same player: another socket with the same token, attached to the same seat. */
  async function secondTab(server: TestServer, code: string, first: TestClient): Promise<TestClient> {
    const tab = await server.connect(first.token);
    tab.send({ type: 'joinGame', code, name: null });
    await tab.nextOfType('gameSync');
    expect(tab.view).toEqual(first.view);
    return tab;
  }

  /** True if this socket carried nothing but the pongs that prove it, from frame `from` on. */
  function onlyPongsSince(client: TestClient, from: number): boolean {
    return client.frames.slice(from).every((frame) => frame === '{"type":"pong"}');
  }

  it('two tabs of one player change the same queue: the list sent last wins, both tabs are sent the result, the other player is sent nothing', async () => {
    const server = await meadowServer();
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    await ada.actOk(1, { type: 'foundCity', unitId: ownUnit(ada.view, 'settler').id });
    const rome = ownCity(ada.view).id;
    const adaTab = await secondTab(server, code, ada);
    await ben.expectNothingPending();
    const benFrames = ben.frames.length;

    // The first tab queues a Warrior and a Scout. Both tabs are sent the new city, and no news.
    const first = queueOf('warrior', 'scout');
    expect((await ada.actOk(1, setQueue(rome, first))).map((message) => message.type)).toEqual(['gameUpdate']);
    const told = await adaTab.nextOfType('gameUpdate');
    expect(Object.keys(told.patch)).toEqual(['cities']);
    expect(told.events).toEqual([]);
    expect(queueItems(ownCity(adaTab.view))).toEqual(first);

    // The second tab sends a list that keeps nothing of the first: the whole list is replaced, not merged.
    const second = queueOf('settler', 'worker', 'worker');
    expect((await adaTab.actOk(1, setQueue(rome, second))).map((message) => message.type)).toEqual(['gameUpdate']);
    await ada.nextOfType('gameUpdate');
    expect(queueItems(ownCity(ada.view))).toEqual(second);
    expect(ada.view).toEqual(adaTab.view);
    expect(server.save(code).game?.cities[rome].buildQueue).toEqual(second);

    // The same list once more, from the other tab: accepted, and nothing to save or send.
    const saved = server.saveText(code);
    expect(await ada.actOk(1, setQueue(rome, second))).toEqual([]);
    await adaTab.expectNothingPending();
    expect(server.saveText(code)).toBe(saved);

    // A real race, several times over: both tabs send before either reads.
    // The server sees one of them last, and that list is the queue: whole,
    // never a mixture of the two.
    for (let round = 1; round <= 5; round++) {
      const one = queueOf(...Array.from({ length: round }, () => 'warrior' as const));
      const two = queueOf(...Array.from({ length: round }, () => 'scout' as const), 'worker');
      const oneRequest = ada.sendAction(1, setQueue(rome, one));
      const twoRequest = adaTab.sendAction(1, setQueue(rome, two));
      expect((await ada.readReply(oneRequest)).reply.type).toBe('actionOk');
      expect((await adaTab.readReply(twoRequest)).reply.type).toBe('actionOk');
      await ada.drain();
      await adaTab.drain();

      const queue = server.save(code).game?.cities[rome].buildQueue;
      expect([one, two]).toContainEqual(queue);
      // Both tabs were shown exactly what was saved.
      expect(queueItems(ownCity(ada.view))).toEqual(queue);
      expect(adaTab.view).toEqual(ada.view);
    }

    // Ben, who cannot see Rome, was sent nothing in all that time.
    await ben.expectNothingPending();
    expect(onlyPongsSince(ben, benFrames)).toBe(true);
  });

  it('a queue that is too long for the rules is answered actionRejected queueFull with its request id, and the socket stays open', async () => {
    const server = await meadowServer();
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    await ada.actOk(1, { type: 'foundCity', unitId: ownUnit(ada.view, 'settler').id });
    const rome = ownCity(ada.view).id;
    await ada.actOk(1, setQueue(rome, queueOf('warrior')));
    const before = server.saveText(code);
    const viewBefore = ada.view;

    // Nine entries: one more than the rules allow, far fewer than a message may carry.
    const tooLong = queueOf(...Array.from({ length: RULES.maxQueueLength + 1 }, () => 'scout' as const));
    expect(tooLong).toHaveLength(9);
    // As often as it takes bad messages to close a socket.
    for (let attempt = 1; attempt <= MAX_BAD_MESSAGES; attempt++) {
      const requestId = ada.sendAction(1, setQueue(rome, tooLong));
      const { reply, before: earlier } = await ada.readReply(requestId);
      expect(reply).toStrictEqual({
        type: 'actionRejected',
        requestId,
        error: { code: 'queueFull', message: RULE_ERROR_MESSAGES.queueFull },
      });
      expect(earlier).toEqual([]);
    }

    // Nothing was saved, nobody was told, and the queue is the one Warrior it was.
    expect(server.saveText(code)).toBe(before);
    await ben.expectNothingPending();
    await ada.expectNothingPending();
    expect(ada.view).toEqual(viewBefore);

    // Those five were answers of the rules, not bad messages: the socket's
    // count of bad messages is untouched. It still takes four real ones
    // (a list too long even to be a message) without closing...
    const notAMessage = JSON.stringify({
      type: 'action',
      requestId: 999,
      turn: 1,
      action: setQueue(rome, queueOf(...Array.from({ length: 65 }, () => 'scout' as const))),
    });
    for (let bad = 1; bad < MAX_BAD_MESSAGES; bad++) {
      ada.sendRaw(notAMessage);
      const error = await ada.nextOfType('error');
      expect(error.code).toBe('badMessage');
      // No request id: what was sent was not an action at all.
      expect(error).not.toHaveProperty('requestId');
    }
    await ada.expectNothingPending();
    expect(server.saveText(code)).toBe(before);

    // ...the longest queue the rules allow goes through, and fills the queue...
    const longest = queueOf(...Array.from({ length: RULES.maxQueueLength }, () => 'scout' as const));
    await ada.actOk(1, setQueue(rome, longest));
    expect(queueItems(ownCity(ada.view))).toEqual(longest);
    // Nothing can be added now, and each entry of the menu says why. Rome
    // owns no water on this meadow, and for the two boats that is the
    // reason: it lasts, a full queue does not.
    expect(ownCity(ada.view).own.buildOptions.map((option) => [option.item.unitType, option.addError])).toEqual([
      ['warrior', 'queueFull'],
      ['scout', 'queueFull'],
      ['settler', 'queueFull'],
      ['worker', 'queueFull'],
      ['fishingBoat', 'noWaterForBoat'],
      ['scoutBoat', 'noWaterForBoat'],
    ]);

    // ...and only the fifth bad message closes the socket.
    ada.sendRaw(notAMessage);
    await ada.expectError('badMessage');
    expect(await ada.waitForClose()).toBe(1008);
  });

  it('a unit at work is not moved from a second tab: unitBusy, and nothing is saved or sent', async () => {
    const server = await meadowServer();
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    // Ada's Worker steps onto the meadow east of Rome, starts a farm and works on it for one turn.
    const worker = await raiseWorker(ada, clients);
    const field = worker.tile + 1;
    await ada.actOk(turnOf(ada), { type: 'moveUnit', unitId: worker.id, path: [field] });
    await ada.actOk(turnOf(ada), { type: 'startJob', unitId: worker.id, improvement: 'farm' });
    await endTurn(clients);
    const turn = turnOf(ada);
    const atWork = {
      improvement: 'farm',
      turnsWorked: 1,
      turnsTotal: IMPROVEMENTS.farm.turns,
      turnsLeft: IMPROVEMENTS.farm.turns - 1,
    };
    expect(ownUnit(ada.view, 'worker').own?.job).toEqual(atWork);
    // The Worker has its moves for the new turn: it is the job that holds it, nothing else.
    expect(ownUnit(ada.view, 'worker').own?.movesLeft).toBeGreaterThan(0);

    const adaTab = await secondTab(server, code, ada);
    await ben.expectNothingPending();
    const before = server.saveText(code);
    const viewBefore = ada.view;

    // Ben cannot give Ada's Worker orders, whatever id he names: the server
    // asks the rules as Ben, and Ben has no such unit.
    expect(await ben.actRejected(turn, { type: 'stopJob', unitId: worker.id })).toBe('noSuchUnit');
    expect(await ben.actRejected(turn, { type: 'startJob', unitId: worker.id, improvement: 'mine' })).toBe('noSuchUnit');
    const benFrames = ben.frames.length;
    const adaFrames = ada.frames.length;

    // The second tab sends the Worker one tile on.
    const requestId = adaTab.sendAction(turn, { type: 'moveUnit', unitId: worker.id, path: [field + 1] });
    const { reply, before: earlier } = await adaTab.readReply(requestId);
    expect(reply).toStrictEqual({
      type: 'actionRejected',
      requestId,
      error: { code: 'unitBusy', message: RULE_ERROR_MESSAGES.unitBusy },
    });
    expect(earlier).toEqual([]);
    // The answer is about the unit, wherever a well-formed path leads: the tiles on it are not looked at.
    expect(await adaTab.actRejected(turn, { type: 'moveUnit', unitId: worker.id, path: [field + 1, field + 2] })).toBe('unitBusy');
    expect(await adaTab.actRejected(turn, { type: 'moveUnit', unitId: worker.id, path: [worker.tile] })).toBe('unitBusy');
    // And no other job is started on top of the one it has.
    expect(await adaTab.actRejected(turn, { type: 'startJob', unitId: worker.id, improvement: 'mine' })).toBe('unitBusy');

    // Nothing was saved and nothing was sent: not to the other tab, not to Ben.
    expect(server.saveText(code)).toBe(before);
    await ada.expectNothingPending();
    await ben.expectNothingPending();
    expect(onlyPongsSince(ada, adaFrames)).toBe(true);
    expect(onlyPongsSince(ben, benFrames)).toBe(true);
    // The job is where it was, with the turn it has worked.
    adaTab.send({ type: 'resync' });
    expect((await adaTab.nextOfType('gameSync')).view).toEqual(viewBefore);

    // "Stop work" first, then the same move: both go through, and both tabs are told.
    await adaTab.actOk(turn, { type: 'stopJob', unitId: worker.id });
    await ada.nextOfType('gameUpdate');
    expect(ownUnit(ada.view, 'worker').own?.job).toBeNull();
    await adaTab.actOk(turn, { type: 'moveUnit', unitId: worker.id, path: [field + 1] });
    await ada.nextOfType('gameUpdate');
    expect(ownUnit(ada.view, 'worker').tile).toBe(field + 1);
    expect(ada.view).toEqual(adaTab.view);
    // The work that was given up left nothing on the tile.
    expect(server.save(code).game?.map.tiles[field].improvement).toBeNull();
    await ben.expectNothingPending();
    expect(onlyPongsSince(ben, benFrames)).toBe(true);
  });
});

/**
 * Boats, a fishing net and "Grow first / Build first", with the real rules,
 * on the meadow by the sea (LONG_SHORE in realWorld.ts): Ada (p1) starts on
 * the shore, where her capital owns seven coast tiles and four plains; Ben
 * (p2) starts inland at the far end, where his owns grassland and no water.
 * Neither ever sees anything of the other.
 */
describe('boats, nets and "Grow first / Build first" through the server (round 3, real rules)', () => {
  function shoreServer(): Promise<TestServer> {
    // Whole turns are played in a moment, far faster than the rate limit allows a person to click.
    return startTestServer({ rules: realRulesOnShore([[3, 7], [20, 3]]), noRateLimit: true });
  }

  /** A second tab of the same player: another socket with the same token, attached to the same seat. */
  async function secondTab(server: TestServer, code: string, first: TestClient): Promise<TestClient> {
    const tab = await server.connect(first.token);
    tab.send({ type: 'joinGame', code, name: null });
    await tab.nextOfType('gameSync');
    expect(tab.view).toEqual(first.view);
    return tab;
  }

  /** The frames a socket received from frame `from` on, without the pongs that only answer a test's own pings. */
  function framesSince(client: TestClient, from: number): string[] {
    return client.frames.slice(from).filter((frame) => frame !== '{"type":"pong"}');
  }

  /** Every event a socket has been sent so far, in order. */
  function eventsSentTo(client: TestClient): GameEvent[] {
    return client.frames
      .map((frame) => JSON.parse(frame) as ServerMessage)
      .flatMap((message) => (message.type === 'gameUpdate' || message.type === 'gameSync' ? message.events : []));
  }

  it('setCityFocus through real sockets: the actor gets a gameUpdate with the new focus and worked tiles, then actionOk; the other seat gets nothing', async () => {
    // (The storage counts its saves, so that the test can tell "saved the same again" from "not saved".)
    const disk = newDiskControl();
    const server = await startTestServer({
      rules: realRulesOnShore([[3, 7], [20, 3]]),
      noRateLimit: true,
      wrapStorage: (real) => failingStorage(real, disk),
    });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    await ada.actOk(1, { type: 'foundCity', unitId: ownUnit(ada.view, 'settler').id });
    const rome = ownCity(ada.view).id;
    await ada.actOk(1, setQueue(rome, queueOf('warrior')));
    const adaTab = await secondTab(server, code, ada);
    await ben.expectNothingPending();
    const benFrames = ben.frames.length;

    // A new city grows first: its one citizen gathers from grassland (2 food, 1 production).
    const growing = ownCity(ada.view).own;
    expect(growing.focus).toBe('grow');
    expect(growing.worked).toEqual([at(2, 5)]);
    expect([growing.foodPerTurn, growing.productionPerTurn]).toEqual([2, 2]);
    const viewBefore = ada.view;
    const savedBefore = server.save(code).game;
    if (savedBefore === null) throw new Error('the game was not saved');
    expect(savedBefore.cities[rome].focus).toBe('grow');

    // The press on "Build first": first the city as it is now, then the answer.
    const savesBefore = disk.saves;
    const requestId = ada.sendAction(1, setFocus(rome, 'build'));
    const update = await ada.nextOfType('gameUpdate');
    expect(Object.keys(update.patch)).toEqual(['cities']);
    expect(update.events).toEqual([]);
    expect(update.patch.cities).toHaveLength(1);
    expect(update.patch.cities?.[0].id).toBe(rome);
    const building = update.patch.cities?.[0].own;
    if (building === null || building === undefined) throw new Error('the update does not hold the city as its owner sees it');
    // The citizen has gone to the plains behind the city (1 food, 2 production):
    // one food less, one production more, and the Warrior is done sooner.
    expect(building.focus).toBe('build');
    expect(building.worked).toEqual([at(2, 6)]);
    expect([building.foodPerTurn, building.productionPerTurn]).toEqual([1, 3]);
    expect(building.buildQueue.map((row) => row.item)).toEqual(queueOf('warrior'));
    const [sooner, later] = [building.buildQueue[0].turns, growing.buildQueue[0].turns];
    if (sooner === null || later === null) throw new Error('the queue does not say when the Warrior will be done');
    expect(sooner).toBeLessThan(later);
    // Nothing the city has saved was touched, and nothing else of the view changed.
    expect({ ...building, focus: 0, worked: 0, foodPerTurn: 0, productionPerTurn: 0, buildQueue: 0, buildOptions: 0 }).toEqual({
      ...growing, focus: 0, worked: 0, foodPerTurn: 0, productionPerTurn: 0, buildQueue: 0, buildOptions: 0,
    });
    expect(ownCity(ada.view).own).toEqual(building);
    expect({ ...ada.view, cities: [] }).toEqual({ ...viewBefore, cities: [] });
    expect(await ada.next()).toEqual({ type: 'actionOk', requestId });
    await ada.expectNothingPending();

    // Saved, once: the city's focus, and not one thing more.
    expect(disk.saves).toBe(savesBefore + 1);
    const saved = server.save(code).game;
    expect(saved).toEqual({ ...savedBefore, cities: { [rome]: { ...savedBefore.cities[rome], focus: 'build' } } });
    // The player's other tab is shown the same city. Ben, far away, is sent nothing.
    expect((await adaTab.nextOfType('gameUpdate')).patch).toEqual(update.patch);
    await adaTab.expectNothingPending();
    expect(adaTab.view).toEqual(ada.view);
    await ben.expectNothingPending();

    // The same press again, from either tab: accepted, and nothing to save or send.
    const fileBefore = server.saveText(code);
    expect(await ada.actOk(1, setFocus(rome, 'build'))).toEqual([]);
    expect(await adaTab.actOk(1, setFocus(rome, 'build'))).toEqual([]);
    await ada.expectNothingPending();
    await adaTab.expectNothingPending();
    expect(disk.saves).toBe(savesBefore + 1);
    expect(server.saveText(code)).toBe(fileBefore);

    // Back to "Grow first" and the view is, to the last number, the one from before the first press:
    // pressing costs nothing. Then "Build first" once more, which is how the turn will be played.
    expect((await adaTab.actOk(1, setFocus(rome, 'grow'))).map((message) => message.type)).toEqual(['gameUpdate']);
    await ada.nextOfType('gameUpdate');
    expect(ada.view).toEqual(viewBefore);
    expect(server.save(code).game).toEqual(savedBefore);
    await ada.actOk(1, setFocus(rome, 'build'));
    await adaTab.nextOfType('gameUpdate');
    expect(ownCity(adaTab.view).own).toEqual(building);

    // In all that time Ben's socket carried nothing at all.
    await ben.expectNothingPending();
    expect(framesSince(ben, benFrames)).toEqual([]);

    // The turn that resolves next uses the choice as it stands: the city
    // gets exactly what its panel showed under "Build first".
    await ada.actOk(1, { type: 'endTurn' });
    await adaTab.nextOfType('gameUpdate');
    // After End Turn the choice is closed, like every order.
    expect(await ada.actRejected(1, setFocus(rome, 'grow'))).toBe('turnAlreadyEnded');
    expect(await adaTab.actRejected(1, setFocus(rome, 'grow'))).toBe('turnAlreadyEnded');
    await ben.actOk(1, { type: 'endTurn' });
    for (const client of [ada, adaTab, ben]) await client.drain();
    expect(turnOf(ada)).toBe(2);
    const afterTheTurn = ownCity(ada.view).own;
    expect(afterTheTurn.focus).toBe('build');
    expect(afterTheTurn.productionStored).toBe(growing.productionStored + building.productionPerTurn);
    expect(afterTheTurn.foodStored).toBe(growing.foodStored + building.foodPerTurn);
    expect(afterTheTurn.buildQueue[0].turns).toBe(sooner - 1);
    // A late press that still carries the old turn is stale; one with the new turn counts.
    expect(await ada.actRejected(1, setFocus(rome, 'grow'))).toBe('staleTurn');
    await ada.actOk(2, setFocus(rome, 'grow'));
    expect(ownCity(ada.view).own.focus).toBe('grow');
    expect(server.save(code).game?.cities[rome].focus).toBe('grow');

    // Of the city, its citizens and its choice, Ben was never sent a word.
    const everythingBenGot = ben.frames.join('\n');
    const everythingAdaGot = ada.frames.join('\n');
    for (const secret of [rome, 'Rome', '"focus"', '"worked"', 'productionPerTurn']) {
      expect(everythingAdaGot.includes(secret), `Ada was told ${secret}`).toBe(true);
      expect(everythingBenGot.includes(secret), `Ben was told ${secret}`).toBe(false);
    }
  });

  it('a boat is queued, built and moved through real sockets, and a net is finished; the other seat receives nothing of the job; a boat for a city without water is answered actionRejected noWaterForBoat with a request id; a Worker told to build a net is answered cannotImprove', async () => {
    const server = await shoreServer();
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const benFrames = ben.frames.length;
    const net = IMPROVEMENTS.fishingNet;

    // Rome, on the shore, owns seven coast tiles: every entry of its menu can be added, the two boats too.
    await ada.actOk(1, { type: 'foundCity', unitId: ownUnit(ada.view, 'settler').id });
    const rome = ownCity(ada.view).id;
    const water = [at(2, 8), at(3, 8), at(4, 8), at(5, 8), at(2, 9), at(3, 9), at(4, 9)];
    expect(ownWater(ada.view)).toEqual(water);
    for (const tile of water) expect(ada.view?.tiles[tile]).toMatchObject({ terrain: 'coast', improvement: null, owner: 'p1' });
    expect(ownCity(ada.view).own.buildOptions.map((option) => [option.item.unitType, option.addError])).toEqual(
      UNIT_TYPE_IDS.map((type) => [type, null]),
    );
    // With a full queue (of boats) every entry says so, the boats like the rest: this city has water.
    const fleet = queueOf(...Array.from({ length: RULES.maxQueueLength }, () => 'scoutBoat' as const));
    await ada.actOk(1, setQueue(rome, fleet));
    expect(queueItems(ownCity(ada.view))).toEqual(fleet);
    expect(server.save(code).game?.cities[rome].buildQueue).toEqual(fleet);
    expect(ownCity(ada.view).own.buildOptions.map((option) => [option.item.unitType, option.addError])).toEqual(
      UNIT_TYPE_IDS.map((type) => [type, 'queueFull']),
    );

    // A Fishing Boat is queued (alone) and is built in the very turn its row
    // promised. It lies on the water, on the coast tile beside the city
    // with the higher number, with its moves and with one job it can begin.
    const boat = await raiseBoat(ada, clients);
    expect(boat).toEqual({
      id: boat.id,
      type: 'fishingBoat',
      owner: 'p1',
      tile: at(4, 8),
      own: {
        movesLeft: UNITS.fishingBoat.moves,
        foundCityError: 'cannotFoundCity',
        job: null,
        jobOptions: [{ improvement: 'fishingNet', turns: net.turns, error: null }],
      },
    });
    expect(eventsSentTo(ada).filter((event) => event.type === 'unitBuilt')).toEqual([
      { type: 'unitBuilt', playerId: 'p1', cityId: rome, cityName: 'Rome', unitId: boat.id, unitType: 'fishingBoat', queueEmpty: true },
    ]);
    expect(server.save(code).game?.units[boat.id]).toEqual({
      id: boat.id, type: 'fishingBoat', owner: 'p1', tile: at(4, 8), movesLeft: UNITS.fishingBoat.moves, job: null,
    });

    // It does not go ashore: not onto the meadow, not into its own city, not even as the second step of a path.
    let turn = turnOf(ada);
    const before = server.saveText(code);
    expect(await ada.actRejected(turn, { type: 'moveUnit', unitId: boat.id, path: [at(4, 7)] })).toBe('impassable');
    expect(await ada.actRejected(turn, { type: 'moveUnit', unitId: boat.id, path: [at(3, 7)] })).toBe('impassable');
    expect(server.saveText(code)).toBe(before);
    // It sails: two coast tiles, to the far corner of Rome's water. That uses up its moves.
    const site = at(3, 9);
    const sailed = await ada.actOk(turn, { type: 'moveUnit', unitId: boat.id, path: [at(4, 9), site] });
    expect(sailed).toHaveLength(1);
    expect(sailed[0]).toMatchObject({
      type: 'gameUpdate',
      events: [{ type: 'unitMoved', playerId: 'p1', unitId: boat.id, from: at(4, 8), path: [at(4, 9), site], stoppedEarly: false }],
    });
    const arrived = ada.view?.units.find((unit) => unit.id === boat.id);
    expect(arrived).toMatchObject({ tile: site, own: { movesLeft: 0, job: null } });
    expect(server.save(code).game?.units[boat.id].tile).toBe(site);

    // A net is the one thing it builds. It needs no moves left to begin.
    expect(await ada.actRejected(turn, { type: 'startJob', unitId: boat.id, improvement: 'farm' })).toBe('cannotImprove');
    expect(await ada.actRejected(turn, { type: 'startJob', unitId: boat.id, improvement: 'mine' })).toBe('cannotImprove');
    const begun = await ada.actOk(turn, { type: 'startJob', unitId: boat.id, improvement: 'fishingNet' });
    expect(begun.map((message) => (message.type === 'gameUpdate' ? [Object.keys(message.patch), message.events] : message.type))).toEqual([
      [['units'], []],
    ]);
    expect(server.save(code).game?.units[boat.id].job).toEqual({ improvement: 'fishingNet', turnsWorked: 0 });
    await ben.expectNothingPending();

    // The work, turn after turn: Ada is told how far it is, the tile is
    // still bare coast, and the boat does not sail away from its work.
    for (let worked = 0; worked < net.turns; worked++) {
      const atWork = ada.view?.units.find((unit) => unit.id === boat.id);
      expect(atWork?.own?.job).toEqual({ improvement: 'fishingNet', turnsWorked: worked, turnsTotal: net.turns, turnsLeft: net.turns - worked });
      expect(atWork?.tile).toBe(site);
      expect(ada.view?.tiles[site]?.improvement).toBeNull();
      expect(await ada.actRejected(turnOf(ada), { type: 'moveUnit', unitId: boat.id, path: [at(4, 9)] })).toBe('unitBusy');
      await endTurn(clients);
    }

    // Finished: the net is on the tile, in Ada's view and in the file; the
    // boat is where it was, free, with its moves; and Ada got the news, once.
    expect(ada.view?.tiles[site]).toMatchObject({ terrain: 'coast', improvement: 'fishingNet', owner: 'p1', visible: true });
    expect(server.save(code).game?.map.tiles[site].improvement).toBe('fishingNet');
    expect(server.save(code).game?.map.tiles.filter((tile) => tile.improvement !== null)).toHaveLength(1);
    expect(ada.view?.units.find((unit) => unit.id === boat.id)).toMatchObject({
      tile: site,
      own: { movesLeft: UNITS.fishingBoat.moves, job: null, jobOptions: [{ improvement: 'fishingNet', error: 'alreadyImproved' }] },
    });
    expect(eventsSentTo(ada).filter((event) => event.type === 'improvementBuilt')).toEqual([
      { type: 'improvementBuilt', playerId: 'p1', unitId: boat.id, improvement: 'fishingNet', tile: site, cityName: 'Rome' },
    ]);
    // A fished coast tile is the best tile Rome has: a citizen gathers from it.
    expect(ownCity(ada.view).own.worked).toContain(site);
    // No second net on the same tile; on the next coast tile the boat could begin one at once.
    turn = turnOf(ada);
    expect(await ada.actRejected(turn, { type: 'startJob', unitId: boat.id, improvement: 'fishingNet' })).toBe('alreadyImproved');
    await ada.actOk(turn, { type: 'moveUnit', unitId: boat.id, path: [at(2, 9)] });
    expect(ada.view?.units.find((unit) => unit.id === boat.id)?.own?.jobOptions).toEqual([
      { improvement: 'fishingNet', turns: net.turns, error: null },
    ]);

    // Everything Ben was sent since the game began: Ada has ended her turn;
    // the turn has changed; the answers to his own End Turns. No tile, no
    // unit, no city, and no news but the turn counter.
    await ben.expectNothingPending();
    const toldBen = framesSince(ben, benFrames);
    expect(toldBen.length).toBeGreaterThan(3 * net.turns);
    for (const frame of toldBen) {
      const message = JSON.parse(frame) as ServerMessage;
      if (message.type === 'actionOk') continue;
      if (message.type !== 'gameUpdate') throw new Error(`Ben was sent a ${message.type}: ${frame.slice(0, 200)}`);
      expect(Object.keys(message.patch).filter((key) => key !== 'players' && key !== 'turn'), frame.slice(0, 200)).toEqual([]);
      expect(message.events.filter((event) => event.type !== 'turnStarted'), frame.slice(0, 200)).toEqual([]);
    }
    // In words, over every frame from his first: nothing names the boat, its job or the net.
    const everythingAdaGot = ada.frames.join('\n');
    const everythingBenGot = ben.frames.join('\n');
    for (const secret of [boat.id, '"fishingBoat"', '"fishingNet"', 'improvementBuilt', '"turnsWorked"', '"turnsLeft"']) {
      // The check can fail: Ada was told every one of them.
      expect(everythingAdaGot.includes(secret), `Ada was told ${secret}`).toBe(true);
      expect(everythingBenGot.includes(secret), `Ben was told ${secret}`).toBe(false);
    }
    expect(ben.view?.tiles[site]).toBeNull();

    // Ben's turn to build. Thebes, inland, owns no water; its Worker is
    // built like any other, and the two boats of its menu say why they
    // cannot be: for good, whatever the queue holds.
    const worker = await raiseWorker(ben, clients);
    const thebes = ownCity(ben.view).id;
    expect(ownWater(ben.view)).toEqual([]);
    const boats = ownCity(ben.view).own.buildOptions.filter((option) => UNITS[option.item.unitType].domain === 'sea');
    expect(boats.map((option) => option.item.unitType)).toEqual(['fishingBoat', 'scoutBoat']);
    for (const option of boats) expect(option).toMatchObject({ turns: null, wait: 'noRoom', addError: 'noWaterForBoat' });
    const land = ownCity(ben.view).own.buildOptions.filter((option) => UNITS[option.item.unitType].domain === 'land');
    expect(land.map((option) => [option.item.unitType, option.addError, option.wait])).toEqual([
      ['warrior', null, null],
      ['scout', null, null],
      ['settler', null, null],
      ['worker', null, null],
    ]);

    // A boat for that city, alone or between land units: refused by the
    // rules, with the request id and the standard sentence. As often as it
    // takes bad messages to close a socket: these are answers, not bad messages.
    turn = turnOf(ben);
    await ben.actOk(turn, setQueue(thebes, queueOf('warrior')));
    // (The Worker steps out of the city first, onto Ben's own meadow, for what is asked of it further down.)
    const meadow = worker.tile + 1;
    await ben.actOk(turn, { type: 'moveUnit', unitId: worker.id, path: [meadow] });
    expect(ben.view?.tiles[meadow]).toMatchObject({ terrain: 'grassland', feature: null, improvement: null, owner: 'p2' });
    for (const client of clients) await client.drain();
    const fileBefore = server.saveText(code);
    const viewBefore = ben.view;
    const adaFrames = ada.frames.length;
    const dryQueues = [
      queueOf('fishingBoat'),
      queueOf('scoutBoat'),
      queueOf('warrior', 'fishingBoat'),
      queueOf('scoutBoat', 'worker', 'scout'),
      queueOf('warrior', 'worker', 'settler', 'scout', 'fishingBoat'),
    ];
    expect(dryQueues).toHaveLength(MAX_BAD_MESSAGES);
    for (const queue of dryQueues) {
      const requestId = ben.sendAction(turn, setQueue(thebes, queue));
      const { reply, before: earlier } = await ben.readReply(requestId);
      expect(reply).toStrictEqual({
        type: 'actionRejected',
        requestId,
        error: { code: 'noWaterForBoat', message: RULE_ERROR_MESSAGES.noWaterForBoat },
      });
      expect(earlier).toEqual([]);
    }
    // Ada's own boat is not Ben's to queue for her either, and Rome is no city of his.
    expect(await ben.actRejected(turn, setQueue(rome, queueOf('fishingBoat')))).toBe('noSuchCity');

    // A Worker told to build a net: that is not its trade, on a meadow where
    // it could begin a farm at once as little as anywhere. Its panel never offers it.
    expect(ownUnit(ben.view, 'worker').own?.jobOptions).toEqual([
      { improvement: 'farm', turns: IMPROVEMENTS.farm.turns, error: null },
      { improvement: 'mine', turns: IMPROVEMENTS.mine.turns, error: 'badImprovementTile' },
    ]);
    const requestId = ben.sendAction(turn, { type: 'startJob', unitId: worker.id, improvement: 'fishingNet' });
    const { reply, before: earlier } = await ben.readReply(requestId);
    expect(reply).toStrictEqual({
      type: 'actionRejected',
      requestId,
      error: { code: 'cannotImprove', message: RULE_ERROR_MESSAGES.cannotImprove },
    });
    expect(earlier).toEqual([]);

    // Nothing of all that was saved or sent on: the queue is the one
    // Warrior it was, the socket is open, and Ada heard nothing.
    expect(server.saveText(code)).toBe(fileBefore);
    await ben.expectNothingPending();
    expect(ben.view).toEqual(viewBefore);
    expect(queueItems(ownCity(ben.view))).toEqual(queueOf('warrior'));
    await ada.expectNothingPending();
    expect(framesSince(ada, adaFrames)).toEqual([]);
  });
});
