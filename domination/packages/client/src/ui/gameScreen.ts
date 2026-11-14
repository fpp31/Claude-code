/**
 * Game screen (work package WP4): the map canvas with the panels floating
 * over it. This is the one place where the app shell and the renderer (WP5)
 * are wired together.
 */

import type { Connection } from '../net/connection';
import type { Store } from '../state/store';
import type { Unmount } from './dom';

/**
 * Builds the game screen and keeps it in step with the store.
 *
 * Wiring, in order:
 *  1. Create a <canvas> (TEST_IDS.gameCanvas) that fills the window and
 *     APPEND IT TO `parent` right away. `parent` is in the document, so the
 *     canvas has its real size before step 2: the renderer measures the
 *     canvas when it is created (see render/api.ts).
 *  2. renderer = createRendererOrPlaceholder(canvas)   (render/placeholderRenderer.ts)
 *     This is createMapRenderer(canvas) from render/renderer.ts, except that
 *     while WP5's renderer is still a stub it returns the scaffold's simple
 *     flat-colour renderer instead, so this screen, map input and tapping
 *     can be built and tried in the browser (/?demo) before WP5 has landed.
 *  3. controller = createController(store, connection) (game/controller.ts)
 *  4. detachInput = attachMapInput(canvas, renderer, controller)
 *  5. Mount the panels over the canvas: top bar (top), End Turn button
 *     (bottom right), unit panel and city panel (bottom left; only one of
 *     them is visible at a time), zoom buttons (+ / -, calling
 *     renderer.zoomBy(1) / zoomBy(-1)).
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
 * Unmounting undoes all of it (renderer.destroy(), detachInput(),
 * controller.destroy(), the debug hook, the panels, the canvas).
 *
 * Layout: laptop first; must stay usable on a touch screen (panels do not
 * cover the whole map, buttons are at least 44 CSS px tall under
 * `@media (pointer: coarse)`).
 */
export function mountGameScreen(parent: HTMLElement, store: Store, connection: Connection): Unmount {
  throw new Error('not implemented: mountGameScreen');
}
