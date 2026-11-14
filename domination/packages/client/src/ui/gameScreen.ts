/**
 * Game screen (work package WP4): the map canvas with the panels floating
 * over it. This is the one place where the app shell and the renderer (WP5)
 * are wired together.
 */

import type { PlayerView, TileIndex } from '@domination/shared';
import { installDebugHook } from '../debugHook';
import { createController } from '../game/controller';
import { overlayFor, sameOverlay } from '../game/selectors';
import { attachMapInput } from '../input/mapInput';
import type { Connection } from '../net/connection';
import { EMPTY_OVERLAY } from '../render/api';
import type { MapOverlay, MapRenderer } from '../render/api';
import { createMapRenderer } from '../render/renderer';
import type { AppState, Store } from '../state/store';
import { mountCityPanel } from './cityPanel';
import { h } from './dom';
import type { Unmount } from './dom';
import { mountEndTurnButton } from './endTurnButton';
import { mountStartHint } from './startHint';
import { TEST_IDS } from './testIds';
import { tabTitleText } from './texts';
import { mountTopBar } from './topBar';
import { mountUnitPanel } from './unitPanel';

/** A selected tile is kept at least this far (in CSS pixels, about one tile) clear of the panels. */
const REVEAL_MARGIN = 44;

/**
 * Builds the game screen and keeps it in step with the store.
 *
 * Wiring, in order:
 *  1. Create a <canvas> (TEST_IDS.gameCanvas) that fills the map area (the
 *     window below the top bar) and APPEND IT TO `parent` right away.
 *     `parent` is in the document, so the canvas has its real size before
 *     step 2: the renderer measures the canvas when it is created (see
 *     render/api.ts).
 *  2. renderer = createMapRenderer(canvas)            (render/renderer.ts)
 *  3. controller = createController(store, connection) (game/controller.ts)
 *  4. detachInput = attachMapInput(canvas, renderer, controller)
 *  5. Mount the panels over the canvas: top bar (top), End Turn button
 *     (bottom right), unit panel, city panel and the "First steps" note
 *     (bottom left; only one of the three is visible at a time), zoom
 *     buttons (+ / -, calling renderer.zoomBy(1) / zoomBy(-1)).
 *  6. installDebugHook(store, renderer)                (debugHook.ts)
 *  7. Subscribe to the store, and run the same code once right away for the
 *     state that is already there. On every change:
 *       - if state.game.view is a different object than last time:
 *         renderer.setView(view);
 *       - renderer.setOverlay(overlayFor(state)) if the overlay changed.
 *     On the FIRST view, AFTER setView: renderer.centerOn(the tile of the
 *     player's first city, or else of their first unit). (centerOn needs a
 *     view; before setView it does nothing.)
 *
 * ORDER AS BUILT: steps 3 and 5 (controller, panels) are carried out before
 * step 2 (renderer). The top bar and, on a narrow screen, the bottom panels
 * take their room from the map area, so they have to be in place before the
 * renderer measures the canvas; that is the very point of step 1.
 *
 * Unmounting undoes all of it (renderer.destroy(), detachInput(),
 * controller.destroy(), the debug hook, the panels, the canvas).
 *
 * Layout: laptop first; must stay usable on a touch screen (panels do not
 * cover the whole map, buttons are at least 44 CSS px tall under
 * `@media (pointer: coarse)`).
 */
export function mountGameScreen(parent: HTMLElement, store: Store, connection: Connection): Unmount {
  // 1. The whole screen goes into the page first: the top bar, the map area
  // with the canvas in it, and the bottom panels. On a laptop the bottom
  // panels float over the map; on a narrow screen they sit below it and the
  // map area gets what is left (see styles.css).
  const canvas = h('canvas', { className: 'map-canvas', testId: TEST_IDS.gameCanvas, attributes: { 'aria-label': 'Map' } });
  const hudTop = h('div', { className: 'hud-top' });
  const hudLeft = h('div', { className: 'hud-left' });
  const hudRight = h('div', { className: 'hud-right' });
  const screen = h(
    'div',
    { className: 'screen game-screen' },
    hudTop,
    h('div', { className: 'map-area' }, canvas),
    h('div', { className: 'hud-bottom' }, hudLeft, hudRight),
  );
  parent.append(screen);

  // 3. and 5. The controller and the panels come BEFORE the renderer (the
  // one change to the order in the doc comment above): the top bar and the
  // bottom row take their room from the map area, and the renderer measures
  // the canvas the moment it is created. Mounted afterwards, they would
  // shrink the canvas behind its back, and the first centerOn would aim at
  // the middle of a canvas that is taller than what is really shown.
  const controller = createController(store, connection);
  const zoomButtons = h(
    'div',
    { className: 'zoom-buttons' },
    h('button', {
      className: 'button zoom-button',
      text: '+',
      attributes: { 'aria-label': 'Zoom in', title: 'Zoom in (+)' },
      onClick: () => renderer.zoomBy(1),
    }),
    h('button', {
      className: 'button zoom-button',
      text: '-',
      attributes: { 'aria-label': 'Zoom out', title: 'Zoom out (-)' },
      onClick: () => renderer.zoomBy(-1),
    }),
  );
  hudRight.append(zoomButtons);
  const unmountPanels: Unmount[] = [
    mountTopBar(hudTop, store),
    mountStartHint(hudLeft, store),
    mountUnitPanel(hudLeft, store, controller),
    mountCityPanel(hudLeft, store, controller),
    mountEndTurnButton(hudRight, store, controller, (tile) => renderer.centerOn(tile)),
  ];

  // 2. and 4. The renderer (on a canvas that now has its real size) and the input.
  let renderer: MapRenderer;
  try {
    renderer = createMapRenderer(canvas);
  } catch (error) {
    // No map can be drawn (a browser without canvas support, or a bug in the
    // renderer). Take down what was built so far and let the app say so.
    for (const unmount of unmountPanels) unmount();
    controller.destroy();
    screen.remove();
    throw error;
  }
  const detachInput = attachMapInput(canvas, renderer, controller);

  // 6. The window into the client for the end-to-end test.
  const removeDebugHook = installDebugHook(store, renderer);

  // 7. Keep the renderer in step with the store.
  let shownView: PlayerView | null = null;
  let shownOverlay: MapOverlay = EMPTY_OVERLAY;
  let centered = false;
  let revealFrame: number | null = null;

  /**
   * Selecting something opens a panel, and the panel can land right on top
   * of the thing that was selected (or, on a narrow screen, push the map
   * area up past it). So after the selected tile has changed, the map is
   * scrolled just far enough to bring that tile into the open. It waits for
   * the next frame: by then the panel has its size, and a centerOn asked for
   * in the same instant (N key, "Show me") has been done.
   */
  function revealSelectionSoon(): void {
    if (revealFrame !== null) return;
    revealFrame = requestAnimationFrame(() => {
      revealFrame = null;
      const tile = shownOverlay.selectedTile;
      if (tile === null || shownView === null) return;
      const point = renderer.tileToScreen(tile);
      const map = canvas.getBoundingClientRect();
      const highest = map.top + REVEAL_MARGIN;
      const lowest = lowestUncoveredY(point.x, map.bottom - REVEAL_MARGIN);
      if (lowest <= highest) return; // no room to show it properly: leave the map alone
      if (point.y > lowest) renderer.panBy(0, lowest - point.y);
      else if (point.y < highest) renderer.panBy(0, highest - point.y);
    });
  }

  /** How far down the screen a tile at this x may sit before a floating bottom panel covers it. */
  function lowestUncoveredY(x: number, mapBottom: number): number {
    let lowest = mapBottom;
    for (const corner of [hudLeft, hudRight]) {
      const box = corner.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (x > box.left - REVEAL_MARGIN && x < box.right + REVEAL_MARGIN) lowest = Math.min(lowest, box.top - REVEAL_MARGIN);
    }
    return lowest;
  }

  // On a narrow screen an opening panel makes the canvas itself smaller.
  // This observer is created after the renderer's own, so it runs after the
  // renderer has taken the new size in, and can then put the selection right.
  const sizeWatcher = new ResizeObserver(revealSelectionSoon);
  sizeWatcher.observe(canvas);

  const titleBefore = document.title;

  function update(state: AppState): void {
    const view = state.game?.view ?? null;
    if (view !== shownView) {
      renderer.setView(view);
      shownView = view;
      // The tab title says whose move it is, for a game left in a background tab.
      const title = view === null ? titleBefore : tabTitleText(view);
      if (document.title !== title) document.title = title;
      if (view !== null && !centered) {
        const home = homeTile(view);
        if (home !== null) renderer.centerOn(home);
        centered = true;
      }
    }
    const overlay = overlayFor(state);
    if (!sameOverlay(overlay, shownOverlay)) {
      const selectionMoved = overlay.selectedTile !== null && overlay.selectedTile !== shownOverlay.selectedTile;
      renderer.setOverlay(overlay);
      shownOverlay = overlay;
      if (selectionMoved) revealSelectionSoon();
    }
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    sizeWatcher.disconnect();
    if (revealFrame !== null) cancelAnimationFrame(revealFrame);
    removeDebugHook();
    detachInput();
    renderer.destroy();
    for (const unmount of unmountPanels) unmount();
    controller.destroy();
    document.title = titleBefore;
    screen.remove();
  };
}

/** Where the map opens: the player's first city, or else their first unit; null if they have neither. */
function homeTile(view: PlayerView): TileIndex | null {
  const city = view.cities.find((candidate) => candidate.owner === view.you);
  if (city !== undefined) return city.tile;
  const unit = view.units.find((candidate) => candidate.owner === view.you);
  return unit?.tile ?? null;
}
