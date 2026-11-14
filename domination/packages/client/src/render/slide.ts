/**
 * The one animation of phase 1 (work package WP5): a unit that has a new
 * tile in the next view slides there from its old tile instead of jumping.
 * Purely cosmetic: nothing waits for it, and hit testing always uses the
 * real positions. Pure: the renderer supplies the time.
 */

import { tileCoord } from '@domination/shared';
import type { PlayerView, UnitId } from '@domination/shared';
import { tileOrigin } from './geometry';

/** How long a slide takes, in milliseconds. */
export const SLIDE_MS = 180;

export interface Slide {
  unitId: UnitId;
  /** Where the unit starts, in art pixels relative to where it belongs now. */
  fromDx: number;
  fromDy: number;
  /** When the slide began (milliseconds, same clock as the `now` of slideOffset). */
  startedAt: number;
}

/**
 * The slides to start when `next` replaces `previous`: one for every unit
 * that is in both views on different tiles. None if the two views are not
 * of the same map.
 */
export function startSlides(previous: PlayerView, next: PlayerView, now: number): Slide[] {
  if (previous.width !== next.width || previous.height !== next.height) return [];
  const oldTiles = new Map(previous.units.map((unit) => [unit.id, unit.tile]));
  const slides: Slide[] = [];
  for (const unit of next.units) {
    const oldTile = oldTiles.get(unit.id);
    if (oldTile === undefined || oldTile === unit.tile) continue;
    const from = tileOrigin(tileCoord(oldTile, next));
    const to = tileOrigin(tileCoord(unit.tile, next));
    slides.push({ unitId: unit.id, fromDx: from.px - to.px, fromDy: from.py - to.py, startedAt: now });
  }
  return slides;
}

/**
 * How far a sliding unit is from its real position at time `now`, in art
 * pixels, or null once the slide is over. It starts fast and settles gently.
 */
export function slideOffset(slide: Slide, now: number): { dx: number; dy: number } | null {
  const progress = (now - slide.startedAt) / SLIDE_MS;
  if (progress >= 1) return null;
  const left = (1 - Math.max(0, progress)) ** 2;
  return { dx: slide.fromDx * left, dy: slide.fromDy * left };
}
