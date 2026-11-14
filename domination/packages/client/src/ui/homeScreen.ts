/**
 * Home screen (work package WP4): type a name, then create a game or join
 * one by code.
 */

import type { Connection } from '../net/connection';
import type { Store } from '../state/store';
import type { Unmount } from './dom';

/**
 *  - Name field (TEST_IDS.homeNameInput), at most RULES.maxNameLength
 *    characters, pre-filled from the store; saved with savePlayerName on change.
 *  - "Create private game" (homeCreateButton): sends `createGame { name }`.
 *  - Code field (homeCodeInput, pre-filled from ?g=CODE or the last game)
 *    and "Join" (homeJoinButton): sends `joinGame { code, name }`.
 *  - Both buttons are disabled while the name is empty or the connection is
 *    not 'online'. Pressing Enter in a field presses the matching button.
 *  - While state.joining is set (the app is asking the server for the game
 *    in the address bar: after a reload, a reconnect or opening a link) show
 *    "Opening game K7QXM..." and keep both buttons disabled, so nobody creates
 *    a second game by accident in that moment.
 *  - If the page was opened through a shared link (?g=CODE) by somebody who
 *    has no seat in that game yet, the server answers `nameRequired`, and
 *    this screen is what the player sees: the code is already filled in,
 *    they type a name (or keep the remembered one) and press Join. Opening a
 *    link never takes a seat by itself.
 *  - Works on a phone: large touch targets, no hover-only controls.
 */
export function mountHomeScreen(parent: HTMLElement, store: Store, connection: Connection): Unmount {
  throw new Error('not implemented: mountHomeScreen');
}
