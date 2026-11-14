/**
 * The app shell (work package WP4): creates the store and the connection,
 * and shows the right screen.
 */

import { isDemoMode, startDemo } from '../demo';
import { createConnection } from '../net/connection';
import type { Connection } from '../net/connection';
import { gameCodeFromUrl, loadPlayerName, reloadPage } from '../net/identity';
import { handleServerMessage } from '../state/serverMessages';
import { createStore, currentScreen, initialState } from '../state/store';
import type { AppState, ScreenName, Store } from '../state/store';
import { h, setAttribute, setHidden } from './dom';
import type { Unmount } from './dom';
import { mountGameScreen } from './gameScreen';
import { mountHomeScreen } from './homeScreen';
import { mountLobbyScreen } from './lobbyScreen';
import { mountToasts, showToast } from './toasts';

/** Shown once if the browser will not keep the player's token (see net/connection.ts). */
const TOKEN_NOT_SAVED_MESSAGE = 'This browser is not saving data. If you close this tab you will lose your seat.';

/** Shown, with the reason in brackets, when a screen could not be built at all. */
const SCREEN_FAILED_MESSAGE = 'Something went wrong while showing the game. Reloading the page usually helps.';

/** What the app shows: one of the three screens, or only the message that blocks everything. */
type Shown = ScreenName | 'fatal';

/**
 * Starts the whole client inside `root`. Called once by main.ts.
 *
 * Boot order:
 *  1. store = createStore(initialState(loadPlayerName(), gameCodeFromUrl())).
 *     (In demo mode pass null as the second argument.)
 *  2. If the address has `?demo`: startDemo(store) (no server, sample data),
 *     and instead of step 3 use a DUMMY Connection whose `send` returns
 *     false and whose `close` does nothing. Every screen and the controller
 *     take a Connection; with the dummy they all work unchanged, and because
 *     the controller sets `busy` only when `send` returned true, nothing
 *     gets stuck: actions simply go nowhere.
 *  3. connection = createConnection({ ... }):
 *       onStatus      -> store.set({ connection })
 *       onMessage     -> handleServerMessage(store, message, connection.send)
 *       onDisconnect  -> store.set({ busy: false })
 *       onTokenNotSaved -> one error toast: "This browser is not saving
 *                        data. If you close this tab you will lose your seat."
 *       onReady       -> if gameCodeFromUrl() is set: send `joinGame` with
 *                        that code and `name: null`, and store.set({ joining:
 *                        code }). This one line is the whole
 *                        reconnect-and-resume logic: it runs on the first
 *                        connect, after every reconnect, after a reload and
 *                        after a server restart.
 *                        `name: null` on purpose: this message may only bring
 *                        the player BACK to a seat they already have. It
 *                        never takes a new one, so opening an invite link on
 *                        a second device does not quietly put a second seat
 *                        into the game. Somebody without a seat gets `error
 *                        nameRequired` and sees the home screen with the code
 *                        filled in; taking a seat always needs the Join button.
 *  4. Mount the toasts (always visible) and the screen for
 *     currentScreen(state); when the screen changes, unmount the old one and
 *     mount the new one. If `fatalMessage` is set, show only that message
 *     with a Reload button.
 *
 * Returns a function that tears everything down (used by tests).
 */
export function startApp(root: HTMLElement): Unmount {
  const demo = isDemoMode();
  const store = createStore(initialState(loadPlayerName(), demo ? null : gameCodeFromUrl()));

  let connection: Connection;
  if (demo) {
    startDemo(store);
    connection = { send: () => false, close: () => {} };
  } else {
    connection = createConnection({
      onStatus: (status) => store.set({ connection: status }),
      onMessage: (message) => handleServerMessage(store, message, (reply) => connection.send(reply)),
      onDisconnect: () => store.set({ busy: false }),
      onTokenNotSaved: () => showToast(store, TOKEN_NOT_SAVED_MESSAGE, 'error'),
      onReady: () => rejoin(store, connection),
    });
  }

  // ---- The page: one place for the current screen, one for messages on top of it ----
  const screenHost = h('div', { className: 'screen-host' });
  const notices = h('div', { className: 'notices' });
  const connectionNotice = h('div', {
    className: 'connection-notice',
    text: 'Connection lost. Trying to reconnect...',
    attributes: { role: 'status' },
  });
  connectionNotice.hidden = true;
  notices.append(connectionNotice);
  root.replaceChildren(screenHost, notices);
  if (demo) {
    // Buttons that do nothing would look broken; say why they do nothing.
    root.append(h('div', { className: 'demo-note', text: 'Demo: sample data, nothing is sent to a server' }));
  }
  const unmountToasts = mountToasts(notices, store);

  let shown: Shown | null = null;
  let unmountScreen: Unmount = () => {};

  function update(state: AppState): void {
    setHidden(connectionNotice, state.connection !== 'reconnecting' || state.fatalMessage !== null);

    const wanted: Shown = state.fatalMessage !== null ? 'fatal' : currentScreen(state);
    if (wanted === shown) return;
    unmountScreen();
    shown = wanted;
    // The stylesheet places the notices differently per screen (below the game's top bar).
    setAttribute(root, 'data-screen', wanted);
    if (wanted === 'fatal') {
      // Nothing can be done until the page is reloaded: stop talking to the server.
      connection.close();
      unmountScreen = mountFatalMessage(screenHost, state.fatalMessage ?? '');
      return;
    }
    try {
      if (wanted === 'game') unmountScreen = mountGameScreen(screenHost, store, connection);
      else if (wanted === 'lobby') unmountScreen = mountLobbyScreen(screenHost, store, connection);
      else unmountScreen = mountHomeScreen(screenHost, store, connection);
    } catch (error) {
      // A screen that cannot be built must not leave a blank page behind:
      // say what happened (the details go to the browser console).
      console.error(error);
      unmountScreen = () => {};
      store.set({ fatalMessage: `${SCREEN_FAILED_MESSAGE} (${error instanceof Error ? error.message : String(error)})` });
    }
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    unmountScreen();
    unmountToasts();
    connection.close();
    root.replaceChildren();
    root.removeAttribute('data-screen');
  };
}

/**
 * Asks the server to put this page back into its game. Runs every time a
 * new socket is ready (see step 3 above).
 *
 * The code normally comes from the address bar. Should the address bar be
 * out of reach (some embedded pages cannot change it), the game or lobby
 * already on screen says which game to return to.
 */
function rejoin(store: Store, connection: Connection): void {
  const state = store.get();
  const code = gameCodeFromUrl() ?? state.game?.code ?? state.lobby?.code ?? null;
  if (code === null) {
    if (state.joining !== null) store.set({ joining: null });
    return;
  }
  const sent = connection.send({ type: 'joinGame', code, name: null });
  store.set({ joining: sent ? code : null });
}

/** The message that replaces the whole app, with a Reload button. */
function mountFatalMessage(parent: HTMLElement, message: string): Unmount {
  const box = h(
    'div',
    { className: 'card fatal', attributes: { role: 'alert' } },
    h('h1', { className: 'title', text: 'Domination' }),
    h('p', { text: message }),
    h('button', { className: 'button primary', text: 'Reload', onClick: reloadPage }),
  );
  const screen = h('div', { className: 'screen centered' }, box);
  parent.append(screen);
  return () => screen.remove();
}
