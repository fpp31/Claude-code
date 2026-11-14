import { describe, expect, it } from 'vitest';
import { getPlayer, newCityId, newUnitId, playerIdForSeat, seatOfPlayer } from '../src/ids';
import { seedRng } from '../src/rng';
import { STATE_SCHEMA } from '../src/types';
import type { GameState, PlayerState } from '../src/types';

function makePlayer(seat: number, seed: string): PlayerState {
  const id = playerIdForSeat(seat);
  return {
    id,
    name: `Player ${seat}`,
    civ: 'rome',
    endedTurn: false,
    citiesFounded: 0,
    idRng: seedRng(seed, `ids:${id}`),
    knowledge: { explored: [0], remembered: {} },
  };
}

/** A tiny state with two players: just enough for the id functions. */
function makeState(seed = 'test-seed'): GameState {
  return {
    schema: STATE_SCHEMA,
    seed,
    rng: seedRng(seed, 'dice'),
    settings: { mapSize: 'small', turnMode: 'simultaneous' },
    turn: 1,
    map: { width: 1, height: 1, tiles: [{ terrain: 'grassland', feature: null, cityId: null }] },
    players: [makePlayer(1, seed), makePlayer(2, seed)],
    units: {},
    cities: {},
  };
}

describe('player ids', () => {
  it('converts between seat numbers and player ids', () => {
    expect(playerIdForSeat(1)).toBe('p1');
    expect(playerIdForSeat(8)).toBe('p8');
    expect(seatOfPlayer('p1')).toBe(1);
    expect(seatOfPlayer('p8')).toBe(8);
  });

  it('refuses ids that are not a seat name, instead of making ids like uNaN_...', () => {
    for (const bad of ['alice', 'a', '', 'p', 'p0', 'p1x', 'P1', '1']) {
      expect(() => seatOfPlayer(bad)).toThrow();
    }
    const state = makeState();
    state.players[0].id = 'alice';
    expect(() => newUnitId(state, 'alice')).toThrow();
    expect(() => newCityId(state, 'alice')).toThrow();
  });

  it('finds players and complains about unknown ones', () => {
    const state = makeState();
    expect(getPlayer(state, 'p2').name).toBe('Player 2');
    expect(() => getPlayer(state, 'p3')).toThrow();
  });
});

describe('unit and city ids', () => {
  it('look like u<seat>_xxxxxx and c<seat>_xxxxxx', () => {
    const state = makeState();
    expect(newUnitId(state, 'p1')).toMatch(/^u1_[a-z2-9]{6}$/);
    expect(newUnitId(state, 'p2')).toMatch(/^u2_[a-z2-9]{6}$/);
    expect(newCityId(state, 'p1')).toMatch(/^c1_[a-z2-9]{6}$/);
    expect(newCityId(state, 'p2')).toMatch(/^c2_[a-z2-9]{6}$/);
  });

  it('are the same for the same seed and different for another seed', () => {
    const a = makeState('seed-one');
    const b = makeState('seed-one');
    const c = makeState('seed-two');
    const idsA = [newUnitId(a, 'p1'), newUnitId(a, 'p1'), newCityId(a, 'p1')];
    const idsB = [newUnitId(b, 'p1'), newUnitId(b, 'p1'), newCityId(b, 'p1')];
    const idsC = [newUnitId(c, 'p1'), newUnitId(c, 'p1'), newCityId(c, 'p1')];
    expect(idsB).toEqual(idsA);
    expect(idsC).not.toEqual(idsA);
  });

  it('do not repeat', () => {
    const state = makeState();
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = newUnitId(state, 'p1');
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      state.units[id] = { id, type: 'warrior', owner: 'p1', tile: 0, movesLeft: 0 };
    }
  });

  it("depend only on the creating player's own history (nothing leaks between players)", () => {
    // In world A only p1 creates things. In world B p2 is very busy in between.
    const a = makeState();
    const b = makeState();
    const idsA: string[] = [];
    const idsB: string[] = [];
    for (let i = 0; i < 20; i++) {
      idsA.push(newUnitId(a, 'p1'), newCityId(a, 'p1'));
      for (let j = 0; j < 5; j++) {
        const other = newUnitId(b, 'p2');
        b.units[other] = { id: other, type: 'warrior', owner: 'p2', tile: 0, movesLeft: 0 };
        newCityId(b, 'p2');
      }
      idsB.push(newUnitId(b, 'p1'), newCityId(b, 'p1'));
    }
    expect(idsB).toEqual(idsA);
  });
});
