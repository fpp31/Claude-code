/**
 * The hover box: what the player may read about the tile under a resting
 * mouse. It sits BESIDE that tile on the map, never on it, so it cannot
 * hide what it describes. When it appears and goes away is decided by
 * input/hoverInfo.ts; where it goes by ui/hoverPlacement.ts; its words by
 * game/tileInfo.ts. This file only prints, measures and places.
 */

import type { MapRenderer, ScreenRect } from '../render/api';
import { describeTile } from '../game/tileInfo';
import type { AppState, Store } from '../state/store';
import { h, setAttribute, setHidden } from './dom';
import type { Unmount } from './dom';
import { placeHoverBox } from './hoverPlacement';
import { TEST_IDS } from './testIds';
import { createTileInfoView } from './tileInfoView';

/** What the hover box has to know about the screen around it. */
export interface HoverBoxSurroundings {
  /** Where tiles are on screen. */
  renderer: Pick<MapRenderer, 'tileScreenRect'>;
  /** The map canvas: the box stays inside its rectangle. */
  canvas: HTMLElement;
  /** The corners that float over the map (the game screen passes hudLeft and hudRight). */
  obstacles: HTMLElement[];
}

/**
 * The hover box (TEST_IDS.hoverBox, role="tooltip"): shown while
 * state.hoverInfoTile is set (rules A-H8 to A-H10). `position: fixed`,
 * `pointer-events: none`. Same data-tile and data-knowledge attributes as
 * the tile card. On every store change while it is visible: rewrite,
 * measure, place (placeHoverBox); if there is no place, or the renderer
 * cannot answer (it throws without a view), hide.
 *
 * Because the pointer never "sees" the box, the box cannot become the thing
 * under the mouse: it cannot make itself flicker and never takes a click.
 * An obstacle with no size (an empty corner) is left out.
 */
export function mountHoverBox(parent: HTMLElement, store: Store, surroundings: HoverBoxSurroundings): Unmount {
  const info = createTileInfoView({ title: TEST_IDS.hoverBoxTitle, line: TEST_IDS.hoverBoxLine });
  const box = h(
    'div',
    { className: 'hover-box', testId: TEST_IDS.hoverBox, attributes: { role: 'tooltip' } },
    info.title,
    info.lines,
  );
  box.hidden = true;
  parent.append(box);

  function update(state: AppState): void {
    const view = state.game?.view ?? null;
    const tile = state.hoverInfoTile;
    if (view === null || tile === null) {
      setHidden(box, true);
      return;
    }

    const description = describeTile(view, tile);
    info.update(description);
    setAttribute(box, 'data-tile', String(tile));
    setAttribute(box, 'data-knowledge', description.knowledge);

    let tileRect: ScreenRect;
    try {
      tileRect = surroundings.renderer.tileScreenRect(tile);
    } catch {
      // No view in the renderer yet, or a tile of another map: there is no place to point at.
      setHidden(box, true);
      return;
    }

    // To be measured the box has to be in the layout. It is shown, measured
    // and moved (or hidden again) in one go, before the browser paints, so
    // it is never seen at the wrong place.
    setHidden(box, false);
    const size = box.getBoundingClientRect();
    const place = placeHoverBox({
      tile: tileRect,
      box: { width: size.width, height: size.height },
      area: rectOf(surroundings.canvas),
      obstacles: surroundings.obstacles.map(rectOf).filter((rect) => rect.right > rect.left && rect.bottom > rect.top),
    });
    if (place === null) {
      setHidden(box, true);
      return;
    }
    setPixels(box, 'left', place.left);
    setPixels(box, 'top', place.top);
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    box.remove();
  };
}

/** An element's rectangle on screen, as a plain ScreenRect. */
function rectOf(element: HTMLElement): ScreenRect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/** Sets `left` or `top` of an element in CSS pixels, only if it differs. */
function setPixels(element: HTMLElement, side: 'left' | 'top', pixels: number): void {
  const value = `${pixels}px`;
  if (element.style[side] !== value) element.style[side] = value;
}
