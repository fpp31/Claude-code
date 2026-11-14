/**
 * Small helpers for pictures held as plain RGBA bytes (work package WP5).
 * Pure: no canvas, so everything built from them can be tested in Node.
 */

import type { RasterImage } from './format';
import type { Rgba } from './color';

/** A fully transparent picture of the given size. */
export function createImage(width: number, height: number): RasterImage {
  return { width, height, pixels: new Uint8ClampedArray(width * height * 4) };
}

/** The colour of one pixel. (x, y) must be inside the picture. */
export function getPixel(image: RasterImage, x: number, y: number): Rgba {
  const at = (y * image.width + x) * 4;
  return [image.pixels[at], image.pixels[at + 1], image.pixels[at + 2], image.pixels[at + 3]];
}

/**
 * Paints one pixel "source over": an opaque colour replaces what is there, a
 * transparent one changes nothing, and anything in between is blended over
 * what is underneath (which may itself be partly transparent).
 */
export function blendPixel(image: RasterImage, x: number, y: number, color: Rgba): void {
  const at = (y * image.width + x) * 4;
  const pixels = image.pixels;
  const sourceAlpha = color[3] / 255;
  if (sourceAlpha === 0) return;
  const underAlpha = (pixels[at + 3] / 255) * (1 - sourceAlpha);
  const alpha = sourceAlpha + underAlpha;
  for (let channel = 0; channel < 3; channel++) {
    pixels[at + channel] = (color[channel] * sourceAlpha + pixels[at + channel] * underAlpha) / alpha;
  }
  pixels[at + 3] = alpha * 255;
}

/**
 * Paints `source` onto `target` with its top-left corner at (x, y), blending
 * as blendPixel does. The source must fit inside the target.
 */
export function stampImage(target: RasterImage, source: RasterImage, x: number, y: number): void {
  for (let row = 0; row < source.height; row++) {
    for (let column = 0; column < source.width; column++) {
      blendPixel(target, x + column, y + row, getPixel(source, column, row));
    }
  }
}
