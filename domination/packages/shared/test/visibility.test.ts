import { describe, expect, it } from 'vitest';
import {
  RULES,
  UNITS,
  buildCost,
  buildOptions,
  buildPlayerView,
  cityEconomy,
  cloneJson,
  computeVisible,
  distance,
  filterEvents,
  foodToGrow,
  updateKnowledge,
} from '../src/index';
import type { AddressedEvent, GameState, TileIndex } from '../src/index';
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
  newGame,
  placeUnit,
  send,
  stepFrom,
  tamper,
  unitOf,
  unitsOf,
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

  it('remembers owner and city of visible tiles and forgets them when the visible tile is empty again', () => {
    const { state, rome, thebes, scoutId } = borderScene();
    const map = state.map;
    // One step east and Thebes itself is in the scout's sight.
    const near = scoutSteps(state, scoutId, EAST, 1);
    const memory = near.players[0].knowledge.remembered;

    // The city: exactly the five public facts.
    expect(memory[thebes.tile]).toEqual({
      owner: 'p2',
      city: { id: thebes.id, owner: 'p2', name: thebes.name, tile: thebes.tile, population: thebes.population },
    });
    // Its land: the owner, and no city.
    const thebanField = at(map, 11, 5);
    expect(memory[thebanField]).toEqual({ owner: 'p2', city: null });
    // The player's own land is remembered in the same way.
    expect(memory[rome.tile]).toEqual({ owner: 'p1', city: { id: rome.id, owner: 'p1', name: rome.name, tile: rome.tile, population: 1 } });
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
    // Units are never remembered: the memory has only owners and cities in it.
    for (const entry of Object.values(memory)) expect(Object.keys(entry).sort()).toEqual(['city', 'owner']);
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
    expect(founded.players[0].knowledge.remembered[site]).toEqual({ owner: 'p1', city: facts });
    expect(founded.players[1].knowledge.remembered[site]).toEqual({ owner: 'p1', city: facts });
    expect(founded.players[1].knowledge.remembered[at(map, 5, 5)]).toEqual({ owner: 'p1', city: null });

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
    expect(before.remembered[fogged]).toEqual({ owner: 'p2', city: null });

    // Out of sight, everything changes: the city grows and is renamed, a field is given up.
    const changed = tamper(away, (draft) => {
      draft.cities[thebes.id].population = 9;
      draft.cities[thebes.id].name = 'Somewhere Else';
      draft.map.tiles[fogged].cityId = null;
    });
    updateKnowledge(changed);
    expect(changed.players[0].knowledge).toEqual(before);
    // The owner of those tiles, who does see them, is brought up to date.
    expect(changed.players[1].knowledge.remembered[thebes.tile].city?.population).toBe(9);
    expect(fogged in changed.players[1].knowledge.remembered).toBe(false);

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
        expect(tile).toEqual({ terrain: map.tiles[index].terrain, feature: map.tiles[index].feature, owner: null, visible: true });
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
    expect(near.tiles[thebanField]).toEqual({ terrain: 'grassland', feature: null, owner: 'p2', visible: true });
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
    expect(fogged.tiles[thebanField]).toEqual({ terrain: 'grassland', feature: null, owner: 'p2', visible: false });
    expect(fogged.tiles[freeField]).toEqual({ terrain: 'grassland', feature: null, owner: null, visible: false });
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
      { id: warrior.id, type: 'warrior', owner: 'p1', tile: warrior.tile, own: { movesLeft: UNITS.warrior.moves, foundCityError: 'cannotFoundCity' } },
      { id: scoutId, type: 'scout', owner: 'p1', tile: at(map, 8, 5), own: { movesLeft: 2, foundCityError: 'cannotFoundCity' } },
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

  it('lists own cities with OwnCityDetail whose numbers match cityEconomy', () => {
    const { state, rome } = borderScene();

    // Nothing chosen yet.
    const idle = buildPlayerView(state, 'p1').cities.find((city) => city.id === rome.id);
    const economy = cityEconomy(state, rome);
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
        production: null,
        productionStored: 0,
        productionCost: null,
        productionPerTurn: economy.production,
        turnsLeft: null,
        productionBlocked: null,
        worked: economy.worked,
        buildOptions: buildOptions(state, rome),
      },
    });
    expect(idle?.own?.buildOptions).toHaveLength(3);

    // A bigger city that is half-way through a warrior.
    const busy = arrange(state, (draft) => {
      Object.assign(draft.cities[rome.id], {
        population: 3,
        foodStored: 5,
        production: { kind: 'unit', unitType: 'warrior' },
        productionStored: 7,
      });
    });
    const busyEconomy = cityEconomy(busy, busy.cities[rome.id]);
    const detail = buildPlayerView(busy, 'p1').cities.find((city) => city.id === rome.id)?.own;
    expect(detail).toMatchObject({
      foodStored: 5,
      foodToGrow: foodToGrow(3),
      foodPerTurn: busyEconomy.foodSurplus,
      production: { kind: 'unit', unitType: 'warrior' },
      productionStored: 7,
      productionCost: buildCost({ kind: 'unit', unitType: 'warrior' }),
      productionPerTurn: busyEconomy.production,
      worked: busyEconomy.worked,
    });
    expect(detail?.worked).toHaveLength(3);
    // turnsLeft is the number of turn resolutions until the warrior appears: count them by playing.
    let played = busy;
    let turns = 0;
    while (unitsOf(played, 'p1', 'warrior').length < 2 && turns < 50) {
      played = endTurnForAll(played).state;
      turns += 1;
    }
    expect(unitsOf(played, 'p1', 'warrior')).toHaveLength(2);
    expect(detail?.turnsLeft).toBe(turns);
    // The build menu says the same about the current item.
    expect(detail?.buildOptions.find((option) => option.item.unitType === 'warrior')?.turns).toBe(turns);

    // Paid for already: one turn. A city that eats more than it grows shows a negative number.
    const paid = arrange(busy, (draft) => {
      draft.cities[rome.id].productionStored = 500;
      draft.cities[rome.id].population = 25;
    });
    const paidDetail = buildPlayerView(paid, 'p1').cities.find((city) => city.id === rome.id)?.own;
    expect(paidDetail?.turnsLeft).toBe(1);
    expect(paidDetail?.foodPerTurn).toBeLessThan(0);
  });

  it('sets productionBlocked for a Settler in a population-1 city (needsPopulation) and null for a Warrior', () => {
    const { state, rome } = borderScene();
    const blockedFor = (unitType: 'settler' | 'warrior', population: number): unknown => {
      const chosen = arrange(act(state, 'p1', { type: 'setProduction', cityId: rome.id, item: { kind: 'unit', unitType } }), (draft) => {
        draft.cities[rome.id].population = population;
      });
      return buildPlayerView(chosen, 'p1').cities.find((city) => city.id === rome.id)?.own?.productionBlocked;
    };
    expect(blockedFor('settler', 1)).toBe('needsPopulation');
    expect(blockedFor('settler', 2)).toBeNull();
    expect(blockedFor('warrior', 1)).toBeNull();
    // Nothing chosen: nothing is blocked.
    expect(buildPlayerView(state, 'p1').cities.find((city) => city.id === rome.id)?.own?.productionBlocked).toBeNull();
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
    const busy = scoutSteps(act(state, 'p1', { type: 'setProduction', cityId: Object.keys(state.cities)[0], item: { kind: 'unit', unitType: 'scout' } }), scoutId, EAST, 1);
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

describe('filterEvents (WP2)', () => {
  const moved = (playerId: string, unitId: string): AddressedEvent['event'] => ({
    type: 'unitMoved', playerId, unitId, from: 1, path: [2], stoppedEarly: false,
  });
  const events: AddressedEvent[] = [
    { to: ['p1'], event: moved('p1', 'u1_a') },
    { to: ['p2'], event: moved('p2', 'u2_b') },
    { to: ['p1', 'p3'], event: { type: 'cityGrew', playerId: 'p1', cityId: 'c1_x', name: 'Rome', population: 2 } },
    // An event ABOUT p1 that is addressed to p2 only (as the victim of a phase 2 fight might be).
    { to: ['p2'], event: { type: 'unitBuilt', playerId: 'p1', cityId: 'c1_x', cityName: 'Rome', unitId: 'u1_c', unitType: 'scout' } },
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
          city.production = { kind: 'unit', unitType: 'scout' };
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
