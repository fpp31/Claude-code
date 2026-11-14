import { describe, it } from 'vitest';

/**
 * Tests WP2 must write for the rules engine (packages/shared/src/rules/).
 * Each `it.todo` is a promise made in a doc comment; replace it with a real
 * test. Use hand-drawn maps (mapFromAscii from '../src/testing') and pass a
 * fixed-map generator to createGame, so these tests do not depend on WP1.
 * Compare error CODES, never message texts.
 */

describe('createGame (WP2)', () => {
  it.todo('creates players in seat order with a Settler and a Warrior on their start tile');
  it.todo('is deterministic: the same setup gives a deep-equal state');
  it.todo('starts at turn 1 with nobody having ended the turn and no cities');
  it.todo('has explored exactly what the starting units can see');
  it.todo('returns a state that is plain JSON (survives cloneJson unchanged) and passes checkInvariants');
  it.todo('throws for no players, too many players, duplicate ids or an empty seed');
  it.todo('throws for an id that is not a seat name ("alice", "p0", "p9") and for ids out of seat order; accepts gaps (p1, p3)');
});

describe('applyAction: common checks (WP2)', () => {
  it.todo('never modifies the state it is given (accepted, rejected and no-op actions)');
  it.todo('rejects an unknown player or an unknown action type with badAction');
  it.todo('rejects an action carrying an old or future turn number with staleTurn');
  it.todo('rejects everything except cancelEndTurn after the player ended the turn (turnAlreadyEnded)');
  it.todo('treats a second endTurn, a needless cancelEndTurn and an unchanged setProduction as no-ops (changed false, same state object)');
});

describe('applyAction: moveUnit (WP2)', () => {
  it.todo('moves along the path and charges tileMoveCost per step');
  it.todo('lets a unit with 1 move left enter rough terrain (moves floor at 0)');
  it.todo('rejects a missing unit and another player\'s unit with the same code, noSuchUnit');
  it.todo('rejects empty, too long, off-map and non-adjacent paths with badPath');
  it.todo('rejects a unit with no moves left with noMovesLeft');
  it.todo('rejects a first step into water or mountains with impassable');
  it.todo('rejects a first step onto a foreign unit, a foreign city, or an own unit of the same class with blocked');
  it.todo('allows a military and a civilian unit of the same player to share a tile');
  it.todo('stops early (and succeeds) when a later step is illegal or the moves run out, reporting stoppedEarly');
  it.todo('explores along the way: tiles seen from intermediate steps become explored');
  it.todo('emits one unitMoved event with the steps actually taken, addressed to the mover only (to: [playerId])');
});

describe('applyAction: foundCity (WP2)', () => {
  it.todo('consumes the settler and creates a population-1 city named from the civ list');
  it.todo('claims every unowned tile within RULES.cityClaimRadius and leaves owned tiles alone');
  it.todo('rejects non-settlers (cannotFoundCity), spent settlers (noMovesLeft), bad ground (badCityTile)');
  it.todo('rejects founding on another player\'s territory (tileOwned) but allows it inside own territory');
  it.todo('rejects a city closer than RULES.minCityDistance to any city (tooCloseToCity) and accepts exactly that distance');
  it.todo('gives a second city the second name of the list');
});

describe('city economy and production (WP2)', () => {
  it.todo('works the centre for free with at least RULES.cityCenterMinYields');
  it.todo('assigns citizens by total yield, then food, then lower tile index');
  it.todo('never works mountains, tiles of other cities, or more tiles than citizens');
  it.todo('setProduction: rejects foreign or missing cities (noSuchCity) and unknown items (cannotBuild), keeps stored production');
  it.todo('findSpawnTile prefers the city tile, then the nearest free owned tile, else null');
});

describe('turn resolution (WP2)', () => {
  it.todo('resolves only when every player has ended the turn; a single-player game resolves on each endTurn');
  it.todo('cancelEndTurn before the last player ends keeps the turn open');
  it.todo('grows a city when stored food reaches foodToGrow, carrying the rest over');
  it.todo('never lets stored food go below 0 and never shrinks a city');
  it.todo('adds production only while an item is selected, completes the unit, carries the rest over and keeps the item selected');
  it.todo('makes a Settler wait until the city has population 2, then removes one population');
  it.todo('makes a finished unit wait when there is no free tile');
  it.todo('productionBlocked says needsPopulation / noRoom exactly when resolveTurn would make the city wait, and null otherwise');
  it.todo('restores every unit\'s moves, clears endedTurn, adds 1 to the turn and ends with a turnStarted event addressed to all');
  it.todo('addresses cityGrew and unitBuilt to the city\'s owner only');
  it.todo('resolveTurn does not modify its input');
});

describe('whole-game properties (WP2)', () => {
  it.todo('random legal play for 30 turns with 4 players: checkInvariants stays empty after every action');
  it.todo('the same seed and the same actions give byte-identical JSON twice');
  it.todo('saving and loading (JSON round trip) in mid-game changes nothing afterwards');
  it.todo('a rejected action leaves the state deep-equal');
});
