/**
 * The "First steps" note: a few words at the very start of a game that say
 * what to touch first. It sits where the unit and city panels and the tile
 * card appear (bottom left), is shown only while none of them is, and is
 * gone for good once the player has founded a city.
 */

import type { AppState, Store } from '../state/store';
import { h, setHidden, setText } from './dom';
import type { Unmount } from './dom';
import { TEST_IDS } from './testIds';
import { firstStepsText } from './texts';

/**
 * The note (TEST_IDS.startHint) is hidden unless there is a game, nothing
 * is selected, no tile card is open (state.inspectedTile is null) and
 * firstStepsText(view) has something to say. It has no buttons and sends
 * nothing. Built once; updated in place.
 */
export function mountStartHint(parent: HTMLElement, store: Store): Unmount {
  const text = h('p', { className: 'panel-hint' });
  const panel = h(
    'div',
    { className: 'panel start-hint', testId: TEST_IDS.startHint },
    h('h2', { className: 'panel-title', text: 'First steps' }),
    text,
  );
  panel.hidden = true;
  parent.append(panel);

  function update(state: AppState): void {
    const somethingElseShows = state.selection !== null || state.inspectedTile !== null;
    const words = state.game === null || somethingElseShows ? null : firstStepsText(state.game.view);
    setHidden(panel, words === null);
    if (words !== null) setText(text, words);
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    panel.remove();
  };
}
