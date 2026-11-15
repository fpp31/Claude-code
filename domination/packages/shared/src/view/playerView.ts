/**
 * Building what one player is allowed to see (work package WP2).
 *
 * THE ONE FILTER. Everything a client is ever sent about a game comes out of
 * `buildPlayerView` (or is a diff of two of its results) and `filterEvents`.
 * If a secret leaks, the bug is in this file.
 */

import type { AddressedEvent, GameEvent } from '../actions';
import { foodToGrow } from '../data/rules';
import { getPlayer } from '../ids';
import { buildPlan, foundCityError } from '../rules/city';
import { jobOptions, jobView } from '../rules/improvements';
import { tileOwner } from '../rules/stateQueries';
import type { City, CityPublic, GameState, PlayerId, PlayerKnowledge, PlayerState, Unit } from '../types';
import type { CityView, OwnCityDetail, PlayerPublic, PlayerView, TileView, UnitView } from '../viewTypes';
import { computeVisible } from './visibility';

/**
 * Builds the view of one player. See viewTypes.ts for what a view may and may not
 * contain. Pure; throws if `playerId` is not a player of the game.
 *
 * It expects `updateKnowledge` to have run on `state` (true for every state
 * returned by createGame, applyAction and resolveTurn).
 *
 * CONSTRUCTION RULE: build every output object field by field from scratch
 * (an allow-list). Never copy a state object with spread or by reference and
 * then delete fields: a forgotten copy is harmless, a forgotten delete is a
 * leak.
 *
 * Contents:
 *  - you, turn, width, height.
 *  - tiles[i]:
 *      * never explored                 -> null;
 *      * visible now (computeVisible)   -> terrain, feature, visible: true,
 *                                          owner = current owner of the tile,
 *                                          improvement = what is built on it;
 *      * explored but not visible       -> terrain, feature, visible: false,
 *                                          owner = knowledge.remembered[i]?.owner ?? null,
 *                                          improvement = knowledge.remembered[i]?.improvement ?? null
 *                                          (both as last seen, never the truth).
 *  - units, sorted by id (plain string comparison with < and >):
 *      * the viewer's own units, with own = { movesLeft, foundCityError,
 *        job, jobOptions } (jobView and jobOptions in rules/improvements.ts);
 *      * other players' units standing on tiles visible now, with own = null:
 *        nothing says whether such a unit has a job.
 *  - cities, sorted by id:
 *      * the viewer's own cities: visible: true, own = OwnCityDetail computed
 *        with buildPlan (rules/city.ts: the economy and a forecast made with
 *        the functions turn resolution uses) and foodToGrow;
 *      * other players' cities on tiles visible now: current public fields,
 *        visible: true, own = null;
 *      * cities in knowledge.remembered on tiles NOT visible now: the
 *        remembered public fields, visible: false, own = null.
 *  - players: id, name, civ, endedTurn for every player, in seat order.
 *
 * Property the tests must prove (non-interference): changing anything in the
 * state that this player cannot see (a hidden unit's position, terrain of a
 * never-seen tile, another city's food or production, another city's build
 * queue, a foreign unit's job, the improvement of a tile out of sight,
 * another player's knowledge or idRng, `seed`, `rng`) leaves the returned
 * view deep-equal.
 */
export function buildPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  const viewer = getPlayer(state, playerId); // throws for somebody who is not in this game
  const visible = computeVisible(state, playerId);

  return {
    you: playerId,
    turn: state.turn,
    width: state.map.width,
    height: state.map.height,
    tiles: tileViews(state, viewer.knowledge, visible),
    units: unitViews(state, playerId, visible),
    cities: cityViews(state, playerId, viewer.knowledge, visible),
    players: state.players.map(playerPublic),
  };
}

// ---------------------------------------------------------------------------
// The parts of a view. Every object below is written out field by field.
// ---------------------------------------------------------------------------

/** One entry per tile: null (never seen), the tile as it is (in sight), or the tile as last seen (fogged). */
function tileViews(state: GameState, knowledge: PlayerKnowledge, visible: boolean[]): (TileView | null)[] {
  return state.map.tiles.map((tile, index): TileView | null => {
    if (knowledge.explored[index] !== 1) return null;
    if (visible[index]) {
      return {
        terrain: tile.terrain,
        feature: tile.feature,
        improvement: tile.improvement,
        owner: tileOwner(state, index),
        visible: true,
      };
    }
    // Terrain never changes, so it may be read from the truth. The owner can
    // change out of sight, so it comes from the player's memory only, and so
    // does the improvement.
    const remembered = knowledge.remembered[index];
    return {
      terrain: tile.terrain,
      feature: tile.feature,
      improvement: remembered === undefined ? null : remembered.improvement,
      owner: remembered === undefined ? null : remembered.owner,
      visible: false,
    };
  });
}

/** The viewer's own units in full, and other players' units that stand on tiles in sight. Sorted by id. */
function unitViews(state: GameState, viewerId: PlayerId, visible: boolean[]): UnitView[] {
  const views: UnitView[] = [];
  for (const unit of Object.values(state.units)) {
    if (unit.owner === viewerId) views.push(ownUnitView(state, unit));
    else if (visible[unit.tile]) views.push(foreignUnitView(unit));
  }
  return views.sort(byId);
}

/** One of the viewer's own units, with the details only its owner may know. */
function ownUnitView(state: GameState, unit: Unit): UnitView {
  return {
    id: unit.id,
    type: unit.type,
    owner: unit.owner,
    tile: unit.tile,
    own: {
      movesLeft: unit.movesLeft,
      foundCityError: foundCityError(state, unit),
      job: unit.job === null ? null : jobView(unit.job),
      jobOptions: jobOptions(state, unit),
    },
  };
}

/** Somebody else's unit: what can be seen from outside, and nothing about its moves. */
function foreignUnitView(unit: Unit): UnitView {
  return { id: unit.id, type: unit.type, owner: unit.owner, tile: unit.tile, own: null };
}

/** The viewer's own cities in full, other cities in sight, and cities remembered on fogged tiles. Sorted by id. */
function cityViews(state: GameState, viewerId: PlayerId, knowledge: PlayerKnowledge, visible: boolean[]): CityView[] {
  const views: CityView[] = [];

  for (const city of Object.values(state.cities)) {
    if (city.owner === viewerId) views.push(ownCityView(state, city));
    else if (visible[city.tile]) views.push(publicCityView(city, true));
  }

  // Cities the player saw earlier, on tiles that are out of sight now: shown
  // exactly as remembered, whatever has become of them since. (A tile in
  // sight is skipped: its city, if it still has one, was listed above.)
  for (const [key, remembered] of Object.entries(knowledge.remembered)) {
    const tile = Number(key);
    if (remembered.city === null || visible[tile]) continue;
    views.push(publicCityView(remembered.city, false));
  }

  return views.sort(byId);
}

/** A city as anybody may see it. Takes the five public fields and nothing else. */
function publicCityView(city: CityPublic, visible: boolean): CityView {
  return {
    id: city.id,
    owner: city.owner,
    name: city.name,
    tile: city.tile,
    population: city.population,
    visible,
    own: null,
  };
}

/** One of the viewer's own cities, with the details only its owner may know. */
function ownCityView(state: GameState, city: City): CityView {
  return {
    id: city.id,
    owner: city.owner,
    name: city.name,
    tile: city.tile,
    population: city.population,
    visible: true, // a player always sees their own territory
    own: ownCityDetail(state, city),
  };
}

/** Every number the city panel prints, computed with the same functions turn resolution uses. */
function ownCityDetail(state: GameState, city: City): OwnCityDetail {
  // ONE call: the plan reads the city's land once and hands out the economy it found.
  const plan = buildPlan(state, city);
  return {
    foodStored: city.foodStored,
    foodToGrow: foodToGrow(city.population),
    foodPerTurn: plan.economy.foodSurplus,
    buildQueue: plan.queue,
    held: plan.held,
    productionStored: city.productionStored,
    productionPerTurn: plan.economy.production,
    worked: plan.economy.worked,
    buildOptions: plan.options,
  };
}

/** What everybody may know about a player. The rest of a PlayerState (id stream, memory) is private. */
function playerPublic(player: PlayerState): PlayerPublic {
  return { id: player.id, name: player.name, civ: player.civ, endedTurn: player.endedTurn };
}

/** Plain string comparison with < and >, the same on every machine (no locale rules). */
function byId(a: { id: string }, b: { id: string }): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * The events one player may receive, in their original order, WITHOUT their
 * audience lists: the `event` of every entry whose `to` is 'all' or contains
 * `playerId`. Everything else is dropped. Returns a new array; pure. (The
 * array is new, the event objects in it are the engine's own: nobody edits
 * an event after it was made.)
 *
 * It looks only at `to`, never at the event's own fields: who may hear about
 * an event was decided by the engine when it made the event (AddressedEvent
 * in actions.ts). In phase 1 that means a player's own events plus
 * 'turnStarted'.
 */
export function filterEvents(events: AddressedEvent[], playerId: PlayerId): GameEvent[] {
  const mine: GameEvent[] = [];
  for (const addressed of events) {
    if (addressed.to === 'all' || addressed.to.includes(playerId)) mine.push(addressed.event);
  }
  return mine;
}
