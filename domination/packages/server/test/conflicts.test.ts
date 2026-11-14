import { CIV_IDS } from '@domination/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeRules } from './fakeRules';
import { cleanUp, gameWith, lobbyWith, startTestServer } from './harness';
import type { TestClient } from './harness';
import { at, ownUnit, realRulesOnMeadow } from './realWorld';

/**
 * Two wishes in the same instant. The server handles one message completely
 * before the next, so there is always an order, and the first valid one wins.
 *
 * Where a test lets two sockets race, it does not know which message the
 * server will see first, and does not need to: it checks that the outcome is
 * one of the two consistent ones, never a mixture.
 */

afterEach(cleanUp);

/** The reply to an action as one word: 'ok', or the error code. */
async function outcomeOf(client: TestClient, requestId: number): Promise<string> {
  const { reply } = await client.readReply(requestId);
  if (reply.type === 'actionOk') return 'ok';
  if (reply.type === 'actionRejected') return reply.error.code;
  throw new Error(`unexpected reply: ${JSON.stringify(reply)}`);
}

describe('same-instant conflicts: first valid action wins (WP3, real rules)', () => {
  it('two units sent to the same tile: exactly one arrives', async () => {
    // The two Warriors start two tiles apart; the tile between them is next to both.
    const server = await startTestServer({ rules: realRulesOnMeadow([[5, 5], [7, 5]]) });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;
    const between = at(6, 5);
    const adaWarrior = ownUnit(ada.view, 'warrior');
    const benWarrior = ownUnit(ben.view, 'warrior');

    // Both sent before either answer is read.
    const adaRequest = ada.sendAction(1, { type: 'moveUnit', unitId: adaWarrior.id, path: [between] });
    const benRequest = ben.sendAction(1, { type: 'moveUnit', unitId: benWarrior.id, path: [between] });
    const outcomes = [await outcomeOf(ada, adaRequest), await outcomeOf(ben, benRequest)];
    expect([...outcomes].sort()).toEqual(['blocked', 'ok']);
    await ada.drain();
    await ben.drain();

    // Exactly one Warrior stands on the tile, and both players see the same one.
    const winner = outcomes[0] === 'ok' ? adaWarrior : benWarrior;
    const loser = outcomes[0] === 'ok' ? benWarrior : adaWarrior;
    for (const client of clients) {
      const there = client.view?.units.filter((unit) => unit.tile === between) ?? [];
      expect(there.map((unit) => unit.id)).toEqual([winner.id]);
      // The loser's Warrior has not moved.
      expect(client.view?.units.find((unit) => unit.id === loser.id)?.tile).toBe(loser.tile);
    }
    const saved = server.save(code).game;
    expect(Object.values(saved?.units ?? {}).filter((unit) => unit.tile === between)).toHaveLength(1);
  });

  it('two cities founded too close together: the second gets tooCloseToCity', async () => {
    // The two Settlers start three tiles apart: one city fits, two do not.
    const server = await startTestServer({ rules: realRulesOnMeadow([[5, 5], [8, 5]]) });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    const adaRequest = ada.sendAction(1, { type: 'foundCity', unitId: ownUnit(ada.view, 'settler').id });
    const benRequest = ben.sendAction(1, { type: 'foundCity', unitId: ownUnit(ben.view, 'settler').id });
    const outcomes = [await outcomeOf(ada, adaRequest), await outcomeOf(ben, benRequest)];
    expect([...outcomes].sort()).toEqual(['ok', 'tooCloseToCity']);
    await ada.drain();
    await ben.drain();

    // One city exists, and the Settler that was refused is still there.
    const saved = server.save(code).game;
    expect(Object.keys(saved?.cities ?? {})).toHaveLength(1);
    const founder = outcomes[0] === 'ok' ? ada : ben;
    const refused = outcomes[0] === 'ok' ? ben : ada;
    expect(founder.view?.cities.filter((city) => city.owner === founder.view?.you)).toHaveLength(1);
    expect(founder.view?.units.some((unit) => unit.owner === founder.view?.you && unit.type === 'settler')).toBe(false);
    expect(ownUnit(refused.view, 'settler').own?.foundCityError).toBe('tooCloseToCity');
  });

  it("the last endTurn racing another player's cancelEndTurn: whichever arrives first counts; a cancel after resolution gets staleTurn", async () => {
    const server = await startTestServer({ rules: realRulesOnMeadow([[3, 5], [20, 5]]) });

    // Order 1: Ben's End Turn arrives first. The turn resolves; Ada's cancel is too late.
    {
      const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
      const [ada, ben] = clients;
      await ada.actOk(1, { type: 'endTurn' });
      await ben.actOk(1, { type: 'endTurn' });
      const cancel = ada.sendAction(1, { type: 'cancelEndTurn' }); // still carries turn 1
      expect(await outcomeOf(ada, cancel)).toBe('staleTurn');
      await ada.drain();
      expect(ada.view?.turn).toBe(2);
      expect(ada.view?.players.map((player) => player.endedTurn)).toEqual([false, false]);
      expect(server.save(code).game?.turn).toBe(2);
    }

    // Order 2: Ada's cancel arrives first. Ben's End Turn is then not the last one: no resolution.
    {
      const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
      const [ada, ben] = clients;
      await ada.actOk(1, { type: 'endTurn' });
      await ada.actOk(1, { type: 'cancelEndTurn' });
      await ben.actOk(1, { type: 'endTurn' });
      await ada.drain();
      expect(ada.view?.turn).toBe(1);
      expect(ada.view?.players.map((player) => player.endedTurn)).toEqual([false, true]);
      expect(server.save(code).game?.turn).toBe(1);
    }

    // A real race, several times over: the result is always one of those two, never a mixture.
    for (let round = 0; round < 10; round++) {
      const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
      const [ada, ben] = clients;
      await ada.actOk(1, { type: 'endTurn' });
      const cancel = ada.sendAction(1, { type: 'cancelEndTurn' });
      const end = ben.sendAction(1, { type: 'endTurn' });
      const cancelOutcome = await outcomeOf(ada, cancel);
      expect(await outcomeOf(ben, end)).toBe('ok');
      await ada.drain();
      await ben.drain();

      const saved = server.save(code).game;
      if (cancelOutcome === 'staleTurn') {
        expect(saved?.turn).toBe(2);
        expect(saved?.players.map((player) => player.endedTurn)).toEqual([false, false]);
      } else {
        expect(cancelOutcome).toBe('ok');
        expect(saved?.turn).toBe(1);
        expect(saved?.players.map((player) => player.endedTurn)).toEqual([false, true]);
      }
      // Both players were shown exactly what was saved.
      for (const client of clients) {
        expect(client.view?.turn).toBe(saved?.turn);
        expect(client.view?.players.map((player) => player.endedTurn)).toEqual(saved?.players.map((player) => player.endedTurn));
      }
    }
  });

  it('End Turn double-clicked: the second is an accepted no-op and the turn advances once', async () => {
    const server = await startTestServer({ rules: realRulesOnMeadow([[3, 5], [20, 5]]) });
    const { code, clients } = await gameWith(server, ['Ada', 'Ben']);
    const [ada, ben] = clients;

    // Ada double-clicks while Ben is still playing: the second click changes nothing.
    const first = ada.sendAction(1, { type: 'endTurn' });
    const second = ada.sendAction(1, { type: 'endTurn' });
    expect(await outcomeOf(ada, first)).toBe('ok');
    expect(await outcomeOf(ada, second)).toBe('ok');
    // One update each for the one change; nothing for the no-op.
    expect((await ben.drain()).map((message) => message.type)).toEqual(['gameUpdate']);
    expect(ada.seq).toBe(2);
    expect(ada.view?.turn).toBe(1);

    // Ben, the last player, double-clicks too: the first click resolves the
    // turn, and the second, still carrying turn 1, cannot end turn 2.
    const third = ben.sendAction(1, { type: 'endTurn' });
    const fourth = ben.sendAction(1, { type: 'endTurn' });
    expect(await outcomeOf(ben, third)).toBe('ok');
    expect(await outcomeOf(ben, fourth)).toBe('staleTurn');
    await ada.drain();
    await ben.drain();

    for (const client of clients) {
      expect(client.view?.turn).toBe(2);
      expect(client.view?.players.map((player) => player.endedTurn)).toEqual([false, false]);
    }
    expect(server.save(code).game?.turn).toBe(2);
  });
});

// The last two conflicts are about the lobby, which does not depend on the
// rules of the game: they run with the fake rules, always.
describe('same-instant conflicts in the lobby (WP3)', () => {
  it('two players choosing the same civilization: the second gets civTaken', async () => {
    const server = await startTestServer({ rules: createFakeRules().rules });
    const wanted = CIV_IDS[4];

    for (let round = 0; round < 10; round++) {
      const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
      const [ada, ben] = clients;
      ada.send({ type: 'chooseCiv', civ: wanted });
      ben.send({ type: 'chooseCiv', civ: wanted });

      // Each of them gets one `lobby` (for the choice that won); the loser also gets `civTaken`.
      const answers = [await ada.drain(), await ben.drain()];
      const refusals = answers.map((messages) => messages.filter((message) => message.type === 'error'));
      expect(refusals[0].length + refusals[1].length).toBe(1);
      expect([...refusals[0], ...refusals[1]][0]).toMatchObject({ code: 'civTaken' });
      for (const messages of answers) {
        expect(messages.filter((message) => message.type === 'lobby')).toHaveLength(1);
      }

      // Exactly one seat has the civilization, and it is the seat that was not refused.
      const seats = server.save(code).seats;
      expect(seats.filter((seat) => seat.civ === wanted)).toHaveLength(1);
      const winner = refusals[0].length === 0 ? 'p1' : 'p2';
      expect(seats.find((seat) => seat.civ === wanted)?.playerId).toBe(winner);
    }
  });

  it('a join arriving just after the start gets gameAlreadyStarted', async () => {
    const server = await startTestServer({ rules: createFakeRules().rules });
    const { code, clients } = await lobbyWith(server, ['Ada', 'Ben']);
    const late = await server.connect();

    clients[0].send({ type: 'startGame' });
    for (const client of clients) await client.nextOfType('gameSync');
    late.send({ type: 'joinGame', code, name: 'Cleo' });
    await late.expectError('gameAlreadyStarted');

    // The game has the two players it was started with.
    expect(server.save(code).seats.map((seat) => seat.name)).toEqual(['Ada', 'Ben']);
    expect(server.save(code).game?.players.map((player) => player.name)).toEqual(['Ada', 'Ben']);
    for (const client of clients) await client.expectNothingPending();
  });

  it('a join racing the start: the newcomer is either in the game from the start or told gameAlreadyStarted', async () => {
    const server = await startTestServer({ rules: createFakeRules().rules });

    for (let round = 0; round < 10; round++) {
      const { code, clients } = await lobbyWith(server, ['Ada']);
      const racer = await server.connect();
      clients[0].send({ type: 'startGame' });
      racer.send({ type: 'joinGame', code, name: 'Ben' });

      const answer = (await racer.drain()).filter((message) => message.type !== 'lobby');
      const saved = server.save(code);
      if (answer[0]?.type === 'error') {
        expect(answer[0].code).toBe('gameAlreadyStarted');
        expect(saved.seats).toHaveLength(1);
        expect(saved.game?.players).toHaveLength(1);
      } else {
        // The join came first: the newcomer has a seat AND is a player of the started game.
        expect(answer.map((message) => message.type)).toEqual(['gameSync']);
        expect(saved.seats.map((seat) => seat.name)).toEqual(['Ada', 'Ben']);
        expect(saved.game?.players.map((player) => player.name)).toEqual(['Ada', 'Ben']);
      }
    }
  });
});
