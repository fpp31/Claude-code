import { describe, expect, it } from 'vitest';
import {
  IMPROVEMENTS,
  IMPROVEMENT_IDS,
  RULES,
  UNITS,
  UNIT_TYPE_IDS,
  buildCost,
  buildPlan,
  buildPlayerView,
  cityEconomy,
  cloneJson,
  computeVisible,
  diffViews,
  distance,
  filterEvents,
  foodToGrow,
  siteInView,
  siteOfTile,
  startJobError,
  updateKnowledge,
} from '../src/index';
import type { AddressedEvent, GameState, ImprovementId, TileIndex } from '../src/index';
import {
  EAST,
  WEST,
  act,
  actWithEvents,
  arrange,
  at,
  codeOf,
  deepFreeze,
  endTurnForAll,
  improve,
  newGame,
  placeUnit,
  queueOf,
  send,
  stepFrom,
  tamper,
  unitOf,
  unitsOf,
  workerOn,
} from './rulesKit';
import { LONG_TEST, WILDS, WILDS_STARTS, playRandomGame } from './rulesRandomPlay';
import { borderScene, meadowGame, scoutSteps } from './visibilityScenes';

/**
 * Tests for fog of war and the per-player view
 * (packages/shared/src/view/visibility.ts and playerView.ts), part 1: what
 * a player sees, remembers and is shown.
 *
 * The tests that prove a view never contains hidden information are in
 * visibilityNoLeak.test.ts (non-interference and the oracle) and
 * visibilityTwinWorlds.test.ts (twin worlds, error codes, half-finished
 * moves). Helpers: visibilityScenes.ts, visibilityOracle.ts, rulesKit.ts.
 */

/** The tiles for which `flags` is true. */
function tilesWhere(flags: boolean[]): TileIndex[] {
  return flags.map((flag, tile) => (flag ? tile : -1)).filter((tile) => tile >= 0);
}

describe('computeVisible and updateKnowledge (WP2)', () => {
  it('sees tiles within each own unit\'s sight radius (plain distance)', () => {
    const start = meadowGame();
    const map = start.map;
    // A warrior at (3,5) and a scout at (10,2); the settler is taken away.
    const warrior = unitOf(start, 'p1', 'warrior');
    const scoutTile = at(map, 10, 2);
    const state = arrange(start, (draft) => {
      delete draft.units[unitOf(start, 'p1', 'settler').id];
      placeUnit(draft, 'p1', 'scout', scoutTile);
      // Nothing blocks sight: mountains and forest right in front of the warrior hide nothing.
      draft.map.tiles[stepFrom(map, warrior.tile, EAST)].feature = 'mountains';
      draft.map.tiles[stepFrom(map, warrior.tile, WEST)].feature = 'forest';
    });

    const expected = map.tiles.map(
      (_, tile) =>
        distance(tile, warrior.tile, map) <= UNITS.warrior.sight || distance(tile, scoutTile, map) <= UNITS.scout.sight,
    );
    expect(computeVisible(state, 'p1')).toEqual(expected);
    // Water is seen like land: the ocean north of the scout is in sight.
    expect(state.map.tiles[at(map, 10, 0)].terrain).toBe('ocean');
    expect(computeVisible(state, 'p1')[at(map, 10, 0)]).toBe(true);
    // The other player, far away, sees none of this.
    expect(computeVisible(state, 'p2')[warrior.tile]).toBe(false);
  });

  it('sees every tile owned by own cities plus RULES.territorySightMargin rings', () => {
    const { state, rome } = borderScene();
    const map = state.map;
    // Send p1's units to the far south-east, so only the city's land gives sight around Rome.
    const farCorner = at(map, 14, 9);
    const cityOnly = arrange(state, (draft) => {
      for (const unit of unitsOf(draft, 'p1')) delete draft.units[unit.id];
      placeUnit(draft, 'p1', 'warrior', farCorner);
    });

    const ownLand = map.tiles.map((_, tile) => tile).filter((tile) => cityOnly.map.tiles[tile].cityId === rome.id);
    expect(ownLand.length).toBeGreaterThan(7);
    const expected = map.tiles.map(
      (_, tile) =>
        ownLand.some((owned) => distance(tile, owned, map) <= RULES.territorySightMargin) ||
        distance(tile, farCorner, map) <= UNITS.warrior.sight,
    );
    expect(computeVisible(cityOnly, 'p1')).toEqual(expected);

    // Land of any shape counts, not just a circle around the city: one more
    // tile far to the east gives sight of itself and its ring.
    const outpost = at(map, 8, 8);
    const stretched = arrange(cityOnly, (draft) => {
      draft.map.tiles[outpost].cityId = rome.id;
    });
    const gained = tilesWhere(computeVisible(stretched, 'p1')).filter((tile) => !expected[tile]);
    expect(gained).toEqual(map.tiles.map((_, tile) => tile).filter((tile) => distance(tile, outpost, map) <= RULES.territorySightMargin && !expected[tile]));
    expect(gained).toContain(outpost);
  });

  it('sees nothing else', () => {
    const { state } = borderScene();
    const map = state.map;

    // Other players' units and cities give no sight: p1 sees nothing around Thebes but what its own scout sees.
    const thebesTile = at(map, 12, 5);
    expect(computeVisible(state, 'p1')[thebesTile]).toBe(false);
    expect(computeVisible(state, 'p2')[thebesTile]).toBe(true);
    expect(computeVisible(state, 'p2')[at(map, 3, 5)]).toBe(false);

    // Somebody with no units and no cities sees nothing at all.
    const start = meadowGame();
    const nothingLeft = tamper(start, (draft) => {
      for (const unit of unitsOf(draft, 'p1')) delete draft.units[unit.id];
    });
    expect(computeVisible(nothingLeft, 'p1').every((flag) => flag === false)).toBe(true);
    expect(computeVisible(nothingLeft, 'p1')).toHaveLength(map.tiles.length);

    // It is derived every time and changes nothing.
    const frozen = deepFreeze(tamper(state, () => undefined));
    expect(computeVisible(frozen, 'p1')).toEqual(computeVisible(state, 'p1'));
    // Somebody who is not in the game has no sight to compute.
    expect(() => computeVisible(state, 'p3')).toThrow();
  });

  it('marks visible tiles explored and never un-explores a tile', () => {
    const { state, scoutId } = borderScene();
    const explored = (game: GameState): number[] => game.players[0].knowledge.explored;

    // Right now: everything in sight is explored.
    computeVisible(state, 'p1').forEach((inSight, tile) => {
      if (inSight) expect(explored(state)[tile]).toBe(1);
    });

    // The scout walks three tiles west. What it leaves behind stays explored
    // although it is no longer in sight, and every step only adds tiles.
    let current = state;
    for (let i = 0; i < 3; i++) {
      const next = scoutSteps(current, scoutId, WEST, 1);
      explored(current).forEach((flag, tile) => {
        if (flag === 1) expect(explored(next)[tile]).toBe(1);
      });
      current = next;
    }
    const leftBehind = at(state.map, 11, 5);
    expect(computeVisible(state, 'p1')[leftBehind]).toBe(true);
    expect(computeVisible(current, 'p1')[leftBehind]).toBe(false);
    expect(explored(current)[leftBehind]).toBe(1);
    // Entries are 0 or 1, one per tile.
    expect(explored(current)).toHaveLength(state.map.tiles.length);
    expect(explored(current).every((flag) => flag === 0 || flag === 1)).toBe(true);
    expect(explored(current)).toContain(0);
  });

  it('remembers { owner, city, improvement } and forgets the tile when all three are empty', () => {
    const { state, rome, thebes, scoutId } = borderScene();
    const map = state.map;
    // One step east and Thebes itself is in the scout's sight.
    const near = scoutSteps(state, scoutId, EAST, 1);
    const memory = near.players[0].knowledge.remembered;

    // The city: exactly the five public facts.
    expect(memory[thebes.tile]).toEqual({
      owner: 'p2',
      city: { id: thebes.id, owner: 'p2', name: thebes.name, tile: thebes.tile, population: thebes.population },
      improvement: null,
    });
    // Its land: the owner, no city, nothing built.
    const thebanField = at(map, 11, 5);
    expect(memory[thebanField]).toEqual({ owner: 'p2', city: null, improvement: null });
    // The player's own land is remembered in the same way.
    expect(memory[rome.tile]).toEqual({
      owner: 'p1',
      city: { id: rome.id, owner: 'p1', name: rome.name, tile: rome.tile, population: 1 },
      improvement: null,
    });
    // Tiles in sight that nobody owns have no entry at all.
    const noMansLand = at(map, 8, 5);
    expect(near.map.tiles[noMansLand].cityId).toBeNull();
    expect(computeVisible(near, 'p1')[noMansLand]).toBe(true);
    expect(noMansLand in memory).toBe(false);

    // While it is in sight, the memory follows the truth: the city grows...
    const grown = arrange(near, (draft) => {
      draft.cities[thebes.id].population = 4;
    });
    expect(grown.players[0].knowledge.remembered[thebes.tile].city?.population).toBe(4);

    // ...and if city and land disappear before the player's eyes, so does the memory.
    const gone = tamper(near, (draft) => {
      delete draft.cities[thebes.id];
      for (const tile of draft.map.tiles) if (tile.cityId === thebes.id) tile.cityId = null;
    });
    updateKnowledge(gone);
    const after = gone.players[0].knowledge.remembered;
    expect(thebes.tile in after).toBe(false);
    expect(thebanField in after).toBe(false);
    expect(after[rome.tile]).toEqual(memory[rome.tile]);
    // Units are never remembered: the memory has only owners, cities and improvements in it.
    for (const entry of Object.values(memory)) expect(Object.keys(entry).sort()).toEqual(['city', 'improvement', 'owner']);

    // An improvement is the third thing worth remembering. A farm on Theban
    // land in sight is remembered with its owner...
    const farmed = arrange(near, (draft) => improve(draft, thebanField, 'farm'));
    expect(farmed.players[0].knowledge.remembered[thebanField]).toEqual({ owner: 'p2', city: null, improvement: 'farm' });
    // ...a farm on land nobody owns is reason enough for an entry of its own
    // (the rules never build one there; a later rule might leave one behind)...
    const strayFarm = tamper(near, (draft) => improve(draft, noMansLand, 'farm'));
    updateKnowledge(strayFarm);
    expect(strayFarm.players[0].knowledge.remembered[noMansLand]).toEqual({ owner: null, city: null, improvement: 'farm' });
    // ...and when the farm is gone again before the player's eyes, with no
    // owner and no city left on the tile, the entry goes too.
    const cleared = tamper(strayFarm, (draft) => improve(draft, noMansLand, null));
    updateKnowledge(cleared);
    expect(noMansLand in cleared.players[0].knowledge.remembered).toBe(false);
    // A tile that keeps its owner keeps its entry, now without the improvement.
    const ploughedUnder = arrange(farmed, (draft) => improve(draft, thebanField, null));
    expect(ploughedUnder.players[0].knowledge.remembered[thebanField]).toEqual({ owner: 'p2', city: null, improvement: null });
  });

  it('a newly founded city is remembered at once by everybody who sees it', () => {
    const start = meadowGame();
    const map = start.map;
    const site = at(map, 3, 5); // p1's settler stands here
    // A scout of p2 watches from three tiles away, the edge of its sight.
    let watcherId = '';
    const watched = arrange(start, (draft) => {
      watcherId = placeUnit(draft, 'p2', 'scout', at(map, 6, 5)).id;
    });
    expect(watched.players[1].knowledge.remembered).toEqual({});

    // The state that comes straight out of the action already holds the
    // memory, for the founder and for the onlooker.
    const founded = act(watched, 'p1', { type: 'foundCity', unitId: unitOf(watched, 'p1', 'settler').id });
    const rome = Object.values(founded.cities)[0];
    const facts = { id: rome.id, owner: 'p1', name: rome.name, tile: site, population: 1 };
    expect(founded.players[0].knowledge.remembered[site]).toEqual({ owner: 'p1', city: facts, improvement: null });
    expect(founded.players[1].knowledge.remembered[site]).toEqual({ owner: 'p1', city: facts, improvement: null });
    expect(founded.players[1].knowledge.remembered[at(map, 5, 5)]).toEqual({ owner: 'p1', city: null, improvement: null });

    // So when the scout turns away in its very next step, p2 keeps the city on the map as a memory.
    const left = act(founded, 'p2', { type: 'moveUnit', unitId: watcherId, path: [at(map, 7, 5)] });
    expect(computeVisible(left, 'p2')[site]).toBe(false);
    expect(buildPlayerView(left, 'p2').cities).toEqual([{ ...facts, visible: false, own: null }]);
    expect(buildPlayerView(left, 'p2').tiles[site]).toMatchObject({ owner: 'p1', visible: false });
  });

  it('leaves the memory of tiles that are out of sight untouched', () => {
    const { state, thebes, scoutId } = borderScene();
    // The scout looks at Thebes and walks away again, far enough to lose sight of all Egyptian land.
    const near = scoutSteps(state, scoutId, EAST, 1);
    const away = scoutSteps(endTurnForAll(near).state, scoutId, WEST, 3);
    const fogged = at(state.map, 10, 5);
    expect(computeVisible(away, 'p1')[thebes.tile]).toBe(false);
    expect(computeVisible(away, 'p1')[fogged]).toBe(false);
    const before = cloneJson(away.players[0].knowledge);
    expect(before.remembered[thebes.tile].city?.population).toBe(1);
    expect(before.remembered[fogged]).toEqual({ owner: 'p2', city: null, improvement: null });

    // Out of sight, everything changes: the city grows and is renamed, a
    // field is given up, another one gets a farm.
    const farmedField = at(state.map, 11, 5);
    expect(computeVisible(away, 'p1')[farmedField]).toBe(false);
    const changed = tamper(away, (draft) => {
      draft.cities[thebes.id].population = 9;
      draft.cities[thebes.id].name = 'Somewhere Else';
      draft.map.tiles[fogged].cityId = null;
      improve(draft, farmedField, 'farm');
    });
    updateKnowledge(changed);
    expect(changed.players[0].knowledge).toEqual(before);
    // The owner of those tiles, who does see them, is brought up to date.
    expect(changed.players[1].knowledge.remembered[thebes.tile].city?.population).toBe(9);
    expect(fogged in changed.players[1].knowledge.remembered).toBe(false);
    expect(changed.players[1].knowledge.remembered[farmedField].improvement).toBe('farm');

    // Running it again changes nothing.
    const again = cloneJson(changed);
    updateKnowledge(again);
    expect(again).toEqual(changed);
  });
});

describe('buildPlayerView (WP2)', () => {
  it('shows never-explored tiles as null', () => {
    const start = meadowGame();
    const map = start.map;
    const view = buildPlayerView(start, 'p1');
    const farthestSight = Math.max(...RULES.startingUnits.map((type) => UNITS[type].sight));

    expect(view.you).toBe('p1');
    expect(view.turn).toBe(1);
    expect([view.width, view.height]).toEqual([map.width, map.height]);
    expect(view.tiles).toHaveLength(map.tiles.length);
    view.tiles.forEach((tile, index) => {
      const seen = distance(index, at(map, 3, 5), map) <= farthestSight;
      if (seen) {
        expect(tile).toEqual({
          terrain: map.tiles[index].terrain, feature: map.tiles[index].feature, improvement: null, owner: null, visible: true,
        });
      } else {
        expect(tile).toBeNull();
      }
    });
    expect(view.tiles.filter((tile) => tile === null).length).toBeGreaterThan(50);
  });

  it('shows current owner on visible tiles and last-seen owner on fogged tiles', () => {
    const { state, rome, scoutId } = borderScene();
    const map = state.map;
    const thebanField = at(map, 10, 5);
    const freeField = at(map, 9, 2); // unowned, in the scout's sight

    const near = buildPlayerView(state, 'p1');
    expect(near.tiles[thebanField]).toEqual({ terrain: 'grassland', feature: null, improvement: null, owner: 'p2', visible: true });
    expect(near.tiles[freeField]).toMatchObject({ owner: null, visible: true });
    expect(near.tiles[rome.tile]).toMatchObject({ owner: 'p1', visible: true });

    // The scout leaves. Out of its sight the field is given up and the free tile is claimed.
    const away = scoutSteps(state, scoutId, WEST, 3);
    const changed = tamper(away, (draft) => {
      draft.map.tiles[thebanField].cityId = null;
      draft.map.tiles[freeField].cityId = draft.map.tiles[at(map, 12, 5)].cityId;
    });
    updateKnowledge(changed);
    const fogged = buildPlayerView(changed, 'p1');
    // p1 is shown both tiles as they were when last seen...
    expect(fogged.tiles[thebanField]).toEqual({ terrain: 'grassland', feature: null, improvement: null, owner: 'p2', visible: false });
    expect(fogged.tiles[freeField]).toEqual({ terrain: 'grassland', feature: null, improvement: null, owner: null, visible: false });
    // ...while the owner sees them as they are.
    const theirs = buildPlayerView(changed, 'p2');
    expect(theirs.tiles[thebanField]).toMatchObject({ owner: null, visible: true });
    expect(theirs.tiles[freeField]).toMatchObject({ owner: 'p2', visible: true });

    // Back in sight, the truth replaces the memory.
    const back = arrange(changed, (draft) => {
      draft.units[scoutId].tile = at(map, 8, 5);
    });
    const seenAgain = buildPlayerView(back, 'p1');
    expect(seenAgain.tiles[thebanField]).toMatchObject({ owner: null, visible: true });
    expect(seenAgain.tiles[freeField]).toMatchObject({ owner: 'p2', visible: true });
  });

  it('lists own units with details and foreign units on visible tiles without details', () => {
    const { state, scoutId } = borderScene();
    const map = state.map;
    const warrior = unitOf(state, 'p1', 'warrior');
    // An Egyptian scout in sight of p1's scout, another one out of anybody's sight.
    let inSightId = '';
    const scene = arrange(state, (draft) => {
      inSightId = placeUnit(draft, 'p2', 'scout', at(map, 10, 5), 1).id;
      placeUnit(draft, 'p2', 'scout', at(map, 13, 9));
      draft.units[scoutId].movesLeft = 2;
    });

    const expected = [
      {
        id: warrior.id, type: 'warrior', owner: 'p1', tile: warrior.tile,
        own: { movesLeft: UNITS.warrior.moves, foundCityError: 'cannotFoundCity', job: null, jobOptions: [] },
      },
      {
        id: scoutId, type: 'scout', owner: 'p1', tile: at(map, 8, 5),
        own: { movesLeft: 2, foundCityError: 'cannotFoundCity', job: null, jobOptions: [] },
      },
      // Somebody else's unit: where it is and what it is, but not how many moves it has left.
      { id: inSightId, type: 'scout', owner: 'p2', tile: at(map, 10, 5), own: null },
    ].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(buildPlayerView(scene, 'p1').units).toEqual(expected);

    // p2 sees its own three units in full, and p1's scout (2 tiles from its land) without details.
    const theirs = buildPlayerView(scene, 'p2').units;
    expect(theirs.filter((unit) => unit.owner === 'p2').every((unit) => unit.own !== null)).toBe(true);
    expect(theirs.filter((unit) => unit.owner === 'p2')).toHaveLength(3);
    expect(theirs.filter((unit) => unit.owner === 'p1')).toEqual([{ id: scoutId, type: 'scout', owner: 'p1', tile: at(map, 8, 5), own: null }]);
  });

  it('lists own cities with OwnCityDetail whose economy, queue, menu and held come from buildPlan', () => {
    const { state, rome } = borderScene();

    // An empty queue.
    const idle = buildPlayerView(state, 'p1').cities.find((city) => city.id === rome.id);
    const economy = cityEconomy(state, rome);
    const idlePlan = buildPlan(state, rome);
    expect(idle).toEqual({
      id: rome.id,
      owner: 'p1',
      name: rome.name,
      tile: rome.tile,
      population: 1,
      visible: true,
      own: {
        foodStored: 0,
        foodToGrow: foodToGrow(1),
        foodPerTurn: economy.foodSurplus,
        buildQueue: [],
        held: null,
        productionStored: 0,
        productionPerTurn: economy.production,
        worked: economy.worked,
        buildOptions: idlePlan.options,
      },
    });
    expect(idlePlan.economy).toEqual(economy);
    expect(idle?.own?.buildOptions.map((option) => option.item.unitType)).toEqual(UNIT_TYPE_IDS);

    // A bigger city that is half-way through a warrior, with a scout behind it.
    const busy = arrange(state, (draft) => {
      Object.assign(draft.cities[rome.id], {
        population: 3,
        foodStored: 5,
        buildQueue: queueOf('warrior', 'scout'),
        productionStored: 7,
      });
    });
    const busyEconomy = cityEconomy(busy, busy.cities[rome.id]);
    const busyPlan = buildPlan(busy, busy.cities[rome.id]);
    const detail = buildPlayerView(busy, 'p1').cities.find((city) => city.id === rome.id)?.own;
    expect(detail).toEqual({
      foodStored: 5,
      foodToGrow: foodToGrow(3),
      foodPerTurn: busyEconomy.foodSurplus,
      buildQueue: busyPlan.queue,
      held: busyPlan.held,
      productionStored: 7,
      productionPerTurn: busyEconomy.production,
      worked: busyEconomy.worked,
      buildOptions: busyPlan.options,
    });
    expect(detail?.worked).toHaveLength(3);
    expect(detail?.buildQueue.map((row) => [row.item, row.cost, row.wait])).toEqual([
      [{ kind: 'unit', unitType: 'warrior' }, buildCost({ kind: 'unit', unitType: 'warrior' }), null],
      [{ kind: 'unit', unitType: 'scout' }, buildCost({ kind: 'unit', unitType: 'scout' }), null],
    ]);
    // The first row's turns is the number of turn resolutions until the warrior appears: count them by playing.
    let played = busy;
    let turns = 0;
    while (unitsOf(played, 'p1', 'warrior').length < 2 && turns < 50) {
      played = endTurnForAll(played).state;
      turns += 1;
    }
    expect(unitsOf(played, 'p1', 'warrior')).toHaveLength(2);
    expect(detail?.buildQueue[0].turns).toBe(turns);
    // The second row comes later, and the menu later still (it is forecast behind the whole queue).
    const scoutRow = detail?.buildQueue[1].turns ?? 0;
    expect(scoutRow).toBeGreaterThan(turns);
    expect(detail?.buildOptions.find((option) => option.item.unitType === 'warrior')?.turns).toBeGreaterThan(scoutRow);

    // Paid for already: one turn. A city that eats more than it grows shows a negative number.
    const paid = arrange(busy, (draft) => {
      draft.cities[rome.id].productionStored = 500;
      draft.cities[rome.id].population = 25;
    });
    const paidDetail = buildPlayerView(paid, 'p1').cities.find((city) => city.id === rome.id)?.own;
    expect(paidDetail?.buildQueue[0].turns).toBe(1);
    expect(paidDetail?.held).toBeNull();
    expect(paidDetail?.foodPerTurn).toBeLessThan(0);
  });

  it('sets held for a paid-for Settler in a population-1 city (needsPopulation) and null for a Warrior', () => {
    const { state, rome } = borderScene();
    const heldFor = (unitType: 'settler' | 'warrior', population: number, stored: number): unknown => {
      const chosen = arrange(act(state, 'p1', { type: 'setBuildQueue', cityId: rome.id, queue: queueOf(unitType) }), (draft) => {
        draft.cities[rome.id].population = population;
        draft.cities[rome.id].productionStored = stored;
      });
      return buildPlayerView(chosen, 'p1').cities.find((city) => city.id === rome.id)?.own?.held;
    };
    expect(heldFor('settler', 1, UNITS.settler.cost)).toBe('needsPopulation');
    expect(heldFor('settler', 1, UNITS.settler.cost - 1)).toBeNull(); // not paid for: nothing waits yet
    expect(heldFor('settler', 2, UNITS.settler.cost)).toBeNull();
    expect(heldFor('warrior', 1, UNITS.warrior.cost)).toBeNull();
    // An empty queue: nothing is held.
    expect(buildPlayerView(state, 'p1').cities.find((city) => city.id === rome.id)?.own?.held).toBeNull();
  });

  it('lists a foreign city as remembered (visible false, old population) after it leaves sight', () => {
    const { state, thebes, scoutId } = borderScene();
    const publicFacts = { id: thebes.id, owner: 'p2', name: thebes.name, tile: thebes.tile };

    // Not seen yet: p1's view has no trace of Thebes.
    expect(buildPlayerView(state, 'p1').cities.map((city) => city.id)).not.toContain(thebes.id);

    // In sight: the current public facts.
    const near = scoutSteps(state, scoutId, EAST, 1);
    expect(buildPlayerView(near, 'p1').cities.find((city) => city.id === thebes.id)).toEqual({
      ...publicFacts, population: 1, visible: true, own: null,
    });

    // Out of sight again, and Thebes grows meanwhile: p1 keeps seeing the old number, marked as a memory.
    const away = scoutSteps(endTurnForAll(near).state, scoutId, WEST, 3);
    const grown = arrange(away, (draft) => {
      draft.cities[thebes.id].population = 6;
    });
    expect(buildPlayerView(grown, 'p1').cities.find((city) => city.id === thebes.id)).toEqual({
      ...publicFacts, population: 1, visible: false, own: null,
    });
    expect(buildPlayerView(grown, 'p1').tiles[thebes.tile]).toMatchObject({ owner: 'p2', visible: false });

    // Coming back shows the new number.
    const back = arrange(grown, (draft) => {
      draft.units[scoutId].tile = at(draft.map, 9, 5);
    });
    expect(buildPlayerView(back, 'p1').cities.find((city) => city.id === thebes.id)).toEqual({
      ...publicFacts, population: 6, visible: true, own: null,
    });
    // Each city is listed once, whichever way it is known.
    for (const game of [near, grown, back]) {
      const ids = buildPlayerView(game, 'p1').cities.map((city) => city.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('sorts units and cities by id and players by seat', LONG_TEST, () => {
    // A played game has plenty of units and cities, created in an order that is not the order of their ids.
    const end = playRandomGame({ start: newGame(WILDS, WILDS_STARTS, 'sorting'), seed: 'sorting-actions', turns: 25, wildShare: 0 });
    expect(Object.keys(end.units).length).toBeGreaterThan(8);

    let unsortedInState = 0;
    for (const player of end.players) {
      const view = buildPlayerView(end, player.id);
      const unitIds = view.units.map((unit) => unit.id);
      const cityIds = view.cities.map((city) => city.id);
      // Plain comparison of the id strings, character by character.
      expect(unitIds).toEqual([...unitIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      expect(cityIds).toEqual([...cityIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      expect(view.players.map((entry) => entry.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
      expect(view.players).toEqual(end.players.map((entry) => ({ id: entry.id, name: entry.name, civ: entry.civ, endedTurn: entry.endedTurn })));

      const ownInCreationOrder = unitsOf(end, player.id).map((unit) => unit.id);
      if (ownInCreationOrder.join() !== [...ownInCreationOrder].sort().join()) unsortedInState += 1;
    }
    // The sorting did something: the state keeps units in creation order, which is not id order.
    expect(unsortedInState).toBeGreaterThan(0);
  });

  it('sets foundCityError to null exactly when foundCity would be accepted', () => {
    const { state } = borderScene();
    const map = state.map;
    // p1 settlers in every kind of spot.
    const spots: [string, TileIndex, number][] = [
      ['free land', at(map, 3, 9), 2],
      ['free land, one move left', at(map, 7, 9), 1],
      ['no moves left', at(map, 7, 1), 0],
      ['forest', at(map, 5, 9), 2],
      ['inside own land, next to Rome', at(map, 4, 5), 2],
      ['just outside own land', at(map, 6, 5), 2],
      ['on Egyptian land', at(map, 10, 5), 2],
      ['just outside Egyptian land', at(map, 9, 4), 2],
      ['hills', at(map, 13, 1), 2],
    ];
    const scene = arrange(state, (draft) => {
      draft.map.tiles[at(map, 5, 9)].feature = 'forest';
      draft.map.tiles[at(map, 13, 1)].feature = 'hills';
      for (const [, tile, moves] of spots) placeUnit(draft, 'p1', 'settler', tile, moves);
    });

    const view = buildPlayerView(scene, 'p1');
    const seenCodes = new Set<string | null>();
    for (const unit of view.units) {
      if (unit.own === null) continue;
      const actual = codeOf(send(scene, 'p1', { type: 'foundCity', unitId: unit.id }));
      expect(unit.own.foundCityError, `${unit.type} on tile ${unit.tile}`).toBe(actual);
      seenCodes.add(actual);
    }
    // The spots cover a city that can be founded and every reason why not.
    expect([...seenCodes].map(String).sort()).toEqual(
      ['badCityTile', 'cannotFoundCity', 'noMovesLeft', 'null', 'tileOwned', 'tooCloseToCity'],
    );
    // Units that are not settlers always carry cannotFoundCity.
    for (const unit of view.units) {
      if (unit.own !== null && !UNITS[unit.type].canFoundCity) expect(unit.own.foundCityError).toBe('cannotFoundCity');
    }
  });

  it('is plain JSON and shares no object with the state (editing the view cannot change the state)', () => {
    const { state, scoutId } = borderScene();
    const queued = act(state, 'p1', { type: 'setBuildQueue', cityId: Object.keys(state.cities)[0], queue: queueOf('scout', 'worker') });
    const worker = workerOn(queued, 'p1', at(state.map, 2, 5));
    const working = act(worker.state, 'p1', { type: 'startJob', unitId: worker.workerId, improvement: 'farm' });
    const busy = scoutSteps(working, scoutId, EAST, 1);
    const view = buildPlayerView(busy, 'p1');

    // Plain JSON: a trip through text gives the same view back.
    expect(cloneJson(view)).toEqual(view);
    expect(JSON.stringify(cloneJson(view))).toBe(JSON.stringify(view));
    expect(JSON.stringify(view)).not.toContain('undefined');

    // No object of the view is an object of the state.
    const collect = (value: unknown, into: Set<object>): Set<object> => {
      if (typeof value === 'object' && value !== null && !into.has(value)) {
        into.add(value);
        for (const inner of Object.values(value)) collect(inner, into);
      }
      return into;
    };
    const stateObjects = collect(busy, new Set());
    const viewObjects = collect(view, new Set());
    expect(viewObjects.size).toBeGreaterThan(100);
    for (const object of viewObjects) expect(stateObjects.has(object)).toBe(false);

    // So scribbling all over the view leaves the state as it was.
    const before = JSON.stringify(busy);
    for (const object of viewObjects) {
      const record = object as Record<string, unknown>;
      for (const key of Object.keys(record)) record[key] = 'scribble';
    }
    expect(JSON.stringify(busy)).toBe(before);

    // Building a view does not change the state either, and the same state gives the same view.
    const frozen = deepFreeze(cloneJson(busy));
    const first = buildPlayerView(frozen, 'p1');
    expect(buildPlayerView(frozen, 'p1')).toEqual(first);
    expect(JSON.stringify(frozen)).toBe(before);
    // Somebody who is not in the game gets no view.
    expect(() => buildPlayerView(busy, 'p3')).toThrow();
  });
});

describe('improvements and jobs in the view', () => {
  it('shows the improvement of a tile in sight', () => {
    const { state, rome } = borderScene();
    const map = state.map;
    const ownField = at(map, 2, 5); // Rome's land
    const ownHills = at(map, 4, 5); // Rome's land, turned into hills below
    const thebanField = at(map, 10, 5); // Thebes' land, in the scout's sight
    const built = arrange(state, (draft) => {
      improve(draft, ownField, 'farm');
      draft.map.tiles[ownHills].feature = 'hills';
      improve(draft, ownHills, 'mine');
      improve(draft, thebanField, 'farm');
    });

    const view = buildPlayerView(built, 'p1');
    expect(view.tiles[ownField]).toEqual({ terrain: 'grassland', feature: null, improvement: 'farm', owner: 'p1', visible: true });
    expect(view.tiles[ownHills]).toEqual({ terrain: 'grassland', feature: 'hills', improvement: 'mine', owner: 'p1', visible: true });
    // Somebody else's improvement is as public as their border, while the tile is in sight.
    expect(view.tiles[thebanField]).toEqual({ terrain: 'grassland', feature: null, improvement: 'farm', owner: 'p2', visible: true });
    // Every other tile in sight shows that nothing is built there.
    view.tiles.forEach((tile, index) => {
      if (tile !== null && ![ownField, ownHills, thebanField].includes(index)) expect(tile.improvement, `tile ${index}`).toBeNull();
    });
    expect(view.tiles[rome.tile]?.improvement).toBeNull();
    // The other player sees their own farm, and of Rome's two only what is in their sight: nothing.
    const theirs = buildPlayerView(built, 'p2');
    expect(theirs.tiles[thebanField]?.improvement).toBe('farm');
    expect(theirs.tiles[ownField]).toBeNull();
  });

  it('shows a fogged tile\'s improvement as last seen: one built after the player left stays hidden, one seen stays shown', () => {
    const { state, scoutId } = borderScene();
    const map = state.map;
    const seenFarm = at(map, 10, 5);
    const laterFarm = at(map, 11, 5);
    // A farm stands on Theban land while p1's scout looks at it...
    const farmed = arrange(state, (draft) => improve(draft, seenFarm, 'farm'));
    expect(buildPlayerView(farmed, 'p1').tiles[seenFarm]).toMatchObject({ improvement: 'farm', visible: true });
    expect(buildPlayerView(farmed, 'p1').tiles[laterFarm]).toMatchObject({ improvement: null, visible: true });

    // ...the scout leaves, and out of its sight the farm is torn down and another one is built next to it.
    const away = scoutSteps(farmed, scoutId, WEST, 3);
    expect(computeVisible(away, 'p1')[seenFarm]).toBe(false);
    expect(computeVisible(away, 'p1')[laterFarm]).toBe(false);
    const changed = tamper(away, (draft) => {
      improve(draft, seenFarm, null);
      improve(draft, laterFarm, 'farm');
    });
    updateKnowledge(changed);

    // p1 is shown both tiles as they were when last seen...
    const fogged = buildPlayerView(changed, 'p1');
    expect(fogged.tiles[seenFarm]).toEqual({ terrain: 'grassland', feature: null, improvement: 'farm', owner: 'p2', visible: false });
    expect(fogged.tiles[laterFarm]).toEqual({ terrain: 'grassland', feature: null, improvement: null, owner: 'p2', visible: false });
    // ...which is exactly the view p1 had before anything changed out there.
    expect(fogged).toEqual(buildPlayerView(away, 'p1'));
    // The owner sees them as they are.
    const theirs = buildPlayerView(changed, 'p2');
    expect(theirs.tiles[seenFarm]).toMatchObject({ improvement: null, visible: true });
    expect(theirs.tiles[laterFarm]).toMatchObject({ improvement: 'farm', visible: true });

    // Back in sight, the truth replaces the memory.
    const back = arrange(changed, (draft) => {
      draft.units[scoutId].tile = at(map, 8, 5);
    });
    const seenAgain = buildPlayerView(back, 'p1');
    expect(seenAgain.tiles[seenFarm]).toMatchObject({ improvement: null, visible: true });
    expect(seenAgain.tiles[laterFarm]).toMatchObject({ improvement: 'farm', visible: true });
  });

  it('a player who has the tile in sight when the turn resolves sees the new improvement in the next view; a player who has not gets no patch entry for that tile', () => {
    const { state } = borderScene();
    const map = state.map;
    const inSightSite = at(map, 10, 5); // Theban land that p1's scout sees
    const hiddenSite = at(map, 14, 5); // Theban land that p1 has never seen
    const first = workerOn(state, 'p2', inSightSite);
    const second = workerOn(first.state, 'p2', hiddenSite);
    const almost = arrange(second.state, (draft) => {
      draft.units[first.workerId].job = { improvement: 'farm', turnsWorked: IMPROVEMENTS.farm.turns - 1 };
      draft.units[second.workerId].job = { improvement: 'farm', turnsWorked: IMPROVEMENTS.farm.turns - 1 };
    });
    const before = { p1: buildPlayerView(almost, 'p1'), p2: buildPlayerView(almost, 'p2') };
    expect(before.p1.tiles[inSightSite]).toMatchObject({ improvement: null, visible: true });
    expect(before.p1.tiles[hiddenSite]).toBeNull();
    // Nothing in p1's view says that the Worker it sees is at work.
    expect(before.p1.units.find((unit) => unit.id === first.workerId)).toEqual({
      id: first.workerId, type: 'worker', owner: 'p2', tile: inSightSite, own: null,
    });

    const resolved = endTurnForAll(almost);
    expect(resolved.state.map.tiles[inSightSite].improvement).toBe('farm');
    expect(resolved.state.map.tiles[hiddenSite].improvement).toBe('farm');
    const after = { p1: buildPlayerView(resolved.state, 'p1'), p2: buildPlayerView(resolved.state, 'p2') };

    // p1: the farm in sight is on the map; the patch names that one tile and no other.
    expect(after.p1.tiles[inSightSite]).toMatchObject({ improvement: 'farm', visible: true });
    expect(after.p1.tiles[hiddenSite]).toBeNull();
    const patchForP1 = diffViews(before.p1, after.p1);
    expect(patchForP1?.tiles).toEqual([[inSightSite, { terrain: 'grassland', feature: null, improvement: 'farm', owner: 'p2', visible: true }]]);
    // And no news: the event went to the Worker's owner only.
    expect(filterEvents(resolved.events, 'p1').map((event) => event.type)).toEqual(['turnStarted']);

    // p2, who sees both tiles, is sent both, and the news of both.
    const patchForP2 = diffViews(before.p2, after.p2);
    expect(patchForP2?.tiles?.map(([tile]) => tile)).toEqual([inSightSite, hiddenSite]);
    expect(filterEvents(resolved.events, 'p2').map((event) => event.type)).toEqual(['improvementBuilt', 'improvementBuilt', 'turnStarted']);

    // Had p1's scout looked away in time, p1 would have been sent nothing about either tile.
    const lookedAway = arrange(almost, (draft) => {
      const scout = Object.values(draft.units).find((unit) => unit.owner === 'p1' && unit.type === 'scout');
      if (scout !== undefined) scout.tile = at(map, 5, 5);
    });
    const unseen = endTurnForAll(lookedAway);
    const quietPatch = diffViews(buildPlayerView(lookedAway, 'p1'), buildPlayerView(unseen.state, 'p1'));
    expect(quietPatch?.tiles).toBeUndefined();
    expect(buildPlayerView(unseen.state, 'p1').tiles[inSightSite]).toMatchObject({ improvement: null, visible: false });
  });

  it('own units carry job and jobOptions: turns from the table, error equal to startJobError, in IMPROVEMENT_IDS order; units that cannot improve carry an empty list', () => {
    const { state, scoutId } = borderScene();
    const map = state.map;
    const placed = workerOn(state, 'p1', at(map, 2, 5));
    const view = buildPlayerView(placed.state, 'p1');
    const worker = placed.state.units[placed.workerId];

    const own = view.units.find((unit) => unit.id === placed.workerId)?.own;
    expect(own).toEqual({
      movesLeft: UNITS.worker.moves,
      foundCityError: 'cannotFoundCity',
      job: null,
      jobOptions: IMPROVEMENT_IDS.map((improvement) => ({
        improvement,
        turns: IMPROVEMENTS[improvement].turns,
        error: startJobError(placed.state, worker, improvement),
      })),
    });
    expect(own?.jobOptions.map((option) => [option.improvement, option.error])).toEqual([['farm', null], ['mine', 'badImprovementTile']]);

    // Units that cannot build improvements carry no job and an empty list.
    for (const unit of view.units) {
      if (unit.own === null || unit.id === placed.workerId) continue;
      expect(UNITS[unit.type].canImprove).toBe(false);
      expect(unit.own.job, unit.type).toBeNull();
      expect(unit.own.jobOptions, unit.type).toEqual([]);
    }
    expect(view.units.find((unit) => unit.id === scoutId)?.own?.jobOptions).toEqual([]);

    // At work: the job with its numbers, and every option says the unit is busy.
    const working = act(placed.state, 'p1', { type: 'startJob', unitId: placed.workerId, improvement: 'farm' });
    const busy = buildPlayerView(working, 'p1').units.find((unit) => unit.id === placed.workerId)?.own;
    expect(busy).toEqual({
      movesLeft: UNITS.worker.moves,
      foundCityError: 'cannotFoundCity',
      job: { improvement: 'farm', turnsWorked: 0, turnsTotal: IMPROVEMENTS.farm.turns, turnsLeft: IMPROVEMENTS.farm.turns },
      jobOptions: IMPROVEMENT_IDS.map((improvement) => ({ improvement, turns: IMPROVEMENTS[improvement].turns, error: 'unitBusy' })),
    });
  });

  it('job.turnsLeft counts down to 1 and is never less', () => {
    const { state } = borderScene();
    const placed = workerOn(state, 'p1', at(state.map, 2, 5));
    const jobIn = (game: GameState): unknown => buildPlayerView(game, 'p1').units.find((unit) => unit.id === placed.workerId)?.own?.job;
    const total = IMPROVEMENTS.farm.turns;

    let current = act(placed.state, 'p1', { type: 'startJob', unitId: placed.workerId, improvement: 'farm' });
    const seen: unknown[] = [];
    for (let turn = 0; turn < total; turn++) {
      seen.push(jobIn(current));
      current = endTurnForAll(current).state;
    }
    expect(seen).toEqual(
      Array.from({ length: total }, (_, worked) => ({ improvement: 'farm', turnsWorked: worked, turnsTotal: total, turnsLeft: total - worked })),
    );
    expect(jobIn(current)).toBeNull(); // finished

    // A job that has been worked on for longer than the table asks (the table
    // was tuned under a running game, say) still needs the turn to resolve: 1, never 0 or less.
    for (const worked of [total - 1, total, total + 1, total + 30]) {
      const overdue = arrange(placed.state, (draft) => {
        draft.units[placed.workerId].job = { improvement: 'farm', turnsWorked: worked };
      });
      expect(jobIn(overdue), `${worked} turns worked`).toEqual({ improvement: 'farm', turnsWorked: worked, turnsTotal: total, turnsLeft: 1 });
      // And one resolution does finish it.
      expect(endTurnForAll(overdue).state.map.tiles[at(state.map, 2, 5)].improvement).toBe('farm');
    }
  });

  it('sets a job option\'s error to null exactly when startJob would start the job', () => {
    const { state, rome } = borderScene();
    const map = state.map;
    // Workers of p1 in every kind of spot.
    const spots: [string, TileIndex, ImprovementId | null][] = [
      ['own grassland', at(map, 2, 5), null],
      ['own hills', at(map, 4, 5), null],
      ['own forest', at(map, 3, 6), null],
      ['own farm', at(map, 2, 4), null],
      ['own grassland, at work on a farm', at(map, 4, 4), 'farm'],
      ['own hills, at work on a mine', at(map, 3, 4), 'mine'],
      ['in Rome', rome.tile, null],
      ['nobody\'s land', at(map, 6, 8), null],
      ['Theban land', at(map, 10, 5), null],
    ];
    const scene = arrange(state, (draft) => {
      draft.map.tiles[at(map, 4, 5)].feature = 'hills';
      draft.map.tiles[at(map, 3, 4)].feature = 'hills';
      draft.map.tiles[at(map, 3, 6)].feature = 'forest';
      improve(draft, at(map, 2, 4), 'farm');
      for (const [, tile, job] of spots) {
        placeUnit(draft, 'p1', 'worker', tile).job = job === null ? null : { improvement: job, turnsWorked: 1 };
      }
    });

    const view = buildPlayerView(scene, 'p1');
    const seenCodes = new Set<string>();
    let options = 0;
    for (const unit of view.units) {
      if (unit.own === null) continue;
      for (const option of unit.own.jobOptions) {
        const what = `${unit.type} on tile ${unit.tile}, ${option.improvement}`;
        const result = send(scene, 'p1', { type: 'startJob', unitId: unit.id, improvement: option.improvement });
        const wouldStart = result.ok && result.changed;
        expect(option.error === null, what).toBe(wouldStart);
        // Where it would not, the option names the reason the action gives. The one exception
        // is the job the unit is already doing: the action is then an accepted no-op.
        if (!result.ok) expect(option.error, what).toBe(result.error.code);
        else if (!result.changed) expect(option.error, what).toBe('unitBusy');
        seenCodes.add(String(option.error));
        options += 1;
      }
    }
    expect(options).toBe(spots.length * IMPROVEMENT_IDS.length);
    // The spots cover a job that can be started and every reason why not (a
    // Worker always "can improve", so that one reason never shows in an option).
    expect([...seenCodes].sort()).toEqual(['alreadyImproved', 'badImprovementTile', 'cityOnTile', 'notYourLand', 'null', 'unitBusy']);
  });

  it('a foreign unit looks the same at work and idle: own is null and the unit view has exactly five other fields', () => {
    const { state } = borderScene();
    const map = state.map;
    const site = at(map, 10, 5); // Theban land, in the sight of p1's scout
    const placed = workerOn(state, 'p2', site);
    const idle = buildPlayerView(placed.state, 'p1');
    const shown = idle.units.find((unit) => unit.id === placed.workerId);
    expect(shown).toEqual({ id: placed.workerId, type: 'worker', owner: 'p2', tile: site, own: null });
    expect(Object.keys(shown ?? {}).sort()).toEqual(['id', 'own', 'owner', 'tile', 'type']);

    // At work, in every stage of the job: the same bytes.
    const working = act(placed.state, 'p2', { type: 'startJob', unitId: placed.workerId, improvement: 'farm' });
    for (const turnsWorked of [0, 1, IMPROVEMENTS.farm.turns - 1]) {
      const stage = arrange(working, (draft) => {
        draft.units[placed.workerId].job = { improvement: 'farm', turnsWorked };
      });
      const view = buildPlayerView(stage, 'p1');
      expect(view).toEqual(idle);
      expect(JSON.stringify(view)).toBe(JSON.stringify(idle));
    }
    // Its owner is shown the job.
    expect(buildPlayerView(working, 'p2').units.find((unit) => unit.id === placed.workerId)?.own?.job).toMatchObject({ improvement: 'farm' });
    // And an own Worker's job never reaches the other player either.
    const mine = workerOn(placed.state, 'p1', at(map, 5, 5));
    const theirViewBefore = buildPlayerView(mine.state, 'p2');
    const mineWorking = act(mine.state, 'p1', { type: 'startJob', unitId: mine.workerId, improvement: 'farm' });
    expect(buildPlayerView(mineWorking, 'p2')).toEqual(theirViewBefore);
  });

  it('siteInView gives the same facts as siteOfTile on every tile of the viewer\'s own land, throughout a random game; it is null for a never-seen tile', LONG_TEST, () => {
    let compared = 0;
    let improvedSites = 0;
    let citySites = 0;
    let neverSeen = 0;

    playRandomGame({
      start: newGame(WILDS, WILDS_STARTS, 'sites'),
      seed: 'site-actions',
      turns: 30,
      wildShare: 10,
      onStep: (step) => {
        // After every turn, and now and then in between.
        if (!step.result.ok || !step.result.changed) return;
        if (step.after.turn === step.before.turn && step.index % 25 !== 0) return;
        const state = step.after;
        for (const player of state.players) {
          const view = buildPlayerView(state, player.id);
          state.map.tiles.forEach((tile, index) => {
            const inView = siteInView(view, index);
            if (view.tiles[index] === null) {
              expect(inView, `never-seen tile ${index}`).toBeNull();
              neverSeen += 1;
              return;
            }
            const truth = siteOfTile(state, player.id, index);
            if (!truth.own) return;
            // The player's own land: always in sight, so every fact is the truth.
            expect(view.tiles[index]?.visible, `own tile ${index} of ${player.id}`).toBe(true);
            expect(inView, `own tile ${index} of ${player.id}`).toEqual(truth);
            compared += 1;
            if (tile.improvement !== null) improvedSites += 1;
            if (truth.city) citySites += 1;
          });
        }
      },
    });
    expect(compared).toBeGreaterThan(2000);
    expect(improvedSites).toBeGreaterThan(50);
    expect(citySites).toBeGreaterThan(100);
    expect(neverSeen).toBeGreaterThan(1000);

    // Not on the map at all: null, never an exception.
    const view = buildPlayerView(newGame(WILDS, WILDS_STARTS, 'sites'), 'p1');
    for (const tile of [-1, view.tiles.length, view.tiles.length + 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(siteInView(view, tile), String(tile)).toBeNull();
    }
    // A site is a fresh object: editing it changes neither the view nor the state.
    const own = view.tiles.findIndex((tile) => tile !== null);
    const site = siteInView(view, own);
    if (site !== null) site.ground.improvement = 'mine';
    expect(view.tiles[own]?.improvement).toBeNull();
  });
});

describe('filterEvents (WP2)', () => {
  const moved = (playerId: string, unitId: string): AddressedEvent['event'] => ({
    type: 'unitMoved', playerId, unitId, from: 1, path: [2], stoppedEarly: false,
  });
  const events: AddressedEvent[] = [
    { to: ['p1'], event: moved('p1', 'u1_a') },
    { to: ['p2'], event: moved('p2', 'u2_b') },
    { to: ['p1', 'p3'], event: { type: 'cityGrew', playerId: 'p1', cityId: 'c1_x', name: 'Rome', population: 2 } },
    // An event ABOUT p1 that is addressed to p2 only (as the victim of a phase 2 fight might be).
    { to: ['p2'], event: { type: 'unitBuilt', playerId: 'p1', cityId: 'c1_x', cityName: 'Rome', unitId: 'u1_c', unitType: 'scout', queueEmpty: true } },
    { to: [], event: moved('p3', 'u3_d') },
    { to: 'all', event: { type: 'turnStarted', turn: 5 } },
  ];

  it('keeps the events addressed to the player (to contains them, or to is "all"), in order', () => {
    expect(filterEvents(events, 'p1')).toEqual([events[0].event, events[2].event, events[5].event]);
    expect(filterEvents(events, 'p2')).toEqual([events[1].event, events[3].event, events[5].event]);
    expect(filterEvents(events, 'p3')).toEqual([events[2].event, events[5].event]);
    // Somebody nothing was addressed to still hears what everybody hears.
    expect(filterEvents(events, 'p4')).toEqual([events[5].event]);
    expect(filterEvents([], 'p1')).toEqual([]);
  });

  it('drops every event addressed to somebody else, whatever its playerId field says', () => {
    // p1 does not get the event about its own city that was addressed to p2 only...
    expect(filterEvents(events, 'p1')).not.toContainEqual(events[3].event);
    // ...and p2 does get it, although it names p1.
    expect(filterEvents(events, 'p2')).toContainEqual(events[3].event);
    // An event addressed to nobody reaches nobody, not even the player it is about.
    for (const playerId of ['p1', 'p2', 'p3', 'all']) expect(filterEvents(events, playerId)).not.toContainEqual(events[4].event);
    // A player is never mistaken for the audience 'all'.
    expect(filterEvents([{ to: ['all'], event: moved('p1', 'u1_a') }], 'p1')).toEqual([]);
  });

  it('returns bare GameEvents: the audience list (to) is never part of the result', () => {
    const frozen = deepFreeze(cloneJson(events));
    for (const playerId of ['p1', 'p2', 'p3']) {
      const mine = filterEvents(frozen, playerId);
      for (const event of mine) {
        expect('to' in event).toBe(false);
        expect('event' in event).toBe(false);
        expect(typeof event.type).toBe('string');
      }
      expect(JSON.stringify(mine)).not.toContain('"to"');
    }
    // A new array every time; the input is left alone.
    expect(filterEvents(frozen, 'p1')).not.toBe(filterEvents(frozen, 'p1'));
    expect(frozen).toEqual(events);
  });

  it('gives each player their own news of a real turn', () => {
    const { state, rome, thebes } = (() => {
      const scene = borderScene();
      const ready = arrange(scene.state, (draft) => {
        for (const city of Object.values(draft.cities)) {
          city.buildQueue = queueOf('scout');
          city.productionStored = UNITS.scout.cost;
        }
      });
      return { ...scene, state: ready };
    })();
    const resolved = endTurnForAll(state);
    const forP1 = filterEvents(resolved.events, 'p1');
    const forP2 = filterEvents(resolved.events, 'p2');
    expect(forP1.map((event) => event.type)).toEqual(['unitBuilt', 'turnStarted']);
    expect(forP2.map((event) => event.type)).toEqual(['unitBuilt', 'turnStarted']);
    expect(forP1[0]).toMatchObject({ playerId: 'p1', cityId: rome.id });
    expect(forP2[0]).toMatchObject({ playerId: 'p2', cityId: thebes.id });

    // A move is news for the mover only.
    const warrior = unitOf(state, 'p1', 'warrior');
    const step = actWithEvents(state, 'p1', { type: 'moveUnit', unitId: warrior.id, path: [stepFrom(state.map, warrior.tile, EAST)] });
    expect(filterEvents(step.events, 'p1')).toHaveLength(1);
    expect(filterEvents(step.events, 'p2')).toEqual([]);
  });
});
