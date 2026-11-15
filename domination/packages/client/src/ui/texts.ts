/**
 * The sentences the panels print (work package WP4).
 *
 * They are kept apart from the code that builds the page for two reasons:
 * the wording can be read and changed in one place, and plain functions
 * from data to text can be unit-tested without a browser. Nothing here does
 * rule maths: every number comes ready-made from the server's view.
 */

import { GAME_CODE_LENGTH, IMPROVEMENTS, MAP_SIZES, RULES, RULE_ERROR_MESSAGES, UNITS } from '@domination/shared';
import type {
  BuildOption,
  BuildWait,
  GameCode,
  JobOption,
  MapSizeId,
  OwnCityDetail,
  PlayerId,
  PlayerView,
  QueueEntryView,
  UnitJobView,
  UnitView,
} from '@domination/shared';
import { citiesWaiting, citiesWithoutProduction, idleUnits, ownThingsAt } from '../game/selectors';
import type { OrdersClosed } from '../game/selectors';
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
 * The two sentences of the unit panel's hint, apart: `main` is what can be
 * done with the unit right now, `more` how to select the other thing on the
 * same tile ('' if there is none). A low window shows only `main`.
 * `main` is the first that applies:
 *   not online                      'No connection: orders have to wait.'
 *   the player has ended the turn   'You have ended your turn. Cancel that to give orders.'
 *   the unit has a job              'At work here. Stop the work to move this unit.'
 *   no moves left                   'No moves left this turn.'
 *   otherwise                       'Choose a highlighted tile to move there.'
 * `more` is 'Tap the same tile again to select the Settler.' (or '... to
 * select Rome.' for a city): every game starts with a Warrior and a Settler
 * on one tile, and a tap on a city with a unit in it selects the unit
 * first; without this sentence the second thing is only found by accident.
 *
 * Both are '' for somebody else's unit: there is nothing to do with it.
 *
 * @param online  false while there is no connection to the server
 */
export function unitHintParts(view: PlayerView, unit: UnitView, online: boolean): { main: string; more: string } {
  if (unit.own === null) return { main: '', more: '' };
  const me = view.players.find((player) => player.id === view.you);

  let main = 'Choose a highlighted tile to move there.';
  if (!online) main = 'No connection: orders have to wait.';
  else if (me !== undefined && me.endedTurn) main = 'You have ended your turn. Cancel that to give orders.';
  else if (unit.own.job !== null) main = 'At work here. Stop the work to move this unit.';
  else if (unit.own.movesLeft <= 0) main = 'No moves left this turn.';

  // What a second tap on the tile would select: the next of the player's things there, in tap order.
  const things = ownThingsAt(view, unit.tile);
  const index = things.findIndex((thing) => thing.kind === 'unit' && thing.unit.id === unit.id);
  if (index === -1 || things.length < 2) return { main, more: '' };
  const next = things[(index + 1) % things.length];
  const name = next.kind === 'unit' ? `the ${UNITS[next.unit.type].name}` : next.city.name;
  return { main, more: `Tap the same tile again to select ${name}.` };
}

/**
 * The unit panel's hint as one string, for the tests and for anybody who
 * wants one: `main`, then a space and `more` if there is one. '' for
 * somebody else's unit.
 */
export function unitHintText(view: PlayerView, unit: UnitView, online: boolean): string {
  const { main, more } = unitHintParts(view, unit, online);
  return more === '' ? main : `${main} ${more}`;
}

/** "Build Farm (4 turns)", "Build Farm (1 turn)". */
export function jobButtonText(option: JobOption): string {
  return `Build ${IMPROVEMENTS[option.improvement].name} (${countOf(option.turns, 'turn', 'turns')})`;
}

/**
 * Why a job button is greyed out, in words; null if it is not.
 *  'badImprovementTile' -> "A Farm needs open grassland, plains or desert."
 *                          ("A <name> needs <IMPROVEMENTS[id].needs>.")
 *  'alreadyImproved'    -> "This tile already has a Farm."
 *  anything else        -> RULE_ERROR_MESSAGES[error]
 */
export function jobReasonText(option: JobOption): string | null {
  if (option.error === null) return null;
  const improvement = IMPROVEMENTS[option.improvement];
  if (option.error === 'badImprovementTile') return `A ${improvement.name} needs ${improvement.needs}.`;
  if (option.error === 'alreadyImproved') return `This tile already has a ${improvement.name}.`;
  return RULE_ERROR_MESSAGES[option.error];
}

/**
 * The ONE sentence for the whole job block when every job is impossible for
 * the same reason (the same jobReasonText for every option, and there is at
 * least one option): "That can only be built on your own land.", "Nothing
 * can be built on the tile of a city." null otherwise; the panel then puts
 * each button's own reason under it.
 */
export function jobsReasonText(options: JobOption[]): string | null {
  if (options.length === 0) return null;
  const first = jobReasonText(options[0]);
  if (first === null) return null;
  return options.every((option) => jobReasonText(option) === first) ? first : null;
}

/** "Building a Farm: 3 turns left", "Building a Mine: 1 turn left". */
export function jobProgressText(job: UnitJobView): string {
  return `Building a ${IMPROVEMENTS[job.improvement].name}: ${countOf(job.turnsLeft, 'turn', 'turns')} left`;
}

/**
 * What an improvement adds ("+1 food"): the small print of a job button.
 * The words are made in game/tileInfo.ts, where the tile's improvement line
 * uses them too; handed on here so that the unit panel finds every sentence
 * it prints in this file.
 */
export { improvementBonusText } from '../game/tileInfo';

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
 * The words for why something has no "in N turns" (lower case, no full stop:
 * callers put them into a sentence):
 *   needsPopulation -> 'the city must grow first'
 *   noRoom          -> 'no free tile for the unit'
 *   noProduction    -> 'this city makes no production'
 *   tooFar          -> 'more than 50 turns' (RULES.forecastTurns)
 *   earlier         -> 'after the item above'
 */
export function buildWaitText(wait: BuildWait): string {
  switch (wait) {
    case 'needsPopulation':
      return 'the city must grow first';
    case 'noRoom':
      return 'no free tile for the unit';
    case 'noProduction':
      return 'this city makes no production';
    case 'tooFar':
      return `more than ${countOf(RULES.forecastTurns, 'turn', 'turns')}`;
    case 'earlier':
      return 'after the item above';
  }
}

/**
 * The current build: "Warrior 6/18 (+3 per turn, 4 turns)", "Warrior 15/18
 * (+3 per turn, 1 turn)"; the turns are left out when the first row has no
 * number ("Settler 30/30 (+2 per turn)"). With an empty queue: "Nothing to
 * build.", or, with production saved, "Nothing to build (7 production saved)."
 */
export function productionText(own: OwnCityDetail): string {
  const first = own.buildQueue[0];
  if (first === undefined) {
    return own.productionStored > 0 ? `Nothing to build (${own.productionStored} production saved).` : 'Nothing to build.';
  }
  const name = UNITS[first.item.unitType].name;
  const rate = `${signed(own.productionPerTurn)} per turn`;
  const detail = first.turns === null ? rate : `${rate}, ${countOf(first.turns, 'turn', 'turns')}`;
  return `${name} ${own.productionStored}/${first.cost} (${detail})`;
}

/**
 * What follows the current build in the same element, or null:
 *   empty queue      -> "This city's production is lost every turn."
 *   own.held is set  -> "Waiting: the city must grow first", "Waiting: no
 *                       free tile for the unit" (buildWaitText)
 *   otherwise        -> null (also for a first entry that has no number but
 *                       is not paid for yet)
 */
export function productionNoteText(own: OwnCityDetail): string | null {
  if (own.buildQueue.length === 0) return "This city's production is lost every turn.";
  if (own.held !== null) return `Waiting: ${buildWaitText(own.held)}`;
  return null;
}

/**
 * The small line of a queue row:
 *   index 0, a number   -> 'now, 4 turns', 'now, 1 turn'
 *   index > 0, a number -> 'in 8 turns'
 *   no number           -> buildWaitText(entry.wait) (every row, the first included)
 * (A row with neither a number nor a reason, which the server never sends,
 * says what is true of every row: 'now' for the first, 'after the item
 * above' for the others.)
 */
export function queueRowText(entry: QueueEntryView, index: number): string {
  if (entry.turns !== null) {
    const turns = countOf(entry.turns, 'turn', 'turns');
    return index === 0 ? `now, ${turns}` : `in ${turns}`;
  }
  if (entry.wait !== null) return buildWaitText(entry.wait);
  return index === 0 ? 'now' : buildWaitText('earlier');
}

/** "Queue 3 of 8": the entries in the queue and RULES.maxQueueLength. Shown in the panel's head. */
export function queueCountText(own: OwnCityDetail): string {
  return `Queue ${own.buildQueue.length} of ${RULES.maxQueueLength}`;
}

/**
 * The line under the queue title, or null: why the queue cannot be changed
 * right now. First that applies:
 *   closed === 'offline'    -> 'No connection: the queue cannot be changed right now.'
 *   closed === 'turnEnded'  -> 'You have ended your turn. Cancel that to change the queue.'
 *   an option has addError  -> RULE_ERROR_MESSAGES[addError] ('The build queue is full.')
 *                              (the first such option of the menu)
 */
export function queueNoteText(own: OwnCityDetail, closed: OrdersClosed | null): string | null {
  if (closed === 'offline') return 'No connection: the queue cannot be changed right now.';
  if (closed === 'turnEnded') return 'You have ended your turn. Cancel that to change the queue.';
  for (const option of own.buildOptions) {
    if (option.addError !== null) return RULE_ERROR_MESSAGES[option.addError];
  }
  return null;
}

/** How full a progress bar is, from 0 to 1 (a total of zero counts as empty). */
export function progressFraction(stored: number, total: number | null): number {
  if (total === null || total <= 0) return 0;
  return Math.min(1, Math.max(0, stored / total));
}

/**
 * The second line of an add button:
 *   '18 production, in 4 turns', '18 production, in 1 turn'
 *   '30 production, in 18 turns, uses 1 population'
 *   '30 production, uses 1 population (the city must grow first)'
 *                            a wait other than 'earlier': the reason in brackets
 *   '18 production (more than 50 turns)'
 *   '18 production'          wait 'earlier': the rows above already say why
 */
export function buildOptionText(option: BuildOption): string {
  const parts = [`${option.cost} production`];
  if (option.turns !== null) parts.push(`in ${countOf(option.turns, 'turn', 'turns')}`);
  const populationCost = UNITS[option.item.unitType].populationCost;
  if (populationCost > 0) parts.push(`uses ${populationCost} population`);
  const text = parts.join(', ');
  return option.wait === null || option.wait === 'earlier' ? text : `${text} (${buildWaitText(option.wait)})`;
}

// ---------------------------------------------------------------------------
// End Turn button and top bar
// ---------------------------------------------------------------------------

/**
 * What still needs the player this turn, one short sentence each, in this
 * order:
 *  1. idle cities (citiesWithoutProduction), by name when there is exactly
 *     one: "Rome has nothing to build", "2 cities have nothing to build";
 *  2. cities that wait with no end in sight (citiesWaiting), by name and
 *     reason when there is exactly one: "Rome is waiting: the city must
 *     grow first", "2 cities are waiting to finish a unit";
 *  3. the units (idleUnits, which leaves out units at work): "1 unit can
 *     still move", "2 units can still move".
 * Empty when nothing does. (A reminder only: it never stops anybody from
 * ending the turn.)
 */
export function todoHints(view: PlayerView): string[] {
  const hints: string[] = [];

  const idle = citiesWithoutProduction(view);
  if (idle.length === 1) hints.push(`${idle[0].name} has nothing to build`);
  else if (idle.length > 1) hints.push(`${idle.length} cities have nothing to build`);

  const waiting = citiesWaiting(view);
  const held = waiting.length === 1 ? (waiting[0].own?.held ?? null) : null;
  if (held !== null) hints.push(`${waiting[0].name} is waiting: ${buildWaitText(held)}`);
  else if (waiting.length > 0) hints.push(`${countOf(waiting.length, 'city is', 'cities are')} waiting to finish a unit`);

  const units = idleUnits(view).length;
  if (units > 0) hints.push(`${countOf(units, 'unit', 'units')} can still move`);
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
