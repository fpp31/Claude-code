import { describe, expect, it } from 'vitest';
import {
  IMPROVEMENTS,
  RULES,
  applyViewPatch,
  buildPlayerView,
  diffViews,
  filterEvents,
  jsonEqual,
  tileMoveCost,
} from '../src/index';
import type { Action, GameState, PlayerId, PlayerView, TileIndex } from '../src/index';
import { arrange, at, deepFreeze, improve, newGame, placeUnit, queueOf, send, tamper, unitOf } from './rulesKit';
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
      for (const tile of neverSeen) {
        draft.map.tiles[tile] = { terrain: 'ocean', feature: null, improvement: null, cityId: draft.map.tiles[tile].cityId };
      }
    });
    expectSameView(allChanged, baseline, 'every never-seen tile is ocean');

    // The same change on a tile the player has seen (even one that is only remembered) shows up.
    const foggedTile = baseline.tiles.findIndex((tile) => tile !== null && !tile.visible);
    expect(foggedTile).toBeGreaterThanOrEqual(0);
    expectChangedView(tamper(state, (draft) => { draft.map.tiles[foggedTile].terrain = 'desert'; }), baseline, 'terrain of a seen tile');
  });

  it('non-interference: changing a foreign city\'s build queue or stored production does not change the view', () => {
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
        draft.cities[thebesId].buildQueue = queueOf('settler', 'worker', 'worker');
        draft.cities[thebesId].productionStored = 888456;
      });
      expectSameView(changed, baseline, what);
      expect(JSON.stringify(buildPlayerView(changed, 'p1'))).not.toContain('777123');
      expect(JSON.stringify(buildPlayerView(changed, 'p1'))).not.toContain('888456');
      // The owner does see those numbers, and the queue.
      expect(JSON.stringify(buildPlayerView(changed, 'p2'))).toContain('888456');
      expect(buildPlayerView(changed, 'p2').cities.find((city) => city.id === thebesId)?.own?.buildQueue).toHaveLength(3);

      // Not the items, not the length, not even whether there is a queue:
      // every queue from empty to full gives p1 the same view.
      for (let length = 0; length <= RULES.maxQueueLength; length++) {
        const queued = tamper(state, (draft) => {
          draft.cities[thebesId].buildQueue = Array.from({ length }, (_, index) => queueOf(index % 2 === 0 ? 'scout' : 'settler')[0]);
          draft.cities[thebesId].productionStored = 1000 * length;
        });
        expectSameView(queued, baseline, `${what}, a queue of ${length}`);
      }
      // A queue that waits (a paid-for Settler in a city of one) is as private as any.
      const held = tamper(state, (draft) => {
        draft.cities[thebesId].buildQueue = queueOf('settler');
        draft.cities[thebesId].productionStored = 30;
      });
      expect(buildPlayerView(held, 'p2').cities.find((city) => city.id === thebesId)?.own?.held).toBe('needsPopulation');
      expectSameView(held, baseline, `${what}, a held queue`);
    }

    // Population is public while the city is in sight: there the view follows the truth.
    const grown = tamper(near, (draft) => {
      draft.cities[inSightScene.thebes.id].population = 5;
    });
    expectChangedView(grown, buildPlayerView(near, 'p1'), 'population of a city in sight');
    // And the viewer's own queue is in the viewer's own view.
    const ownQueue = tamper(near, (draft) => {
      draft.cities[inSightScene.rome.id].buildQueue = queueOf('scout');
    });
    expectChangedView(ownQueue, buildPlayerView(near, 'p1'), 'the queue of an own city');
  });

  it('non-interference: changing improvements on fogged and never-seen tiles does not change the view', () => {
    const { state } = fogScene();
    const map = state.map;
    const baseline = buildPlayerView(state, 'p1');
    const fogged = baseline.tiles.map((tile, index) => (tile !== null && !tile.visible ? index : -1)).filter((index) => index >= 0);
    const neverSeen = baseline.tiles.map((tile, index) => (tile === null ? index : -1)).filter((index) => index >= 0);
    const openGround = (tile: TileIndex): boolean => tileMoveCost(map.tiles[tile]) !== null && map.tiles[tile].feature === null;
    expect(fogged.filter(openGround).length).toBeGreaterThan(10);
    expect(neverSeen.filter(openGround).length).toBeGreaterThan(20);
    // Nothing is built anywhere yet, as far as p1 knows.
    expect(baseline.tiles.every((tile) => tile === null || tile.improvement === null)).toBe(true);

    // A farm on each such tile, one at a time; then farms on all of them; then mines (on new hills) on the never-seen ones.
    for (const tile of [...fogged, ...neverSeen].filter(openGround)) {
      expectSameView(tamper(state, (draft) => improve(draft, tile, 'farm')), baseline, `a farm on hidden tile ${tile}`);
    }
    expectSameView(tamper(state, (draft) => {
      for (const tile of [...fogged, ...neverSeen].filter(openGround)) improve(draft, tile, 'farm');
    }), baseline, 'farms on every hidden tile');
    expectSameView(tamper(state, (draft) => {
      for (const tile of neverSeen.filter(openGround)) {
        draft.map.tiles[tile].feature = 'hills';
        improve(draft, tile, 'mine');
      }
    }), baseline, 'mined hills on every never-seen tile');

    // A farm p1 HAS seen stays on p1's map when it is torn down out of sight,
    // and a farm p1 saw being replaced out of sight still shows as it was.
    const seenFarm = fogged.filter(openGround)[0];
    const withMemory = tamper(state, (draft) => {
      improve(draft, seenFarm, 'farm');
      const memory = draft.players[0].knowledge.remembered;
      memory[seenFarm] = { owner: memory[seenFarm]?.owner ?? null, city: null, improvement: 'farm' };
    });
    const remembering = buildPlayerView(withMemory, 'p1');
    expect(remembering.tiles[seenFarm]).toMatchObject({ improvement: 'farm', visible: false });
    expectSameView(tamper(withMemory, (draft) => improve(draft, seenFarm, null)), remembering, 'a remembered farm removed out of sight');

    // The same on a tile in sight is noticed.
    const inSightTile = at(map, 8, 4);
    expect(baseline.tiles[inSightTile]).toMatchObject({ visible: true, improvement: null });
    expectChangedView(tamper(state, (draft) => improve(draft, inSightTile, 'farm')), baseline, 'a farm on a tile in sight');
  });

  it('non-interference: giving a foreign Worker a job, in sight or hidden, or changing its turnsWorked, does not change the view', () => {
    const scene = borderScene();
    const map = scene.state.map;
    // Two Workers of p2 on Theban land: one on the western edge, in sight of
    // p1's scout, one east of Thebes, where p1 has never looked.
    const inSightTile = at(map, 10, 5);
    const hiddenTile = at(map, 14, 5);
    let seenWorkerId = '';
    let hiddenWorkerId = '';
    const state = arrange(scene.state, (draft) => {
      seenWorkerId = placeUnit(draft, 'p2', 'worker', inSightTile).id;
      hiddenWorkerId = placeUnit(draft, 'p2', 'worker', hiddenTile).id;
    });
    const baseline = buildPlayerView(state, 'p1');
    expect(inSight(state, 'p1')[inSightTile]).toBe(true);
    expect(baseline.tiles[hiddenTile]).toBeNull();
    expect(baseline.units.find((unit) => unit.id === seenWorkerId)).toEqual({
      id: seenWorkerId, type: 'worker', owner: 'p2', tile: inSightTile, own: null,
    });
    expect(baseline.units.some((unit) => unit.id === hiddenWorkerId)).toBe(false);

    for (const [what, workerId] of [['the Worker in sight', seenWorkerId], ['the hidden Worker', hiddenWorkerId]] as const) {
      // Through the real action...
      const started = send(state, 'p2', { type: 'startJob', unitId: workerId, improvement: 'farm' });
      expect(started.ok && started.changed, what).toBe(true);
      if (!started.ok) continue;
      expectSameView(started.state, baseline, `${what} starts a farm`);
      expect(filterEvents(started.events, 'p1')).toEqual([]);
      expect(diffViews(baseline, buildPlayerView(started.state, 'p1'))).toBeNull(); // nothing at all is sent to p1
      // ...and by hand, every count of turns the job can have, and then some.
      for (const turnsWorked of [0, 1, IMPROVEMENTS.farm.turns - 1, IMPROVEMENTS.farm.turns, 40]) {
        expectSameView(tamper(state, (draft) => {
          draft.units[workerId].job = { improvement: 'farm', turnsWorked };
        }), baseline, `${what} has worked ${turnsWorked} turns`);
      }
      // Stopping is as private as starting.
      const stopped = send(started.state, 'p2', { type: 'stopJob', unitId: workerId });
      expect(stopped.ok && stopped.changed, what).toBe(true);
      if (stopped.ok) expectSameView(stopped.state, baseline, `${what} stops again`);
      // The owner does see the job.
      expect(buildPlayerView(started.state, 'p2').units.find((unit) => unit.id === workerId)?.own?.job).toEqual({
        improvement: 'farm', turnsWorked: 0, turnsTotal: IMPROVEMENTS.farm.turns, turnsLeft: IMPROVEMENTS.farm.turns,
      });
    }

    // What IS public about a foreign Worker in sight does show: where it stands.
    expectChangedView(tamper(state, (draft) => { draft.units[seenWorkerId].tile = at(map, 9, 5); }), baseline, 'a foreign Worker in sight moves');
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
      draft.cities.c2_secret = {
        id: 'c2_secret', owner: 'p2', name: 'Secret', tile: foggedFreeTile, population: 3, foodStored: 0, buildQueue: [], productionStored: 0,
      };
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
      draft.players[1].knowledge.remembered = { 5: { owner: 'p1', city: null, improvement: 'farm' } };
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
    let improvementsInSight = 0;
    let improvementsRemembered = 0;
    let ownJobsSeen = 0;
    let foreignWorkersSeen = 0;

    const checkAllViews = (state: GameState, when: string): void => {
      for (const player of state.players) {
        const view = buildPlayerView(state, player.id);
        expect(viewProblems(oracle, state, player.id, view), `${when}, view of ${player.id}`).toEqual([]);
        viewsChecked += 1;
        foreignUnitsSeen += view.units.filter((unit) => unit.owner !== player.id).length;
        rememberedCitiesSeen += view.cities.filter((city) => !city.visible).length;
        foggedTilesSeen += view.tiles.filter((tile) => tile !== null && !tile.visible).length;
        improvementsInSight += view.tiles.filter((tile) => tile !== null && tile.visible && tile.improvement !== null).length;
        improvementsRemembered += view.tiles.filter((tile) => tile !== null && !tile.visible && tile.improvement !== null).length;
        ownJobsSeen += view.units.filter((unit) => unit.own !== null && unit.own.job !== null).length;
        foreignWorkersSeen += view.units.filter((unit) => unit.owner !== player.id && unit.type === 'worker').length;
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
    // Workers were built and put to work, and what they built was seen, in sight and as a memory.
    expect(ownJobsSeen).toBeGreaterThan(50);
    expect(improvementsInSight).toBeGreaterThan(50);
    expect(improvementsRemembered).toBeGreaterThan(20);
    expect(foreignWorkersSeen).toBeGreaterThan(20);
  });

  it('allow-list: every object of a view has exactly the documented keys, and foreign units and cities have own === null', LONG_TEST, () => {
    const keys = (value: object): string[] => Object.keys(value).sort();
    let foreignUnits = 0;
    let foreignCities = 0;
    let ownCities = 0;
    let improvedTiles = 0;
    let jobs = 0;
    let jobOptions = 0;
    let queueRows = 0;

    const checkView = (state: GameState, playerId: PlayerId): void => {
      const view = buildPlayerView(state, playerId);
      expect(keys(view)).toEqual(['cities', 'height', 'players', 'tiles', 'turn', 'units', 'width', 'you']);
      for (const tile of view.tiles) {
        if (tile === null) continue;
        expect(keys(tile)).toEqual(['feature', 'improvement', 'owner', 'terrain', 'visible']);
        if (tile.improvement !== null) improvedTiles += 1;
      }
      for (const player of view.players) expect(keys(player)).toEqual(['civ', 'endedTurn', 'id', 'name']);

      for (const unit of view.units) {
        expect(keys(unit)).toEqual(['id', 'own', 'owner', 'tile', 'type']);
        if (unit.owner === playerId) {
          const own = unit.own as NonNullable<typeof unit.own>;
          expect(keys(own)).toEqual(['foundCityError', 'job', 'jobOptions', 'movesLeft']);
          if (own.job !== null) {
            expect(keys(own.job)).toEqual(['improvement', 'turnsLeft', 'turnsTotal', 'turnsWorked']);
            jobs += 1;
          }
          for (const option of own.jobOptions) {
            expect(keys(option)).toEqual(['error', 'improvement', 'turns']);
            jobOptions += 1;
          }
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
            'buildOptions', 'buildQueue', 'foodPerTurn', 'foodStored', 'foodToGrow', 'held',
            'productionPerTurn', 'productionStored', 'worked',
          ]);
          for (const row of own.buildQueue) {
            expect(keys(row)).toEqual(['cost', 'item', 'turns', 'wait']);
            expect(keys(row.item)).toEqual(['kind', 'unitType']);
            queueRows += 1;
          }
          for (const option of own.buildOptions) {
            expect(keys(option)).toEqual(['addError', 'cost', 'item', 'turns', 'wait']);
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
    // The new objects were there to be looked at.
    expect(queueRows).toBeGreaterThan(100);
    expect(jobOptions).toBeGreaterThan(20);
    expect(jobs).toBeGreaterThan(5);
    expect(improvedTiles).toBeGreaterThan(5);
  });

  it('canary: unique marker strings placed in hidden cities, hidden unit ids and the seed never appear in JSON.stringify(view) or in filtered events', () => {
    const scene = borderScene();
    const map = scene.state.map;
    const oldThebesId = scene.thebes.id;

    // Everything p1 has never seen gets a marker: the seed, both streams of
    // random numbers, p2's city (id, name, private numbers) and p2's units
    // (ids). p1's scout is moved back west, so that all of Thebes' land is
    // out of its sight; p1 has never seen the city itself.
    //
    // Two more secrets have no number to carry a marker, so their marker is
    // the word itself: a farm on Theban land p1 has never seen, and a hidden
    // Worker of p2 who is building a second one (and finishes it while the
    // test runs). p1 has no Worker and sees no improvement, so the words
    // "farm" and "mine", and the fields of a job, have no honest reason to
    // be in anything p1 is sent.
    const hiddenFarm = at(map, 13, 5);
    const hiddenSite = at(map, 14, 5);
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
        // A full queue of scouts: the city turns its hoard into one of them every turn of this test.
        buildQueue: Array.from({ length: RULES.maxQueueLength }, () => queueOf('scout')[0]),
      });
      draft.cities[thebes.id] = thebes;
      for (const tile of draft.map.tiles) if (tile.cityId === oldThebesId) tile.cityId = thebes.id;

      improve(draft, hiddenFarm, 'farm');
      const theirUnits = Object.values(draft.units).filter((unit) => unit.owner === 'p2');
      theirUnits.push(placeUnit(draft, 'p2', 'settler', at(map, 13, 8)));
      const hiddenWorker = placeUnit(draft, 'p2', 'worker', hiddenSite);
      hiddenWorker.job = { improvement: 'farm', turnsWorked: 1 };
      theirUnits.push(hiddenWorker);
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
    /** The words that would give away the hidden farm, the hidden job or its completion. */
    const jobWords = ['"farm"', '"mine"', 'turnsWorked', 'turnsLeft', 'improvementBuilt'];
    const expectClean = (game: GameState, text: string, when: string): void => {
      for (const secret of [...secretsOf(game), ...jobWords]) expect(text.includes(secret), `${secret} ${when}`).toBe(false);
    };
    expect(secretsOf(state).length).toBeGreaterThan(15);
    expect(state.map.tiles[hiddenFarm]).toMatchObject({ improvement: 'farm', cityId: 'c2_CANARYCITYID' });
    expect(state.units.u2_CANARYUNIT1.type).toBe('settler');
    expect(state.units.u2_CANARYUNIT2).toMatchObject({ type: 'worker', tile: hiddenSite, job: { improvement: 'farm', turnsWorked: 1 } });
    expect(buildPlayerView(state, 'p1').tiles[hiddenFarm]).toBeNull();
    expect(buildPlayerView(state, 'p1').tiles[hiddenSite]).toBeNull();
    expectClean(state, JSON.stringify(buildPlayerView(state, 'p1')), 'in the first view');
    let improvementsFinished = 0;

    // p1 plays on for eight turns and probes with the secret ids, while
    // p2's city turns its hoard into new scouts, one per turn, out of sight.
    const warrior = unitOf(state, 'p1', 'warrior');
    for (let turn = 0; turn < 8; turn++) {
      const attempts: [PlayerId, Action][] = [
        ['p1', { type: 'moveUnit', unitId: 'u2_CANARYUNIT0', path: [at(map, 11, 5)] }],
        ['p1', { type: 'foundCity', unitId: 'u2_CANARYUNIT1' }],
        ['p1', { type: 'foundCity', unitId: 'u2_CANARYUNIT9' }],
        ['p1', { type: 'setBuildQueue', cityId: 'c2_CANARYCITYID', queue: queueOf('warrior') }],
        ['p1', { type: 'setBuildQueue', cityId: 'c2_CANARYCITYID', queue: [] }],
        ['p1', { type: 'setBuildQueue', cityId: scene.rome.id, queue: queueOf(turn % 2 === 0 ? 'warrior' : 'scout') }],
        ['p1', { type: 'startJob', unitId: 'u2_CANARYUNIT2', improvement: 'farm' }],
        ['p1', { type: 'stopJob', unitId: 'u2_CANARYUNIT2' }],
        ['p1', { type: 'moveUnit', unitId: 'u2_CANARYUNIT2', path: [at(map, 13, 5)] }],
        ['p1', { type: 'moveUnit', unitId: warrior.id, path: [turn % 2 === 0 ? at(map, 2, 5) : at(map, 3, 5)] }],
        ['p1', { type: 'endTurn' }],
        ['p2', { type: 'endTurn' }],
      ];
      for (const [playerId, action] of attempts) {
        const result = send(state, playerId, action);
        const when = `after ${action.type} of ${playerId} in turn ${state.turn}`;
        if (result.ok) state = result.state;
        if (result.ok) improvementsFinished += result.events.filter((addressed) => addressed.event.type === 'improvementBuilt').length;
        // What p1 is sent: the answer to its own action, its events, its view.
        if (playerId === 'p1' && !result.ok) expectClean(state, JSON.stringify(result.error), `in the refusal ${when}`);
        if (result.ok) expectClean(state, JSON.stringify(filterEvents(result.events, 'p1')), `in p1's events ${when}`);
        expectClean(state, JSON.stringify(buildPlayerView(state, 'p1')), `in p1's view ${when}`);
      }
    }
    expect(state.turn).toBe(scene.state.turn + 8);

    // The secrets were real all along: p2 has built scouts in hiding...
    expect(Object.values(state.units).filter((unit) => unit.owner === 'p2').length).toBeGreaterThan(8);
    // ...and its Worker has finished the second farm, which p2 was told and p1 was not.
    expect(improvementsFinished).toBe(1);
    expect(state.map.tiles[hiddenSite].improvement).toBe('farm');
    expect(state.units.u2_CANARYUNIT2).toMatchObject({ type: 'worker', job: null });
    expect(buildPlayerView(state, 'p2').tiles[hiddenSite]).toMatchObject({ improvement: 'farm', visible: true });
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
