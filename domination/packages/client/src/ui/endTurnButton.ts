/**
 * The End Turn button (work package WP4).
 */

import type { TileIndex } from '@domination/shared';
import type { Controller } from '../game/controller';
import { myPlayer } from '../game/selectors';
import type { AppState, Store } from '../state/store';
import { h, setAttribute, setClass, setDisabled, setHidden, setText } from './dom';
import type { Unmount } from './dom';
import { TEST_IDS } from './testIds';
import { todoHints, waitingForText } from './texts';

/**
 * One button (TEST_IDS.endTurnButton, attribute data-ended="true|false"):
 *  - not ended: label "End Turn"; a small hint underneath when something is
 *    still to do, one sentence per line, in the order and wording of
 *    todoHints (ui/texts.ts): cities with nothing to build first ("Rome has
 *    nothing to build"), then cities that wait with no end in sight ("Rome
 *    is waiting: the city must grow first"), then units ("2 units can still
 *    move"; a unit at work is not counted). The hint never blocks ending.
 *  - ended: label "Waiting for others - tap to cancel".
 *  - click: controller.toggleEndTurn(). The button does no guarding of its
 *    own: the controller ignores presses for END_TURN_GUARD_MS (0.6 s) after
 *    the button's meaning has changed, which is what makes a double-click
 *    harmless (see Controller.toggleEndTurn). The end-to-end script must
 *    therefore wait that long between two presses of this button.
 *  - GREYING, by the rule of every button that gives an order: disabled
 *    only for a lasting reason, here while the connection is not 'online'.
 *    Never for the blink of a round trip (`busy`): the button would turn
 *    from gold to grey and back at every tap in a panel. A press in that
 *    blink is ignored by the controller.
 *
 * Two additions that make the hint something a player can act on:
 *  - while there is something still to do, a small "Show me" button above
 *    End Turn selects the next such city or unit (controller.selectNextTask:
 *    idle cities, then waiting cities, then units) and scrolls the map to it.
 *    (On a phone held upright it stands above the zoom buttons instead, and
 *    the row of the three has a fixed height, whatever the hint says: the
 *    panel above that row must not move when a tap changes the hint. See
 *    the upright deck in styles.css.);
 *  - once the turn is ended, the hint names who the game is waiting for.
 * Between "Show me" and End Turn lies a strip of ten pixels that takes a
 * press and does nothing (.end-turn-gap in styles.css says why).
 *
 * @param showTile  scrolls the map to a tile (the game screen passes the
 *                  renderer's centerOn); the default does nothing
 */
export function mountEndTurnButton(
  parent: HTMLElement,
  store: Store,
  controller: Controller,
  showTile: (tile: TileIndex) => void = () => {},
): Unmount {
  const showButton = h('button', {
    className: 'button show-next',
    text: 'Show me',
    attributes: { title: 'Go to the next unit or city that still needs you' },
    onClick: () => {
      const tile = controller.selectNextTask();
      if (tile !== null) showTile(tile);
    },
  });

  const label = h('span', { className: 'end-turn-label' });
  const hint = h('span', { className: 'end-turn-hint' });
  const button = h(
    'button',
    {
      className: 'button primary end-turn-button',
      testId: TEST_IDS.endTurnButton,
      attributes: { title: 'End your turn, or take that back (Enter)' },
      onClick: () => controller.toggleEndTurn(),
    },
    label,
    hint,
  );

  // The strip between the two buttons. It takes a press and does nothing
  // with it; the listener is what makes it count as the thing that was
  // pressed. Left see-through, a finger that comes down on it, a few pixels
  // above End Turn, is handed to the nearest button by the browser.
  const gap = h('div', { className: 'end-turn-gap', onClick: () => {} });

  const box = h('div', { className: 'end-turn' }, showButton, gap, button);
  parent.append(box);

  function update(state: AppState): void {
    if (state.game === null) return; // the app is about to take the game screen down
    const view = state.game.view;
    const ended = myPlayer(view).endedTurn;
    const todo = ended ? [] : todoHints(view);

    setAttribute(button, 'data-ended', ended ? 'true' : 'false');
    setClass(button, 'ended', ended);
    setDisabled(button, state.connection !== 'online');
    setText(label, ended ? 'Waiting for others - tap to cancel' : 'End Turn');

    // One sentence per line (the stylesheet keeps the line breaks).
    const hintText = ended ? waitingForText(view, state.game.connected) : todo.join('\n');
    setText(hint, hintText);
    setHidden(hint, hintText === '');

    // "Show me" only selects things on this player's own screen, so it needs
    // no connection and is never disabled: it is simply there while there is
    // something to show.
    setHidden(showButton, todo.length === 0);
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    box.remove();
  };
}
