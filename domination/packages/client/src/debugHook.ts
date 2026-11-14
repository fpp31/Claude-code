/**
 * A small window into the running client for the end-to-end test and for
 * poking around in the browser console (work package WP4).
 *
 * It exposes only what this player's client already knows: their own view.
 * It can do nothing a player could not do by clicking.
 */

import type { PlayerView, TileIndex, UnitId } from '@domination/shared';
import type { MapRenderer, ScreenPoint } from './render/api';
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
  throw new Error('not implemented: installDebugHook');
}
