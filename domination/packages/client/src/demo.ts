/**
 * Demo mode (work package WP4): open the page with `?demo` in the address
 * (for example http://localhost:5173/?demo) to see the game screen filled
 * with sample data, without a server. `?demo=lobby` shows the lobby screen.
 *
 * It exists so the client can be built and looked at before the server and
 * the rules engine are finished, and it stays useful afterwards for working
 * on the look of things.
 */

import type { Store } from './state/store';

/** True if the page address asks for demo mode. */
export function isDemoMode(): boolean {
  throw new Error('not implemented: isDemoMode');
}

/**
 * Fills the store with sample data from '@domination/shared/testing':
 * sampleView() as a running game (or sampleLobby() for `?demo=lobby`),
 * connection 'online'. No socket is opened; actions go nowhere (the app
 * uses a dummy Connection whose `send` returns false, see ui/app.ts).
 */
export function startDemo(store: Store): void {
  throw new Error('not implemented: startDemo');
}
