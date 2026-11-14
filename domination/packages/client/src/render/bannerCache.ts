/**
 * Finished banner pictures, kept for reuse (work package WP5).
 *
 * Writing a banner letter by letter takes a few hundred small rectangles.
 * A banner looks the same in every frame until the city's name, population
 * or the zoom changes, so each one is drawn once onto a small canvas of its
 * own and copied from there afterwards.
 */

import type { CivId } from '@domination/shared';
import { context2d } from '../sprites/canvas';
import { bannerFrame, bannerLayout, bannerScale, bannerSize, drawBanner } from './banner';
import { ownerColors } from './owners';

/** When this many banners are kept, the store is emptied and starts again (a simple way to forget old ones). */
const MOST_KEPT = 300;

export interface BannerCache {
  /** The picture of one banner as it looks at a zoom. `fogged`: the banner of a remembered city. */
  get(name: string, population: number, civ: CivId | undefined, fogged: boolean, zoom: number): HTMLCanvasElement;
}

export function createBannerCache(): BannerCache {
  const kept = new Map<string, HTMLCanvasElement>();

  return {
    get(name, population, civ, fogged, zoom) {
      const key = `${name}|${population}|${civ ?? 'neutral'}|${fogged}|${zoom}`;
      const ready = kept.get(key);
      if (ready !== undefined) return ready;

      const layout = bannerLayout(name, population);
      const scale = bannerScale(zoom);
      const frame = bannerFrame(zoom);
      const size = bannerSize(layout, scale, frame);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      drawBanner(context2d(canvas), layout, ownerColors(civ), fogged, 0, 0, scale, frame);

      if (kept.size >= MOST_KEPT) kept.clear();
      kept.set(key, canvas);
      return canvas;
    },
  };
}
