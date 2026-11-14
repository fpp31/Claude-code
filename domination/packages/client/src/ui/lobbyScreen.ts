/**
 * Lobby screen (work package WP4): who is in, which civilization everybody
 * plays, map size, start.
 */

import type { Connection } from '../net/connection';
import type { Store } from '../state/store';
import type { Unmount } from './dom';

/**
 * Shows store.lobby (a LobbyView) and sends lobby messages.
 *
 *  - The game code (TEST_IDS.lobbyCode) and the shareable link (lobbyLink,
 *    from shareLink(code)) with a "Copy link" button.
 *  - Seats: always RULES.maxSeats (8) rows, so the layout is ready for 8
 *    players. Taken seats (`lobby-seat-<playerId>`) show name, civilization
 *    colours, a host mark and whether the player is connected; free seats
 *    up to lobby.maxPlayers say "Open"; seats beyond that say "Not available
 *    yet" (only six civilizations exist in phase 1).
 *  - Civilization picker: one button per CIV_IDS entry (`lobby-civ-<civ>`)
 *    in the civ's colours, with name and leader; disabled if another seat
 *    has it; the player's own choice is marked. Click sends `chooseCiv`.
 *  - Map size: a <select> (lobbyMapSize) over MAP_SIZE_IDS showing name,
 *    dimensions and "best for up to N players"; enabled for the host only;
 *    change sends `setMapSize`.
 *  - "Start game" (lobbyStartButton): host only; sends `startGame`. Allowed
 *    with a single player.
 *    GHOST-SEAT WARNING: every seat becomes a player and the game waits for
 *    each of them every turn, so a seat nobody sits on stalls the game for
 *    good. If any seat has `connected: false` when Start is pressed, ask
 *    first with window.confirm: "Ben is not connected. The game waits for
 *    every player each turn. Start anyway?" (list all such names), and send
 *    `startGame` only on OK. The host cannot remove a seat in phase 1; the
 *    way out is for that player to come back and press Leave, or to make a
 *    new game.
 *  - "Leave" (lobbyLeaveButton): sends `leaveGame`.
 *  - Names are untrusted text: textContent only.
 */
export function mountLobbyScreen(parent: HTMLElement, store: Store, connection: Connection): Unmount {
  throw new Error('not implemented: mountLobbyScreen');
}
