/**
 * Packing many small pictures onto one big one (work package WP5). Pure: no
 * canvas.
 *
 * Why one sheet: the browser draws fastest when all sprites come from a
 * single image, and a later PNG sprite sheet will be laid out the same way.
 */

import type { RasterImage } from './format';
import { createImage, stampImage } from './image';

/** Empty pixels kept between neighbors on the sheet, so one sprite can never bleed into the next. */
const GAP = 1;

export interface PackedImages {
  /** The sheet with every picture on it. */
  sheet: RasterImage;
  /** Top-left corner of each picture on the sheet, in the order the pictures were given. */
  places: { x: number; y: number }[];
}

/**
 * Lays the pictures out left to right in rows ("shelves") on a sheet of the
 * given width; a row is as tall as its tallest picture. Throws if a picture
 * is wider than the sheet.
 */
export function packImages(images: readonly RasterImage[], sheetWidth: number): PackedImages {
  const places: { x: number; y: number }[] = [];
  let x = GAP;
  let y = GAP;
  let shelfHeight = 0;
  for (const image of images) {
    if (image.width + 2 * GAP > sheetWidth) {
      throw new Error(`a picture ${image.width} wide does not fit on a sprite sheet ${sheetWidth} wide`);
    }
    if (x + image.width + GAP > sheetWidth) {
      // This shelf is full: start the next one below it.
      x = GAP;
      y += shelfHeight + GAP;
      shelfHeight = 0;
    }
    places.push({ x, y });
    x += image.width + GAP;
    shelfHeight = Math.max(shelfHeight, image.height);
  }

  const sheet = createImage(sheetWidth, y + shelfHeight + GAP);
  images.forEach((image, index) => stampImage(sheet, image, places[index].x, places[index].y));
  return { sheet, places };
}
