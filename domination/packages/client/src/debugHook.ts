/**
 * A small window into the running client for the end-to-end test and for
 * poking around in the browser console (work package WP4).
 *
 * It exposes only what this player's client already knows: their own view.
 * It can do nothing a player could not do by clicking.
 */

import type { PlayerView, TileIndex, UnitId } from '@domination/shared';
import { reachableFor } from './game/selectors';
import type { MapRenderer, ScreenPoint, ScreenRect } from './render/api';
import type { Store } from './state/store';

export interface DebugHook {
  /** The current view, or null outside a game. */
  view(): PlayerView | null;
  /**
   * Where to click to hit this tile (the centre of its hexagon on screen).
   * Scroll it into view with centerOn first. Throws if there is no view yet
   * or the tile is not on the map (as renderer.tileToScreen does).
   */
  tileToScreen(tile: TileIndex): ScreenPoint;
  /** Where this tile's box is on the screen (renderer.tileScreenRect). Throws as tileToScreen does. */
  tileScreenRect(tile: TileIndex): ScreenRect;
  /** The tiles an own unit can reach this turn (the highlighted ones), ascending. */
  reachable(unitId: UnitId): TileIndex[];
  /** Scrolls the map so the tile is in the middle of the screen. */
  centerOn(tile: TileIndex): void;
}

declare global {
  interface Window {
    /** Set while the game screen is mounted. */
    __domination?: DebugHook;
  }
}

/** Puts the hook on `window.__domination`. Returns a function that removes it again. */
export function installDebugHook(store: Store, renderer: MapRenderer): () => void {
  const hook: DebugHook = {
    view() {
      return store.get().game?.view ?? null;
    },

    tileToScreen(tile) {
      return renderer.tileToScreen(tile);
    },

    tileScreenRect(tile) {
      return renderer.tileScreenRect(tile);
    },

    reachable(unitId) {
      const view = store.get().game?.view ?? null;
      const unit = view?.units.find((candidate) => candidate.id === unitId);
      if (view === null || unit === undefined) return [];
      // What the rules say the unit can reach. It does not flicker to "none"
      // for the instant an action is in flight, so a test can rely on it.
      return [...reachableFor(view, unit).keys()].sort((a, b) => a - b);
    },

    centerOn(tile) {
      renderer.centerOn(tile);
    },
  };

  window.__domination = hook;
  return () => {
    // Only take down our own hook: a newer game screen may have put up its own already.
    if (window.__domination === hook) delete window.__domination;
  };
}
