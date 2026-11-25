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
  UnitTypeId,
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
    case 'gameNotLoaded':
      return 'This game is on the server but could not be opened. Ask the person who runs the server. When they have put it right, reload this page.';
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
 * Why no order can be given to a unit right now, for a lasting reason:
 *   'offline'    -> 'No connection: orders have to wait.'
 *   'turnEnded'  -> 'You have ended your turn. Cancel that to give orders.'
 * The unit panel prints it where the greyed buttons are: at the top of the
 * job block of a unit that has one (ui/panelButtons.ts), in the hint at the
 * bottom for every other unit (unitHintParts).
 */
export function ordersClosedText(closed: OrdersClosed): string {
  return closed === 'offline' ? 'No connection: orders have to wait.' : 'You have ended your turn. Cancel that to give orders.';
}

/** The words of "Stop work" while it does not ask. */
export const STOP_LABEL = 'Stop work';

/**
 * The words of "Stop work" while it waits for its second press (round 3:
 * the button asks once before it throws work away). Short on purpose: the
 * button keeps its top and its right edge and grows to the left only, and
 * longer words ("Tap again to stop the work") left the small print beside
 * it too little room, so that the row grew under the finger.
 */
export const STOP_ASK = 'Tap again to stop';

/**
 * The small print beside "Stop work" (it replaces round 2's one fixed
 * sentence, "Stopping loses the work done so far."). It is about the
 * button, not about the job: "The work done so far is lost." read as news
 * of a loss. The numbers are the view's (UnitJobView.turnsWorked).
 *   no turn worked yet        -> 'Stopping now loses nothing.' (the button
 *                                does not ask then, whatever `asking` says)
 *   not asking, turns worked  -> 'Stopping loses 3 turns of work.',
 *                                'Stopping loses 1 turn of work.'
 *   asking                    -> '3 turns will be lost.', '1 turn will be
 *                                lost.' The short form: beside the wide
 *                                asking button the longer sentence took
 *                                three lines and the row changed its height.
 * The panel leaves it out while the button cannot be pressed
 * (ui/panelButtons.ts).
 *
 * @param asking  is the button waiting for its second press?
 */
export function stopWarningText(job: UnitJobView, asking: boolean): string {
  if (job.turnsWorked <= 0) return 'Stopping now loses nothing.';
  const turns = countOf(job.turnsWorked, 'turn', 'turns');
  return asking ? `${turns} will be lost.` : `Stopping loses ${turns} of work.`;
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
  if (!online) main = ordersClosedText('offline');
  else if (me !== undefined && me.endedTurn) main = ordersClosedText('turnEnded');
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

/** "Build Farm (4 turns)", "Build Farm (1 turn)", "Build Fishing Net (4 turns)". */
export function jobButtonText(option: JobOption): string {
  return `Build ${IMPROVEMENTS[option.improvement].name} (${countOf(option.turns, 'turn', 'turns')})`;
}

/**
 * Why a job button is greyed out, in words; null if it is not.
 *  'badImprovementTile' -> "A Farm needs open grassland, plains or desert.",
 *                          "A Fishing Net needs coast."
 *                          ("A <name> needs <IMPROVEMENTS[id].needs>.")
 *  'alreadyImproved'    -> "This tile already has a Farm."
 *  anything else        -> RULE_ERROR_MESSAGES[error] ("That can only be
 *                          built inside your own borders.")
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
 * least one option): "That can only be built inside your own borders.",
 * "Nothing can be built on the tile of a city." null otherwise; the panel
 * then puts each button's own reason under it. A Fishing Boat has one job,
 * so for it this is every case: "A Fishing Net needs coast.", "This tile
 * already has a Fishing Net."
 */
export function jobsReasonText(options: JobOption[]): string | null {
  if (options.length === 0) return null;
  const first = jobReasonText(options[0]);
  if (first === null) return null;
  return options.every((option) => jobReasonText(option) === first) ? first : null;
}

/** "Building a Farm: 3 turns left", "Building a Mine: 1 turn left", "Building a Fishing Net: 3 turns left". */
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

/**
 * "Food 4/16 (+2 per turn)"; with a surplus of 0 or less "Food 0/10 (+0 per
 * turn): not growing", "Food 6/22 (-2 per turn): not growing". The last
 * words are said under either way of placing citizens, whenever they are
 * true: they are how a player sees what "Build first" costs, and that a
 * city has reached the limit of its land.
 */
export function foodText(own: OwnCityDetail): string {
  const food = `Food ${own.foodStored}/${own.foodToGrow} (${signed(own.foodPerTurn)} per turn)`;
  return own.foodPerTurn <= 0 ? `${food}: not growing` : food;
}

/** The label of the pair of buttons "Grow first" / "Build first", for screen readers. */
export const FOCUS_GROUP_LABEL = "What this city's citizens put first";

/**
 * The last line of the city panel: what the gold tokens on the map are.
 * (Round 2 wrote it out in ui/cityPanel.ts and said the city "works" the
 * marked tiles; citizens gather, units work.)
 */
export const CITY_TILES_HINT = "Gold tokens on the map mark the tiles this city's citizens gather from.";

/**
 * The words for why something has no "in N turns" (lower case, no full stop:
 * callers put them into a sentence):
 *   needsPopulation -> 'the city must grow first'
 *   noRoom          -> 'no free tile for the unit' for a land unit,
 *                      'no free water tile for the boat' for a sea unit
 *   noProduction    -> 'this city makes no production'
 *   tooFar          -> 'more than 50 turns' (RULES.forecastTurns)
 *   earlier         -> 'after the item above'
 *
 * @param unitType  the type of the item that waits: the first entry of the
 *                  queue for OwnCityDetail.held, the row's entry, the
 *                  option's item. A boat appears on a water tile the city
 *                  owns, never on the city tile, so its 'noRoom' is about
 *                  water.
 */
export function buildWaitText(wait: BuildWait, unitType: UnitTypeId): string {
  switch (wait) {
    case 'needsPopulation':
      return 'the city must grow first';
    case 'noRoom':
      return UNITS[unitType].domain === 'sea' ? 'no free water tile for the boat' : 'no free tile for the unit';
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
 * build:" (was "Nothing to build."). What follows it in the same element is
 * productionNoteText, so that the two read as ONE sentence on one line:
 * "Nothing to build: production is lost." On a small phone the two
 * sentences of before took two lines, and the heading of the build list
 * lay under the panel's edge.
 */
export function productionText(own: OwnCityDetail): string {
  const first = own.buildQueue[0];
  if (first === undefined) return 'Nothing to build:';
  const name = UNITS[first.item.unitType].name;
  const rate = `${signed(own.productionPerTurn)} per turn`;
  const detail = first.turns === null ? rate : `${rate}, ${countOf(first.turns, 'turn', 'turns')}`;
  return `${name} ${own.productionStored}/${first.cost} (${detail})`;
}

/**
 * What follows the current build in the same element, or null:
 *   empty queue      -> "production is lost." (round 2's longer sentence
 *                       took two lines on a phone), or, with production saved,
 *                       "6 production are saved for the next item; what the
 *                       city makes meanwhile is lost." ("1 production is
 *                       saved ..."): the savings stay, and "saved" and
 *                       "lost" must not read as one. Both follow the colon
 *                       of productionText ("Nothing to build: ...")
 *   own.held is set  -> "Waiting: the city must grow first", "Waiting: no
 *                       free tile for the unit", "Waiting: no free water
 *                       tile for the boat" (buildWaitText with the unit
 *                       type of the first entry, which is the one that waits)
 *   otherwise        -> null (also for a first entry that has no number but
 *                       is not paid for yet)
 */
export function productionNoteText(own: OwnCityDetail): string | null {
  const first = own.buildQueue[0];
  if (first === undefined) {
    if (own.productionStored <= 0) return 'production is lost.';
    const saved = `${own.productionStored} production ${own.productionStored === 1 ? 'is' : 'are'} saved`;
    return `${saved} for the next item; what the city makes meanwhile is lost.`;
  }
  if (own.held !== null) return `Waiting: ${buildWaitText(own.held, first.item.unitType)}`;
  return null;
}

/**
 * The small line of a queue row. The number is the turn the item is READY
 * in, and the line says so: after a bare "now", "in 8 turns" read as the
 * turn the next item starts.
 *   index 0, a number   -> 'building now, ready in 4 turns', 'building now, ready in 1 turn'
 *   index > 0, a number -> 'ready in 8 turns'
 *   no number           -> buildWaitText(entry.wait, the row's unit type)
 *                          (every row, the first included; a boat's row
 *                          says 'no free water tile for the boat')
 * (A row with neither a number nor a reason, which the server never sends,
 * says what is true of every row: 'building now' for the first, 'after the
 * item above' for the others.)
 */
export function queueRowText(entry: QueueEntryView, index: number): string {
  if (entry.turns !== null) {
    const ready = `ready in ${countOf(entry.turns, 'turn', 'turns')}`;
    return index === 0 ? `building now, ${ready}` : ready;
  }
  if (entry.wait !== null) return buildWaitText(entry.wait, entry.item.unitType);
  return index === 0 ? 'building now' : buildWaitText('earlier', entry.item.unitType);
}

/**
 * The small line under the queue's title, shown while the queue has
 * entries. The x of a row carries its meaning only as a tooltip, which a
 * touch screen never shows; and the x of the first row is how a
 * construction is stopped. It has to be ONE line on the narrowest phone and
 * in the desktop panel (a test holds it to 60 characters; the end-to-end
 * test looks at its height on a 360 pixel phone).
 */
export const REMOVE_HINT = '× takes an item out. Saved production is kept.';

/** "Queue 3 of 8": the entries in the queue and RULES.maxQueueLength. Shown in the panel's head. */
export function queueCountText(own: OwnCityDetail): string {
  return `Queue ${own.buildQueue.length} of ${RULES.maxQueueLength}`;
}

/**
 * The line in the city panel's head, or null: a reason that holds for the
 * whole panel. (In the head, because the head stays in sight while the
 * panel scrolls: the sentence is on the screen whenever a greyed button
 * is.) First that applies:
 *   closed === 'offline'    -> 'No connection: this city cannot be changed right now.'
 *   closed === 'turnEnded'  -> 'You have ended your turn. Cancel that to change this city.'
 *   an option says 'queueFull' -> 'The build queue is full.' (RULE_ERROR_MESSAGES.queueFull)
 * The two sentences about closed orders say "this city", not "the queue":
 * they also stand for the greyed "Grow first" and "Build first" buttons.
 *
 * Only the reason that is about the QUEUE is printed here. A boat's
 * 'noWaterForBoat' stands inside its own add button (buildOptionText): it
 * lasts for as long as the city stands, and in the head it would be said of
 * every city without water for ever (it was, for a while, when this
 * function printed the first addError of the menu).
 */
export function queueNoteText(own: OwnCityDetail, closed: OrdersClosed | null): string | null {
  if (closed === 'offline') return 'No connection: this city cannot be changed right now.';
  if (closed === 'turnEnded') return 'You have ended your turn. Cancel that to change this city.';
  return own.buildOptions.some((option) => option.addError === 'queueFull') ? RULE_ERROR_MESSAGES.queueFull : null;
}

/** How full a progress bar is, from 0 to 1 (a total of zero counts as empty). */
export function progressFraction(stored: number, total: number | null): number {
  if (total === null || total <= 0) return 0;
  return Math.min(1, Math.max(0, stored / total));
}

/**
 * The middle line of a boat's add button in a city that owns no water (the
 * option's addError is 'noWaterForBoat'): the reason alone, without cost
 * and turns. It stands inside the button, so it is in view whenever the
 * grey button is, on a phone too.
 */
export const NEEDS_WATER = "needs water inside this city's borders";

/**
 * The longest middle line of an add button that was seen on ONE line in the
 * narrowest panel (282 pixels): 'costs 30, ready in 48 turns, uses 1
 * population'. A test holds every answer of buildOptionText to it.
 */
export const ADD_LINE_MAX = 46;

/**
 * The second (middle) line of an add button: what the item costs (in
 * production) and the turn it would be ready in if it were added now. ONE
 * line in every state, at most ADD_LINE_MAX characters: when the line of
 * the Settler took two, its button grew from 62 to 76 pixels at an answer,
 * every button under it moved down, and a second press on the same spot
 * queued another unit than the first. The first that applies:
 *   addError 'noWaterForBoat'    -> NEEDS_WATER alone
 *   a number of turns            -> 'costs 18, ready in 4 turns', 'costs 18, ready in 1 turn',
 *                                   'costs 30, ready in 18 turns, uses 1 population'
 *   wait null or 'earlier'       -> 'costs 18', 'costs 30, uses 1 population'
 *                                   ('earlier': the rows above already say why)
 *   any other wait               -> the reason in brackets, WITHOUT ', uses 1 population':
 *                                   'costs 30 (the city must grow first)', 'costs 18 (more than 50 turns)',
 *                                   'costs 20 (no free water tile for the boat)'
 *                                   (the Settler's third line already says "Takes one citizen.")
 * A full queue ('queueFull') changes nothing in this line: the head of the
 * panel says it (queueNoteText).
 */
export function buildOptionText(option: BuildOption): string {
  if (option.addError === 'noWaterForBoat') return NEEDS_WATER;
  const cost = `costs ${option.cost}`;
  const populationCost = UNITS[option.item.unitType].populationCost;
  const uses = populationCost > 0 ? `, uses ${populationCost} population` : '';
  if (option.turns !== null) return `${cost}, ready in ${countOf(option.turns, 'turn', 'turns')}${uses}`;
  if (option.wait === null || option.wait === 'earlier') return `${cost}${uses}`;
  return `${cost} (${buildWaitText(option.wait, option.item.unitType)})`;
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
 *     grow first", "Rome is waiting: no free water tile for the boat" (the
 *     reason is about the first entry of its queue), "2 cities are waiting
 *     to finish a unit";
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
  const own = waiting.length === 1 ? waiting[0].own : null;
  // citiesWaiting lists only cities that are held with a first entry: that entry is the unit that waits.
  if (own !== null && own.held !== null && own.buildQueue.length > 0) {
    hints.push(`${waiting[0].name} is waiting: ${buildWaitText(own.held, own.buildQueue[0].item.unitType)}`);
  } else if (waiting.length > 0) {
    hints.push(`${countOf(waiting.length, 'city is', 'cities are')} waiting to finish a unit`);
  }

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
