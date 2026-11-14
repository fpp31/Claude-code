import { describe, expect, it } from 'vitest';
import {
  applyViewPatch,
  buildPlayerView,
  diffViews,
  filterEvents,
  jsonEqual,
  tileMoveCost,
} from '../src/index';
import type { Action, GameState, PlayerId, PlayerView, TileIndex } from '../src/index';
import { arrange, at, deepFreeze, newGame, placeUnit, send, tamper, unitOf } from './rulesKit';
import { LONG_TEST, WILDS, WILDS_STARTS, playRandomGame } from './rulesRandomPlay';
import { inSight, observe, startOracle, viewProblems } from './visibilityOracle';
import { borderScene, fogScene, scoutSteps } from './visibilityScenes';

/**
 * The heart of the project's promise that friends cannot cheat by reading
 * network traffic: a view, an event list and an error code never contain
 * anything the player is not entitled to know.
 *
 * Three kinds of proof, each from another angle (the first two are in this
 * file, the third in visibilityTwinWorlds.test.ts):
 *  1. NON-INTERFERENCE. Change something the player cannot see; their view
 *     must stay exactly the same. Each such test also makes the same kind
 *     of change where the player CAN see it and checks that the view does
 *     change, so a test can never pass because it changed nothing.
 *  2. AN ORACLE. A second fog of war, written independently
 *     (visibilityOracle.ts), follows long random games and checks every
 *     tile, unit and city of every view.
 *  3. TWIN WORLDS. Two games that differ only in what one player cannot
 *     see are played side by side; that player must not be able to tell
 *     them apart, whatever they try.
 *
 * One fact is public on purpose (protocol.ts): a city's name follows its
 * owner's founding order.
 */

/** The view of p1 must be exactly `baseline`, as an object and as the text that would go over the wire. */
function expectSameView(state: GameState, baseline: PlayerView, what: string): void {
  const view = buildPlayerView(state, 'p1');
  expect(view, what).toEqual(baseline);
  expect(JSON.stringify(view), what).toBe(JSON.stringify(baseline));
}

function expectChangedView(state: GameState, baseline: PlayerView, what: string): void {
  expect(JSON.stringify(buildPlayerView(state, 'p1')), what).not.toBe(JSON.stringify(baseline));
}

/** A tile a land unit can stand on, with no unit and no city on it. */
function isFreeLand(state: GameState, tile: TileIndex): boolean {
  if (tileMoveCost(state.map.tiles[tile]) === null) return false;
  if (Object.values(state.units).some((unit) => unit.tile === tile)) return false;
  return !Object.values(state.cities).some((city) => city.tile === tile);
}

describe('NO LEAK: a view never contains hidden information (WP2)', () => {
  it('non-interference: moving a hidden foreign unit does not change the view', () => {
    const { state: scene } = fogScene();
    const map = scene.map;
    // p2 gets a scout far in the east; its warrior sits in fogged Thebes.
    let hiddenScoutId = '';
    const state = arrange(scene, (draft) => {
      hiddenScoutId = placeUnit(draft, 'p2', 'scout', at(map, 13, 8)).id;
    });
    const baseline = buildPlayerView(state, 'p1');
    const visible = inSight(state, 'p1');
    expect(baseline.units.some((unit) => unit.owner === 'p2')).toBe(false);

    // Put the scout on every tile p1 cannot see, one after the other (fogged and never-seen tiles alike).
    let tried = 0;
    for (let tile = 0; tile < map.tiles.length; tile++) {
      if (visible[tile] || !isFreeLand(state, tile)) continue;
      const moved = tamper(state, (draft) => {
        draft.units[hiddenScoutId].tile = tile;
      });
      expectSameView(moved, baseline, `hidden scout on tile ${tile}`);
      tried += 1;
    }
    expect(tried).toBeGreaterThan(30);

    // Everything else about hidden units is hidden too: how many there are, what they are, their moves.
    expectSameView(tamper(state, (draft) => { delete draft.units[hiddenScoutId]; }), baseline, 'hidden scout removed');
    expectSameView(tamper(state, (draft) => { draft.units[hiddenScoutId].type = 'settler'; }), baseline, 'hidden unit of another type');
    expectSameView(tamper(state, (draft) => { draft.units[hiddenScoutId].movesLeft = 0; }), baseline, 'hidden unit without moves');
    expectSameView(tamper(state, (draft) => {
      placeUnit(draft, 'p2', 'warrior', at(map, 13, 2));
      placeUnit(draft, 'p2', 'settler', at(map, 13, 2));
      placeUnit(draft, 'p2', 'scout', at(map, 11, 7));
    }), baseline, 'three more hidden units');

    // The check is not blind: the same scout on a tile in sight does change the view...
    const inTheOpen = tamper(state, (draft) => {
      draft.units[hiddenScoutId].tile = at(map, 8, 5);
    });
    expect(visible[at(map, 8, 5)]).toBe(true);
    expectChangedView(inTheOpen, baseline, 'scout in sight');
    // ...but even then its remaining moves stay private.
    const openView = buildPlayerView(inTheOpen, 'p1');
    const tired = tamper(inTheOpen, (draft) => {
      draft.units[hiddenScoutId].movesLeft = 0;
    });
    expectSameView(tired, openView, 'moves of a foreign unit in sight');
  });

  it('non-interference: changing terrain or features of never-seen tiles does not change the view', () => {
    const { state } = fogScene();
    const baseline = buildPlayerView(state, 'p1');
    const neverSeen = baseline.tiles.map((tile, index) => (tile === null ? index : -1)).filter((index) => index >= 0);
    expect(neverSeen.length).toBeGreaterThan(40);

    // One tile at a time, and all of them at once.
    for (const tile of neverSeen) {
      const changed = tamper(state, (draft) => {
        draft.map.tiles[tile].terrain = draft.map.tiles[tile].terrain === 'desert' ? 'plains' : 'desert';
        draft.map.tiles[tile].feature = draft.map.tiles[tile].feature === 'hills' ? null : 'hills';
      });
      expectSameView(changed, baseline, `terrain of never-seen tile ${tile}`);
    }
    const allChanged = tamper(state, (draft) => {
      for (const tile of neverSeen) draft.map.tiles[tile] = { terrain: 'ocean', feature: null, cityId: draft.map.tiles[tile].cityId };
    });
    expectSameView(allChanged, baseline, 'every never-seen tile is ocean');

    // The same change on a tile the player has seen (even one that is only remembered) shows up.
    const foggedTile = baseline.tiles.findIndex((tile) => tile !== null && !tile.visible);
    expect(foggedTile).toBeGreaterThanOrEqual(0);
    expectChangedView(tamper(state, (draft) => { draft.map.tiles[foggedTile].terrain = 'desert'; }), baseline, 'terrain of a seen tile');
  });

  it('non-interference: changing a foreign city\'s food, production or stored production does not change the view', () => {
    // Once with Thebes in sight, once with Thebes remembered.
    const inSightScene = borderScene();
    const near = scoutSteps(inSightScene.state, inSightScene.scoutId, 0, 1);
    const fogged = fogScene();

    for (const [what, state, thebesId] of [
      ['Thebes in sight', near, inSightScene.thebes.id],
      ['Thebes remembered', fogged.state, fogged.thebes.id],
    ] as const) {
      const baseline = buildPlayerView(state, 'p1');
      expect(baseline.cities.find((city) => city.id === thebesId)?.own, what).toBeNull();

      const changed = tamper(state, (draft) => {
        draft.cities[thebesId].foodStored = 777123;
        draft.cities[thebesId].production = { kind: 'unit', unitType: 'settler' };
        draft.cities[thebesId].productionStored = 888456;
      });
      expectSameView(changed, baseline, what);
      expect(JSON.stringify(buildPlayerView(changed, 'p1'))).not.toContain('777123');
      expect(JSON.stringify(buildPlayerView(changed, 'p1'))).not.toContain('888456');
      // The owner does see those numbers.
      expect(JSON.stringify(buildPlayerView(changed, 'p2'))).toContain('888456');
    }

    // Population is public while the city is in sight: there the view follows the truth.
    const grown = tamper(near, (draft) => {
      draft.cities[inSightScene.thebes.id].population = 5;
    });
    expectChangedView(grown, buildPlayerView(near, 'p1'), 'population of a city in sight');
  });

  it('non-interference: changing ownership or cities on fogged tiles does not change the view', () => {
    const { state, thebes } = fogScene();
    const map = state.map;
    const baseline = buildPlayerView(state, 'p1');
    const visible = inSight(state, 'p1');
    // p1 remembers Thebes and some of its land; none of Thebes' land is in sight now.
    expect(baseline.cities.find((city) => city.id === thebes.id)).toMatchObject({ visible: false });
    const thebanLand = map.tiles.map((_, tile) => tile).filter((tile) => state.map.tiles[tile].cityId === thebes.id);
    expect(thebanLand.some((tile) => visible[tile])).toBe(false);
    const remembered = thebanLand.filter((tile) => baseline.tiles[tile] !== null);
    expect(remembered.length).toBeGreaterThan(3);

    // Each remembered tile is given up, one at a time.
    for (const tile of remembered) {
      if (tile === thebes.tile) continue;
      expectSameView(tamper(state, (draft) => { draft.map.tiles[tile].cityId = null; }), baseline, `fogged tile ${tile} given up`);
    }
    // The city changes in every way it can.
    expectSameView(tamper(state, (draft) => {
      draft.cities[thebes.id].population = 12;
      draft.cities[thebes.id].name = 'Renamed';
    }), baseline, 'fogged city grew and was renamed');
    // The city and all its land vanish.
    expectSameView(tamper(state, (draft) => {
      delete draft.cities[thebes.id];
      for (const tile of draft.map.tiles) if (tile.cityId === thebes.id) tile.cityId = null;
    }), baseline, 'fogged city destroyed');
    // A new city appears on a fogged tile and takes over fogged land.
    const foggedFreeTile = at(map, 10, 3);
    expect(baseline.tiles[foggedFreeTile]).toMatchObject({ visible: false, owner: null });
    expectSameView(tamper(state, (draft) => {
      draft.cities.c2_secret = { id: 'c2_secret', owner: 'p2', name: 'Secret', tile: foggedFreeTile, population: 3, foodStored: 0, production: null, productionStored: 0 };
      draft.map.tiles[foggedFreeTile].cityId = 'c2_secret';
      for (const tile of remembered) if (tile !== thebes.tile) draft.map.tiles[tile].cityId = 'c2_secret';
    }), baseline, 'a new city on a fogged tile');

    // The same on a tile in sight is noticed.
    const inSightTile = at(map, 8, 4);
    expect(visible[inSightTile]).toBe(true);
    expectChangedView(tamper(state, (draft) => { draft.map.tiles[inSightTile].cityId = thebes.id; }), baseline, 'a tile in sight changes owner');
  });

  it('non-interference: changing seed, rng, another player\'s idRng or knowledge does not change the view', () => {
    const { state } = fogScene();
    const baseline = buildPlayerView(state, 'p1');

    expectSameView(tamper(state, (draft) => { draft.seed = 'a completely different seed'; }), baseline, 'seed');
    expectSameView(tamper(state, (draft) => { draft.rng = [1, 2, 3, 4]; }), baseline, 'rng');
    expectSameView(tamper(state, (draft) => { draft.players[1].idRng = [5, 6, 7, 8]; }), baseline, 'idRng of p2');
    expectSameView(tamper(state, (draft) => {
      draft.players[1].knowledge.explored = draft.players[1].knowledge.explored.map((flag) => 1 - flag);
      draft.players[1].knowledge.remembered = { 5: { owner: 'p1', city: null } };
    }), baseline, 'knowledge of p2');
    expectSameView(tamper(state, (draft) => { draft.players[1].citiesFounded = 40; }), baseline, 'cities founded by p2');
    // The viewer's own id stream is not in the view either (it would predict future ids).
    expectSameView(tamper(state, (draft) => { draft.players[0].idRng = [9, 9, 9, 9]; }), baseline, 'idRng of p1');

    // What is public about the other player does show.
    expectChangedView(tamper(state, (draft) => { draft.players[1].endedTurn = true; }), baseline, 'endedTurn of p2');
    expectChangedView(tamper(state, (draft) => { draft.players[1].name = 'Benjamin'; }), baseline, 'name of p2');
  });

  it('oracle: during random play, every tile, unit and city in every view is justified by an independently written visibility check', LONG_TEST, () => {
    const start = newGame(WILDS, WILDS_STARTS, 'oracle');
    const oracle = startOracle(start);
    let viewsChecked = 0;
    let foreignUnitsSeen = 0;
    let rememberedCitiesSeen = 0;
    let foggedTilesSeen = 0;

    const checkAllViews = (state: GameState, when: string): void => {
      for (const player of state.players) {
        const view = buildPlayerView(state, player.id);
        expect(viewProblems(oracle, state, player.id, view), `${when}, view of ${player.id}`).toEqual([]);
        viewsChecked += 1;
        foreignUnitsSeen += view.units.filter((unit) => unit.owner !== player.id).length;
        rememberedCitiesSeen += view.cities.filter((city) => !city.visible).length;
        foggedTilesSeen += view.tiles.filter((tile) => tile !== null && !tile.visible).length;
      }
    };
    checkAllViews(start, 'at the start');

    playRandomGame({
      start,
      seed: 'oracle-actions',
      turns: 30,
      wildShare: 25,
      onStep: (step) => {
        if (!step.result.ok || !step.result.changed) return;
        observe(oracle, step.after, step.result.events);
        checkAllViews(step.after, `after step ${step.index}`);
      },
    });

    // The games really exercised the interesting cases.
    expect(viewsChecked).toBeGreaterThan(2000);
    expect(foreignUnitsSeen).toBeGreaterThan(100);
    expect(rememberedCitiesSeen).toBeGreaterThan(100);
    expect(foggedTilesSeen).toBeGreaterThan(10000);
  });

  it('allow-list: foreign units and cities in a view have exactly the documented keys, with own === null', LONG_TEST, () => {
    const keys = (value: object): string[] => Object.keys(value).sort();
    let foreignUnits = 0;
    let foreignCities = 0;
    let ownCities = 0;

    const checkView = (state: GameState, playerId: PlayerId): void => {
      const view = buildPlayerView(state, playerId);
      expect(keys(view)).toEqual(['cities', 'height', 'players', 'tiles', 'turn', 'units', 'width', 'you']);
      for (const tile of view.tiles) {
        if (tile !== null) expect(keys(tile)).toEqual(['feature', 'owner', 'terrain', 'visible']);
      }
      for (const player of view.players) expect(keys(player)).toEqual(['civ', 'endedTurn', 'id', 'name']);

      for (const unit of view.units) {
        expect(keys(unit)).toEqual(['id', 'own', 'owner', 'tile', 'type']);
        if (unit.owner === playerId) {
          expect(keys(unit.own as object)).toEqual(['foundCityError', 'movesLeft']);
        } else {
          expect(unit.own).toBeNull();
          foreignUnits += 1;
        }
      }
      for (const city of view.cities) {
        expect(keys(city)).toEqual(['id', 'name', 'own', 'owner', 'population', 'tile', 'visible']);
        if (city.owner === playerId) {
          ownCities += 1;
          const own = city.own as NonNullable<typeof city.own>;
          expect(keys(own)).toEqual([
            'buildOptions', 'foodPerTurn', 'foodStored', 'foodToGrow', 'production', 'productionBlocked',
            'productionCost', 'productionPerTurn', 'productionStored', 'turnsLeft', 'worked',
          ]);
          if (own.production !== null) expect(keys(own.production)).toEqual(['kind', 'unitType']);
          for (const option of own.buildOptions) {
            expect(keys(option)).toEqual(['cost', 'item', 'turns']);
            expect(keys(option.item)).toEqual(['kind', 'unitType']);
          }
        } else {
          expect(city.own).toBeNull();
          foreignCities += 1;
        }
      }
    };

    playRandomGame({
      start: newGame(WILDS, WILDS_STARTS, 'allow-list'),
      seed: 'allow-list-actions',
      turns: 30,
      wildShare: 10,
      onStep: (step) => {
        // Every view at the end of each turn, and the actor's view now and then in between.
        if (step.after.turn !== step.before.turn) {
          for (const player of step.after.players) checkView(step.after, player.id);
        } else if (step.index % 20 === 0 && step.before.players.some((player) => player.id === step.playerId)) {
          checkView(step.after, step.playerId);
        }
      },
    });
    expect(foreignUnits).toBeGreaterThan(20);
    expect(foreignCities).toBeGreaterThan(20);
    expect(ownCities).toBeGreaterThan(20);
  });

  it('canary: unique marker strings placed in hidden cities, hidden unit ids and the seed never appear in JSON.stringify(view) or in filtered events', () => {
    const scene = borderScene();
    const map = scene.state.map;
    const oldThebesId = scene.thebes.id;

    // Everything p1 has never seen gets a marker: the seed, both streams of
    // random numbers, p2's city (id, name, private numbers) and p2's units
    // (ids). p1's scout is moved back west, so that all of Thebes' land is
    // out of its sight; p1 has never seen the city itself.
    const marked = tamper(scene.state, (draft) => {
      draft.seed = 'CANARYSEED';
      draft.rng = [31415926, 31415927, 31415928, 31415929];
      draft.players[1].idRng = [27182818, 27182819, 27182820, 27182821];

      const thebes = draft.cities[oldThebesId];
      delete draft.cities[oldThebesId];
      Object.assign(thebes, {
        id: 'c2_CANARYCITYID',
        name: 'CANARYCITYNAME',
        foodStored: 16180339,
        productionStored: 14142135,
        production: { kind: 'unit', unitType: 'scout' },
      });
      draft.cities[thebes.id] = thebes;
      for (const tile of draft.map.tiles) if (tile.cityId === oldThebesId) tile.cityId = thebes.id;

      const theirUnits = Object.values(draft.units).filter((unit) => unit.owner === 'p2');
      theirUnits.push(placeUnit(draft, 'p2', 'settler', at(map, 13, 8)));
      theirUnits.forEach((unit, number) => {
        delete draft.units[unit.id];
        unit.id = `u2_CANARYUNIT${number}`;
        draft.units[unit.id] = unit;
      });

      draft.units[scene.scoutId].tile = at(map, 6, 5);
    });
    let state = arrange(marked, () => undefined); // memories up to date, and the result must be a healthy state

    /** Every secret of the moment, as the text it would be if it leaked. */
    const secretsOf = (game: GameState): string[] => {
      const visible = inSight(game, 'p1');
      const secrets = ['CANARYSEED', 'CANARYCITYNAME'];
      for (const unit of Object.values(game.units)) {
        if (unit.owner !== 'p2') continue;
        expect(visible[unit.tile], `${unit.id} must stay out of p1's sight for this test`).toBe(false);
        secrets.push(unit.id);
      }
      for (const city of Object.values(game.cities)) {
        if (city.owner !== 'p2') continue;
        expect(visible[city.tile]).toBe(false);
        secrets.push(city.id, String(city.foodStored), String(city.productionStored));
      }
      // No stream of random numbers is ever sent, not even the viewer's own id stream.
      for (const player of game.players) secrets.push(...player.idRng.map(String));
      secrets.push(...game.rng.map(String));
      // Short numbers could turn up by coincidence (as a tile number, say); long ones cannot.
      return secrets.filter((secret) => secret.length >= 7);
    };
    const expectClean = (game: GameState, text: string, when: string): void => {
      for (const secret of secretsOf(game)) expect(text.includes(secret), `${secret} ${when}`).toBe(false);
    };
    expect(secretsOf(state).length).toBeGreaterThan(15);
    expectClean(state, JSON.stringify(buildPlayerView(state, 'p1')), 'in the first view');

    // p1 plays on for eight turns and probes with the secret ids, while
    // p2's city turns its hoard into new scouts, one per turn, out of sight.
    const warrior = unitOf(state, 'p1', 'warrior');
    for (let turn = 0; turn < 8; turn++) {
      const attempts: [PlayerId, Action][] = [
        ['p1', { type: 'moveUnit', unitId: 'u2_CANARYUNIT0', path: [at(map, 11, 5)] }],
        ['p1', { type: 'foundCity', unitId: 'u2_CANARYUNIT2' }],
        ['p1', { type: 'setProduction', cityId: 'c2_CANARYCITYID', item: { kind: 'unit', unitType: 'warrior' } }],
        ['p1', { type: 'setProduction', cityId: scene.rome.id, item: { kind: 'unit', unitType: turn % 2 === 0 ? 'warrior' : 'scout' } }],
        ['p1', { type: 'moveUnit', unitId: warrior.id, path: [turn % 2 === 0 ? at(map, 2, 5) : at(map, 3, 5)] }],
        ['p1', { type: 'endTurn' }],
        ['p2', { type: 'endTurn' }],
      ];
      for (const [playerId, action] of attempts) {
        const result = send(state, playerId, action);
        const when = `after ${action.type} of ${playerId} in turn ${state.turn}`;
        if (result.ok) state = result.state;
        // What p1 is sent: the answer to its own action, its events, its view.
        if (playerId === 'p1' && !result.ok) expectClean(state, JSON.stringify(result.error), `in the refusal ${when}`);
        if (result.ok) expectClean(state, JSON.stringify(filterEvents(result.events, 'p1')), `in p1's events ${when}`);
        expectClean(state, JSON.stringify(buildPlayerView(state, 'p1')), `in p1's view ${when}`);
      }
    }
    expect(state.turn).toBe(scene.state.turn + 8);

    // The secrets were real all along: p2 has built scouts in hiding...
    expect(Object.values(state.units).filter((unit) => unit.owner === 'p2').length).toBeGreaterThan(8);
    // ...and p2 is shown the ones that are p2's to see: its city, its units, its numbers.
    const theirs = JSON.stringify(buildPlayerView(state, 'p2'));
    for (const secret of ['CANARYCITYNAME', 'c2_CANARYCITYID', 'u2_CANARYUNIT0', String(state.cities.c2_CANARYCITYID.productionStored)]) {
      expect(theirs).toContain(secret);
    }
    // But the seed and the random streams go to nobody.
    for (const secret of ['CANARYSEED', ...state.rng.map(String), ...state.players.flatMap((player) => player.idRng.map(String))]) {
      expect(theirs.includes(secret), secret).toBe(false);
    }
  });

  it('patch round trip during random play: applyViewPatch(a, diffViews(a, b)) deep-equals b', LONG_TEST, () => {
    let patches = 0;
    let silences = 0;
    playRandomGame({
      start: newGame(WILDS, WILDS_STARTS, 'patches'),
      seed: 'patch-actions',
      turns: 25,
      wildShare: 20,
      onStep: (step) => {
        if (!step.result.ok || !step.result.changed) return;
        for (const player of step.after.players) {
          const before = deepFreeze(buildPlayerView(step.before, player.id));
          const after = deepFreeze(buildPlayerView(step.after, player.id));
          const patch = diffViews(before, after);
          if (patch === null) {
            // Nothing to send: then the two views really are the same.
            expect(jsonEqual(before, after)).toBe(true);
            silences += 1;
          } else {
            expect(applyViewPatch(before, patch)).toEqual(after);
            // The patch survives the wire (it is sent as JSON text).
            expect(applyViewPatch(before, JSON.parse(JSON.stringify(patch)))).toEqual(after);
            patches += 1;
          }
        }
      },
    });
    expect(patches).toBeGreaterThan(1000);
    // Most actions happen out of the other players' sight: they are sent nothing at all.
    expect(silences).toBeGreaterThan(1000);
  });
});
