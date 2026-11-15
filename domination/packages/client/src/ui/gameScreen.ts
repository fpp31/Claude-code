/**
 * Game screen (work package WP4): the map canvas with the panels floating
 * over it. This is the one place where the app shell and the renderer (WP5)
 * are wired together.
 */

import type { PlayerView, TileIndex } from '@domination/shared';
import { installDebugHook } from '../debugHook';
import { createController } from '../game/controller';
import { overlayFor, sameOverlay } from '../game/selectors';
import { clickWasByPointer } from '../input/keys';
import { attachMapInput } from '../input/mapInput';
import type { Connection } from '../net/connection';
import { EMPTY_OVERLAY } from '../render/api';
import type { MapOverlay, MapRenderer, ScreenPoint, ScreenRect } from '../render/api';
import { createMapRenderer } from '../render/renderer';
import type { AppState, Store } from '../state/store';
import { mountCityPanel } from './cityPanel';
import { h } from './dom';
import type { Unmount } from './dom';
import { mountEndTurnButton } from './endTurnButton';
import { mountHoverBox } from './hoverBox';
import { isInTheOpen, sidewaysStep, upOrDownStep } from './mapReveal';
import type { RevealSurroundings } from './mapReveal';
import { mountStartHint } from './startHint';
import { TEST_IDS } from './testIds';
import { tabTitleText } from './texts';
import { mountTileCard } from './tileCard';
import { mountTopBar } from './topBar';
import { mountUnitPanel } from './unitPanel';

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
 *     (bottom right), the "First steps" note, unit panel, city panel and
 *     tile card (bottom left; only one of the four is visible at a time),
 *     zoom buttons (+ / -, calling renderer.zoomBy(1) / zoomBy(-1)).
 *  6. installDebugHook(store, renderer)                (debugHook.ts)
 *  7. Subscribe to the store, and run the same code once right away for the
 *     state that is already there. On every change:
 *       - if state.game.view is a different object than last time:
 *         renderer.setView(view);
 *       - renderer.setOverlay(overlayFor(state)) if the overlay changed.
 *     On the FIRST view, AFTER setView: renderer.centerOn(the tile of the
 *     player's first city, or else of their first unit). (centerOn needs a
 *     view; before setView it does nothing.)
 *  8. Mount the hover box (ui/hoverBox.ts) on top of the screen. It comes
 *     last because it asks the renderer where a tile is.
 *
 * STEPPING ASIDE. A panel that opens bottom left can land on the very tile
 * it is about (the marked tile: the selected unit or city, or the tile
 * whose card is open). The map then moves just far enough to bring that
 * tile into the open: up, or sideways when there is no room above the
 * panel, and back from beyond a side edge of the map (a window that got
 * narrower, a phone that was turned). It does so when the marked tile
 * changes. When only a size changes (a panel grows by a queue row, the
 * window is resized) it does so only for a tile that was in the open
 * before; a tile the player has scrolled away is never pulled back.
 * What "in the open" is and how far the map moves is the arithmetic of
 * ui/mapReveal.ts (rectangles in, a pan out; tested in plain Node). This
 * file measures the rectangles, decides WHEN to step aside, and pans.
 *
 * ORDER AS BUILT: steps 3 and 5 (controller, panels) are carried out before
 * step 2 (renderer). The top bar and, on a narrow screen, the bottom panels
 * take their room from the map area, so they have to be in place before the
 * renderer measures the canvas; that is the very point of step 1.
 *
 * The screen also takes the keyboard focus off any of its buttons that was
 * clicked with the mouse or a finger, so that the map keys (Enter above
 * all) keep their meaning after a click on a zoom or build button.
 *
 * Unmounting undoes all of it (renderer.destroy(), detachInput(),
 * controller.destroy(), the debug hook, the panels, the canvas).
 *
 * Layout: laptop first; must stay usable on a touch screen (panels do not
 * cover the whole map, buttons are at least 44 CSS px tall under
 * `@media (any-pointer: coarse)`).
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

  // A button of this screen that was clicked with the mouse or a finger
  // hands the keyboard focus back to the page, so that Enter goes on ending
  // the turn (see clickWasByPointer in input/keys.ts). One listener for all
  // of them: zoom, "Show me", the build menu, the panels' close buttons.
  screen.addEventListener('click', (event) => {
    if (!clickWasByPointer(event.detail)) return;
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (button !== null && document.activeElement === button) button.blur();
  });

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
    mountTileCard(hudLeft, store, controller),
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
  let fullReveal = false; // the marked tile changed: bring it out whatever else is true
  let wasOpen = false; // was the marked tile in the open when last looked at?
  let lookedAtSize = ''; // the canvas's width and height at that look

  /** The rectangles the map steps aside for, as they are on screen right now. */
  function surroundings(): RevealSurroundings {
    const rect = (element: HTMLElement): ScreenRect => {
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    };
    return { map: rect(canvas), leftCorner: rect(hudLeft), rightCorner: rect(hudRight) };
  }

  /**
   * Is there a marked tile, and is it in the open right now (isInTheOpen in
   * ui/mapReveal.ts)? False without a view.
   */
  function markedIsOpen(): boolean {
    const tile = shownOverlay.selectedTile;
    if (tile === null || shownView === null) return false;
    let point: ScreenPoint;
    try {
      point = renderer.tileToScreen(tile);
    } catch {
      // Asked from the camera listener in the middle of a change of view:
      // the renderer already has a map on which the tile marked until now
      // does not exist. Nothing is in the open then.
      return false;
    }
    return isInTheOpen(point, surroundings());
  }

  /** The canvas's width and height on screen (getBoundingClientRect), as one string. */
  function canvasSizeNow(): string {
    const map = canvas.getBoundingClientRect();
    return `${map.width}x${map.height}`;
  }

  /** Notes whether the marked tile is in the open right now. */
  function look(): void {
    wasOpen = markedIsOpen();
    lookedAtSize = canvasSizeNow();
  }

  /**
   * Selecting something opens a panel, and the panel can land right on top
   * of the thing that was selected (or, on a narrow screen, push the map
   * area up past it). So the map is scrolled just far enough to bring the
   * marked tile into the open. It waits for the next frame: by then the
   * panel has its size, and a centerOn asked for in the same instant (N
   * key, "Show me") has been done.
   *
   * @param full  true: the marked tile changed (a selection, a card, a unit
   *              that walked): bring it out. false: only a size changed
   *              (a panel grew, the window was resized): bring the tile
   *              out ONLY if it was in the open before and is not now.
   *              A tile the player has scrolled away is never pulled back.
   */
  function revealSoon(full: boolean): void {
    fullReveal = fullReveal || full;
    if (revealFrame !== null) return;
    revealFrame = requestAnimationFrame(() => {
      revealFrame = null;
      const tile = shownOverlay.selectedTile;
      if (tile !== null && shownView !== null && (fullReveal || (wasOpen && !markedIsOpen()))) bringOut(tile);
      fullReveal = false;
      look();
    });
  }

  /**
   * Moves the map just far enough to bring the tile into the open: first
   * sideways, then up or down (ui/mapReveal.ts says how far). The tile's
   * place is read again between the two: the camera stops at the map's
   * edge, so the first pan may have ended short of where it was sent.
   */
  function bringOut(tile: TileIndex): void {
    const sideways = sidewaysStep(renderer.tileToScreen(tile), surroundings());
    if (sideways === null) return; // no place on the map has room: it is left alone
    if (sideways !== 0) renderer.panBy(sideways, 0);
    const upOrDown = upOrDownStep(renderer.tileToScreen(tile), surroundings());
    if (upOrDown !== 0) renderer.panBy(0, upOrDown);
  }

  // A panel that opens, closes or grows changes the size of a corner, and
  // on a narrow screen of the canvas itself. This observer is created after
  // the renderer's own, so it runs after the renderer has taken a new
  // canvas size in, and can then put the marked tile right.
  const sizeWatcher = new ResizeObserver(() => revealSoon(false));
  sizeWatcher.observe(canvas);
  sizeWatcher.observe(hudLeft);
  sizeWatcher.observe(hudRight);

  // Keeps `wasOpen` true to what the player did: a tile dragged under a
  // panel, or off the screen, is no longer "in the open", and a panel that
  // grows later must not pull it back. A camera report that comes with a
  // new canvas size is left to the size watcher, which must still know how
  // things were before. The listener only reads; it never moves the camera.
  const stopCameraWatch = renderer.onCameraChange(() => {
    if (canvasSizeNow() === lookedAtSize) look();
  });

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
    // The state is read afresh: a camera listener (input/mapInput.ts) may
    // have put a new hover tile into the store while the renderer was
    // given its view just above, and `state` would be a step behind.
    const overlay = overlayFor(store.get());
    if (!sameOverlay(overlay, shownOverlay)) {
      const selectionMoved = overlay.selectedTile !== null && overlay.selectedTile !== shownOverlay.selectedTile;
      renderer.setOverlay(overlay);
      shownOverlay = overlay;
      if (selectionMoved) revealSoon(true);
    }
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  // 8. The hover box. After the first update, so the renderer has its view
  // when the box first asks where a tile is.
  const unmountHoverBox = mountHoverBox(screen, store, { renderer, canvas, obstacles: [hudLeft, hudRight] });

  return () => {
    unsubscribe();
    unmountHoverBox();
    stopCameraWatch();
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
