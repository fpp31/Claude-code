/**
 * The app shell (work package WP4): creates the store and the connection,
 * and shows the right screen.
 */

import type { Unmount } from './dom';

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
  throw new Error('not implemented: startApp');
}
