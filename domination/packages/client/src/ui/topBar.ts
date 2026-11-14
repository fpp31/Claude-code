/**
 * Top bar of the game screen (work package WP4).
 */

import { CIVS } from '@domination/shared';
import type { PlayerPublic } from '@domination/shared';
import { myPlayer } from '../game/selectors';
import type { AppState, Store } from '../state/store';
import { setCivColors } from './civColors';
import { h, setAttribute, setHidden, setText } from './dom';
import type { Unmount } from './dom';
import { TEST_IDS } from './testIds';
import { waitingForText } from './texts';

/** The parts of one player chip. */
interface Chip {
  chip: HTMLElement;
  name: HTMLElement;
}

/**
 * Shows, left to right:
 *  - the turn number (TEST_IDS.topTurn, "Turn 7");
 *  - the player's own civilization (topCiv) as a colour badge with its name;
 *  - one chip per player in seat order (`top-player-<playerId>`, attribute
 *    data-ended): name in the civ's colours, a tick when they have ended
 *    their turn, greyed when they are not connected (game.connected);
 *  - the connection status (topConnection): the exact text "online",
 *    "connecting" or "reconnecting".
 * Built once; updated in place on store changes.
 *
 * Next to the chips the bar also says in words who the game is waiting for
 * ("Waiting for you and Ben"), because a row of ticks is easy to misread.
 */
export function mountTopBar(parent: HTMLElement, store: Store): Unmount {
  const turn = h('div', { className: 'top-turn', testId: TEST_IDS.topTurn });
  const civName = h('span', { className: 'top-civ-name' });
  const civ = h('div', { className: 'top-civ', testId: TEST_IDS.topCiv }, h('span', { className: 'swatch' }), civName);
  const players = h('div', { className: 'top-players' });
  const waiting = h('div', { className: 'top-waiting', attributes: { role: 'status' } });
  const connectionText = h('span', { testId: TEST_IDS.topConnection });
  const connection = h('div', { className: 'top-connection' }, h('span', { className: 'connection-dot' }), connectionText);

  const bar = h('div', { className: 'top-bar' }, turn, civ, players, waiting, connection);
  parent.append(bar);

  /** One chip per player id. Players never change during a game, so chips are made once and then only updated. */
  const chips = new Map<string, Chip>();

  function chipFor(player: PlayerPublic): Chip {
    let chip = chips.get(player.id);
    if (chip === undefined) {
      const name = h('span', { className: 'chip-name' });
      const element = h('div', { className: 'chip', testId: TEST_IDS.topPlayer + player.id }, h('span', { className: 'chip-mark' }), name);
      chip = { chip: element, name };
      chips.set(player.id, chip);
    }
    return chip;
  }

  function update(state: AppState): void {
    setText(connectionText, state.connection);
    setAttribute(connection, 'data-status', state.connection);

    const game = state.game;
    if (game === null) return; // the app is about to take the game screen down
    const view = game.view;
    const me = myPlayer(view);

    setText(turn, `Turn ${view.turn}`);
    setCivColors(civ, me.civ);
    setText(civName, CIVS[me.civ].name);

    // Chips for players who are gone are removed (only happens when another game is loaded).
    for (const [id, chip] of chips) {
      if (view.players.some((player) => player.id === id)) continue;
      chip.chip.remove();
      chips.delete(id);
    }
    view.players.forEach((player, index) => {
      const chip = chipFor(player);
      const connected = game.connected.includes(player.id);
      setCivColors(chip.chip, player.civ);
      setText(chip.name, player.id === view.you ? `${player.name} (you)` : player.name);
      setAttribute(chip.chip, 'data-ended', player.endedTurn ? 'true' : 'false');
      setAttribute(chip.chip, 'data-connected', connected ? 'true' : 'false');
      setAttribute(chip.chip, 'title', chipTitle(player, connected));
      // Keep the chips in seat order without touching the ones already in place.
      if (players.children[index] !== chip.chip) players.insertBefore(chip.chip, players.children[index] ?? null);
    });

    const waitingText = waitingForText(view, game.connected);
    setText(waiting, waitingText);
    setHidden(waiting, waitingText === '');
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  // The bar grows to two or three lines on a narrow screen. The stylesheet
  // places the toasts just below it, so it is told how tall the bar is.
  const page = document.documentElement;
  const heightWatcher = new ResizeObserver(() => {
    page.style.setProperty('--top-bar-height', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  });
  heightWatcher.observe(bar);

  return () => {
    unsubscribe();
    heightWatcher.disconnect();
    page.style.removeProperty('--top-bar-height');
    bar.remove();
  };
}

/** The chip's meaning in words, shown when the mouse rests on it and read out by screen readers. */
function chipTitle(player: PlayerPublic, connected: boolean): string {
  const turn = player.endedTurn ? 'has ended the turn' : 'is still playing this turn';
  return `${player.name} (${CIVS[player.civ].name}) ${turn}${connected ? '' : ' and is not connected'}`;
}
