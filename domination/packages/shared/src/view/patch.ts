/**
 * View patches: sending only what changed.
 *
 * The server keeps the last view it sent on each socket. After a change it
 * builds the player's new view, calls `diffViews(last, next)` and sends the
 * result as a `gameUpdate`; the client calls `applyViewPatch` on its copy.
 *
 * A patch is always the difference of two views that were each built by
 * buildPlayerView, never a difference of raw game states. So a patch cannot
 * contain anything a full view would not.
 *
 * (Implemented as part of the scaffold because three work packages meet
 * here: WP2 produces views, WP3 diffs them, WP4 applies the patches.)
 */

import { jsonEqual } from '../json';
import type { PlayerView, ViewPatch } from '../viewTypes';

/**
 * What changed from `previous` to `next`, or null if the two views are equal
 * (the server then sends nothing at all, so a player gets no hint that
 * something happened out of sight).
 *
 * `turn`, `players`, `units` and `cities` are each included whole if they
 * differ; `tiles` lists only the tiles that differ, in ascending order.
 *
 * Both views must be of the same player and the same map; anything else is a
 * programming error and throws.
 */
export function diffViews(previous: PlayerView, next: PlayerView): ViewPatch | null {
  if (previous.you !== next.you || previous.width !== next.width || previous.height !== next.height) {
    throw new Error('diffViews: the two views are not of the same player and map');
  }

  const patch: ViewPatch = {};
  let changed = false;

  if (previous.turn !== next.turn) {
    patch.turn = next.turn;
    changed = true;
  }
  if (!jsonEqual(previous.players, next.players)) {
    patch.players = next.players;
    changed = true;
  }
  if (!jsonEqual(previous.units, next.units)) {
    patch.units = next.units;
    changed = true;
  }
  if (!jsonEqual(previous.cities, next.cities)) {
    patch.cities = next.cities;
    changed = true;
  }

  // Tiles are compared with jsonEqual, like every other section, and not
  // field by field: a field added to TileView later (improvements, roads...)
  // is then covered without anybody having to remember this function.
  const tiles: NonNullable<ViewPatch['tiles']> = [];
  for (let i = 0; i < next.tiles.length; i++) {
    if (!jsonEqual(previous.tiles[i], next.tiles[i])) tiles.push([i, next.tiles[i]]);
  }
  if (tiles.length > 0) {
    patch.tiles = tiles;
    changed = true;
  }

  return changed ? patch : null;
}

/**
 * The view after the patch. Returns a NEW view object and does not modify
 * `view` (parts that did not change are shared with it, which is fine
 * because views are never edited in place).
 *
 * For any two views a and b of the same player:
 *   applyViewPatch(a, diffViews(a, b)) is deep-equal to b.
 */
export function applyViewPatch(view: PlayerView, patch: ViewPatch): PlayerView {
  let tiles = view.tiles;
  if (patch.tiles !== undefined) {
    tiles = view.tiles.slice();
    for (const [index, tile] of patch.tiles) tiles[index] = tile;
  }
  return {
    you: view.you,
    turn: patch.turn ?? view.turn,
    width: view.width,
    height: view.height,
    tiles,
    units: patch.units ?? view.units,
    cities: patch.cities ?? view.cities,
    players: patch.players ?? view.players,
  };
}
