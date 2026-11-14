/**
 * Demo mode (work package WP4): open the page with `?demo` in the address
 * (for example http://localhost:5173/?demo) to see the game screen filled
 * with sample data, without a server. `?demo=lobby` shows the lobby screen
 * and `?demo=home` the home screen as it looks once connected.
 *
 * It exists so the client can be built and looked at before the server and
 * the rules engine are finished, and it stays useful afterwards for working
 * on the look of things.
 */

import { sampleLobby, sampleView } from '@domination/shared/testing';
import { urlParameter } from './net/identity';
import type { Store } from './state/store';

/** True if the page address asks for demo mode. */
export function isDemoMode(): boolean {
  return urlParameter('demo') !== null;
}

/**
 * Fills the store with sample data from '@domination/shared/testing':
 * sampleView() as a running game (or sampleLobby() for `?demo=lobby`),
 * connection 'online'. No socket is opened; actions go nowhere (the app
 * uses a dummy Connection whose `send` returns false, see ui/app.ts).
 */
export function startDemo(store: Store): void {
  const which = urlParameter('demo');
  if (which === 'home') {
    store.set({ connection: 'online' });
    return;
  }
  if (which === 'lobby') {
    store.set({ connection: 'online', lobby: sampleLobby() });
    return;
  }
  const lobby = sampleLobby();
  const view = sampleView();
  store.set({
    connection: 'online',
    game: {
      code: lobby.code,
      view,
      // Everybody but the last player is connected, so the "offline" look can be seen too.
      connected: view.players.slice(0, Math.max(1, view.players.length - 1)).map((player) => player.id),
      seq: 0,
      awaitingSync: false,
    },
  });
}
