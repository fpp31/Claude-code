/**
 * The "First steps" note: a few words at the very start of a game that say
 * what to touch first. It sits where the unit and city panels appear
 * (bottom left), is shown only while nothing is selected, and is gone for
 * good once the player has founded a city.
 */

import type { AppState, Store } from '../state/store';
import { h, setHidden, setText } from './dom';
import type { Unmount } from './dom';
import { TEST_IDS } from './testIds';
import { firstStepsText } from './texts';

/**
 * The note (TEST_IDS.startHint) is hidden unless there is a game, nothing
 * is selected and firstStepsText(view) has something to say. It has no
 * buttons and sends nothing. Built once; updated in place.
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
    const words = state.game === null || state.selection !== null ? null : firstStepsText(state.game.view);
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
