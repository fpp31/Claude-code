/**
 * What each server message does to the store (work package WP4).
 *
 * This module runs in the unit tests, in plain Node, where there is no
 * window, address bar or storage. It therefore never touches `location`,
 * `history`, localStorage or sessionStorage itself: it calls the functions
 * of net/identity.ts, which are safe to call anywhere.
 */

import { UNITS, applyViewPatch } from '@domination/shared';
import type { ClientMessage, GameEvent, PlayerView, ServerMessage } from '@domination/shared';
import { loadLastGame, reloadPageOnce, saveLastGame, setGameCodeInUrl } from '../net/identity';
import { toastsWith } from '../ui/toasts';
import type { NewToast } from '../ui/toasts';
import { JOIN_PROBLEMS } from './store';
import type { JoinProblem, MapSelection, Store } from './store';

/** Shown instead of the whole app when reloading did not cure a version mismatch. */
export const VERSION_MISMATCH_MESSAGE =
  'This page and the game server are not the same version. Reload the page to get the newest one. ' +
  'If you see this again, the server is still being updated: wait a minute and reload once more.';

/**
 * Applies one message from the server. `send` is used for the rare replies
 * the protocol itself requires (only `resync`).
 *
 *  welcome         nothing. (The connection module has already stored the
 *                  token; see net/connection.ts.)
 *  lobby           lobby = message.lobby, game = null, joining = null,
 *                  joinProblem = null, selection = null, hoverTile = null
 *                  (those two belong to a map, and a lobby has none); put
 *                  the code in the address bar (setGameCodeInUrl) and
 *                  remember it as the last game (saveLastGame).
 *  gameSync        game = { code, view, connected, seq, awaitingSync: false },
 *                  lobby = null, joining = null, joinProblem = null, busy =
 *                  false; address bar
 *                  and last game as for `lobby`; re-validate the selection
 *                  (for ANOTHER game than the one on screen: selection and
 *                  hoverTile = null, it is another map); toast the events.
 *  gameUpdate      ignored completely while game.awaitingSync is set (or
 *                  there is no game). If message.seq !== game.seq + 1 (a
 *                  missed update): change nothing except awaitingSync =
 *                  true, and send `resync` (once: the flag stops repeats).
 *                  Otherwise view = applyViewPatch(view, patch), seq =
 *                  message.seq; re-validate the selection; toast the events.
 *  presence        game.connected = message.connected.
 *  actionOk        busy = false.
 *  actionRejected  busy = false; error toast with error.message.
 *  left            lobby = null, game = null, selection = null, hoverTile =
 *                  null, joining = null, joinProblem = null, busy = false;
 *                  remove ?g= from the address bar.
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
 *  pong            nothing (the connection module tracks liveness).
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
      // The selection and the hovered tile belong to a game's map; without a game they mean nothing.
      store.set({ lobby: message.lobby, game: null, joining: null, joinProblem: null, selection: null, hoverTile: null });
      return;
    }

    case 'gameSync': {
      setGameCodeInUrl(message.code);
      saveLastGame(message.code);
      // Another game means another map: nothing selected or hovered there carries over.
      const sameGame = state.game !== null && state.game.code === message.code;
      store.set({
        game: { code: message.code, view: message.view, connected: message.connected, seq: message.seq, awaitingSync: false },
        lobby: null,
        joining: null,
        joinProblem: null,
        busy: false,
        selection: sameGame ? validSelection(state.selection, message.view) : null,
        hoverTile: sameGame ? state.hoverTile : null,
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
      setGameCodeInUrl(null);
      store.set({ lobby: null, game: null, selection: null, hoverTile: null, joining: null, joinProblem: null, busy: false });
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
      if (message.code === 'noSuchGame') {
        // If the game this page was trying to get back into is gone, stop
        // offering its code on the home screen. (A mistyped code leaves the
        // remembered game alone: `joining` is only set for the automatic rejoin.)
        if (state.joining !== null && state.joining === loadLastGame()) saveLastGame(null);
        setGameCodeInUrl(null);
      }
      const toasts = message.code === 'nameRequired' ? state.toasts : toastsWith(store, [{ text: message.message, kind: 'error' }]);
      store.set({ busy: false, joining: null, joinProblem: joinProblemAfter(state.joinProblem, message.code), toasts });
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

/** The toasts for a list of events (events that need no toast are left out). */
function eventToasts(events: GameEvent[], view: PlayerView): NewToast[] {
  const toasts: NewToast[] = [];
  for (const event of events) {
    const text = describeEvent(event, view);
    if (text !== null) toasts.push({ text, kind: 'info' });
  }
  return toasts;
}

/**
 * A short sentence for a toast, or null for events that need none
 * (for example 'unitMoved'): "Rome grew to 2.", "Warrior completed in Rome.",
 * "Turn 8 has begun.", "You founded Ostia.".
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
    case 'unitBuilt':
      return `${UNITS[event.unitType].name} completed in ${event.cityName}.`;
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
