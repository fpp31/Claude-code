/**
 * Where the hover box goes: beside the tile it describes, never on it.
 * Pure arithmetic on rectangles, so it is tested in plain Node.
 */

import type { ScreenRect } from '../render/api';

/** Free space kept between the hovered tile and the box, in CSS pixels. */
export const HOVER_BOX_GAP = 8;
/** Free space kept between the box and the edges of the map area, in CSS pixels. */
export const HOVER_BOX_EDGE = 8;

/** The four rectangles placeHoverBox works with, all in CSS pixels of the browser window. */
export interface HoverPlacementInput {
  /** The hovered tile on screen (renderer.tileScreenRect). */
  tile: ScreenRect;
  /** The measured size of the box with its words in it. */
  box: { width: number; height: number };
  /** The map canvas on screen (its getBoundingClientRect): the box stays inside it. It starts below the top bar. */
  area: ScreenRect;
  /** What floats over the map and should not be covered: the bottom-left and bottom-right corners (panels, End Turn). */
  obstacles: ScreenRect[];
}

/**
 * The top-left corner for the hover box, or null if it fits nowhere (then
 * no box is shown).
 *
 * `free` is `area` made smaller by HOVER_BOX_EDGE on all four sides. Four
 * places are tried, in this order:
 *  1. right of the tile: left = tile.right + GAP; top = tile.top, moved up
 *     or down just far enough to lie within `free`;
 *  2. left of the tile: left = tile.left - GAP - box.width; top as in 1;
 *  3. above the tile: top = tile.top - GAP - box.height; left = the tile's
 *     middle minus half the box, moved sideways just far enough to lie
 *     within `free`;
 *  4. below the tile: top = tile.bottom + GAP; left as in 3.
 * A place is GOOD if the box lies wholly inside `free` and touches no
 * obstacle. The answer is the first good place; if there is none, the first
 * place that lies wholly inside `free` (it may cover part of a panel);
 * if there is none either, null. By construction no place overlaps `tile`.
 * Results are rounded to whole pixels.
 *
 * The rounding never breaks a promise: a coordinate that keeps the box off
 * the tile is rounded away from the tile (the gap is at least GAP), and one
 * that was moved to lie within `free` is rounded into `free`. With whole
 * numbers coming in, nothing is rounded at all. "Touches" means "has a
 * pixel in common": a box that ends where an obstacle begins is clear of it.
 */
export function placeHoverBox(input: HoverPlacementInput): { left: number; top: number } | null {
  const { tile, box, area, obstacles } = input;
  const free: ScreenRect = {
    left: area.left + HOVER_BOX_EDGE,
    top: area.top + HOVER_BOX_EDGE,
    right: area.right - HOVER_BOX_EDGE,
    bottom: area.bottom - HOVER_BOX_EDGE,
  };

  // Beside the tile the box keeps the tile's top; above and below it the
  // box is centred on the tile. Both are pushed back into `free`.
  const besideTop = within(Math.round(tile.top), Math.ceil(free.top), Math.floor(free.bottom - box.height));
  const centredLeft = within(
    Math.round((tile.left + tile.right) / 2 - box.width / 2),
    Math.ceil(free.left),
    Math.floor(free.right - box.width),
  );
  const places = [
    { left: Math.ceil(tile.right + HOVER_BOX_GAP), top: besideTop },
    { left: Math.floor(tile.left - HOVER_BOX_GAP - box.width), top: besideTop },
    { left: centredLeft, top: Math.floor(tile.top - HOVER_BOX_GAP - box.height) },
    { left: centredLeft, top: Math.ceil(tile.bottom + HOVER_BOX_GAP) },
  ];

  const fitting = places.filter((place) => inside(boxAt(place, box), free));
  const good = fitting.find((place) => obstacles.every((obstacle) => !overlap(boxAt(place, box), obstacle)));
  return good ?? fitting[0] ?? null;
}

/** `value`, moved just far enough to lie between `low` and `high`. (If they cross, `low` wins; the place then does not fit and is dropped.) */
function within(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/** The rectangle a box of this size covers with its top-left corner at `place`. */
function boxAt(place: { left: number; top: number }, box: { width: number; height: number }): ScreenRect {
  return { left: place.left, top: place.top, right: place.left + box.width, bottom: place.top + box.height };
}

/** Does `inner` lie wholly inside `outer`? */
function inside(inner: ScreenRect, outer: ScreenRect): boolean {
  return inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;
}

/** Do the two rectangles have a pixel in common? */
function overlap(a: ScreenRect, b: ScreenRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
