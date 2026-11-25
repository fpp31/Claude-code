/**
 * What the player's taps, clicks and keys MEAN (work package WP4).
 *
 * The controller reads the store, changes only the part of it that says
 * what is selected, inspected and hovered, and sends actions to the server.
 * It never changes game data itself: after sending an action it waits for
 * the server's view.
 *
 * It also holds five of the game screen's nine guards against a second
 * press on a spot that has changed its meaning, each with a clock handed
 * in: End Turn, the job guard, the selection guard, the map-move guard
 * and, since round 3, "Stop work" asking once (Controller.stopJob). The
 * other four are the build queue's and the End Turn key's
 * (ui/pressGuard.ts, ui/queuePresses.ts, input/keys.ts).
 */

import { pathTo } from '@domination/shared';
import type { Action, BuildItem, CityFocusId, CityId, ImprovementId, TileIndex, UnitView } from '@domination/shared';
import type { Connection } from '../net/connection';
import type { AppState, MapSelection, Store } from '../state/store';
import { createAskOnce } from '../ui/queuePresses';
import { queueUnchanged, queueWithAdded, queueWithMoved, queueWithout } from './queueEdits';
import {
  canActNow,
  citiesWaiting,
  citiesWithoutProduction,
  compareIds,
  idleUnits,
  myPlayer,
  ordersClosed,
  ownThingsAt,
  reachableFor,
  selectedCity,
  selectedUnit,
} from './selectors';
import type { OwnThing, ReachFunction } from './selectors';

/**
 * For this long after the End Turn button has changed its meaning, a press
 * of it is ignored (see Controller.toggleEndTurn).
 */
export const END_TURN_GUARD_MS = 600;

/** For this long after the selected unit's job appeared or went away, startJob and stopJob are ignored (see Controller.startJob). */
export const JOB_GUARD_MS = 600;

/**
 * For this long after the selection changed to another unit or city, the
 * order buttons of the panel that opened for it are ignored (see
 * Controller.foundCity).
 */
export const SELECTION_GUARD_MS = 500;

/**
 * For this long after the map moved by itself, a tap on the map gives no
 * order to a unit (see Controller.mapMovedByItself).
 */
export const MAP_MOVE_GUARD_MS = 500;

/**
 * What a press on "Stop work" did (see Controller.stopJob): the order went
 * out; the button now asks ("Tap again to stop"); or nothing happened.
 */
export type StopPress = 'sent' | 'asked' | 'ignored';

export interface Controller {
  /**
   * A tap or click on a map tile.
   *  1. A unit is selected and the tile is in its reachable set
   *     (reach(view, unit)). The first that applies:
   *       - the player cannot give orders for a lasting reason
   *         (ordersClosed(state): no connection, turn ended): this rule
   *         does not apply. Nothing is highlighted then, so the tile must
   *         behave like any other: go on with rules 2 and 3;
   *       - an action is in flight (state.busy): do NOTHING. The unit
   *         stays selected and rules 2 and 3 are skipped, so an impatient
   *         second tap never throws the selection away;
   *       - the map moved by itself less than MAP_MOVE_GUARD_MS ago (see
   *         mapMovedByItself): do NOTHING, as while busy. The tap was
   *         aimed at the map as it lay before the move;
   *       - otherwise: send `moveUnit` with pathTo(reach, tile); the unit
   *         stays selected and rules 2 and 3 are skipped.
   *     (A unit at work has no reachable tiles, so rule 1 never applies to
   *     it. A boat's reachable tiles are water only and a land unit's land
   *     only: a tap on land with a boat selected, or on water with a land
   *     unit, is never an order and goes on with rules 2 and 3.)
   *  2. Otherwise look at the player's own things on the tile (military
   *     unit, civilian unit, city, in that order): if the current selection
   *     is one of them select the next one (wrapping around), else select
   *     the first. Selecting closes the tile card (inspectedTile = null).
   *  3. Nothing of the player's there: clear the selection AND open the
   *     tile card for this tile (inspectedTile = tile). Any tile of the map
   *     can be inspected, also one the player has never seen (its card says
   *     "Unexplored"). Tapping the tile that is already inspected changes
   *     nothing, not even the store.
   * Rules 2 and 3 never send anything to the server.
   */
  onTileTap(tile: TileIndex): void;

  /**
   * The game screen says that the map has just moved BY ITSELF: it stepped
   * aside for a panel after a selection, because a panel grew, or because
   * the window changed its size (ui/gameScreen.ts).
   *
   * MAP-MOVE GUARD. When the map moves, another tile lies under the finger.
   * The second tap of a double tap on a unit near the edge of the map
   * landed on the tile beside it, and with the unit just selected that was
   * an order to walk there. So for MAP_MOVE_GUARD_MS after such a move, a
   * tap on a tile the selected unit could be sent to gives no order: it
   * does nothing at all (onTileTap, rule 1). Only orders are held back. A
   * tap that selects, or opens a tile card, changes nothing in the game
   * and counts at once, as do the buttons and the keys; and a move of the
   * map the player made (a drag, the wheel, the keys, "Show me") starts
   * nothing.
   */
  mapMovedByItself(): void;

  /** The mouse moved over a tile (null: it left the map). Updates hoverTile if it changed. */
  onTileHover(tile: TileIndex | null): void;

  /**
   * The hover timer (input/hoverInfo.ts) says which tile the hover box
   * describes now; null: no hover box. Updates hoverInfoTile if it changed.
   */
  onHoverInfo(tile: TileIndex | null): void;

  /**
   * True while a tap on the map can send a unit somewhere: one of the
   * player's units is selected, canActNow(state), and the unit can reach at
   * least one tile (reach(view, unit) is not empty). The hover timer then
   * waits its full delay for every box, so that no box hops about over the
   * tiles the unit is being sent to. A unit without moves and a unit at
   * work light no tile and can be sent nowhere: with one of them selected
   * the answer is false, and the boxes come as quickly as with nothing
   * selected.
   */
  isAiming(): boolean;

  /**
   * Found City button / F key: send `foundCity` for the selected unit, if
   * its `own.foundCityError` is null.
   *
   * SELECTION GUARD. A panel opens where the lower left of the map was a
   * moment ago, and on a phone where the tapped unit itself stood. The
   * second tap of a double tap on a unit would land on the button that came
   * up there: a city founded for good, a job stopped and its work lost, an
   * item queued. So the controller watches the store: whenever the
   * selection goes to ANOTHER unit or city (also from nothing to
   * something), it notes the time, and for SELECTION_GUARD_MS after that
   * moment the order buttons of the panels do nothing: Found City, the job
   * buttons, "Stop work" (both its presses), every queue button, the add
   * buttons too, and "Grow first" / "Build first". A press that is ignored
   * for this reason gives no order and no message.
   * Map taps, End Turn and the F key are not held back: none of them is a
   * button that came up under the pointer.
   *
   * @param from  'key' for the F key, which the selection guard does not
   *              hold back; left out for the button
   */
  foundCity(from?: 'button' | 'key'): void;

  /**
   * City panel, the four ways to change the selected city's build queue.
   * Each takes the queue from the current view (city.own.buildQueue), makes
   * the wanted list (game/queueEdits.ts) and sends ONE `setBuildQueue`.
   * Nothing is sent without a selected own city, when the edit makes no
   * sense (no such row, a full queue, an empty queue to empty), when
   * canActNow(state) is false (busy, offline, turn ended), or within
   * SELECTION_GUARD_MS of the city being selected (see foundCity).
   *
   * ADDS WAIT. One action is in flight at a time, and on an ordinary
   * internet link the answer takes longer than a quick second tap. So while
   * the answer to a queue edit OF THE SAME CITY is on its way, addToQueue
   * keeps the item instead of dropping the press. When the answer has come
   * and the view shows the list that was sent, everything that was kept
   * goes out in one message, on top of that list (and a press during THAT
   * round trip waits in the same way). An add button pressed while the
   * answer to a "Grow first" / "Build first" press of the same city is on
   * its way waits in the same way (see setCityFocus). What waits is
   * dropped when the answer was a refusal (the view does not show the list
   * that was sent), when the selection has moved away from that city, when
   * the connection is lost and when the turn is ended. The limit of the
   * queue counts what is on its way and what waits. A press on a ROW
   * button during that time is ignored as before: the rows on the screen
   * are one answer behind, so it would hit another entry than the one it
   * was aimed at. End Turn pressed during that time waits as well (see
   * toggleEndTurn), and what waits here is sent in the very moment the
   * answer is taken in, so End Turn can never overtake it.
   *
   * The item of an add button may be a boat. The controller does not look
   * at the option's addError: the city panel greys the button of a boat
   * that a city without water can never build, and the server refuses such
   * a queue ('noWaterForBoat').
   *
   * Each returns true if a message went out (addToQueue also when it kept
   * the item to send it after the answer), false if not: the city panel's
   * press guards start their time only for a press that went out
   * (ui/pressGuard.ts).
   */
  addToQueue(item: BuildItem): boolean;
  removeFromQueue(index: number): boolean;
  moveInQueue(index: number, direction: -1 | 1): boolean;
  clearQueue(): boolean;

  /**
   * Unit panel, a job button: send `startJob` for the selected unit and this
   * improvement, if the unit's job option for it has `error === null`.
   *
   * GUARD. "Build Mine" and "Stop work" appear in the same spot of the
   * panel, one after the other, and swap the moment the server answers. A
   * double-click would start the job and stop it again. So the controller
   * watches the store: whenever the SAME selected unit goes from "no job"
   * to "has a job" or back, it notes the time, and startJob and stopJob
   * called within JOB_GUARD_MS of that moment do nothing. (The pattern of
   * toggleEndTurn. Selecting another unit does not start this guard; it
   * starts the selection guard, see foundCity, which holds both back too.)
   */
  startJob(improvement: ImprovementId): void;

  /**
   * City panel, "Grow first" / "Build first": send `setCityFocus` for the
   * selected own city. Nothing is sent, and false is returned, when the
   * city already has this focus (two buttons, each meaning one thing: a
   * double-click cannot undo itself), when canActNow(state) is false (busy,
   * offline, turn ended), or within SELECTION_GUARD_MS of the city being
   * selected (see foundCity). A press that is not sent is NOT kept for
   * later: the button does not sink, which shows at once, and the player
   * presses again. That is the rule for every order but the two that are
   * kept (an add button, End Turn).
   *
   * ADDS WAIT BEHIND IT. When the message went out, add buttons pressed
   * before its answer is in are kept exactly as behind a queue edit (see
   * addToQueue): the controller notes the city and its queue as the view
   * shows it, as if that list had been sent. addToQueue then keeps the
   * presses, and they go out in ONE `setBuildQueue` when the answer is in:
   * the view's queue still equals the noted one, because a focus changes
   * no queue. (Dropped, such a press gave no sign: the button did not even
   * say "Added to the queue".) They are dropped by the rules of addToQueue:
   * the player turned to another city or closed the panel, the connection
   * was lost, the turn was ended, or the queue on the screen is no longer
   * the noted one. If the focus press itself was refused and the queue is
   * still the same, the kept adds are sent all the same: they are orders
   * of their own, and the server answers them.
   *
   * Returns true if the message went out.
   */
  setCityFocus(focus: CityFocusId): boolean;

  /**
   * Unit panel, "Stop work": stop the selected unit's job. The button ASKS
   * ONCE before it throws work away. The first that applies:
   *  - no selected own unit with a job; orders closed (no connection, turn
   *    ended: the button is grey); within JOB_GUARD_MS of the job
   *    appearing or going (see startJob) or within SELECTION_GUARD_MS of
   *    the selection (see foundCity): 'ignored'. Nothing is asked in that
   *    time either: a double tap on the unit can neither stop the work nor
   *    start the question;
   *  - the job has no turn worked yet (turnsWorked 0): `stopJob` is sent at
   *    once, nothing would be lost. 'sent', or 'ignored' if the message
   *    could not go out (an answer is on its way);
   *  - otherwise the press is put to a button that asks once (createAskOnce
   *    in ui/queuePresses.ts, the function of "Empty the queue") with the
   *    subject `<unit id>:<improvement>:<turnsWorked>`:
   *      'ask'    -> 'asked': the button now waits for its second press,
   *                  for ASKS_FOR_MS (4 s). Nothing is sent;
   *      'ignore' -> 'ignored': it asked less than 0.6 s ago; this is the
   *                  second click of a double-click;
   *      'go'     -> `stopJob` is sent and the question is taken back
   *                  ('sent'); if the message could not go out, the
   *                  question stands and the next press sends ('ignored').
   * The question is about one job at one count of turns: after a turn has
   * been worked it is another question, and the button asks again with the
   * new number. It is also taken back whenever the selection changes
   * (another unit, a city, nothing) and whenever orders close.
   */
  stopJob(): StopPress;

  /**
   * Is "Stop work" of the selected unit waiting for its second press right
   * now? The unit panel asks whenever it prints the button
   * (unitPanelButtons in ui/panelButtons.ts takes the answer). False
   * without a selected own unit at work and while orders are closed. The
   * question ends by time alone (ASKS_FOR_MS after it was asked) with no
   * change of the store: the page keeps a timer that prints the panel
   * again then.
   */
  askingToStop(): boolean;

  /**
   * End Turn button / Enter key: send `endTurn`, or `cancelEndTurn` if the
   * player has already ended the turn (view.players says so).
   *
   * DOUBLE-PRESS GUARD. One control means two opposite things, and its
   * meaning flips the moment the server answers (a few milliseconds on a
   * local network). Without a guard a double-click sends "end" and then
   * "cancel", and for the last player to end it would end the NEXT turn too.
   * So: the controller watches the store, and whenever the player's own
   * `endedTurn` or `view.turn` changes it notes the time; a call within
   * END_TURN_GUARD_MS of that moment does nothing. (`busy` alone is not
   * enough: it only covers the round trip.)
   *
   * END TURN WAITS. The button is not grey for the blink of a round trip,
   * and on a slow link that blink is long enough to press it in: a press
   * that was simply dropped looked as if the game had not heard. So ONE
   * press made while the answer to another action is on its way is kept,
   * and sent when the answers are in: after the adds that wait (see
   * addToQueue) and their answers. The kept press is dropped
   *  - when an answer that came meanwhile was a refusal (`refusals` in the
   *    store went up): the turn must not end on top of an order that did
   *    not happen;
   *  - when the adds that waited in front of it are dropped (the player
   *    turned to another city, or closed the panel): the press was made
   *    after them, and would end the turn without them. With no add
   *    waiting, the selection does not matter to End Turn;
   *  - when the button has changed its meaning meanwhile (the turn is
   *    another one, or the player's `endedTurn` flipped in another tab);
   *  - when the connection is lost, or the game is gone.
   * A second press while one waits takes the waiting one back: a
   * double-click in that blink leaves the turn open, and so does a change
   * of mind. A press made while the answer to End Turn or Cancel ITSELF is
   * on its way is ignored as before: that is the second click of a
   * double-click on the button.
   */
  toggleEndTurn(): void;

  /** Escape key (when no hover box is showing) and every panel's close button: clear the selection and close the tile card. */
  deselect(): void;

  /**
   * N key: select the next own unit with moves left (by id, after the
   * current one) and return its tile, or null if none. It selects, so it
   * closes the tile card. A unit at work is passed by (idleUnits).
   */
  selectNextIdleUnit(): TileIndex | null;

  /**
   * "Show me" button: select the next thing that still needs the player
   * this turn and return its tile, or null if nothing does. Cities with
   * nothing to build come first (by id), then cities that wait with no end
   * in sight (citiesWaiting, by id), then units with moves left and no job
   * (by id); pressing again goes on to the one after the current selection,
   * wrapping around. It selects, so it closes the tile card.
   */
  selectNextTask(): TileIndex | null;

  /** Stops watching the store. Called when the game screen is unmounted. */
  destroy(): void;
}

/** Things tests replace. The app passes nothing. */
export interface ControllerOptions {
  /** How to find the tiles a unit can reach. Default: reachableFor (game/selectors.ts). */
  reach?: ReachFunction;
  /** The clock for the End Turn guard, the job guard, the selection guard, the map-move guard and the question of "Stop work", in milliseconds. Default: Date.now. */
  now?: () => number;
}

/**
 * Every action is sent as `{ type: 'action', requestId, turn: view.turn,
 * action }` with a fresh increasing requestId. Nothing is sent while `busy`
 * is set or while the connection is not 'online': the request is dropped
 * with no queueing (the player simply taps again). Two exceptions: a
 * press on an add button of the build queue waits for the answer to an
 * edit of the same queue, or to a "Grow first" / "Build first" press of
 * the same city (see Controller.addToQueue and Controller.setCityFocus),
 * and one press on End Turn waits until the answers are in (see
 * Controller.toggleEndTurn).
 *
 * `busy` is set ONLY if connection.send returned true, and stays set until
 * the answer arrives (see serverMessages.ts). If send returned false (the
 * socket just dropped, or demo mode's dummy connection) nothing happens and
 * nothing can get stuck.
 */
export function createController(store: Store, connection: Connection, options: ControllerOptions = {}): Controller {
  const reach = options.reach ?? reachableFor;
  const now = options.now ?? Date.now;

  let nextRequestId = 1;

  // ---- The End Turn guard ---------------------------------------------------
  // What the End Turn button means is decided by two facts: has the player
  // ended this turn, and which turn is it. Whenever either changes, the time
  // is noted (see toggleEndTurn).
  let watched = endTurnFacts(store.get());
  let meaningChangedAt = Number.NEGATIVE_INFINITY;

  // ---- The job guard --------------------------------------------------------
  // "Build Mine" and "Stop work" take turns in one spot of the unit panel.
  // Whenever the selected unit's job appears or goes away while that unit
  // stays selected, the time is noted (see startJob).
  let watchedJob = jobFacts(store.get());
  let jobChangedAt = Number.NEGATIVE_INFINITY;

  // ---- The selection guard --------------------------------------------------
  // A panel that opens can come up under the finger that selected its
  // subject. Whenever the selection goes to another unit or city (also from
  // nothing to something), the time is noted (see foundCity).
  let watchedSelection = selectionKey(store.get().selection);
  let selectionChangedAt = Number.NEGATIVE_INFINITY;

  // ---- The map-move guard ---------------------------------------------------
  // When the game screen last said that the map moved by itself (see mapMovedByItself).
  let mapMovedAt = Number.NEGATIVE_INFINITY;

  /** Has the panel of the selected thing only just opened? Its order buttons do nothing then. */
  function panelJustOpened(): boolean {
    return now() - selectionChangedAt < SELECTION_GUARD_MS;
  }

  // ---- "Stop work" asks once -------------------------------------------------
  // The question of the selected unit's "Stop work" button (see stopJob). It
  // lives here and not in the store, like the other guards with a clock.
  const askToStop = createAskOnce(now);

  // ---- Adds that wait -------------------------------------------------------
  // The queue edit whose answer is on its way (the city, and the list that
  // was sent), and the items of the add buttons pressed since, oldest first
  // (see addToQueue). After a "Grow first" / "Build first" press it is the
  // city's queue as the view showed it: that press changes no queue (see
  // setCityFocus).
  let sentQueue: { cityId: CityId; queue: BuildItem[] } | null = null;
  let waitingAdds: BuildItem[] = [];

  // ---- An End Turn that waits ------------------------------------------------
  // The kind of the action whose answer is on its way (null: none), and the
  // one press on End Turn made since: what the button meant at that moment,
  // and how many refusals the store had counted (see toggleEndTurn).
  let inFlight: Action['type'] | null = null;
  let waitingEndTurn: { ended: boolean; turn: number; refusals: number } | null = null;

  /**
   * Looks after the adds that wait, at every change of the store: drops
   * them when they can no longer be meant, and sends them when the answer
   * they waited for has come. An End Turn that waits behind adds that are
   * dropped is dropped with them.
   */
  function watchWaitingAdds(state: AppState): void {
    if (sentQueue === null) return;
    const city = selectedCity(state);
    if (state.connection !== 'online' || city === null || city.id !== sentQueue.cityId) {
      // No connection, or the player has turned to something else.
      if (waitingAdds.length > 0) waitingEndTurn = null;
      sentQueue = null;
      waitingAdds = [];
      return;
    }
    if (state.busy) return; // the answer is still on its way
    const sent = sentQueue;
    const adds = waitingAdds;
    sentQueue = null;
    waitingAdds = [];
    if (adds.length === 0) return;
    // Accepted means: the view shows the list that was sent (the view comes
    // before the acknowledgement). Anything else is a refusal, or a world
    // that changed in a way nobody here foresaw: what waited is dropped.
    const accepted = city.own !== null && ordersClosed(state) === null && sameItems(city.own.buildQueue.map((entry) => entry.item), sent.queue);
    const queue = [...sent.queue, ...adds];
    if (accepted && sendAction({ type: 'setBuildQueue', cityId: sent.cityId, queue })) sentQueue = { cityId: sent.cityId, queue };
    else waitingEndTurn = null;
  }

  /**
   * Looks after the End Turn that waits, at every change of the store and
   * after the adds: drops it when it can no longer be meant, and sends it
   * when every answer is in (see toggleEndTurn).
   */
  function watchWaitingEndTurn(): void {
    if (waitingEndTurn === null) return;
    const state = store.get(); // read afresh: the adds that waited may have gone out just now
    const facts = endTurnFacts(state);
    const stillMeant =
      state.connection === 'online' &&
      state.refusals === waitingEndTurn.refusals &&
      facts.ended === waitingEndTurn.ended &&
      facts.turn === waitingEndTurn.turn;
    if (!stillMeant) {
      waitingEndTurn = null;
      return;
    }
    if (state.busy) return; // an answer is still on its way
    const kept = waitingEndTurn;
    waitingEndTurn = null;
    sendAction({ type: kept.ended ? 'cancelEndTurn' : 'endTurn' });
  }

  const stopWatching = store.subscribe((state) => {
    const facts = endTurnFacts(state);
    if (facts.ended !== watched.ended || facts.turn !== watched.turn) meaningChangedAt = now();
    watched = facts;

    const job = jobFacts(state);
    if (job.unitId !== null && job.unitId === watchedJob.unitId && job.hasJob !== watchedJob.hasJob) jobChangedAt = now();
    watchedJob = job;

    const selection = selectionKey(state.selection);
    if (selection !== null && selection !== watchedSelection) selectionChangedAt = now();
    // The question of "Stop work" is over when the selection changes at all
    // (to nothing too: the panel closed) and when orders close. (`facts` is
    // read without myPlayer, so this watcher cannot throw.)
    if (selection !== watchedSelection || state.connection !== 'online' || facts.ended === true) askToStop.reset();
    watchedSelection = selection;

    if (!state.busy) inFlight = null;
    watchWaitingAdds(state);
    watchWaitingEndTurn();
  });

  /**
   * Sends one game action, unless one is already in flight or there is no
   * connection. Returns true if a message went out, false if not.
   */
  function sendAction(action: Action): boolean {
    const state = store.get();
    if (state.game === null || state.busy || state.connection !== 'online') return false;
    const sent = connection.send({ type: 'action', requestId: nextRequestId, turn: state.game.view.turn, action });
    if (!sent) return false;
    nextRequestId += 1;
    inFlight = action.type;
    store.set({ busy: true });
    return true;
  }

  /** Selects (or, with null, deselects). Always closes the tile card. */
  function select(selection: MapSelection | null): void {
    const state = store.get();
    if (sameSelection(state.selection, selection) && state.inspectedTile === null) return;
    store.set({ selection, inspectedTile: null });
  }

  /** Opens the tile card for a tile. Always clears the selection. */
  function inspect(tile: TileIndex): void {
    const state = store.get();
    if (state.selection === null && state.inspectedTile === tile) return;
    store.set({ selection: null, inspectedTile: tile });
  }

  /** Selects the entry after the current selection in `things` (the first one if the selection is not among them). */
  function selectAfterCurrent(things: OwnThing[]): TileIndex | null {
    if (things.length === 0) return null;
    const current = store.get().selection;
    const index = things.findIndex((thing) => sameSelection(selectionOf(thing), current));
    const next = things[(index + 1) % things.length];
    select(selectionOf(next));
    return next.kind === 'unit' ? next.unit.tile : next.city.tile;
  }

  /**
   * The one way a build queue is changed: takes the selected own city's
   * queue as the view shows it, lets `edit` make the wanted list, and sends
   * it. Nothing is sent, and false is returned, when the player cannot act
   * right now, when no own city is selected, or when `edit` answers null
   * (the edit makes no sense).
   */
  function sendQueue(edit: (queue: BuildItem[]) => BuildItem[] | null): boolean {
    const state = store.get();
    if (!canActNow(state) || panelJustOpened()) return false;
    const city = selectedCity(state);
    if (city === null || city.own === null) return false;
    const queue = edit(city.own.buildQueue.map((entry) => entry.item));
    if (queue === null) return false;
    if (!sendAction({ type: 'setBuildQueue', cityId: city.id, queue })) return false;
    sentQueue = { cityId: city.id, queue };
    waitingAdds = [];
    return true;
  }

  /**
   * An add button was pressed while the answer to a queue edit of the same
   * city is on its way: keeps the item (see addToQueue). False if it cannot
   * be kept: the queue would be too long with it.
   */
  function keepAdd(sent: BuildItem[], item: BuildItem): boolean {
    const longer = queueWithAdded([...sent, ...waitingAdds], item);
    if (longer === null) return false;
    waitingAdds.push(longer[longer.length - 1]);
    return true;
  }

  return {
    onTileTap(tile) {
      const state = store.get();
      if (state.game === null) return;
      const view = state.game.view;

      // 1. A tap on a tile the selected unit can reach is an order to go
      //    there, unless orders are closed for a lasting reason: nothing is
      //    highlighted then, and the tile behaves like any other.
      const unit = selectedUnit(state);
      if (unit !== null && ordersClosed(state) === null) {
        const reachMap = reach(view, unit);
        if (reachMap.has(tile)) {
          if (state.busy) return; // the answer to the last order is on its way
          if (now() - mapMovedAt < MAP_MOVE_GUARD_MS) return; // the map has just moved under the finger
          const path = pathTo(reachMap, tile);
          if (path !== null) sendAction({ type: 'moveUnit', unitId: unit.id, path });
          return;
        }
      }

      // 2. and 3. Otherwise the tap selects what the player owns there, or opens the tile's card.
      const things = ownThingsAt(view, tile);
      if (things.length === 0) inspect(tile);
      else selectAfterCurrent(things);
    },

    mapMovedByItself() {
      mapMovedAt = now();
    },

    onTileHover(tile) {
      if (store.get().hoverTile !== tile) store.set({ hoverTile: tile });
    },

    onHoverInfo(tile) {
      if (store.get().hoverInfoTile !== tile) store.set({ hoverInfoTile: tile });
    },

    isAiming() {
      const state = store.get();
      const unit = selectedUnit(state);
      if (state.game === null || unit === null || !canActNow(state)) return false;
      return reach(state.game.view, unit).size > 0;
    },

    foundCity(from = 'button') {
      const unit = selectedUnit(store.get());
      if (unit === null || unit.own === null || unit.own.foundCityError !== null) return;
      if (from === 'button' && panelJustOpened()) return;
      sendAction({ type: 'foundCity', unitId: unit.id });
    },

    addToQueue(item) {
      const state = store.get();
      const city = selectedCity(state);
      if (state.busy && sentQueue !== null && city !== null && city.id === sentQueue.cityId) {
        // The answer to an edit of this city's queue is on its way: the press waits for it.
        if (ordersClosed(state) !== null || panelJustOpened()) return false;
        return keepAdd(sentQueue.queue, item);
      }
      return sendQueue((queue) => queueWithAdded(queue, item));
    },

    removeFromQueue(index) {
      return sendQueue((queue) => queueWithout(queue, index));
    },

    moveInQueue(index, direction) {
      return sendQueue((queue) => queueWithMoved(queue, index, direction));
    },

    clearQueue() {
      // An empty queue has nothing to empty.
      return sendQueue((queue) => (queue.length === 0 ? null : []));
    },

    startJob(improvement) {
      const unit = selectedUnit(store.get());
      if (unit === null || unit.own === null) return;
      const option = unit.own.jobOptions.find((candidate) => candidate.improvement === improvement);
      if (option === undefined || option.error !== null) return;
      if (now() - jobChangedAt < JOB_GUARD_MS || panelJustOpened()) return;
      sendAction({ type: 'startJob', unitId: unit.id, improvement });
    },

    setCityFocus(focus) {
      const state = store.get();
      if (!canActNow(state) || panelJustOpened()) return false;
      const city = selectedCity(state);
      if (city === null || city.own === null || city.own.focus === focus) return false;
      if (!sendAction({ type: 'setCityFocus', cityId: city.id, focus })) return false;
      // An add button pressed before the answer is in waits behind this
      // press as behind a queue edit: the "list that was sent" is the queue
      // as it stands, which this press does not change.
      sentQueue = { cityId: city.id, queue: queueUnchanged(city.own.buildQueue.map((entry) => entry.item)) };
      waitingAdds = [];
      return true;
    },

    stopJob() {
      const state = store.get();
      const unit = selectedUnit(state);
      if (unit === null || unit.own === null || unit.own.job === null) return 'ignored';
      if (ordersClosed(state) !== null) return 'ignored'; // the button is grey: nothing is stopped and nothing is asked
      // The two guards come first: a press inside them is not the question either.
      if (now() - jobChangedAt < JOB_GUARD_MS || panelJustOpened()) return 'ignored';
      const stop: Action = { type: 'stopJob', unitId: unit.id };
      // Nothing worked yet, nothing to lose: no question.
      if (unit.own.job.turnsWorked <= 0) return sendAction(stop) ? 'sent' : 'ignored';
      const press = askToStop.press(stopSubject(unit));
      if (press === 'ask') return 'asked';
      if (press === 'ignore') return 'ignored';
      // The answer. If the message cannot go out now (an answer is on its
      // way), the question stands: the next press sends.
      if (!sendAction(stop)) return 'ignored';
      askToStop.reset();
      return 'sent';
    },

    askingToStop() {
      const state = store.get();
      const unit = selectedUnit(state);
      if (unit === null || unit.own === null || unit.own.job === null || ordersClosed(state) !== null) return false;
      return askToStop.asking(stopSubject(unit));
    },

    toggleEndTurn() {
      const state = store.get();
      if (state.game === null) return;
      if (now() - meaningChangedAt < END_TURN_GUARD_MS) return;
      const ended = myPlayer(state.game.view).endedTurn;
      if (state.busy && state.connection === 'online' && inFlight !== null) {
        // An answer is on its way. A second press takes the press that waits back.
        if (waitingEndTurn !== null) waitingEndTurn = null;
        // Behind End Turn or Cancel itself nothing waits: that is the second click of a double-click.
        else if (inFlight !== 'endTurn' && inFlight !== 'cancelEndTurn') waitingEndTurn = { ended, turn: state.game.view.turn, refusals: state.refusals };
        return;
      }
      sendAction({ type: ended ? 'cancelEndTurn' : 'endTurn' });
    },

    deselect() {
      select(null);
    },

    selectNextIdleUnit() {
      const state = store.get();
      if (state.game === null) return null;
      const idle = idleUnits(state.game.view);
      if (idle.length === 0) return null;
      // "After the current one" goes by id even when the selected unit itself
      // has no moves left, so N always walks through the units in one order.
      const currentId = state.selection !== null && state.selection.kind === 'unit' ? state.selection.unitId : null;
      const after = currentId === null ? undefined : idle.find((unit) => compareIds(unit.id, currentId) > 0);
      const next = after ?? idle[0];
      select({ kind: 'unit', unitId: next.id });
      return next.tile;
    },

    selectNextTask() {
      const game = store.get().game;
      if (game === null) return null;
      const idleCities: OwnThing[] = citiesWithoutProduction(game.view).map((city) => ({ kind: 'city', city }));
      const waitingCities: OwnThing[] = citiesWaiting(game.view).map((city) => ({ kind: 'city', city }));
      const units: OwnThing[] = idleUnits(game.view).map((unit) => ({ kind: 'unit', unit }));
      return selectAfterCurrent([...idleCities, ...waitingCities, ...units]);
    },

    destroy() {
      stopWatching();
    },
  };
}

/** The two facts that decide what the End Turn button means (both null outside a game). */
function endTurnFacts(state: AppState): { ended: boolean | null; turn: number | null } {
  if (state.game === null) return { ended: null, turn: null };
  const view = state.game.view;
  // Read straight from the list: a view without its own player must not make
  // this watcher (and with it every store update) throw.
  const me = view.players.find((player) => player.id === view.you);
  return { ended: me?.endedTurn ?? null, turn: view.turn };
}

/**
 * The two facts the job guard watches: which unit is selected (null: none,
 * or it is gone from the view) and whether it has a job. Read straight from
 * the state, so that it cannot make the store's watcher throw.
 */
function jobFacts(state: AppState): { unitId: string | null; hasJob: boolean } {
  const unit = selectedUnit(state);
  if (unit === null) return { unitId: null, hasJob: false };
  return { unitId: unit.id, hasJob: unit.own !== null && unit.own.job !== null };
}

/**
 * What the question of "Stop work" is about, as one string: the unit, what
 * it builds and how many turns it has worked ('u1_m4wq7e:farm:3'). A turn
 * later it is another subject, so the button asks again with the new
 * number; '' for a unit without a job, which is never asked about.
 */
function stopSubject(unit: UnitView): string {
  const job = unit.own?.job ?? null;
  return job === null ? '' : `${unit.id}:${job.improvement}:${job.turnsWorked}`;
}

/** What is selected, as one string ('unit:u1_k7m2qd', 'city:c1_r6wz2e'); null for nothing. For the selection guard. */
function selectionKey(selection: MapSelection | null): string | null {
  if (selection === null) return null;
  return selection.kind === 'unit' ? `unit:${selection.unitId}` : `city:${selection.cityId}`;
}

/** Are the two lists the same items in the same order? */
function sameItems(a: readonly BuildItem[], b: readonly BuildItem[]): boolean {
  return a.length === b.length && a.every((item, index) => item.kind === b[index].kind && item.unitType === b[index].unitType);
}

function selectionOf(thing: OwnThing): MapSelection {
  return thing.kind === 'unit' ? { kind: 'unit', unitId: thing.unit.id } : { kind: 'city', cityId: thing.city.id };
}

function sameSelection(a: MapSelection | null, b: MapSelection | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'unit') return b.kind === 'unit' && a.unitId === b.unitId;
  return b.kind === 'city' && a.cityId === b.cityId;
}
