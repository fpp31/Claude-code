/**
 * How far the map steps aside for its own panels: the arithmetic behind
 * "STEPPING ASIDE" in ui/gameScreen.ts. Pure arithmetic on rectangles, like
 * ui/hoverPlacement.ts, so it is tested in plain Node; the game screen
 * measures the rectangles and pans the map by what these functions answer.
 *
 * The marked tile (the selected unit or city, or the tile whose card is
 * open) is IN THE OPEN when its middle lies on the map, at least
 * REVEAL_MARGIN from each of the map's four edges, and not under a corner
 * panel or closer to one than the margin. Stepping aside brings it there in
 * two pans: first sideways (sidewaysStep), then up or down (upOrDownStep).
 * Two pans, because the camera may stop at the map's edge on the way: the
 * game screen looks where the tile really is before it asks for the second.
 */

import type { ScreenPoint, ScreenRect } from '../render/api';

/** The marked tile is kept at least this far (in CSS pixels, about one tile) clear of the panels and of the map's edges. */
export const REVEAL_MARGIN = 44;

/**
 * When the map steps aside it aims this much further than the margin asks
 * for. The camera is drawn on whole device pixels, so a tile can land a
 * fraction of a pixel short of where it was sent; with this to spare it is
 * in the open for certain afterwards.
 */
export const REVEAL_SLACK = 1;

/** What is around the marked tile, all in CSS pixels of the browser window. */
export interface RevealSurroundings {
  /** The map canvas on screen (its getBoundingClientRect). */
  map: ScreenRect;
  /** The corner bottom left, where the unit panel, the city panel and the tile card open. Without a size it covers nothing. */
  leftCorner: ScreenRect;
  /** The corner bottom right: zoom, "Show me" and End Turn. */
  rightCorner: ScreenRect;
}

/** Does the corner have a size? (An empty corner, with no panel open, is a box of nothing.) */
function hasSize(corner: ScreenRect): boolean {
  return corner.right > corner.left && corner.bottom > corner.top;
}

/**
 * How far down the screen a tile at this x may sit: the map's bottom edge
 * less the margin, or, where a corner covers this x (with the margin on
 * both sides), that corner's top less the margin.
 */
export function lowestUncoveredY(x: number, around: RevealSurroundings): number {
  let lowest = around.map.bottom - REVEAL_MARGIN;
  for (const corner of [around.leftCorner, around.rightCorner]) {
    if (!hasSize(corner)) continue;
    if (x > corner.left - REVEAL_MARGIN && x < corner.right + REVEAL_MARGIN) lowest = Math.min(lowest, corner.top - REVEAL_MARGIN);
  }
  return lowest;
}

/** The highest a tile may sit: the map's top edge plus the margin. */
function highestY(around: RevealSurroundings): number {
  return around.map.top + REVEAL_MARGIN;
}

/** Is a tile whose middle is at `point` in the open? (See the top of this file.) */
export function isInTheOpen(point: ScreenPoint, around: RevealSurroundings): boolean {
  if (point.x < around.map.left + REVEAL_MARGIN || point.x > around.map.right - REVEAL_MARGIN) return false;
  if (point.y < highestY(around)) return false;
  return point.y <= lowestUncoveredY(point.x, around);
}

/**
 * The first step: how far the map must be panned SIDEWAYS (positive: to the
 * right) to bring a tile at `point` to an x where it can be in the open; 0
 * if it need not move sideways; null if no x of the map has room (panels
 * from edge to edge, as tall as the map): the map is then left alone.
 *
 *  1. A tile beyond a side edge of the map, or closer to it than the
 *     margin, goes back to the margin (a window that got narrower, a phone
 *     that was turned, used to leave the selected city off the screen with
 *     its panel still open). A map narrower than two margins has no such
 *     place: the tile goes to its middle.
 *  2. If there is no room above the panels at that x (a tall panel, a low
 *     window), it goes on to the nearest x that has room: just right of
 *     the left corner, or just left of the right corner.
 */
export function sidewaysStep(point: ScreenPoint, around: RevealSurroundings): number | null {
  const { map, leftCorner, rightCorner } = around;
  const low = map.left + REVEAL_MARGIN;
  const high = map.right - REVEAL_MARGIN;
  const fits = (x: number): boolean => (low + REVEAL_SLACK <= high - REVEAL_SLACK ? x >= low && x <= high : true);

  let x = point.x;
  if (low + REVEAL_SLACK > high - REVEAL_SLACK) x = (map.left + map.right) / 2;
  else if (x < low) x = low + REVEAL_SLACK;
  else if (x > high) x = high - REVEAL_SLACK;

  if (lowestUncoveredY(x, around) <= highestY(around)) {
    const roomy = [leftCorner.right + REVEAL_MARGIN + REVEAL_SLACK, rightCorner.left - REVEAL_MARGIN - REVEAL_SLACK]
      .filter((candidate) => fits(candidate) && lowestUncoveredY(candidate, around) > highestY(around))
      .sort((a, b) => Math.abs(a - x) - Math.abs(b - x));
    if (roomy.length === 0) return null;
    x = roomy[0];
  }
  return x - point.x;
}

/**
 * The second step: how far the map must be panned UP OR DOWN (positive:
 * down) to bring a tile at `point` into the open at the x it has; 0 if it is
 * high and low enough already, and 0 if there is no room at this x at all
 * (the camera stopped at the map's edge on the way: nothing more can be
 * done).
 */
export function upOrDownStep(point: ScreenPoint, around: RevealSurroundings): number {
  const highest = highestY(around);
  const lowest = lowestUncoveredY(point.x, around);
  if (lowest <= highest) return 0;
  if (point.y > lowest) return lowest - REVEAL_SLACK - point.y;
  if (point.y < highest) return highest + REVEAL_SLACK - point.y;
  return 0;
}
