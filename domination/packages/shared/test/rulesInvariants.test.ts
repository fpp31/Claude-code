import { describe, expect, it } from 'vitest';
import { RULES, STATE_SCHEMA, UNITS, checkInvariants, updateKnowledge } from '../src/index';
import type { GameState } from '../src/index';
import { MEADOW, act, at, deepFreeze, foundCityAt, newGame, placeUnit, tamper, unitOf } from './rulesKit';

/**
 * Tests for checkInvariants, the health check the server runs on a loaded
 * save and the random-play tests run after every step. A health check that
 * misses damage is worse than none, so every promise of its doc comment is
 * tried here: take a healthy state, break one thing, expect a complaint.
 *
 * The sentences themselves are for people and may be reworded freely; the
 * tests only count them.
 */

/** A healthy mid-game state: both players have a city, units stand around. */
function healthyGame(): GameState {
  const start = newGame(MEADOW, [[3, 5], [12, 5]]);
  const withRome = act(start, 'p1', { type: 'foundCity', unitId: unitOf(start, 'p1', 'settler').id });
  return act(withRome, 'p2', { type: 'foundCity', unitId: unitOf(withRome, 'p2', 'settler').id });
}

describe('checkInvariants (WP2)', () => {
  const healthy = healthyGame();
  const map = healthy.map;
  const warriorId = unitOf(healthy, 'p1', 'warrior').id;
  const romeId = Object.values(healthy.cities).find((city) => city.owner === 'p1')?.id as string;
  const thebesId = Object.values(healthy.cities).find((city) => city.owner === 'p2')?.id as string;
  const openTile = at(map, 8, 8); // free, unowned grass, in nobody's sight

  it('finds nothing wrong with a healthy state, and does not change it', () => {
    const frozen = deepFreeze(tamper(healthy, () => undefined));
    const before = JSON.stringify(frozen);
    expect(checkInvariants(frozen)).toEqual([]);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  /** Every entry breaks exactly one promise of the doc comment. */
  const damage: [string, (draft: GameState) => void][] = [
    // schema and turn
    ['a schema from another version', (d) => { d.schema = STATE_SCHEMA + 1; }],
    ['turn 0', (d) => { d.turn = 0; }],
    ['a turn that is not a whole number', (d) => { d.turn = 1.5; }],
    // map
    ['a map with a tile missing', (d) => { d.map.tiles.pop(); }],
    ['a forest on desert', (d) => { d.map.tiles[openTile] = { terrain: 'desert', feature: 'forest', cityId: null }; }],
    ['hills in the ocean', (d) => { d.map.tiles[0].feature = 'hills'; }],
    // players
    ['no players', (d) => { d.players = []; }],
    ['more players than seats', (d) => {
      while (d.players.length <= RULES.maxSeats) d.players.push({ ...d.players[1], id: `p${d.players.length + 1}` });
    }],
    ['a player id that is not a seat name', (d) => { d.players[1].id = 'alice'; }],
    ['players out of seat order', (d) => { d.players.reverse(); }],
    ['the same player twice', (d) => { d.players[1].id = 'p1'; }],
    // units
    ['a unit stored under another id', (d) => { d.units[warriorId].id = 'u1_other'; }],
    ['a unit of an unknown type', (d) => { (d.units[warriorId] as { type: string }).type = 'dragon'; }],
    ['a unit of nobody', (d) => { d.units[warriorId].owner = 'p7'; }],
    ['a unit off the map', (d) => { d.units[warriorId].tile = d.map.tiles.length; }],
    ['a unit in the water', (d) => { d.units[warriorId].tile = 0; }],
    ['a unit on a mountain', (d) => {
      d.map.tiles[openTile].feature = 'mountains';
      d.units[warriorId].tile = openTile;
    }],
    ['negative moves', (d) => { d.units[warriorId].movesLeft = -1; }],
    ['half a move', (d) => { d.units[warriorId].movesLeft = 0.5; }],
    ['more moves than the unit type has', (d) => { d.units[warriorId].movesLeft = UNITS.warrior.moves + 1; }],
    // stacking
    ['two military units on one tile', (d) => { placeUnit(d, 'p1', 'scout', d.units[warriorId].tile); }],
    ['two civilian units on one tile', (d) => {
      placeUnit(d, 'p1', 'settler', openTile);
      placeUnit(d, 'p1', 'settler', openTile);
    }],
    ['units of two players on one tile', (d) => {
      placeUnit(d, 'p1', 'scout', openTile);
      placeUnit(d, 'p2', 'settler', openTile);
    }],
    // cities
    ['a city stored under another id', (d) => { d.cities[romeId].id = 'c1_other'; }],
    ['a city of nobody', (d) => { d.cities[romeId].owner = 'p7'; }],
    ['a city off the map', (d) => { d.cities[romeId].tile = -3; }],
    ['a city without citizens', (d) => { d.cities[romeId].population = 0; }],
    ['negative food', (d) => { d.cities[romeId].foodStored = -1; }],
    ['negative production', (d) => { d.cities[romeId].productionStored = -1; }],
    ['a city whose own tile belongs to nobody', (d) => { d.map.tiles[d.cities[romeId].tile].cityId = null; }],
    ['a city whose own tile belongs to another city', (d) => { d.map.tiles[d.cities[romeId].tile].cityId = thebesId; }],
    ['a foreign unit inside a city', (d) => {
      // Rome's own warrior steps out first, so that the complaint is about the city and not about two players sharing a tile.
      d.units[warriorId].tile = openTile;
      placeUnit(d, 'p2', 'settler', d.cities[romeId].tile);
    }],
    ['two cities too close together', (d) => {
      d.cities[thebesId].tile = d.cities[romeId].tile + RULES.minCityDistance - 1;
      d.map.tiles[d.cities[thebesId].tile].cityId = thebesId;
    }],
    // territory
    ['a tile that belongs to a city that does not exist', (d) => { d.map.tiles[openTile].cityId = 'c1_ghost'; }],
  ];

  /** Damage to the fog-of-war memory itself. */
  const memoryDamage: [string, (draft: GameState) => void][] = [
    ['a memory of the wrong size', (d) => { d.players[0].knowledge.explored.pop(); }],
    ['an explored entry that is neither 0 nor 1', (d) => { d.players[0].knowledge.explored[openTile] = 2; }],
    ['a tile in sight that is not marked explored', (d) => { d.players[0].knowledge.explored[d.units[warriorId].tile] = 0; }],
    ['a memory of a tile that was never explored', (d) => {
      d.players[0].knowledge.remembered[openTile] = { owner: 'p2', city: null };
    }],
  ];

  function expectComplaints(problems: string[]): void {
    expect(problems.length).toBeGreaterThan(0);
    for (const sentence of problems) {
      expect(typeof sentence).toBe('string');
      expect(sentence.length).toBeGreaterThan(10);
    }
  }

  it.each(damage)('complains about %s', (_what, change) => {
    const damaged = tamper(healthy, (draft) => {
      change(draft);
      // Many kinds of damage also change what somebody sees. The fog memory
      // is brought up to date afterwards, so that the complaint has to come
      // from the check that is meant and not from "sees tiles that are not
      // marked as explored".
      try {
        updateKnowledge(draft);
      } catch {
        // Too damaged to work out who sees what (an unknown unit type, say): the memory stays as it is.
      }
    });
    expectComplaints(checkInvariants(damaged));
  });

  it.each(memoryDamage)('complains about %s', (_what, change) => {
    expectComplaints(checkInvariants(tamper(healthy, change)));
  });

  it('the damage list really starts from a healthy state (each entry alone makes the difference)', () => {
    expect(damage.length + memoryDamage.length).toBeGreaterThan(35);
    expect(checkInvariants(tamper(healthy, () => undefined))).toEqual([]);
    expect(healthy.players[0].knowledge.explored[openTile]).toBe(0);
    expect(healthy.map.tiles[openTile].cityId).toBeNull();
  });

  it('never throws, however damaged the state is', () => {
    const wrecks: unknown[] = [
      {},
      null,
      undefined,
      42,
      { schema: STATE_SCHEMA, turn: 1 },
      tamper(healthy, (d) => { (d as { map: unknown }).map = null; }),
      tamper(healthy, (d) => { (d as { players: unknown }).players = 'nobody'; }),
      tamper(healthy, (d) => { (d as { units: unknown }).units = null; }),
      tamper(healthy, (d) => { (d as { cities: unknown }).cities = [null]; }),
      tamper(healthy, (d) => { (d.players[0] as { knowledge: unknown }).knowledge = {}; }),
      tamper(healthy, (d) => { (d.map.tiles as unknown[])[5] = null; }),
      tamper(healthy, (d) => { (d.units as Record<string, unknown>)[warriorId] = { id: warriorId }; }),
    ];
    for (const wreck of wrecks) {
      let problems: string[] = [];
      expect(() => {
        problems = checkInvariants(wreck as GameState);
      }).not.toThrow();
      expect(problems.length).toBeGreaterThan(0);
    }
  });

  it('accepts a second city that is exactly the minimum distance away', () => {
    const start = newGame(MEADOW, [[3, 5], [12, 5]]);
    const withRome = act(start, 'p1', { type: 'foundCity', unitId: unitOf(start, 'p1', 'settler').id });
    const close = foundCityAt(withRome, 'p2', at(map, 3 + RULES.minCityDistance, 5));
    expect(checkInvariants(close)).toEqual([]);
  });
});
