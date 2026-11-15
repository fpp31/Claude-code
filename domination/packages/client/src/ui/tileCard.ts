/**
 * The tile card: what the player may read about a tile they tapped or
 * clicked. It appears bottom left, where the unit and city panels appear,
 * and is the only way to read about a tile on a touch screen, which has no
 * hover.
 */

import type { PlayerView, TileIndex } from '@domination/shared';
import type { Controller } from '../game/controller';
import { describeTile } from '../game/tileInfo';
import type { AppState, Store } from '../state/store';
import { h, setAttribute, setHidden } from './dom';
import type { Unmount } from './dom';
import { TEST_IDS } from './testIds';
import { createTileInfoView } from './tileInfoView';

/**
 * The tile card (TEST_IDS.tileCard): shown while a tile is inspected and
 * nothing is selected (rule A-C1). A `.panel.tile-card` like the unit and
 * city panels: `div.panel-head` with the TileInfoView's heading
 * (TEST_IDS.tileCardTitle) and a close button (TEST_IDS.tileCardClose,
 * aria-label "Close", title "Close (Esc)" -> controller.deselect()), then
 * the TileInfoView's list (TEST_IDS.tileCardLine). Carries
 * data-tile="<tile index>" and data-knowledge="unexplored|remembered|visible".
 *
 * The card keeps only the tile's number. Its words are worked out again
 * from the newest view whenever the view or the tile changes, so a unit
 * that walks away or a tile that falls out of sight rewrites the open card
 * in place, and the card can never show what the server has not sent.
 * Built once; updated in place. When it shows another tile than before, or
 * was hidden, it starts at its top again.
 */
export function mountTileCard(parent: HTMLElement, store: Store, controller: Controller): Unmount {
  const info = createTileInfoView({ title: TEST_IDS.tileCardTitle, line: TEST_IDS.tileCardLine });
  const closeButton = h('button', {
    className: 'button panel-close',
    text: '×', // the multiplication sign: a cross that every font has
    testId: TEST_IDS.tileCardClose,
    attributes: { 'aria-label': 'Close', title: 'Close (Esc)' },
    onClick: () => controller.deselect(),
  });
  const panel = h(
    'div',
    { className: 'panel tile-card', testId: TEST_IDS.tileCard },
    h('div', { className: 'panel-head' }, info.title, closeButton),
    info.lines,
  );
  panel.hidden = true;
  parent.append(panel);

  /** What the card showed at its last update: null while it is hidden. */
  let shownTile: TileIndex | null = null;
  let shownView: PlayerView | null = null;

  function update(state: AppState): void {
    const view = state.game?.view ?? null;
    const tile = state.inspectedTile;
    if (view === null || state.selection !== null || tile === null || tile >= view.tiles.length) {
      setHidden(panel, true);
      shownTile = null;
      shownView = null;
      return;
    }
    // The store changes with every tile the mouse crosses; the words only with the view or the tile.
    if (tile === shownTile && view === shownView) return;
    const newSubject = tile !== shownTile;
    shownTile = tile;
    shownView = view;

    const description = describeTile(view, tile);
    info.update(description);
    setAttribute(panel, 'data-tile', String(tile));
    setAttribute(panel, 'data-knowledge', description.knowledge);
    setHidden(panel, false);
    if (newSubject) panel.scrollTop = 0;
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    panel.remove();
  };
}
