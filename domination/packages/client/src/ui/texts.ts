/**
 * The sentences the panels print (work package WP4).
 *
 * They are kept apart from the code that builds the page for two reasons:
 * the wording can be read and changed in one place, and plain functions
 * from data to text can be unit-tested without a browser. Nothing here does
 * rule maths: every number comes ready-made from the server's view.
 */

import { GAME_CODE_LENGTH, MAP_SIZES, UNITS } from '@domination/shared';
import type { BuildOption, GameCode, MapSizeId, OwnCityDetail, PlayerId, PlayerView, UnitView } from '@domination/shared';
import { citiesWithoutProduction, idleUnits, ownThingsAt } from '../game/selectors';
import type { JoinProblem } from '../state/store';

/** "1 turn", "3 turns": the number with the right form of the word. */
export function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "+2", "+0", "-1": a per-turn change with its sign. */
export function signed(amount: number): string {
  return amount < 0 ? `${amount}` : `+${amount}`;
}

/**
 * A list of names as a phrase: "Ben", "Ben and Cleo", "Ben, Cleo and Dan".
 * More than three become "Ben, Cleo and 2 others", so the line stays short.
 */
export function nameList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

// ---------------------------------------------------------------------------
// Home screen
// ---------------------------------------------------------------------------

/**
 * The first paragraph of the home screen.
 *
 * Somebody who opened an invite link is told so ("You are invited to game
 * K7QXM..."), but only once the server has answered, and only if that game
 * can be joined: an invitation that leads nowhere would be worse than none.
 * The reason it leads nowhere is printed under the code field (codeHintText).
 *
 * @param invitedTo  the game code in the address the page was opened with, or null
 * @param opening    true while the server is still being asked about that game
 * @param problem    why the game on this screen cannot be joined, or null
 */
export function homeIntroText(invitedTo: GameCode | null, opening: boolean, problem: JoinProblem | null): string {
  if (invitedTo !== null && !opening && problem === null) {
    return `You are invited to game ${invitedTo}. Type your name and press Join.`;
  }
  return 'A strategy game to play with friends. Create a game and send them the link, or join theirs.';
}

/**
 * The line under the game code field. It normally says where a code comes
 * from; it turns into a warning when the typed code is too short to be one
 * (`tooShort`, set when Join was pressed), when the server has said that
 * the game cannot be joined, or when the page was opened through a link
 * whose code is not a code at all (`brokenLink`: cut short, or with
 * something stuck to its end; what it held is not repeated on the page).
 */
export function codeHintText(tooShort: boolean, problem: JoinProblem | null, brokenLink = false): string {
  if (tooShort) return `A game code has ${GAME_CODE_LENGTH} letters or digits. Ask your friend for it, or open the link they sent.`;
  if (brokenLink && problem === null) {
    return `The link you opened is damaged: it has no game code in it. Ask your friend for the code (${GAME_CODE_LENGTH} letters or digits) or for the link again.`;
  }
  switch (problem) {
    case 'noSuchGame':
      return 'There is no game with this code. Check the code or the link with your friend.';
    case 'gameAlreadyStarted':
      return 'This game has already started, so nobody new can join it. You can start a new game instead.';
    case 'gameFull':
      return 'This game is full: every seat is taken. You can start a new game instead.';
    case null:
      return 'Your friend sees the code and a link when they create a game.';
  }
}

// ---------------------------------------------------------------------------
// Unit panel
// ---------------------------------------------------------------------------

/** "Moves 1/2" for an own unit; '' for anybody else's (their moves are not ours to know). */
export function movesText(unit: UnitView): string {
  if (unit.own === null) return '';
  return `Moves ${unit.own.movesLeft}/${UNITS[unit.type].moves}`;
}

/**
 * What can be done with the selected unit right now, in one or two short
 * sentences: "Choose a highlighted tile to move there.", "No moves left
 * this turn.", and so on.
 *
 * If something else of the player's is on the same tile, a second sentence
 * says how to get at it: "Tap the same tile again to select the Settler."
 * Every game starts with a Warrior and a Settler on one tile, and a tap on
 * a city with a unit in it selects the unit first; without this sentence
 * the second thing is only found by accident.
 *
 * @param online  false while there is no connection to the server
 */
export function unitHintText(view: PlayerView, unit: UnitView, online: boolean): string {
  if (unit.own === null) return '';
  const me = view.players.find((player) => player.id === view.you);

  let hint = 'Choose a highlighted tile to move there.';
  if (!online) hint = 'No connection: orders have to wait.';
  else if (me !== undefined && me.endedTurn) hint = 'You have ended your turn. Cancel that to give orders.';
  else if (unit.own.movesLeft <= 0) hint = 'No moves left this turn.';

  // What a second tap on the tile would select: the next of the player's things there, in tap order.
  const things = ownThingsAt(view, unit.tile);
  const index = things.findIndex((thing) => thing.kind === 'unit' && thing.unit.id === unit.id);
  if (index === -1 || things.length < 2) return hint;
  const next = things[(index + 1) % things.length];
  const name = next.kind === 'unit' ? `the ${UNITS[next.unit.type].name}` : next.city.name;
  return `${hint} Tap the same tile again to select ${name}.`;
}

/**
 * The words of the "First steps" note, shown at the very start of a game
 * while nothing is selected; null once the player has a city (or has
 * nothing that could found one). A new player sees a map, two little
 * figures and a big End Turn button: this says which of them to touch.
 */
export function firstStepsText(view: PlayerView): string | null {
  const hasCity = view.cities.some((city) => city.owner === view.you);
  const hasFounder = view.units.some((unit) => unit.owner === view.you && UNITS[unit.type].canFoundCity);
  if (hasCity || !hasFounder) return null;
  return 'Tap one of your units on the map to select it. Your Settler can found your first city.';
}

// ---------------------------------------------------------------------------
// City panel
// ---------------------------------------------------------------------------

/** "Population 2". */
export function populationText(population: number): string {
  return `Population ${population}`;
}

/** "Food 4/16 (+2 per turn)". */
export function foodText(own: OwnCityDetail): string {
  return `Food ${own.foodStored}/${own.foodToGrow} (${signed(own.foodPerTurn)} per turn)`;
}

/**
 * "Warrior 6/18 (+3 per turn, 4 turns)", or "Nothing chosen".
 * The number of turns is left out when the city makes no production, and
 * when something else is holding the item back (see productionBlockedText):
 * "0 turns" next to "Waiting" would only confuse.
 */
export function productionText(own: OwnCityDetail): string {
  if (own.production === null || own.productionCost === null) return 'Nothing chosen';
  const name = UNITS[own.production.unitType].name;
  const rate = `${signed(own.productionPerTurn)} per turn`;
  const showTurns = own.turnsLeft !== null && own.productionBlocked === null;
  const detail = showTurns ? `${rate}, ${countOf(own.turnsLeft ?? 0, 'turn', 'turns')}` : rate;
  return `${name} ${own.productionStored}/${own.productionCost} (${detail})`;
}

/** Why a finished item is not appearing, or null if nothing is holding it back. */
export function productionBlockedText(own: OwnCityDetail): string | null {
  if (own.production === null || own.productionBlocked === null) return null;
  switch (own.productionBlocked) {
    case 'needsPopulation':
      return `Waiting: the city needs ${1 + UNITS[own.production.unitType].populationCost} population`;
    case 'noRoom':
      return 'Waiting: no free tile for the unit';
  }
}

/** How full a progress bar is, from 0 to 1 (a total of zero counts as empty). */
export function progressFraction(stored: number, total: number | null): number {
  if (total === null || total <= 0) return 0;
  return Math.min(1, Math.max(0, stored / total));
}

/** The second line of a build button: "18 production, 4 turns" (plus "uses 1 population" for a Settler). */
export function buildOptionText(option: BuildOption): string {
  const parts = [`${option.cost} production`];
  if (option.turns !== null) parts.push(countOf(option.turns, 'turn', 'turns'));
  const populationCost = UNITS[option.item.unitType].populationCost;
  if (populationCost > 0) parts.push(`uses ${populationCost} population`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// End Turn button and top bar
// ---------------------------------------------------------------------------

/**
 * What still needs the player this turn, one short sentence each:
 * "2 units can still move", "1 city has nothing to build". Empty when
 * nothing does. (A reminder only: it never stops anybody from ending the turn.)
 */
export function todoHints(view: PlayerView): string[] {
  const hints: string[] = [];
  const units = idleUnits(view).length;
  const cities = citiesWithoutProduction(view).length;
  if (units > 0) hints.push(`${countOf(units, 'unit', 'units')} can still move`);
  if (cities > 0) hints.push(`${countOf(cities, 'city has', 'cities have')} nothing to build`);
  return hints;
}

/**
 * Who the game is waiting for, in words: "Waiting for you and Ben",
 * "Waiting for Ben (offline)", "Everyone is waiting for you". '' in a game
 * with a single player, where nobody waits for anybody.
 *
 * @param connected  the players with a live connection (GameSession.connected);
 *                   anybody else who is waited for is marked "(offline)"
 */
export function waitingForText(view: PlayerView, connected: PlayerId[]): string {
  if (view.players.length <= 1) return '';
  const waitedFor = view.players.filter((player) => !player.endedTurn);
  if (waitedFor.length === 0) return 'Everyone has ended the turn';

  const others = waitedFor
    .filter((player) => player.id !== view.you)
    .map((player) => (connected.includes(player.id) ? player.name : `${player.name} (offline)`));
  const includesMe = waitedFor.some((player) => player.id === view.you);
  if (includesMe && others.length === 0) return 'Everyone is waiting for you';
  return `Waiting for ${nameList(includesMe ? ['you', ...others] : others)}`;
}

/**
 * The title of the browser tab during a game: "Your move - Turn 7 -
 * Domination" or "Waiting for others - Turn 7 - Domination". A game is often
 * left in a background tab for hours; the tab strip then shows at a glance
 * whether the game is waiting for this player.
 */
export function tabTitleText(view: PlayerView): string {
  const me = view.players.find((player) => player.id === view.you);
  const state = me !== undefined && me.endedTurn ? 'Waiting for others' : 'Your move';
  return `${state} - Turn ${view.turn} - Domination`;
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

/**
 * One line of the map size menu: "Small, best for up to 3 players".
 *
 * It has to be short: a phone shows the chosen line in a box about 34
 * characters wide and cuts off whatever is longer. (The size in tiles used
 * to be in this line too; it is now in the note under the menu, see
 * mapSizeNote.)
 */
export function mapSizeText(id: MapSizeId): string {
  const size = MAP_SIZES[id];
  return `${size.name}, best for up to ${countOf(size.recommendedPlayers, 'player', 'players')}`;
}

/**
 * The note under the map size menu: how big the chosen map is, and who
 * decides. "32 x 20 tiles. A bigger map makes a longer game." for the host,
 * "32 x 20 tiles. Ada chooses the map." for everybody else.
 *
 * @param hostName  the host's name, or null if the reader is the host
 */
export function mapSizeNote(id: MapSizeId, hostName: string | null): string {
  const size = MAP_SIZES[id];
  const who = hostName === null ? 'A bigger map makes a longer game.' : `${hostName} chooses the map.`;
  return `${size.width} x ${size.height} tiles. ${who}`;
}

/**
 * The note under the invite link when the page was opened through an
 * address that only works on the computer the server runs on (see
 * pageIsLocalOnly in net/identity.ts): the link is built from that
 * address, so a friend who is sent it gets nowhere.
 */
export const LOCAL_LINK_NOTE =
  'This link only works on this computer, because you opened the game through "localhost". ' +
  'For friends, open the game through this computer\'s network address or the server\'s address (see the README), and send the link shown then.';

/**
 * The question asked before starting a game with seats nobody is sitting
 * on: "Ben is not connected. The game waits for every player each turn.
 * Start anyway?"
 */
export function ghostSeatWarning(names: string[]): string {
  const who = `${nameList(names)} ${names.length === 1 ? 'is' : 'are'} not connected.`;
  return `${who} The game waits for every player each turn. Start anyway?`;
}
