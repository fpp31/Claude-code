/**
 * What each server message does to the store (work package WP4).
 *
 * This module runs in the unit tests, in plain Node, where there is no
 * window, address bar or storage. It therefore never touches `location`,
 * `history`, localStorage or sessionStorage itself: it calls the functions
 * of net/identity.ts, which are safe to call anywhere.
 */

import { IMPROVEMENTS, UNITS, applyViewPatch } from '@domination/shared';
import type { ClientMessage, GameEvent, PlayerView, ServerMessage } from '@domination/shared';
import { loadLastGame, reloadPageOnce, saveLastGame, setGameCodeInUrl } from '../net/identity';
import { toastsWith } from '../ui/toasts';
import type { NewToast } from '../ui/toasts';
import { JOIN_PROBLEMS } from './store';
import type { AppState, JoinProblem, MapSelection, Store } from './store';

/** Shown instead of the whole app when reloading did not cure a version mismatch. */
export const VERSION_MISMATCH_MESSAGE =
  'This page and the game server are not the same version. Reload the page to get the newest one. ' +
  'If you see this again, the server is still being updated: wait a minute and reload once more.';

/** Shown when the server asks a page for a name although it was showing that very game: its seat there is gone. */
export const NO_LONGER_IN_GAME_MESSAGE = 'You are no longer in this game. Press Join to take a seat in it again.';

/** Shown when a Leave pressed in the lobby arrived after the game had started (the seat is kept, the page goes back in). */
export const STARTED_BEFORE_LEAVE_MESSAGE = 'The game started before you could leave, so you are still in it.';

/** The answers to `joinGame` that mean "you are not in that game" (see "Refused while in a game" below). */
const REJOIN_REFUSALS: readonly string[] = ['noSuchGame', 'nameRequired', 'gameAlreadyStarted', 'gameFull'];

/**
 * Applies one message from the server. `send` is used for the rare replies
 * the protocol itself requires (`resync`, and `joinGame` after a `left`
 * that arrived during a game).
 *
 *  welcome         nothing. (The connection module has already stored the
 *                  token; see net/connection.ts.)
 *  lobby           lobby = message.lobby, game = null, joining = null,
 *                  joinProblem = null, and the four things that belong to a
 *                  map, which a lobby has not ("the map's four" below):
 *                  selection, inspectedTile, hoverTile, hoverInfoTile =
 *                  null; put the code in the address bar (setGameCodeInUrl)
 *                  and remember it as the last game (saveLastGame).
 *  gameSync        game = { code, view, connected, seq, awaitingSync: false },
 *                  lobby = null, joining = null, joinProblem = null, busy =
 *                  false; address bar
 *                  and last game as for `lobby`; re-validate the selection
 *                  and keep the tile card and the hover box (for ANOTHER
 *                  game than the one on screen: the map's four = null, it
 *                  is another map); toast the events.
 *  gameUpdate      ignored completely while game.awaitingSync is set (or
 *                  there is no game). If message.seq !== game.seq + 1 (a
 *                  missed update): change nothing except awaitingSync =
 *                  true, and send `resync` (once: the flag stops repeats).
 *                  Otherwise view = applyViewPatch(view, patch), seq =
 *                  message.seq; re-validate the selection; toast the events.
 *                  The tile card and the hover box stay as they are: they
 *                  are tile numbers, and what they say is worked out from
 *                  the new view.
 *  presence        game.connected = message.connected.
 *  actionOk        busy = false.
 *  actionRejected  busy = false; error toast with error.message.
 *  left            lobby = null, game = null, the map's four = null,
 *                  joining = null, joinProblem = null, busy = false;
 *                  remove ?g= from the address bar. If a lobby was on
 *                  screen, the remembered last game is forgotten too: the
 *                  player has just said they are done with it, and the home
 *                  screen must not offer it again as the next thing to join.
 *                  ONE EXCEPTION: while a GAME is on screen, `left` changes
 *                  nothing; the page asks to be let back in (`joinGame`,
 *                  name null) and says why in a toast. See "left during a
 *                  game" below.
 *  error           busy = false, joining = null; error toast with the
 *                  message, except:
 *                  'protocolMismatch': reloadPageOnce(); if it returns false
 *                  (already reloaded once) set fatalMessage instead;
 *                  'noSuchGame' also clears ?g= so the home screen shows,
 *                  and, if it was the page's own automatic rejoin that
 *                  failed, forgets the remembered last game (a mistyped
 *                  code does not);
 *                  'nameRequired' shows no toast (the home screen, with the
 *                  code already filled in, asks for the name), and clears
 *                  joinProblem (the game can be joined).
 *                  'noSuchGame', 'gameAlreadyStarted' and 'gameFull' also
 *                  set joinProblem to that code: a toast is gone after a
 *                  few seconds, and the home screen must go on saying why
 *                  the game it names cannot be joined.
 *                  Each of these four, arriving while a lobby or a game is
 *                  on screen, also takes that screen down (lobby = null,
 *                  game = null, the map's four = null). See "refused while
 *                  in a game" below.
 *  pong            nothing (the connection module tracks liveness).
 *
 * Refused while in a game. 'noSuchGame', 'nameRequired', 'gameAlreadyStarted'
 * and 'gameFull' are answers to `joinGame` only, and a page that shows a
 * lobby or a game sends `joinGame` only to get back in after a new
 * connection (rejoin in ui/app.ts). So one of them arriving there means
 * that the server no longer has this page in that game: the save was
 * deleted or could not be loaded, the seat was freed by hand, or a Leave
 * went through just before the connection dropped. The old lobby or game
 * must not stay up as if nothing had happened, with "online" in the corner
 * and every button answered "You are not in a game": the home screen
 * appears, with the reason. ('nameRequired', which has no toast of its own,
 * gets one here: the home screen invites the player to join that game, and
 * without a word they could not know why they are being asked.)
 *
 * `left` during a game. The game screen has no Leave button, and the
 * server answers `left` only to the socket that asked. So `left` with a
 * game on screen is the answer to a Leave pressed in the LOBBY in the
 * instant the host pressed Start: the game began first, and the server then
 * took the Leave to mean "detach this socket" (the seat stays, and the game
 * waits for it every turn). Dropping to the home screen would tell the
 * player they are out of a game that is in fact waiting for them. (A later
 * phase that puts a Leave button on the game screen has to tell the two
 * apart; then the remembered last game is the way back and must be kept.)
 *
 * Why `busy` is cleared by gameSync and by every error: an action that fails
 * before it reaches a game is answered with a plain `error` (no requestId),
 * and a gameSync after a reconnect means the old action's answer will never
 * come (protocol.ts, point 5). When the server runs with patches turned off,
 * a gameSync caused by ANOTHER player can clear `busy` while this client's
 * own action is still on its way; that is harmless (the server handles
 * messages in order, and every view is complete).
 *
 * "Re-validate the selection": if the selected unit or city is no longer in
 * the view (or no longer the player's), selection = null.
 *
 * Events are cosmetic. The store must end up correct if every event is ignored.
 */
export function handleServerMessage(store: Store, message: ServerMessage, send: (message: ClientMessage) => void): void {
  const state = store.get();

  switch (message.type) {
    case 'welcome':
    case 'pong':
      return;

    case 'lobby': {
      setGameCodeInUrl(message.lobby.code);
      saveLastGame(message.lobby.code);
      // The selection, the tile card, the hovered tile and the hover box belong to a game's map; without a game they mean nothing.
      store.set({ lobby: message.lobby, game: null, joining: null, joinProblem: null, ...NOTHING_ON_THE_MAP });
      return;
    }

    case 'gameSync': {
      setGameCodeInUrl(message.code);
      saveLastGame(message.code);
      // Another game means another map: nothing selected, inspected or hovered there carries over.
      const sameGame = state.game !== null && state.game.code === message.code;
      const onTheMap: Pick<AppState, 'selection' | 'inspectedTile' | 'hoverTile' | 'hoverInfoTile'> = sameGame
        ? {
            selection: validSelection(state.selection, message.view),
            inspectedTile: state.inspectedTile,
            hoverTile: state.hoverTile,
            hoverInfoTile: state.hoverInfoTile,
          }
        : NOTHING_ON_THE_MAP;
      store.set({
        game: { code: message.code, view: message.view, connected: message.connected, seq: message.seq, awaitingSync: false },
        lobby: null,
        joining: null,
        joinProblem: null,
        busy: false,
        ...onTheMap,
        toasts: toastsWith(store, eventToasts(message.events, message.view)),
      });
      return;
    }

    case 'gameUpdate': {
      const game = state.game;
      if (game === null || game.awaitingSync) return;
      if (message.seq !== game.seq + 1) {
        // An update went missing. A patch cannot be applied to a view with a
        // hole in it, so ask for the whole view and wait for it.
        store.set({ game: { ...game, awaitingSync: true } });
        send({ type: 'resync' });
        return;
      }
      const view = applyViewPatch(game.view, message.patch);
      store.set({
        game: { ...game, view, seq: message.seq },
        selection: validSelection(state.selection, view),
        toasts: toastsWith(store, eventToasts(message.events, view)),
      });
      return;
    }

    case 'presence': {
      if (state.game === null) return;
      store.set({ game: { ...state.game, connected: message.connected } });
      return;
    }

    case 'actionOk': {
      store.set({ busy: false });
      return;
    }

    case 'actionRejected': {
      store.set({ busy: false, toasts: toastsWith(store, [{ text: message.error.message, kind: 'error' }]) });
      return;
    }

    case 'left': {
      if (state.game !== null) {
        // See "`left` during a game" above: still a player of this game, so go back in.
        send({ type: 'joinGame', code: state.game.code, name: null });
        store.set({ toasts: toastsWith(store, [{ text: STARTED_BEFORE_LEAVE_MESSAGE, kind: 'info' }]) });
        return;
      }
      if (state.lobby !== null) saveLastGame(null);
      setGameCodeInUrl(null);
      store.set({ lobby: null, game: null, ...NOTHING_ON_THE_MAP, joining: null, joinProblem: null, busy: false });
      return;
    }

    case 'error': {
      if (message.code === 'protocolMismatch') {
        // One reload fetches the matching client. If this tab has already
        // tried that, reloading again would only loop: say so instead.
        const reloading = reloadPageOnce();
        store.set({ busy: false, joining: null, fatalMessage: reloading ? state.fatalMessage : VERSION_MISMATCH_MESSAGE });
        return;
      }
      // The lobby or game on screen, if the server has just said that this page is not in it (see "Refused while in a game").
      const lostCode = REJOIN_REFUSALS.includes(message.code) ? (state.game?.code ?? state.lobby?.code ?? null) : null;
      if (message.code === 'noSuchGame') {
        // If the game this page was trying to get back into is gone, stop
        // offering its code on the home screen. (A mistyped code leaves the
        // remembered game alone: `joining` is only set for the automatic rejoin.)
        const gone = lostCode ?? state.joining;
        if (gone !== null && gone === loadLastGame()) saveLastGame(null);
      }
      let toasts = state.toasts;
      if (message.code !== 'nameRequired') toasts = toastsWith(store, [{ text: message.message, kind: 'error' }]);
      else if (lostCode !== null) toasts = toastsWith(store, [{ text: NO_LONGER_IN_GAME_MESSAGE, kind: 'error' }]);
      const changes: Partial<AppState> = { busy: false, joining: null, joinProblem: joinProblemAfter(state.joinProblem, message.code), toasts };
      if (lostCode !== null) Object.assign(changes, { lobby: null, game: null, ...NOTHING_ON_THE_MAP });
      store.set(changes);
      // The address is cleared AFTER the store change, on purpose. If that
      // change took a lobby or game down, the home screen was put up by it
      // just now, and it still found the code in the address: it shows the
      // code with "There is no game with this code" under it, exactly what
      // a reload of the page would have shown.
      if (message.code === 'noSuchGame') setGameCodeInUrl(null);
      return;
    }

    default: {
      // A message type this client does not know (a newer server) is ignored.
      // The line below makes the compiler complain if a known type is missing above.
      const unknown: never = message;
      void unknown;
    }
  }
}

/**
 * "The map's four": what the player has selected, inspected and hovered on
 * a game's map, all cleared. Stored whenever the map they belong to goes
 * away (a lobby, another game, the home screen), so that a tile card or a
 * hover box of the old map can never come up on the next one.
 */
const NOTHING_ON_THE_MAP: Pick<AppState, 'selection' | 'inspectedTile' | 'hoverTile' | 'hoverInfoTile'> = {
  selection: null,
  inspectedTile: null,
  hoverTile: null,
  hoverInfoTile: null,
};

/**
 * What the home screen should say about the game it names, after an error:
 * the three answers that mean "you cannot get into this game" are kept;
 * 'nameRequired' means the game is there and has a seat, so an older problem
 * is forgotten; any other error (a full message queue, a server hiccup) says
 * nothing about the game and leaves things as they were.
 */
function joinProblemAfter(before: JoinProblem | null, code: string): JoinProblem | null {
  const problem = JOIN_PROBLEMS.find((candidate) => candidate === code);
  if (problem !== undefined) return problem;
  return code === 'nameRequired' ? null : before;
}

/** The selection if what it points at is still the player's own and in the view, otherwise null. */
function validSelection(selection: MapSelection | null, view: PlayerView): MapSelection | null {
  if (selection === null) return null;
  const stillThere =
    selection.kind === 'unit'
      ? view.units.some((unit) => unit.id === selection.unitId && unit.owner === view.you)
      : view.cities.some((city) => city.id === selection.cityId && city.owner === view.you);
  return stillThere ? selection : null;
}

/** The slot (see Toast.slot) of the "Turn 8 has begun." toast: at most one of them is on screen, the newest. */
export const TURN_TOAST_SLOT = 'turn';

/** The toasts for a list of events (events that need no toast are left out). */
function eventToasts(events: GameEvent[], view: PlayerView): NewToast[] {
  const toasts: NewToast[] = [];
  for (const event of events) {
    const text = describeEvent(event, view);
    if (text === null) continue;
    // Turns can go by in a second (a game alone, or everybody pressing End
    // Turn): only the latest "has begun" is news.
    toasts.push(event.type === 'turnStarted' ? { text, kind: 'info', slot: TURN_TOAST_SLOT } : { text, kind: 'info' });
  }
  return toasts;
}

/**
 * A short sentence for a toast, or null for events that need none
 * (for example 'unitMoved'): "Rome grew to 2.", "Warrior completed in Rome.",
 * "Turn 8 has begun.", "You founded Ostia.", "Your Worker finished a Farm
 * near Rome.".
 *
 * A unit that was the last entry of its city's build queue gets a second
 * sentence, "Warrior completed in Rome. Rome has nothing left to build.":
 * from now on that city's production is lost every turn, and this toast is
 * the first place that says so.
 *
 * One kind of move does get a sentence: the player's own unit stopping
 * before the tile they sent it to (something they could not see was in the
 * way). Without a word it would look as if the game had ignored the tap.
 */
export function describeEvent(event: GameEvent, view: PlayerView): string | null {
  switch (event.type) {
    case 'unitMoved': {
      if (!event.stoppedEarly || event.playerId !== view.you) return null;
      const unit = view.units.find((candidate) => candidate.id === event.unitId);
      const name = unit === undefined ? 'unit' : UNITS[unit.type].name;
      return `Your ${name} stopped early: something is in the way.`;
    }
    case 'cityFounded':
      return event.playerId === view.you
        ? `You founded ${event.name}.`
        : `${playerName(view, event.playerId)} founded ${event.name}.`;
    case 'cityGrew':
      return `${event.name} grew to ${event.population}.`;
    case 'unitBuilt': {
      const completed = `${UNITS[event.unitType].name} completed in ${event.cityName}.`;
      return event.queueEmpty ? `${completed} ${event.cityName} has nothing left to build.` : completed;
    }
    case 'improvementBuilt': {
      const unit = view.units.find((candidate) => candidate.id === event.unitId);
      const name = unit === undefined ? 'unit' : UNITS[unit.type].name;
      const where = event.cityName === '' ? '' : ` near ${event.cityName}`;
      return `Your ${name} finished a ${IMPROVEMENTS[event.improvement].name}${where}.`;
    }
    case 'turnStarted':
      return `Turn ${event.turn} has begun.`;
    default: {
      // An event type this client does not know (a newer server) needs no toast.
      const unknown: never = event;
      void unknown;
      return null;
    }
  }
}

/** A player's name for a sentence, or a neutral stand-in if the view does not list them. */
function playerName(view: PlayerView, playerId: string): string {
  return view.players.find((player) => player.id === playerId)?.name ?? 'Another player';
}
